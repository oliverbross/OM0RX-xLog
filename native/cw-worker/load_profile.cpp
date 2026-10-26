// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
// Synthetic replay performance instrument. No radio, network or spot output.
#include "skimmer.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <map>
#include <set>
#include <thread>
#include <sys/resource.h>

namespace {
using Clock=std::chrono::steady_clock;
double milliseconds(Clock::duration value){return std::chrono::duration<double,std::milli>(value).count();}
std::vector<float> envelope(int wpm,const std::string& text) {
  const std::map<char,std::string> code{{'C',"-.-."},{'Q',"--.-"},{'O',"---"},{'M',"--"},{'0',"-----"},{'R',".-."},{'X',"-..-"},
    {'D',"-.."},{'L',".-.."},{'1',".----"},{'A',".-"},{'B',"-..."}};
  std::vector<float> result;
  const auto add=[&](int units,bool on){
    const size_t length=size_t(std::round(3200*1.2/wpm*units));
    for(size_t i=0;i<length;++i)result.push_back(on?float(0.03*std::min(1.0,double(std::min(i,length-1-i))/16)):0);
  };
  for(char character:text) {
    if(character==' '){add(4,false);continue;}
    const auto& symbols=code.at(character);
    for(size_t i=0;i<symbols.size();++i){add(symbols[i]=='-'?3:1,true);if(i+1<symbols.size())add(1,false);}
    add(3,false);
  }
  add(7,false);return result;
}
struct Signal {std::vector<float> key;std::complex<double> oscillator{1,0},step;size_t phase;};
}
int main(int argc,char** argv) {
  try {
    if(argc!=4 && argc!=5) throw std::invalid_argument("Usage: cw-load-profile model.onnx tracks_per_span seconds (10..60) [workers (1..4)]");
    const int count=std::stoi(argv[2]),seconds=std::stoi(argv[3]),rate=96000;
    const int workers=argc==5?std::stoi(argv[4]):2;
    if(count<1 || count>16 || seconds<10 || seconds>60 || workers<1 || workers>4) throw std::invalid_argument("Outside bounded profile");
    cw::Engine engine(argv[1]);cw::Skimmer skimmer(engine,size_t(workers),16);
    const std::string tokens[2]={"00112233445566778899aabbccddeeff","ffeeddccbbaa99887766554433221100"};
    for(int span=0;span<2;++span)skimmer.open(tokens[span],uint64_t(span+1),rate,-39000,39000,true);
    std::vector<Signal> signals[2];
    constexpr double pi=3.14159265358979323846;
    for(int span=0;span<2;++span)for(int index=0;index<count;++index) {
      Signal signal;signal.key=envelope(20+(index%4)*5,index%2?"CQ DL1ABC":"CQ OM0RX");
      signal.step=std::polar(1.0,2*pi*(-22500+index*3000+span*500)/rate);signal.phase=size_t(index%5)*320;
      signals[span].push_back(std::move(signal));
    }
    std::set<std::string> decoded;
    std::vector<double> latencies;
    size_t maximum_tracks=0,maximum_pending=0;
    double maximum_lag=0,generation_ms=0,feed_ms=0;
    bool deadline_missed=false;
    const auto start=Clock::now();
    const auto drain=[&] {
      for(const auto& event:skimmer.events())if(event.kind=="decode") {
        decoded.insert(event.track_id);
        const double expected=double(event.source_first_sample)/rate+double(event.end_sample)/3200;
        latencies.push_back(std::max(0.0,milliseconds(Clock::now()-start)-expected*1000));
      }
      const auto metrics=skimmer.metrics();maximum_tracks=std::max(maximum_tracks,metrics.tracks);maximum_pending=std::max(maximum_pending,metrics.pending);
    };
    uint64_t sequence[2]={0,0},samples_fed=0;
    for(uint64_t first=0;first<uint64_t(seconds*rate);first+=4096) {
      const size_t length=std::min(uint64_t(4096),uint64_t(seconds*rate)-first);
      std::vector<std::complex<float>> iq[2];
      const auto generating=Clock::now();
      for(int span=0;span<2;++span) {
        iq[span].resize(length);
        for(size_t i=0;i<length;++i)for(auto& signal:signals[span]) {
          const auto at=(size_t((first+i)/30)+signal.phase)%signal.key.size();
          const double fraction=double((first+i)%30)/30;
          const double key=signal.key[at]*(1-fraction)+signal.key[(at+1)%signal.key.size()]*fraction;
          iq[span][i]+=std::complex<float>(signal.oscillator*key);signal.oscillator*=signal.step;
        }
      }
      generation_ms+=milliseconds(Clock::now()-generating);
      const auto deadline=start+std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(double(first+length)/rate));
      std::this_thread::sleep_until(deadline);
      for(int span=0;span<2;++span) {
        maximum_lag=std::max(maximum_lag,milliseconds(Clock::now()-deadline));
        if(maximum_lag>250){deadline_missed=true;break;}
        const auto feeding=Clock::now();
        skimmer.feed(tokens[span],uint64_t(span+1),sequence[span]++,first,rate,iq[span]);
        feed_ms+=milliseconds(Clock::now()-feeding);drain();
      }
      if(deadline_missed)break;
      samples_fed=first+length;
    }
    const bool drained=skimmer.wait_idle(15);drain();
    std::sort(latencies.begin(),latencies.end());
    const double p95=latencies.empty()?0:latencies[std::min(latencies.size()-1,size_t(std::ceil(latencies.size()*0.95))-1)];
    const auto metrics=skimmer.metrics();struct rusage usage{};getrusage(RUSAGE_SELF,&usage);
    const double rss=double(usage.ru_maxrss)
#if defined(__APPLE__)
      /1024/1024;
#else
      /1024;
#endif
    const bool stable=!deadline_missed && drained && decoded.size()==size_t(count*2) && maximum_tracks==size_t(count*2) &&
      !latencies.empty() && p95<=2000 && metrics.coalesced==0 && metrics.dropped_events==0;
    std::cout<<"{\"instrument\":\"synthetic-paced-cw-v1\",\"replay\":true,\"spans\":2,\"tracks_per_span\":"<<count
      <<",\"inference_workers\":"<<workers
      <<",\"sample_rate\":"<<rate<<",\"requested_seconds\":"<<seconds<<",\"delivered_seconds\":"<<double(samples_fed)/rate
      <<",\"wall_seconds\":"<<milliseconds(Clock::now()-start)/1000<<",\"maximum_tracks\":"<<maximum_tracks
      <<",\"inferred_tracks\":"<<decoded.size()<<",\"inference_events\":"<<latencies.size()<<",\"maximum_pending\":"<<maximum_pending
      <<",\"coalesced\":"<<metrics.coalesced<<",\"dropped_events\":"<<metrics.dropped_events
      <<",\"maximum_input_lateness_ms\":"<<maximum_lag<<",\"decode_p95_ms\":"<<p95
      <<",\"signal_generation_ms\":"<<generation_ms<<",\"dsp_ingress_ms\":"<<feed_ms<<",\"peak_rss_mib\":"<<rss
      <<",\"cpu_seconds\":"<<double(usage.ru_utime.tv_sec+usage.ru_stime.tv_sec)+double(usage.ru_utime.tv_usec+usage.ru_stime.tv_usec)/1e6
      <<",\"stable_under_this_synthetic_load\":"<<(stable?"true":"false")<<"}"<<std::endl;
    skimmer.stop();return 0;
  } catch(const std::exception& error){std::cerr<<error.what()<<std::endl;return 1;}
}
