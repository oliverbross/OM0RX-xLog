// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "engine.h"
#include "skimmer.h"
#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <fstream>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace {
std::mutex outputMutex;
uint64_t le(const uint8_t* p,size_t n) { uint64_t v=0; for(size_t i=0;i<n;++i) v|=uint64_t(p[i])<<(8*i); return v; }
bool readExact(char* out,size_t count,bool eofOK=false) {
  std::cin.read(out,std::streamsize(count));
  if (eofOK && std::cin.gcount()==0 && std::cin.eof()) return false;
  if (size_t(std::cin.gcount())!=count) throw std::runtime_error("Truncated worker frame");
  return true;
}
std::string hex(const uint8_t* p,size_t n) {
  const char* alphabet="0123456789abcdef"; std::string s;
  for(size_t i=0;i<n;++i) { s+=alphabet[p[i]>>4]; s+=alphabet[p[i]&15]; } return s;
}
// Model alphabet is ASCII and has no quotes, slash escapes or controls.
void output(const cw::Decode& d,const std::vector<uint8_t>& h) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout<<"{\"type\":\"decode\",\"stream_token\":\""<<hex(h.data()+4,16)
    <<"\",\"epoch\":\""<<le(h.data()+20,8)<<"\",\"sequence\":\""<<le(h.data()+28,8)
    <<"\",\"first_sample\":\""<<le(h.data()+36,8)<<"\",\"text\":\""<<d.text
    <<"\",\"inference_ms\":"<<d.inference_ms<<",\"tokens\":[";
  bool comma=false;
  for(const auto& t:d.tokens) {
    if(comma) std::cout<<','; comma=true;
    std::cout<<"{\"symbol\":\""<<t.symbol<<"\",\"first_sample\":\""<<t.first_sample
      <<"\",\"end_sample\":\""<<t.end_sample<<"\",\"log_score\":"<<t.log_score<<'}';
  }
  std::cout<<"]}"<<std::endl;
}
void outputEvent(const cw::SkimmerEvent& e) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout<<"{\"type\":\""<<e.kind<<"\",\"stream_token\":\""<<e.stream_token
    <<"\",\"epoch\":\""<<e.epoch<<"\",\"track_id\":\""<<e.track_id<<"\",\"state\":\""<<e.state
    <<"\",\"first_sample\":\""<<e.first_sample<<"\",\"end_sample\":\""<<e.end_sample
    <<"\",\"source_first_sample\":\""<<e.source_first_sample<<"\",\"filter_delay_seconds\":"<<e.filter_delay_seconds
    <<",\"track_revision\":\""<<e.track_revision<<'"'
    <<",\"offset_hz\":"<<e.offset_hz<<",\"ambiguous\":"<<(e.ambiguous?"true":"false")
    <<",\"replay\":"<<(e.replay?"true":"false");
  if(e.kind=="decode") {
    if(e.estimated_snr_db) std::cout<<",\"estimated_snr_db\":"<<*e.estimated_snr_db<<",\"snr_reference_hz\":2500";
    if(e.estimated_wpm) std::cout<<",\"estimated_wpm\":"<<*e.estimated_wpm;
    std::cout<<",\"text\":\""<<e.copy.text<<"\",\"inference_ms\":"<<e.copy.inference_ms<<",\"tokens\":[";
    bool comma=false;
    for(const auto& t:e.copy.tokens) {
      if(comma) std::cout<<','; comma=true;
      std::cout<<"{\"symbol\":\""<<t.symbol<<"\",\"first_sample\":\""<<t.first_sample
        <<"\",\"end_sample\":\""<<t.end_sample<<"\",\"log_score\":"<<t.log_score;
      if(t.rf) std::cout<<",\"rf_offset_hz\":"<<t.rf->offset_hz<<",\"rf_sample\":\""<<t.rf->sample<<'"';
      std::cout<<'}';
    }
    std::cout<<']';
  }
  std::cout<<'}'<<std::endl;
}
class EventWriter {
  cw::Skimmer& skimmer;
  std::atomic<bool> done{false};
  std::mutex flushMutex;
  std::thread thread;
 public:
  explicit EventWriter(cw::Skimmer& s):skimmer(s),thread([this]{
    while(!done) { flush(); std::this_thread::sleep_for(std::chrono::milliseconds(20)); }
    flush();
  }) {}
  void flush() { std::lock_guard<std::mutex> lock(flushMutex); for(const auto& e:skimmer.events()) outputEvent(e); }
  ~EventWriter() { skimmer.stop(); done=true; thread.join(); }
};
}
int main(int argc,char** argv) {
  try {
    if(argc==4 && std::string(argv[1])=="--features") {
      std::ifstream input(argv[2],std::ios::binary|std::ios::ate);
      const auto size=input.tellg();
      if(size<1024 || size>256000 || size%4) throw std::runtime_error("Invalid feature input size");
      input.seekg(0);
      std::vector<float> audio(size_t(size)/4);
      input.read(reinterpret_cast<char*>(audio.data()),size);
      if(!input) throw std::runtime_error("Cannot read feature input");
      const auto data=cw::features(audio);
      std::ofstream output(argv[3],std::ios::binary);
      output.write(reinterpret_cast<const char*>(data.data()),std::streamsize(data.size()*4));
      if(!output) throw std::runtime_error("Cannot write features");
      return 0;
    }
    if(argc!=2) throw std::runtime_error("Usage: xlog-cw-worker /absolute/path/model.onnx");
    cw::Engine engine(argv[1]);
#if defined(__APPLE__)
    constexpr size_t inference_workers=4;
#else
    constexpr size_t inference_workers=2;
#endif
    cw::Skimmer skimmer(engine,inference_workers);
    EventWriter writer(skimmer);
    std::cout<<"{\"type\":\"ready\",\"protocol_version\":1,\"sample_rate\":3200,\"max_spans\":2,"
      <<"\"max_tracks_per_span\":16,\"inference_workers\":"<<inference_workers<<",\"runtime_version\":\""<<cw::Engine::runtime_version()<<"\"}"<<std::endl;
    while(true) {
      std::array<uint8_t,8> prefix{};
      if(!readExact(reinterpret_cast<char*>(prefix.data()),8,true)) {
        if(!skimmer.wait_idle(10)) throw std::runtime_error("Inference did not drain before EOF deadline");
        writer.flush(); return 0;
      }
      if(std::memcmp(prefix.data(),"XCW1",4)) throw std::runtime_error("Invalid protocol magic");
      const auto size=le(prefix.data()+4,4);
      if(size<52 || size>52+16384*8) throw std::runtime_error("Frame exceeds finite sample budget");
      std::vector<uint8_t> frame(size);
      readExact(reinterpret_cast<char*>(frame.data()),size);
      if(le(frame.data(),2)!=1) throw std::runtime_error("Unsupported protocol version");
      const auto kind=le(frame.data()+2,2), count=le(frame.data()+48,4);
      const auto rate=le(frame.data()+44,4), epoch=le(frame.data()+20,8), sequence=le(frame.data()+28,8), first=le(frame.data()+36,8);
      const auto token=hex(frame.data()+4,16);
      if(kind==4 && size==52 && !count) { skimmer.stop(); writer.flush(); return 0; }
      if(kind==7 && size==52 && !count) {
        const auto m=skimmer.metrics(); std::lock_guard<std::mutex> lock(outputMutex);
        std::cout<<"{\"type\":\"status\",\"request_sequence\":\""<<sequence<<"\",\"sources\":"<<m.sources
          <<",\"tracks\":"<<m.tracks<<",\"pending\":"<<m.pending<<",\"in_flight\":"<<m.in_flight
          <<",\"coalesced\":\""<<m.coalesced<<"\",\"dropped_events\":\""<<m.dropped_events<<"\"}"<<std::endl;
        continue;
      }
      if(kind==1 && size==72 && !count && !sequence && !first) {
        double lower,upper; uint64_t lowBits=le(frame.data()+52,8),highBits=le(frame.data()+60,8);
        std::memcpy(&lower,&lowBits,8); std::memcpy(&upper,&highBits,8);
        const auto flags=le(frame.data()+68,4);
        if(flags>1) throw std::runtime_error("Unknown stream flags");
        skimmer.open(token,epoch,int(rate),lower,upper,flags==1); continue;
      }
      if((kind==3||kind==6) && size==52 && !count) { skimmer.end(token); continue; }
      if((kind==8 || kind==9) && size==68 && !count && (kind==9 || !sequence) && !first && !rate) {
        const auto raw=hex(frame.data()+52,16);
        const auto id=raw.substr(0,8)+"-"+raw.substr(8,4)+"-"+raw.substr(12,4)+"-"+raw.substr(16,4)+"-"+raw.substr(20);
        if(kind==8) skimmer.mute(token,epoch,id);else skimmer.focus(token,epoch,id,sequence);continue;
      }
      if(kind==10 && size==52 && !count && !sequence && !first && !rate && !epoch && token==std::string(32,'0')) {skimmer.clear_focus();continue;}
      if(kind==5) {
        if(count==0 || count>16384 || size!=52+count*8) throw std::runtime_error("IQ scalar count mismatch");
        std::vector<std::complex<float>> iq(count);
        for(size_t i=0;i<count;++i) {
          uint32_t a=uint32_t(le(frame.data()+52+i*8,4)),b=uint32_t(le(frame.data()+56+i*8,4));
          float real,imag; std::memcpy(&real,&a,4); std::memcpy(&imag,&b,4); iq[i]={real,imag};
        }
        skimmer.feed(token,epoch,sequence,first,int(rate),iq); continue;
      }
      if(kind!=2 || le(frame.data()+44,4)!=3200 || count<16000 || count>32000 || size!=52+count*4)
        throw std::runtime_error("Unsupported audio frame contract");
      std::vector<float> audio(count);
      for(size_t i=0;i<count;++i) {
        uint32_t bits=uint32_t(le(frame.data()+52+i*4,4));
        std::memcpy(&audio[i],&bits,4);
      }
      output(engine.decode(audio,le(frame.data()+36,8)),frame);
    }
  } catch(const std::exception& error) {
    // Diagnostics never share the machine-readable event stream.
    std::cerr<<"CW worker stopped: "<<error.what()<<'\n'; return 1;
  }
}
