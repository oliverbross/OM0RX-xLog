// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include <complex>
#include <cstdint>
#include <vector>
#include <optional>

namespace cw {
struct Carrier {
  double offset_hz; double power; double noise_bin_power; bool ambiguous=false;
  double integrated_power=0;
  bool noise_estimate_valid=false;
  std::optional<double> estimated_snr_db(int rate,double reference_hz=2500) const;
};
/// PARIS speed fitted to observed key-down runs, not inferred from model scores.
/// One tick is the track envelope's 40 samples / 3200 Hz. Unknown/poor fits stay absent.
class KeyingSpeed {
 public:
  void tick(bool down);
  std::optional<double> estimate() const;
 private:
  bool down=false;
  uint64_t ticks=0,last_fall=0;
  size_t run=0;
  std::vector<double> durations;
};
// Analysis only: keyed-carrier eligibility is decided by temporal tracking.
std::vector<Carrier> carriers(const std::vector<std::complex<float>>& iq,int rate,
                              double lower_offset,double upper_offset,size_t capacity);
class Channelizer {
 public:
  Channelizer(int source_rate,double offset_hz,bool use_acceleration=true);
  // Ingress-owner only: preserve mixer phase, FIR history and sample indices.
  void retune(double offset_hz);
  std::vector<float> process(const std::vector<std::complex<float>>& iq);
  uint64_t output_samples() const { return emitted; }
  double group_delay_seconds() const { return (coefficients[0].size()-1)/2.0/rate; }
 private:
  int rate;
  std::complex<double> mixer{1,0}, step;
  std::vector<float> real_ring,imaginary_ring;
  std::vector<std::vector<float>> coefficients;
  uint64_t received=0,emitted=0,next_numerator=0;
  [[maybe_unused]] bool accelerated;
};
}
