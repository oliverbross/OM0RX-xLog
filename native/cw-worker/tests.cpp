// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "engine.h"
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
