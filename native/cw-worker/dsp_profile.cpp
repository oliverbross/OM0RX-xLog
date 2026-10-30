// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
// Bounded offline attribution instrument. No model, IQ source or radio opened.
#include "dsp.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <sys/resource.h>

namespace {
using Clock=std::chrono::steady_clock;
double ms(Clock::duration value){return std::chrono::duration<double,std::milli>(value).count();}
double cpu_ms(){struct rusage value{};if(getrusage(RUSAGE_SELF,&value))throw std::runtime_error("CPU clock unavailable");
  return (value.ru_utime.tv_sec+value.ru_stime.tv_sec)*1000.0+(value.ru_utime.tv_usec+value.ru_stime.tv_usec)/1000.0;}
struct Totals{double wall=0,cpu=0,maximum=0;size_t calls=0;};
template<class Work> void measure(Totals& total,Work work){const auto start=Clock::now();const auto cpu=cpu_ms();work();
  const auto elapsed=ms(Clock::now()-start);total.wall+=elapsed;total.cpu+=cpu_ms()-cpu;total.maximum=std::max(total.maximum,elapsed);++total.calls;}
void print(const char* name,const Totals& value){std::cout<<"\""<<name<<"\":{\"calls\":"<<value.calls<<",\"wall_ms\":"<<value.wall
  <<",\"process_cpu_ms\":"<<value.cpu<<",\"maximum_call_ms\":"<<value.maximum<<"}";}
}
int main(int argc,char** argv){
  try{
    if(argc!=3)throw std::invalid_argument("Usage: cw-dsp-profile tracks_per_span (1..16) blocks (1..128)");
    const int tracks=std::stoi(argv[1]),blocks=std::stoi(argv[2]),rate=96000;
    if(tracks<1||tracks>16||blocks<1||blocks>128)throw std::invalid_argument("Outside bounded DSP profile");
    constexpr double pi=3.14159265358979323846;
    std::vector<std::complex<float>> input(8192);
    for(size_t sample=0;sample<input.size();++sample)for(int track=0;track<tracks;++track)
      input[sample]+=std::complex<float>(std::polar(0.03,2*pi*(-22500+track*3000)*sample/rate));
    std::vector<std::complex<float>> block(input.begin(),input.begin()+4096);
    std::vector<std::unique_ptr<cw::Channelizer>> channels;
    Totals construction,analysis,processing;size_t outputs=0,peaks=0;
    for(int index=0;index<tracks*2;++index)measure(construction,[&]{channels.push_back(std::make_unique<cw::Channelizer>(rate,-22500+(index%tracks)*3000));});
    for(int index=0;index<blocks;++index){
      for(int span=0;span<2;++span)measure(analysis,[&]{peaks+=cw::carriers(input,rate,-39000,39000,16).size();});
      for(auto& channel:channels)measure(processing,[&]{outputs+=channel->process(block).size();});
    }
    std::cout<<"{\"instrument\":\"offline-cw-dsp-attribution-v1\",\"spans\":2,\"tracks_per_span\":"<<tracks
      <<",\"sample_rate\":"<<rate<<",\"blocks\":"<<blocks<<",\"block_samples\":4096,\"detected_peak_sum\":"<<peaks
      <<",\"output_sample_sum\":"<<outputs<<",";print("construction",construction);std::cout<<",";print("spectrum",analysis);
    std::cout<<",";print("channel_processing",processing);std::cout<<",\"capacity_qualified\":false}"<<std::endl;
    return 0;
  }catch(const std::exception& error){std::cerr<<error.what()<<std::endl;return 1;}
}
