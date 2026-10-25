// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "engine.h"
#include <array>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {
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
    std::cout<<"{\"type\":\"ready\",\"protocol_version\":1,\"sample_rate\":3200}"<<std::endl;
    while(true) {
      std::array<uint8_t,8> prefix{};
      if(!readExact(reinterpret_cast<char*>(prefix.data()),8,true)) return 0;
      if(std::memcmp(prefix.data(),"XCW1",4)) throw std::runtime_error("Invalid protocol magic");
      const auto size=le(prefix.data()+4,4);
      if(size<52 || size>52+32000*4) throw std::runtime_error("Frame exceeds finite sample budget");
      std::vector<uint8_t> frame(size);
      readExact(reinterpret_cast<char*>(frame.data()),size);
      if(le(frame.data(),2)!=1) throw std::runtime_error("Unsupported protocol version");
      const auto kind=le(frame.data()+2,2), count=le(frame.data()+48,4);
      if(kind==4 && size==52 && !count) return 0;
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
