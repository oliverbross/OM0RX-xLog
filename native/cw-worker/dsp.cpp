// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "dsp.h"
#include "engine.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace cw {
constexpr double pi=3.14159265358979323846;
std::vector<Carrier> carriers(const std::vector<std::complex<float>>& iq,int rate,
                              double lower,double upper,size_t capacity) {
  if(iq.size()!=8192 || rate<24000 || rate>384000 || !std::isfinite(lower) || !std::isfinite(upper) ||
     lower>=upper || lower<-rate/2.0 || upper>rate/2.0 || capacity>128)
    throw std::invalid_argument("Invalid bounded spectrum request");
  std::vector<std::complex<double>> spectrum(iq.size());
  for(size_t i=0;i<iq.size();++i) {
    if(!std::isfinite(iq[i].real()) || !std::isfinite(iq[i].imag())) throw std::invalid_argument("Non-finite IQ");
    spectrum[i]=std::complex<double>(iq[i])*(0.5-0.5*std::cos(2*pi*i/iq.size()));
  }
  fft(spectrum);
  std::vector<double> power(iq.size());
  for(size_t i=0;i<iq.size();++i) power[i]=std::norm(spectrum[i]);
  const double numericFloor=*std::max_element(power.begin(),power.end())*1e-8;
  std::vector<Carrier> found;
  const double bin=double(rate)/iq.size();
  for(size_t i=2;i<iq.size()-2;++i) {
    const double offset=(i<iq.size()/2?double(i):double(i)-iq.size())*bin;
    if(offset<lower || offset>upper || std::abs(offset)<2*bin) continue;
    if(power[i]<=power[i-1] || power[i]<power[i+1]) continue;
    // Median in a local 1-kHz neighbourhood rejects single strong adjacent
    // stations and their main lobes without imposing a global noise floor.
    std::vector<double> neighbours;
    const int reach=std::max(8,int(std::ceil(500/bin)));
    for(int delta=-reach;delta<=reach;++delta) {
      if(std::abs(delta)<=3) continue;
      const int index=int(i)+delta;
      if(index>=0 && index<int(power.size())) neighbours.push_back(power[size_t(index)]);
    }
    if(neighbours.empty()) continue;
    auto middle=neighbours.begin()+neighbours.size()/2;
    std::nth_element(neighbours.begin(),middle,neighbours.end());
    const double noise=std::max({1e-16,*middle,numericFloor});
    if(power[i]<noise*16) continue;
    const double left=std::log(std::max(power[i-1],1e-30)),mid=std::log(std::max(power[i],1e-30)),right=std::log(std::max(power[i+1],1e-30));
    const double denom=left-2*mid+right;
    const double correction=std::abs(denom)>1e-12?std::clamp(0.5*(left-right)/denom,-0.5,0.5):0;
    found.push_back({offset+correction*bin,power[i],noise});
  }
  std::sort(found.begin(),found.end(),[](const auto& a,const auto& b){return a.power>b.power;});
  std::vector<Carrier> selected;
  for(const auto& peak:found) {
    if(selected.size()>=capacity) break;
    auto neighbour=std::find_if(selected.begin(),selected.end(),[&](const auto& c){return std::abs(c.offset_hz-peak.offset_hz)<250;});
    if(neighbour==selected.end()) selected.push_back(peak);
    // Keying sidebands are not independent stations. A nearby comparable peak
    // instead marks the unresolved group ambiguous. Closer-spacing profiles
    // need separate corpus qualification, not a promise of source separation.
    else if(std::abs(neighbour->offset_hz-peak.offset_hz)>175 && peak.power>neighbour->power*0.5) neighbour->ambiguous=true;
  }
  return selected;
}

double bessel0(double x) {
  double sum=1,term=1;
  for(int k=1;k<50;++k) { term*=x*x/(4*k*k); sum+=term; if(term<sum*1e-15) break; }
  return sum;
}
Channelizer::Channelizer(int source_rate,double offset):rate(source_rate) {
  if((rate!=24000 && rate!=48000 && rate!=96000 && rate!=192000 && rate!=384000) ||
     !std::isfinite(offset) || std::abs(offset)>rate/2.0-400) throw std::invalid_argument("Unsupported channelizer source");
  step=std::polar(1.0,-2*pi*offset/rate);
  // Independent Kaiser-windowed sinc, 100-Hz useful passband / 250-Hz stopband.
  // This is a measured engineering profile, not an arbitrary linear interpolator.
  const size_t taps=size_t(rate/25)|1;
  ring.resize(taps*2);
  const int phases=(rate==24000?2:1);
  const double beta=8.6,scale=bessel0(beta),cutoff=175.0/rate;
  for(int phase=0;phase<phases;++phase) {
    std::vector<float> h(taps); double sum=0;
    for(size_t i=0;i<taps;++i) {
      const double x=double(i)-double(taps-1)/2+double(phase)/2;
      const double sinc=std::abs(x)<1e-12?2*cutoff:std::sin(2*pi*cutoff*x)/(pi*x);
      const double p=2.0*i/(taps-1)-1;
      h[i]=float(sinc*bessel0(beta*std::sqrt(std::max(0.0,1-p*p)))/scale); sum+=h[i];
    }
    for(float& v:h) v=float(v/sum);
    coefficients.push_back(std::move(h));
  }
}
std::vector<float> Channelizer::process(const std::vector<std::complex<float>>& iq) {
  if(iq.size()>16384) throw std::invalid_argument("Oversize channelizer block");
  std::vector<float> out;
  out.reserve(iq.size()*3200/rate+2);
  for(const auto& sample:iq) {
    if(!std::isfinite(sample.real()) || !std::isfinite(sample.imag())) throw std::invalid_argument("Non-finite channel IQ");
    const size_t taps=coefficients[0].size(),newest=size_t(received%taps);
    const auto mixed=std::complex<float>(std::complex<double>(sample)*mixer);
    ring[newest]=mixed; ring[newest+taps]=mixed;
    mixer*=step;
    if((received&4095)==0) mixer/=std::abs(mixer);
    // Output at rational source positions; 24k has alternating integer/half
    // phases. Filter delay is exposed for absolute sample-time alignment.
    if(received>=next_numerator/3200) {
      const size_t phase=(next_numerator%3200)==0?0:1;
      const auto& h=coefficients[phase];
      std::complex<double> value(0,0);
      for(size_t k=0;k<h.size();++k) value+=std::complex<double>(ring[newest+taps-k])*double(h[k]);
      // Real audio carrier at 800 Hz; signed RF translation is already removed.
      const auto oscillator=std::polar(1.0,2*pi*800*double(emitted%4)/3200);
      out.push_back(float((value*oscillator).real()));
      ++emitted; next_numerator+=uint64_t(rate);
    }
    ++received;
  }
  return out;
}
}
