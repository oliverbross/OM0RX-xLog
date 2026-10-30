// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "skimmer.h"
#include "job_order.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <random>
#include <sstream>
#include <thread>
#include <iomanip>

namespace cw {
namespace {
std::string uuid() {
  std::random_device random;
  std::array<uint8_t,16> bytes{};
  for(auto& byte:bytes) byte=uint8_t(random());
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  std::ostringstream out; out<<std::hex<<std::setfill('0');
  for(size_t i=0;i<16;++i) { if(i==4||i==6||i==8||i==10) out<<'-'; out<<std::setw(2)<<unsigned(bytes[i]); }
  return out.str();
}
struct Track {
  const std::string id=uuid();
  const uint64_t origin;
  const bool replay;
  std::atomic<bool> valid{true};
  std::atomic<bool> muted{false};
  std::atomic<uint64_t> revision{0};
  double offset;
  Channelizer channel;
  uint64_t last_peak=0,next_job=19200;
  std::vector<float> audio;
  double peak_envelope=0,envelope_sum=0;
  size_t envelope_samples=0,rises=0,falls=0;
  size_t ambiguity_hits=0;
  size_t separated_hits=0;
  bool keyed=false,ambiguous=false,spectral_ambiguity=false,association_conflict=false;
  KeyingSpeed speed;
  std::optional<double> snr{};
  Track(int rate,double offset,uint64_t origin,bool replay):origin(origin),replay(replay),offset(offset),channel(rate,offset) {}
  bool cw_keying() const { return rises>=2 && falls>=2; }
  void append(const std::vector<std::complex<float>>& iq) {
    const auto samples=channel.process(iq);
    audio.insert(audio.end(),samples.begin(),samples.end());
    if(audio.size()>32000) audio.erase(audio.begin(),audio.begin()+std::ptrdiff_t(audio.size()-32000));
    for(float f:samples) {
      envelope_sum+=double(f)*f;
      if(++envelope_samples==40) {
        const double power=envelope_sum/40;
        peak_envelope=std::max(peak_envelope*0.999,power);
        const bool on=power>1e-10 && power>peak_envelope*0.2;
        speed.tick(on);
        if(on && !keyed) rises=std::min(size_t(100),rises+1);
        if(!on && keyed) falls=std::min(size_t(100),falls+1);
        keyed=on; envelope_sum=0; envelope_samples=0;
      }
    }
  }
};
struct Span {
  struct Candidate { double offset; uint64_t first,last; size_t hits; };
  uint64_t epoch,sequence=0,sample=0;
  int rate;
  bool replay;
  double lower,upper;
  std::vector<std::complex<float>> analysis;
  std::vector<std::complex<float>> history;
  std::vector<std::shared_ptr<Track>> tracks;
  std::vector<Candidate> candidates;
};
struct Job {
  std::shared_ptr<Track> track;
  std::string token;
  uint64_t epoch,revision,first,end;
  std::vector<float> audio;
  double offset;
  std::optional<double> snr{},wpm{};
  std::chrono::steady_clock::time_point enqueued{};
};
struct QueuedEvent {
  SkimmerEvent event;
  std::weak_ptr<Track> track;
  uint64_t revision=0;
  size_t bytes() const { return 256+event.copy.text.size()+event.copy.tokens.size()*128; }
};
}
struct Skimmer::Impl {
  Engine& engine;
  const size_t cap;
  std::map<std::string,Span> spans; // only ingress caller mutates source/track state
  std::mutex jobs_mutex,events_mutex;
  std::condition_variable work,idle;
  std::map<std::string,Job> pending;
  JobOrder order;
  std::set<std::string> busy;
  std::deque<QueuedEvent> output;
  std::vector<std::thread> threads;
  size_t in_flight=0,output_bytes=0;
  uint64_t coalesced=0,dropped=0;
  bool stopping=false;
  Impl(Engine& engine,size_t workers,size_t cap):engine(engine),cap(cap) {
    if(workers<1 || workers>4 || cap<1 || cap>16) throw std::invalid_argument("CW capacity outside fixed profile");
    for(size_t i=0;i<workers;++i) threads.emplace_back([this]{run();});
  }
  ~Impl() {
    for(auto& source:spans) for(auto& track:source.second.tracks) track->valid=false;
    { std::lock_guard<std::mutex> lock(jobs_mutex); stopping=true; pending.clear(); order.clear(); }
    work.notify_all();
    for(auto& thread:threads) thread.join();
  }
  void emit(SkimmerEvent event,const std::shared_ptr<Track>& track={},std::optional<uint64_t> revision={}) {
    if(track) { event.source_first_sample=track->origin; event.filter_delay_seconds=track->channel.group_delay_seconds(); event.replay=track->replay; }
    QueuedEvent item{std::move(event),track,revision.value_or(track?track->revision.load():0)};
    item.event.track_revision=item.revision;
    std::lock_guard<std::mutex> lock(events_mutex);
    const auto invalidate_lost=[&](const QueuedEvent& lost) {
      // Missing derived copy is a text-evidence discontinuity even though the
      // IQ clock itself remained continuous. Every later decode carries the
      // new revision, including when its explicit notification is also lost.
      if(auto affected=lost.track.lock()) {
        ++affected->revision;
        if(affected==track) {
          item.revision=affected->revision;item.event.track_revision=item.revision;
          if(item.event.kind=="track" && item.event.state=="overloaded") {
            item.event.first_sample=item.event.end_sample=std::max(item.event.end_sample,lost.event.end_sample);
          }
        }
      }
    };
    // Coalesce superseded derived copy, not transmitted occurrence identities.
    if(item.event.kind=="decode") {
      auto old=std::find_if(output.begin(),output.end(),[&](const auto& value){
        return value.event.kind=="decode" && value.event.track_id==item.event.track_id;
      });
      if(old!=output.end()) { invalidate_lost(*old);output_bytes-=old->bytes(); output.erase(old); ++dropped; }
    }
    while(!output.empty() && (output.size()>=64 || output_bytes+item.bytes()>1024*1024)) {
      invalidate_lost(output.front());output_bytes-=output.front().bytes(); output.pop_front(); ++dropped;
    }
    output_bytes+=item.bytes(); output.push_back(std::move(item));
  }
  void enqueue(Job job) {
    job.enqueued=std::chrono::steady_clock::now();
    std::lock_guard<std::mutex> lock(jobs_mutex);
    const auto id=job.track->id;
    if(pending.count(id)) {
      const auto lost_end=pending.at(id).end;
      ++job.track->revision;++coalesced;
      emit({"track",job.token,id,"overloaded",job.epoch,lost_end,lost_end,job.track->offset,false,{}},job.track);
      job.revision=job.track->revision;
      pending[id]=std::move(job);
    }
    else { order.push(id); pending.emplace(id,std::move(job)); }
    work.notify_one();
  }
  void run() {
    while(true) {
      Job job;
      {
        std::unique_lock<std::mutex> lock(jobs_mutex);
        work.wait(lock,[this]{return stopping || order.ready([this](const auto& id){return !busy.count(id);});});
        if(stopping) return;
        const auto next=order.take([this](const auto& id){return !busy.count(id);});
        if(!next) continue;
        const auto id=*next;
        auto found=pending.find(id);
        if(found==pending.end()) continue;
        job=std::move(found->second); pending.erase(found); busy.insert(id); ++in_flight;
      }
      if(job.track->valid && !job.track->muted && job.track->revision==job.revision) {
        try {
          const double queue_ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-job.enqueued).count();
          auto copy=engine.decode(job.audio,job.first);
          if(job.track->valid && !job.track->muted && job.track->revision==job.revision) {
            SkimmerEvent event{"decode",job.token,job.track->id,"provisional",job.epoch,job.first,job.end,job.offset,false,std::move(copy)};
            event.estimated_snr_db=job.snr;event.estimated_wpm=job.wpm;
            event.queue_wait_ms=queue_ms;
            emit(std::move(event),job.track,job.revision);
          }
        } catch(...) {
          job.track->valid=false;
          emit({"fault",job.token,job.track->id,"inference_failed",job.epoch,0,0,0,false,{}},job.track);
        }
      }
      {
        std::lock_guard<std::mutex> lock(jobs_mutex); --in_flight; busy.erase(job.track->id);
        if(pending.empty() && in_flight==0) idle.notify_all();
      }
      work.notify_all();
    }
  }
  void retire(const std::string& token,Span& span,const std::shared_ptr<Track>& track) {
    track->valid=false;
    { std::lock_guard<std::mutex> lock(jobs_mutex); pending.erase(track->id); order.remove(track->id); }
    emit({"retired",token,track->id,"retired",span.epoch,0,0,track->offset,false,{}},track);
  }
};
Skimmer::Skimmer(Engine& engine,size_t workers,size_t cap):impl(std::make_unique<Impl>(engine,workers,cap)) {}
Skimmer::~Skimmer()=default;
void Skimmer::open(const std::string& token,uint64_t epoch,int rate,double lower,double upper,bool replay) {
  if(token.size()!=32 || !std::all_of(token.begin(),token.end(),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');}) ||
     (rate!=24000&&rate!=48000&&rate!=96000&&rate!=192000&&rate!=384000) ||
     !std::isfinite(lower)||!std::isfinite(upper)||lower>=upper||lower<-rate/2.0||upper>rate/2.0)
    throw std::invalid_argument("Invalid IQ stream descriptor");
  if(impl->spans.count(token)) end(token);
  if(impl->spans.size()>=2) throw std::runtime_error("Two-span capacity reached");
  impl->spans.emplace(token,Span{epoch,0,0,rate,replay,lower,upper,{},{},{},{}});
  SkimmerEvent event{"stream",token,"","acquiring",epoch,0,0,0,false,{}}; event.replay=replay;
  impl->emit(std::move(event));
}
void Skimmer::end(const std::string& token) {
  auto found=impl->spans.find(token); if(found==impl->spans.end()) return;
  for(auto& track:found->second.tracks) impl->retire(token,found->second,track);
  impl->spans.erase(found);
}
bool Skimmer::mute(const std::string& token,uint64_t epoch,const std::string& id) {
  const auto found=impl->spans.find(token);
  if(found==impl->spans.end() || found->second.epoch!=epoch) return false;
  auto& span=found->second;
  const auto match=std::find_if(span.tracks.begin(),span.tracks.end(),[&](const auto& track){return track->id==id && track->valid;});
  if(match==span.tracks.end()) return false;
  const auto& track=*match;track->muted=true;
  { std::lock_guard<std::mutex> lock(impl->jobs_mutex);
    impl->pending.erase(id);impl->order.remove(id);
    if(impl->pending.empty() && impl->in_flight==0) impl->idle.notify_all(); }
  impl->emit({"track",token,id,"muted",span.epoch,0,0,track->offset,false,{}},track);
  return true;
}
bool Skimmer::focus(const std::string& token,uint64_t epoch,const std::string& id,uint64_t revision) {
  const auto found=impl->spans.find(token);
  if(found==impl->spans.end() || found->second.epoch!=epoch) return false;
  const auto& tracks=found->second.tracks;
  const auto match=std::find_if(tracks.begin(),tracks.end(),[&](const auto& track){return track->id==id && track->valid && !track->muted && track->revision==revision;});
  if(match==tracks.end()) return false;
  { std::lock_guard<std::mutex> lock(impl->jobs_mutex);impl->order.focus(id); }
  impl->work.notify_all();return true;
}
void Skimmer::clear_focus() {
  std::lock_guard<std::mutex> lock(impl->jobs_mutex);impl->order.focus("");
}
void Skimmer::feed(const std::string& token,uint64_t epoch,uint64_t sequence,uint64_t first,
                   int actualRate,const std::vector<std::complex<float>>& iq) {
  auto found=impl->spans.find(token);
  if(found==impl->spans.end()) throw std::invalid_argument("StreamOpen required before IQ");
  auto& span=found->second;
  if(epoch!=span.epoch || actualRate!=span.rate || sequence!=span.sequence || first!=span.sample || sequence==UINT64_MAX ||
     iq.empty() || iq.size()>size_t(span.rate/8) || iq.size()>16384 || iq.size()>UINT64_MAX-first ||
     std::any_of(iq.begin(),iq.end(),[](const auto& f){return !std::isfinite(f.real())||!std::isfinite(f.imag());})) {
    SkimmerEvent event{"fault",token,"","discontinuity",span.epoch,0,0,0,false,{}}; event.replay=span.replay;
    impl->emit(std::move(event));
    end(token); return;
  }
  ++span.sequence; span.sample+=iq.size();
  span.history.insert(span.history.end(),iq.begin(),iq.end());
  if(span.history.size()>size_t(span.rate)) span.history.erase(span.history.begin(),span.history.begin()+std::ptrdiff_t(span.history.size()-span.rate));
  for(auto& track:span.tracks) if(track->valid && !track->muted) track->append(iq);
  span.analysis.insert(span.analysis.end(),iq.begin(),iq.end());
  size_t admitted=0;
  while(span.analysis.size()>=8192) {
    const std::vector<std::complex<float>> window(span.analysis.begin(),span.analysis.begin()+8192);
    const auto peaks=carriers(window,span.rate,span.lower,span.upper,impl->cap+8);
    const uint64_t windowEnd=span.sample-span.analysis.size()+8192;
    span.candidates.erase(std::remove_if(span.candidates.begin(),span.candidates.end(),[&](const auto& c){
      return windowEnd-c.last>uint64_t(span.rate)/2;
    }),span.candidates.end());
    for(const auto& peak:peaks) {
      if(std::abs(peak.offset_hz)>span.rate/2.0-400) continue;
      auto match=std::find_if(span.tracks.begin(),span.tracks.end(),[&](const auto& track){return track->valid && std::abs(track->offset-peak.offset_hz)<75;});
      if(match!=span.tracks.end()) {
        auto& track=**match;
        bool neighbour=false,separated=true;
        for(const auto& other:span.tracks) if(other!=*match && other->valid) {
          const double distance=std::abs(other->offset-peak.offset_hz);
          if(distance<300) separated=false;
          if(distance<250) {neighbour=true;other->association_conflict=true;other->separated_hits=0;}
        }
        if(neighbour) {track.association_conflict=true;track.separated_hits=0;}
        else if(!peak.ambiguous && separated) {
          // CW edge/sideband jitter must not clear a known collision at the
          // grouping boundary. Require the declared 300-Hz initial separation
          // and three fresh observations before re-establishing this track.
          track.separated_hits=std::min(size_t(3),track.separated_hits+1);
          if(track.separated_hits>=3) track.association_conflict=false;
        } else track.separated_hits=0;
        const bool isolated=!peak.ambiguous && !track.ambiguous && !neighbour;
        if(isolated) {
          // Follow this isolated carrier without resetting its NCO/FIR clock.
          // Inference receives the observed offset with its exact input window,
          // never a later mutable frequency read from a worker thread.
          track.channel.retune(peak.offset_hz);track.offset=peak.offset_hz;
        }
        track.last_peak=windowEnd;
        track.snr=peak.estimated_snr_db(span.rate);
        track.ambiguity_hits=peak.ambiguous?std::min(size_t(3),track.ambiguity_hits+1):0;
        track.spectral_ambiguity=track.ambiguity_hits>=3;
        continue;
      }
      auto candidate=std::find_if(span.candidates.begin(),span.candidates.end(),[&](const auto& c){return std::abs(c.offset-peak.offset_hz)<50;});
      if(candidate==span.candidates.end()) {
        if(span.candidates.size()<128) span.candidates.push_back({peak.offset_hz,windowEnd,windowEnd,1});
        continue;
      }
      candidate->last=windowEnd; ++candidate->hits;
      if(candidate->hits<3 || windowEnd-candidate->first<uint64_t(span.rate)/20) continue;
      // Bound history priming when many carriers appear together. A single
      // input block cannot create and backfill all sixteen channelizers.
      if(span.tracks.size()>=impl->cap || admitted>=1) continue;
      auto track=std::make_shared<Track>(span.rate,peak.offset_hz,span.sample-span.history.size(),span.replay); track->last_peak=windowEnd;
      track->snr=peak.estimated_snr_db(span.rate);
      track->ambiguity_hits=peak.ambiguous?1:0;
      for(size_t at=0;at<span.history.size();at+=8192) {
        const std::vector<std::complex<float>> before(span.history.begin()+std::ptrdiff_t(at),
            span.history.begin()+std::ptrdiff_t(std::min(at+8192,span.history.size())));
        track->append(before);
      }
      span.tracks.push_back(track);
      ++admitted;
      impl->emit({"track",token,track->id,"acquiring",span.epoch,0,0,track->offset,false,{}},track);
    }
    span.analysis.erase(span.analysis.begin(),span.analysis.begin()+4096);
  }
  for(auto& track:span.tracks) {
    const bool collision=track->spectral_ambiguity || track->association_conflict || std::any_of(span.tracks.begin(),span.tracks.end(),[&](const auto& other){return other!=track && other->valid && std::abs(other->offset-track->offset)<250;});
    if(collision!=track->ambiguous) {
      track->ambiguous=collision; ++track->revision;
      const auto fence=track->channel.output_samples();
      impl->emit({"track",token,track->id,collision?"ambiguous":"acquiring",span.epoch,fence,fence,track->offset,collision,{}},track);
    }
    if(span.sample-track->last_peak>uint64_t(span.rate)*12 || !track->valid) { impl->retire(token,span,track); continue; }
    if(track->muted) continue;
    const auto last=track->channel.output_samples();
    if(!collision && track->cw_keying() && last>=track->next_job && track->audio.size()>=19200) {
      track->next_job=last+3200;
      // Filter delay remains explicitly reported; absolute channel indices are
      // tied to this track acquisition, not synthesized hardware timestamps.
      impl->enqueue({track,token,span.epoch,track->revision,last-track->audio.size(),last,track->audio,track->offset,
          span.sample-track->last_peak<uint64_t(span.rate)/2 ? track->snr:std::nullopt,track->speed.estimate()});
    }
  }
  span.tracks.erase(std::remove_if(span.tracks.begin(),span.tracks.end(),[](const auto& t){return !t->valid;}),span.tracks.end());
}
std::vector<SkimmerEvent> Skimmer::events() {
  std::lock_guard<std::mutex> lock(impl->events_mutex);
  std::vector<SkimmerEvent> result;
  for(auto& item:impl->output) {
    if(item.event.kind=="decode") {
      const auto track=item.track.lock();
      if(!track || !track->valid || track->muted || track->revision!=item.revision) continue;
    }
    result.push_back(std::move(item.event));
  }
  impl->output.clear(); impl->output_bytes=0; return result;
}
void Skimmer::stop() {
  while(!impl->spans.empty()) end(impl->spans.begin()->first);
}
bool Skimmer::wait_idle(double seconds) {
  std::unique_lock<std::mutex> lock(impl->jobs_mutex);
  return impl->idle.wait_for(lock,std::chrono::duration<double>(seconds),[this]{return impl->pending.empty()&&impl->in_flight==0;});
}
SkimmerMetrics Skimmer::metrics() {
  size_t tracks=0; for(const auto& source:impl->spans) tracks+=source.second.tracks.size();
  std::scoped_lock lock(impl->jobs_mutex,impl->events_mutex);
  return {impl->spans.size(),tracks,impl->pending.size(),impl->in_flight,impl->coalesced,impl->dropped};
}
}
