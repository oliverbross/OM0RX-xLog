// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include "dsp.h"
#include "engine.h"
#include <memory>

namespace cw {
struct SkimmerEvent {
  std::string kind,stream_token,track_id,state;
  uint64_t epoch=0,first_sample=0,end_sample=0;
  double offset_hz=0;
  bool ambiguous=false;
  Decode copy;
  uint64_t source_first_sample=0;
  double filter_delay_seconds=0;
  bool replay=false;
  uint64_t track_revision=0;
  std::optional<double> estimated_snr_db{},estimated_wpm{};
  double queue_wait_ms=0; // Internal developer timing, excluded from wire output.
};
struct SkimmerMetrics {
  size_t sources,tracks,pending,in_flight;
  uint64_t coalesced,dropped_events;
  // Internal profiler ledger, not additional fields in the bundled v1 status.
  // Completed models can also have an invalidated result; these are not additive.
  uint64_t submitted_jobs,model_jobs_started,model_jobs_completed,invalidated_jobs;
};
/// One instance owns two spans and a fixed shared CPU inference pool. Radio
/// control, RF mapping, committed text and spot publication stay in the parent.
class Skimmer {
 public:
  explicit Skimmer(Engine& engine,size_t inference_threads=2,size_t tracks_per_span=16);
  ~Skimmer();
  void open(const std::string& token,uint64_t epoch,int rate,double lower_offset,double upper_offset,bool replay);
  void feed(const std::string& token,uint64_t epoch,uint64_t sequence,uint64_t first_sample,
            int actual_rate,const std::vector<std::complex<float>>& iq);
  void end(const std::string& token);
  bool mute(const std::string& token,uint64_t epoch,const std::string& track_id);
  bool focus(const std::string& token,uint64_t epoch,const std::string& track_id,uint64_t revision);
  void clear_focus();
  void stop();
  std::vector<SkimmerEvent> events();
  bool wait_idle(double timeout_seconds);
  SkimmerMetrics metrics();
 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};
}
