// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "engine.h"
#include "model_contract.h"
#include <onnxruntime_cxx_api.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <stdexcept>

namespace cw {
constexpr double pi = 3.14159265358979323846;
void fft(std::vector<std::complex<double>>& a) {
  const size_t n = a.size();
  if (!n || (n & (n - 1))) throw std::invalid_argument("FFT size must be a power of two");
  for (size_t i=1,j=0; i<n; ++i) {
    size_t bit=n>>1;
    for (; j&bit; bit>>=1) j^=bit;
    j^=bit;
    if (i<j) std::swap(a[i],a[j]);
  }
  for (size_t len=2; len<=n; len<<=1) {
    auto wlen=std::polar(1.0,-2*pi/len);
    for (size_t i=0; i<n; i+=len) {
      std::complex<double> w(1,0);
      for (size_t j=0; j<len/2; ++j) {
        auto u=a[i+j],v=a[i+j+len/2]*w;
        a[i+j]=u+v; a[i+j+len/2]=u-v; w*=wlen;
      }
    }
  }
}

std::vector<float> features(const std::vector<float>& audio) {
  if (audio.size()<256 || audio.size()>64000) throw std::invalid_argument("Audio window outside 256..64000 samples");
  for (float f:audio) if (!std::isfinite(f)) throw std::invalid_argument("Non-finite audio");
  const size_t frames=1+audio.size()/model::hop_length;
  std::vector<float> result(frames*65);
  std::array<float,256> window{};
  for (size_t i=0;i<256;++i) window[i]=float(0.5-0.5*std::cos(2*pi*i/256));
  std::vector<std::complex<double>> frame(256);
  for (size_t t=0;t<frames;++t) {
    for (size_t i=0;i<256;++i) {
      int64_t pos=int64_t(t*48+i)-128;
      if (pos<0) pos=-pos;
      if (pos>=int64_t(audio.size())) pos=2*int64_t(audio.size())-2-pos;
      // Reference multiplies in float32 before NumPy's double FFT.
      frame[i]=double(audio[size_t(pos)]*window[i]);
    }
    fft(frame);
    for (size_t bin=0;bin<65;++bin) result[t*65+bin]=std::log1p(float(std::abs(frame[bin+32])));
  }
  return result;
}

struct Engine::Impl {
  Ort::Env env{ORT_LOGGING_LEVEL_WARNING,"xlog-cw"};
  Ort::Session session{nullptr};
  std::unique_ptr<Ort::Session> startup;
  static Ort::SessionOptions options_for(const EngineProfile& profile,bool fixed) {
    Ort::SessionOptions options;
    if(profile.intra_op_threads<1 || profile.intra_op_threads>4) throw std::invalid_argument("ORT shared pool outside bounded profile");
    options.SetIntraOpNumThreads(profile.intra_op_threads); options.SetInterOpNumThreads(1);
    if(!profile.cpu_mem_arena) options.DisableCpuMemArena();
    if(fixed) {
      Ort::ThrowOnError(Ort::GetApi().AddFreeDimensionOverrideByName(options,"batch",1));
      Ort::ThrowOnError(Ort::GetApi().AddFreeDimensionOverrideByName(options,"time",667));
    }
    options.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
    if(!profile.profiling_prefix.empty()) options.EnableProfiling(profile.profiling_prefix.c_str());
    if(profile.provider!=ExecutionProvider::cpu) {
#if defined(__APPLE__)
      options.AppendExecutionProvider("CoreML",{{"ModelFormat",profile.provider==ExecutionProvider::core_ml?"MLProgram":"NeuralNetwork"},{"MLComputeUnits","CPUAndNeuralEngine"},
        {"RequireStaticInputShapes",fixed?"1":"0"},{"EnableOnSubgraphs","0"}});
#else
      throw std::invalid_argument("CoreML profile requires Apple Silicon Mac qualification");
#endif
    }
    return options;
  }
  static void validate(const Ort::Session& session,bool fixed) {
    if (session.GetInputCount()!=1 || session.GetOutputCount()!=1) throw std::runtime_error("Unexpected model I/O count");
    const auto inputInfo=session.GetInputTypeInfo(0);
    const auto outputInfo=session.GetOutputTypeInfo(0);
    const auto input=inputInfo.GetTensorTypeAndShapeInfo(), output=outputInfo.GetTensorTypeAndShapeInfo();
    const auto in=input.GetShape(),out=output.GetShape();
    Ort::AllocatorWithDefaultOptions alloc;
    if (input.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT || output.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT ||
        in.size()!=4 || in[1]!=1 || in[3]!=65 || (fixed && (in[0]!=1 || in[2]!=667)) || out.size()!=3 || out[2]!=42 ||
        std::string(session.GetInputNameAllocated(0,alloc).get())!=model::onnx_input_name ||
        std::string(session.GetOutputNameAllocated(0,alloc).get())!=model::onnx_output_name)
      throw std::runtime_error("Model tensor contract mismatch");
  }
  Impl(const std::string& path,const EngineProfile& profile) {
    if(profile.steady_ten_second) {
      // Exactly two shared plans for the same model. Startup keeps every
      // original variable-length window; no input is padded or shortened.
      auto warm=profile;warm.provider=ExecutionProvider::cpu;warm.steady_ten_second=false;
      if(!warm.profiling_prefix.empty()) warm.profiling_prefix+=".startup";
      auto options=options_for(warm,false);
      startup=std::make_unique<Ort::Session>(env,path.c_str(),options);validate(*startup,false);
    }
    auto options=options_for(profile,profile.steady_ten_second);
    session=Ort::Session(env,path.c_str(),options);validate(session,profile.steady_ten_second);
  }
};
Engine::Engine(const std::string& path,const EngineProfile& profile):impl(std::make_unique<Impl>(path,profile)) {}
std::string Engine::runtime_version() { return OrtGetApiBase()->GetVersionString(); }
Engine::~Engine()=default;
Decode Engine::decode(const std::vector<float>& audio,uint64_t first) {
  if (audio.size()<16000 || audio.size()>32000 || first>UINT64_MAX-audio.size()) throw std::invalid_argument("Inference requires 5..10 seconds and a valid sample range");
  const auto feature_start=std::chrono::steady_clock::now();
  auto data=features(audio);
  const double feature_ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-feature_start).count();
  std::array<int64_t,4> shape{1,1,int64_t(data.size()/65),65};
  auto mem=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);
  auto input=Ort::Value::CreateTensor<float>(mem,data.data(),data.size(),shape.data(),shape.size());
  const char* names[]{model::onnx_input_name}; const char* outputs[]{model::onnx_output_name};
  const auto start=std::chrono::steady_clock::now();
  const bool steady=impl->startup && shape[2]==667;
  auto& session=impl->startup && !steady ? *impl->startup:impl->session;
  auto tensors=session.Run(Ort::RunOptions{nullptr},names,&input,1,outputs,1);
  const auto dims=tensors[0].GetTensorTypeAndShapeInfo().GetShape();
  if (dims.size()!=3 || dims[0]!=1 || dims[1]!=shape[2] || dims[2]!=42) throw std::runtime_error("Unexpected output shape");
  Decode result{"",{},std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count()};
  result.features_ms=feature_ms;
  result.used_steady_plan=steady;
  const auto ctc_start=std::chrono::steady_clock::now();
  const float* logits=tensors[0].GetTensorData<float>();
  int previous=-1;
  for (int64_t t=0;t<dims[1];++t) {
    const auto row=logits+t*42;
    for (size_t i=0;i<42;++i) if (!std::isfinite(row[i])) throw std::runtime_error("Non-finite model output");
    const int best=int(std::max_element(row,row+42)-row);
    if (best==model::blank_index) { previous=-1; continue; }
    const uint64_t begin=first+std::min(uint64_t(t*48),uint64_t(audio.size()));
    const uint64_t end=first+std::min(uint64_t((t+1)*48),uint64_t(audio.size()));
    if (best!=previous) {
      result.text+=model::alphabet[best];
      result.tokens.push_back({model::alphabet[best],begin,end,row[best]});
    } else result.tokens.back().end_sample=end;
    previous=best;
  }
  result.ctc_ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-ctc_start).count();
  return result;
}
}
