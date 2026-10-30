// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include <complex>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace cw {
struct Token { char symbol; uint64_t first_sample; uint64_t end_sample; float log_score; };
struct Decode {
  std::string text;
  std::vector<Token> tokens;
  double inference_ms;
  // Internal attribution only. The XCW1/JSON wire retains its existing model
  // Run timing; these clocks do not change samples, features or acceptance.
  double features_ms=0,ctc_ms=0;
};
void fft(std::vector<std::complex<double>>& values);
std::vector<float> features(const std::vector<float>& audio);
enum class ExecutionProvider { cpu, core_ml, core_ml_neural_network };
struct EngineProfile {
  ExecutionProvider provider=ExecutionProvider::cpu;
  int intra_op_threads=1;
  bool cpu_mem_arena=true;
  std::string profiling_prefix;
};
class Engine {
 public:
  explicit Engine(const std::string& model_path,const EngineProfile& profile={});
  static std::string runtime_version();
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;
  Decode decode(const std::vector<float>& audio, uint64_t first_sample);
 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};
}
