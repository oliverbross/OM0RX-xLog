// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "engine.h"
#include "dsp.h"
#include <cmath>
#include <iostream>
#include <map>
#include <stdexcept>

void require(bool v,const char* what) { if(!v) throw std::runtime_error(what); }
std::vector<float> morse(int wpm) {
  const std::map<char,std::string> codes{{'C',"-.-."},{'Q',"--.-"},{'O',"---"},{'M',"--"},{'0',"-----"},{'R',".-."},{'X',"-..-"}};
  std::vector<float> out(1600,0);
  const auto add=[&](int units,bool keyed) {
    const size_t count=size_t(std::round(3200.0*1.2/wpm*units)), first=out.size();
    for(size_t i=0;i<count;++i) {
      double ramp=std::min(1.0,double(std::min(i,count-1-i))/16.0);
      out.push_back(keyed?float(0.6*ramp*std::sin(2*3.141592653589793*800*(first+i)/3200)):0);
    }
  };
  const std::string text="CQ OM0RX";
  for(size_t c=0;c<text.size();++c) {
    if(text[c]==' ') { add(4,false); continue; }
    const auto& code=codes.at(text[c]);
    for(size_t i=0;i<code.size();++i) { add(code[i]=='-'?3:1,true); if(i+1<code.size()) add(1,false); }
    add(3,false);
  }
  out.resize(std::max(size_t(19200),out.size()+1600),0); return out;
}
int main(int argc,char** argv) {
  try {
    require(argc==2,"Model path required");
    auto zero=cw::features(std::vector<float>(19200));
    require(zero.size()==401*65,"Centred reflect shape");
    for(float f:zero) require(f==0,"Silence features");
    auto tone=std::vector<float>(19200);
    for(size_t i=0;i<tone.size();++i) tone[i]=float(std::sin(2*3.141592653589793*800*i/3200));
    auto feat=cw::features(tone);
    require(std::abs(feat[100*65+32]-std::log1p(64.0f))<0.00001,"Unscaled periodic Hann magnitude");
    bool rejected=false; try { cw::features(std::vector<float>(256,NAN)); } catch(...) { rejected=true; }
    require(rejected,"Nonfinite rejection");
    const double pi=3.141592653589793;
    std::vector<std::complex<float>> spectrum(8192);
    for(size_t i=0;i<spectrum.size();++i) spectrum[i]=std::polar(0.4f,float(2*pi*6200*i/96000))+std::polar(0.2f,float(-2*pi*4100*i/96000));
    const auto peaks=cw::carriers(spectrum,96000,-39000,39000,4);
    require(peaks.size()==2,"Two independently located IQ carriers");
    require(std::abs(peaks[0].offset_hz-6200)<2 && std::abs(peaks[1].offset_hz+4100)<2,"Signed frequency estimator");
    for(int rate:{24000,48000,96000,192000}) {
      cw::Channelizer channel(rate,6200);
      std::vector<float> audio;
      for(int block=0;block<rate/4000;++block) {
        std::vector<std::complex<float>> iq(4000);
        for(size_t i=0;i<iq.size();++i) iq[i]=std::polar(0.4f,float(2*pi*6200*(block*4000+i)/rate));
        const auto output=channel.process(iq); audio.insert(audio.end(),output.begin(),output.end());
      }
      double power=0;
      for(size_t i=400;i<audio.size();++i) power+=audio[i]*audio[i];
      power/=audio.size()-400;
      require(std::abs(power-0.08)<0.001,"Channel gain, rational resampling and 800-Hz translation");
      require(std::abs(channel.group_delay_seconds()-0.02)<0.0001,"Explicit filter delay");
      cw::Channelizer rejection(rate,6200);
      double leak=0; size_t total=0,index=0;
      for(int block=0;block<rate/4000;++block) {
        std::vector<std::complex<float>> iq(4000);
        for(size_t i=0;i<iq.size();++i) iq[i]=std::polar(12.65f,float(2*pi*6500*(block*4000+i)/rate));
        for(float f:rejection.process(iq)) { if(index++>400) { leak+=f*f; ++total; } }
      }
      require(leak/total < 0.08*0.001,"Thirty-dB stronger neighbour at 300 Hz rejected");
    }
    cw::Engine engine(argv[1]);
    require(engine.decode(std::vector<float>(19200),0).text.empty(),"Silence must not decode a call");
    for(int speed:{20,30}) {
      auto result=engine.decode(morse(speed),3200);
      std::cout<<speed<<" WPM: ["<<result.text<<"] "<<result.inference_ms<<" ms\n";
      require(result.text.find("CQ OM0RX")!=std::string::npos,"Synthetic Morse decoding");
      for(auto t:result.tokens) require(t.first_sample>=3200 && t.end_sample>=t.first_sample,"Absolute sample alignment");
    }
    std::cout<<"Native CW engine checks passed\n";
    return 0;
  } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
