// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include <complex>
#include <cstdint>
#include <vector>

namespace cw {
struct Carrier { double offset_hz; double power; double noise_bin_power; bool ambiguous=false; };
// Analysis only: keyed-carrier eligibility is decided by temporal tracking.
std::vector<Carrier> carriers(const std::vector<std::complex<float>>& iq,int rate,
                              double lower_offset,double upper_offset,size_t capacity);
class Channelizer {
 public:
  Channelizer(int source_rate,double offset_hz);
  std::vector<float> process(const std::vector<std::complex<float>>& iq);
  uint64_t output_samples() const { return emitted; }
  double group_delay_seconds() const { return (coefficients[0].size()-1)/2.0/rate; }
 private:
  int rate;
  std::complex<double> mixer{1,0}, step;
  std::vector<std::complex<float>> ring;
  std::vector<std::vector<float>> coefficients;
  uint64_t received=0,emitted=0,next_numerator=0;
};
}
