// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include <algorithm>
#include <deque>
#include <optional>
#include <string>
namespace cw {
/// One preferred dispatch alternates with oldest-ready work. Changing focus
/// never resets the quota; a busy preferred track cannot stall other tracks.
/// The caller holds the scheduler mutex; at most 32 track IDs are retained.
class JobOrder {
  std::deque<std::string> order;
  std::string focused;
  bool preferred_last=false;
 public:
  void push(const std::string& id) { order.push_back(id); }
  void remove(const std::string& id) {
    order.erase(std::remove(order.begin(),order.end(),id),order.end());
    if(focused==id) focused.clear();
  }
  void clear() { order.clear(); focused.clear(); preferred_last=false; }
  void focus(const std::string& id) { focused=id; }
  template<class Ready> bool ready(Ready can_run) const {
    return std::any_of(order.begin(),order.end(),can_run);
  }
  template<class Ready> std::optional<std::string> take(Ready can_run) {
    auto next=order.end();
    if(!preferred_last && !focused.empty()) next=std::find_if(order.begin(),order.end(),[&](const auto& id){return id==focused && can_run(id);});
    if(next==order.end()) next=std::find_if(order.begin(),order.end(),can_run);
    if(next==order.end()) return {};
    const auto id=*next;order.erase(next);preferred_last=id==focused;return id;
  }
};
}
