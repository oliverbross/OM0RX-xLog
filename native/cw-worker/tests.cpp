// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "engine.h"
#include "dsp.h"
#include "skimmer.h"
#include "job_order.h"
#include <cmath>
#include <future>
#include <iostream>
#include <map>
#include <random>
#include <set>
#include <stdexcept>

void require(bool v,const char* what) { if(!v) throw std::runtime_error(what); }
std::vector<float> morse(int wpm,const std::string& text="CQ OM0RX",bool envelope=false,bool tapered=true,int rate=3200) {
  const std::map<char,std::string> codes{{'C',"-.-."},{'Q',"--.-"},{'O',"---"},{'M',"--"},{'0',"-----"},{'R',".-."},{'X',"-..-"},
    {'D',"-.."},{'L',".-.."},{'1',".----"},{'7',"--..."},{'A',".-"},{'B',"-..."}};
  std::vector<float> out(size_t(rate/2),0);
  const auto add=[&](int units,bool keyed) {
    const size_t count=size_t(std::round(rate*1.2/wpm*units)), first=out.size();
    for(size_t i=0;i<count;++i) {
      double ramp=tapered?std::min(1.0,double(std::min(i,count-1-i))/(rate/200.0)):1;
      out.push_back(keyed?(envelope?float(0.6*ramp):float(0.6*ramp*std::sin(2*3.141592653589793*800*(first+i)/rate))):0);
    }
  };
  for(size_t c=0;c<text.size();++c) {
    if(text[c]==' ') { add(4,false); continue; }
    const auto& code=codes.at(text[c]);
    for(size_t i=0;i<code.size();++i) { add(code[i]=='-'?3:1,true); if(i+1<code.size()) add(1,false); }
    add(3,false);
  }
  out.resize(std::max(size_t(rate*6),out.size()+size_t(rate/2)),0); return out;
}
int main(int argc,char** argv) {
  try {
    require(argc==2 || (argc==3 && (std::string(argv[2])=="coreml" || std::string(argv[2])=="coreml-neural" || std::string(argv[2])=="system-allocator" ||
      std::string(argv[2])=="cpu-steady" || std::string(argv[2])=="coreml-steady" || std::string(argv[2])=="coreml-neural-steady" ||
      std::string(argv[2])=="coreml-neural-gpu" || std::string(argv[2])=="coreml-neural-gpu-steady" ||
      std::string(argv[2])=="cpu-intra4" || std::string(argv[2])=="cpu-shared8" || std::string(argv[2])=="cpu-steady-parity" ||
      std::string(argv[2])=="cpu-attribution")),"Model path and bounded provider/allocator/shape/thread profile required");
    cw::JobOrder jobs;
    const auto ready=[](const auto&){return true;};
    jobs.push("oldest");jobs.push("second");jobs.push("selected");jobs.focus("selected");
    require(jobs.take(ready)=="selected","Selected pending track gets bounded priority");jobs.push("selected");
    require(jobs.take(ready)=="oldest","Priority cannot starve oldest ready work");
    require(jobs.take(ready)=="selected","Selected priority resumes after ordinary service");jobs.push("selected");
    jobs.focus("second");require(jobs.take(ready)=="second","Changing focus does not reset ordinary FIFO turn");
    jobs.push("ordinary");jobs.focus("selected");
    require(jobs.take([](const auto& id){return id!="selected";})=="ordinary","Busy focused track cannot stall another track");
    jobs.remove("selected");require(!jobs.ready(ready),"Retirement clears pending preference");
    jobs.push("a");jobs.push("b");jobs.focus("b");jobs.clear();require(!jobs.take(ready),"Stop clears scheduler state");
    for(int i=0;i<32;++i) jobs.push(std::to_string(i));jobs.focus("31");
    std::map<std::string,size_t> served;
    for(int turn=0;turn<63;++turn) {
      const auto next=jobs.take(ready);require(bool(next),"Fairness profile retains pending work");++served[*next];
      if(*next=="31") jobs.push(*next);
    }
    require(served.size()==32,"Every admitted track receives service with one continuously pending focused track");
    jobs.clear();
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
    for(size_t i=0;i<spectrum.size();++i) spectrum[i]=std::complex<float>(std::polar(0.4,2*pi*6200*i/96000)+std::polar(0.2,-2*pi*4100*i/96000));
    const auto peaks=cw::carriers(spectrum,96000,-39000,39000,4);
    require(peaks.size()==2,"Two independently located IQ carriers");
    require(std::abs(peaks[0].offset_hz-6200)<2 && std::abs(peaks[1].offset_hz+4100)<2,"Signed frequency estimator");
    std::mt19937 snr_random(9372);std::normal_distribution<float> snr_noise(0,float(0.01/std::sqrt(2.0)));
    for(size_t i=0;i<spectrum.size();++i) spectrum[i]=std::complex<float>(std::polar(0.1,2*pi*9600*i/96000))+
      std::complex<float>(snr_noise(snr_random),snr_noise(snr_random));
    const auto noisy=cw::carriers(spectrum,96000,-39000,39000,4);
    require(!noisy.empty(),"Noisy carrier detected");
    const auto snr=noisy[0].estimated_snr_db(96000);
    require(snr && std::abs(*snr-10*std::log10(100.0*96000/2500))<2,"Measured Hann SNR uses explicit 2.5-kHz reference bandwidth");
    for(size_t i=0;i<spectrum.size();++i)spectrum[i]=std::complex<float>(std::polar(0.1,2*pi*6000*i/96000));
    const auto clean=cw::carriers(spectrum,96000,-39000,39000,4);
    require(!clean.empty() && !clean[0].estimated_snr_db(96000),"An artificial numerical noise floor cannot become reported SNR");
    for(double weak:{0.00001,0.0002}) {
      for(size_t i=0;i<spectrum.size();++i) spectrum[i]=std::complex<float>(std::polar(0.1,2*pi*6000*i/96000)+std::polar(weak,2*pi*9000*i/96000));
      const auto floor_limited=cw::carriers(spectrum,96000,-39000,39000,4);
      require(floor_limited.size()==(weak<0.0001?1:2),"Numerical-floor rejection preserves eligible weaker carriers");
      require(std::abs(floor_limited[0].offset_hz-6000)<2,"Strong carrier remains independently attributed");
      if(floor_limited.size()==2)require(std::abs(floor_limited[1].offset_hz-9000)<2,"Above-floor weak carrier is not suppressed");
    }
    for(int samples_per_tick:{8,40}) {
      const double interval=double(samples_per_tick)/3200;
      for(int speed:{10,15,20,25,30,35,40}) {
        cw::KeyingSpeed measured{size_t(samples_per_tick)};
        for(int repeat=0;repeat<12;++repeat) {
          const int ticks=int(std::round((repeat%2?3:1)*1.2/speed/interval));
          for(int tick=0;tick<ticks;++tick) measured.tick(true);
          for(int tick=0;tick<8;++tick) measured.tick(false);
        }
        const auto estimate=measured.estimate();
        require(estimate && std::abs(*estimate-speed)<=2,"Observed dot/dash speed estimate");
        measured.reset();
        require(!measured.estimate(),"Reset removes previous keying-speed evidence");
        for(int repeat=0;repeat<12;++repeat) {
          const int ticks=int(std::round((repeat%2?3:1)*1.2/speed/interval));
          for(int tick=0;tick<ticks;++tick) measured.tick(true);
          if(repeat==0) { // The remaining partial mark is invalid.
            measured.reset();
            for(int tick=0;tick<ticks;++tick) measured.tick(true);
          }
          for(int tick=0;tick<8;++tick) measured.tick(false);
        }
        require(!measured.estimate(),"Reset cannot count a partially observed mark toward twelve runs");
        for(int tick=0;tick<int(std::round(1.2/speed/interval));++tick) measured.tick(true);
        for(int tick=0;tick<8;++tick) measured.tick(false);
        require(bool(measured.estimate()),"Twelve complete post-reset runs can establish speed");
        for(int tick=0;tick<8000/samples_per_tick;++tick) measured.tick(false);
        require(!measured.estimate(),"Stale keying speed expires in physical seconds");
      }
      cw::KeyingSpeed carrier_speed{size_t(samples_per_tick)};
      for(int tick=0;tick<10000;++tick)carrier_speed.tick(true);
      require(!carrier_speed.estimate(),"Unmodulated carrier has no invented WPM");
      cw::KeyingSpeed irregular{size_t(samples_per_tick)};
      for(double duration:{.017,.113,.032,.067,.193,.025,.301,.047,.137,.091,.263,.011,.167,.053,.401,.079}) {
        for(int tick=0;tick<int(std::round(duration/interval));++tick)irregular.tick(true);
        for(int tick=0;tick<8;++tick)irregular.tick(false);
      }
      require(!irregular.estimate(),"Inconsistent key-down durations stay unknown");
    }
    for(int rate:{24000,48000,96000,192000,384000}) {
      cw::Channelizer channel(rate,6200);
      cw::Channelizer reference_channel(rate,6200,false);
      for(double invalid:{double(NAN),double(rate)/2}) {
        bool refused=false;try {channel.retune(invalid);} catch(...) {refused=true;}
        require(refused,"Invalid tracking offsets cannot alter a channelizer");
      }
      std::vector<float> audio;
      for(int block=0;block<rate/4000;++block) {
        // The independent scalar reference never retunes. Resetting NCO phase,
        // FIR history or sample indices here would break their sample parity.
        channel.retune(6200);
        std::vector<std::complex<float>> iq(4000);
        for(size_t i=0;i<iq.size();++i) iq[i]=std::complex<float>(std::polar(0.4,2*pi*6200*(block*4000+i)/rate));
        const auto output=channel.process(iq),reference=reference_channel.process(iq);
        require(output.size()==reference.size(),"Accelerated/scalar rational phase count agrees");
        for(size_t i=0;i<output.size();++i)require(std::abs(output[i]-reference[i])<0.00001,"Accelerated FIR agrees with scalar reference");
        audio.insert(audio.end(),output.begin(),output.end());
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
        for(size_t i=0;i<iq.size();++i) iq[i]=std::complex<float>(std::polar(12.65,2*pi*6500*(block*4000+i)/rate));
        for(float f:rejection.process(iq)) { if(index++>400) { leak+=f*f; ++total; } }
      }
      require(leak/total < 0.08*0.001,"Thirty-dB stronger neighbour at 300 Hz rejected");
    }
    cw::Engine engine(argv[1]);
    if(argc==3) {
      cw::EngineProfile profile;
      const std::string selected=argv[2];profile.steady_ten_second=selected.find("-steady")!=std::string::npos;
      profile.measure_thread_execution=selected=="cpu-attribution";
      if(selected=="system-allocator") profile.cpu_mem_arena=false;
      else if(selected=="cpu-intra4") profile.intra_op_threads=4;
      else if(selected=="coreml" || selected=="coreml-steady") profile.provider=cw::ExecutionProvider::core_ml;
      else if(selected=="coreml-neural" || selected=="coreml-neural-steady") profile.provider=cw::ExecutionProvider::core_ml_neural_network;
      else if(selected=="coreml-neural-gpu" || selected=="coreml-neural-gpu-steady") profile.provider=cw::ExecutionProvider::core_ml_neural_network_gpu;
      cw::Engine accelerated(argv[1],profile);
      auto full=morse(20);full.resize(32000);
      for(const auto& audio:{std::vector<float>(19200),morse(20),morse(30),std::vector<float>(32000),full}) {
        const auto cpu=engine.decode(audio,3200);
        require(!cpu.run_calling_thread_cpu_ms && !cpu.requested_worker_qos,"Default engine performs no thread attribution");
        std::vector<cw::Decode> copies;
        if(selected=="cpu-shared8") {
          std::vector<std::future<cw::Decode>> jobs;
          for(size_t i=0;i<8;++i) jobs.push_back(std::async(std::launch::async,[&]{return accelerated.decode(audio,3200);}));
          for(auto& job:jobs) copies.push_back(job.get());
        } else copies.push_back(accelerated.decode(audio,3200));
        for(const auto& other:copies) {
          if(profile.measure_thread_execution) {
#if defined(__APPLE__)
            require(other.run_calling_thread_cpu_ms && std::isfinite(*other.run_calling_thread_cpu_ms) && *other.run_calling_thread_cpu_ms>0,
              "Opt-in CPU clock measures calling-thread work");
            require(other.requested_worker_qos.has_value(),"Opt-in requested QoS is observed on Mac");
#endif
          }
          if(profile.steady_ten_second) require(other.used_steady_plan==(audio.size()/48+1==667),"Exact shape selects bounded shared plan");
          require(cpu.text==other.text && cpu.tokens.size()==other.tokens.size(),"Profile/CPU fixture text parity");
          for(size_t i=0;i<cpu.tokens.size();++i) {
            const auto a=cpu.tokens[i],b=other.tokens[i];
            if(a.symbol!=b.symbol || a.first_sample!=b.first_sample || a.end_sample!=b.end_sample)
              std::cerr<<"Profile token mismatch: samples="<<audio.size()<<" steady="<<other.used_steady_plan<<" token="<<i
                <<" CPU="<<a.symbol<<":"<<a.first_sample<<".."<<a.end_sample<<" profile="<<b.symbol<<":"<<b.first_sample<<".."<<b.end_sample<<"\n";
            require(a.symbol==b.symbol && a.first_sample==b.first_sample && a.end_sample==b.end_sample,"Profile/CPU fixture sample alignment parity");
            if(profile.provider==cw::ExecutionProvider::cpu) require(std::abs(a.log_score-b.log_score)<0.0001,"CPU profile fixture score parity");
          }
        }
      }
      if(selected=="cpu-shared8") {
        std::cout<<"40 shared-session CPU text/token/sample/score parity cases passed\n";
        return 0;
      }
      if(selected=="cpu-steady-parity") {
        std::cout<<"5 dynamic/static CPU text/token/sample/score parity cases passed\n";
        return 0;
      }
      if(selected=="cpu-attribution") {
        std::cout<<"5 opt-in CPU attribution text/token/sample/score parity cases passed\n";
        return 0;
      }
    }
    require(engine.decode(std::vector<float>(19200),0).text.empty(),"Silence must not decode a call");
    for(int speed:{20,30}) {
      auto result=engine.decode(morse(speed),3200);
      std::cout<<speed<<" WPM: ["<<result.text<<"] "<<result.inference_ms<<" ms\n";
      require(result.text.find("CQ OM0RX")!=std::string::npos,"Synthetic Morse decoding");
      for(auto t:result.tokens) require(t.first_sample>=3200 && t.end_sample>=t.first_sample,"Absolute sample alignment");
    }
    // Known-speed waveform through the actual channelizer/track envelope.
    // Rounded boolean ticks alone hide the 35-WPM timing-resolution failure.
    // Include pre-carrier noise: history priming must not poison the speed of
    // a subsequently clear carrier with unrelated short noise excursions.
    for(bool with_noise:{false,true}) for(size_t alignment:{0,8,16,24,32}) {
      cw::Skimmer speed_track(engine,1);
      const std::string speed_source="99887766554433221100ffeeddccbbaa";
      speed_track.open(speed_source,1,48000,-21000,21000,true);
      auto key=morse(35,"CQ AB7DXQ AB7DXQ",true,false,48000);
      key.insert(key.begin(),alignment*15,0);
      std::mt19937 speed_random(83100631);
      std::normal_distribution<float> speed_noise(0,0.002f);
      const double final_key=double(key.size()-24000)/48000-3*1.2/35;
      size_t eligible=0,known=0;uint64_t sequence=0;
      for(size_t first=0;first<key.size();first+=4096) {
        const size_t count=std::min(size_t(4096),key.size()-first);
        std::vector<std::complex<float>> iq(count);
        for(size_t i=0;i<count;++i) {
          const size_t n=first+i;
          iq[i]=std::complex<float>(std::polar(0.05*key[n],2*pi*(-10700.6)*n/48000));
          if(with_noise) iq[i]+=std::complex<float>(speed_noise(speed_random),speed_noise(speed_random));
        }
        speed_track.feed(speed_source,1,sequence++,first,48000,iq);
        require(speed_track.wait_idle(10),"Known-speed IQ drains every required job");
        for(const auto& event:speed_track.events()) if(event.kind=="decode" && std::abs(event.offset_hz+10700.6)<25) {
          const double capture_end=double(event.source_first_sample)/48000+double(event.end_sample)/3200-event.filter_delay_seconds;
          if(capture_end>=6 && capture_end<=final_key) {
            ++eligible;
            std::cout<<"35 WPM IQ noise "<<with_noise<<" alignment "<<alignment<<": "<<(event.estimated_wpm?std::to_string(*event.estimated_wpm):"unknown")<<"\n";
            if(event.estimated_wpm) {++known;require(std::abs(*event.estimated_wpm-35)<=2,"Measured 35-WPM IQ remains within two WPM");}
          }
        }
      }
      require(eligible>=1 && known*5>=eligible*4,"Known-speed 35-WPM IQ has measured speed on at least 80 percent of eligible windows");
    }
    // Two independent CW signals in IQ, extracted and decoded through the
    // actual tracker/scheduler. Offline draining proves function, not capacity.
    cw::Skimmer skimmer(engine,2);
    const std::string source="00112233445566778899aabbccddeeff";
    const std::string second_source="ffeeddccbbaa99887766554433221100";
    skimmer.open(source,7,96000,-39000,39000,true);
    skimmer.open(second_source,9,48000,-19000,19000,true);
    rejected=false;
    try { skimmer.open("11112233445566778899aabbccddeeff",1,96000,-39000,39000,true); } catch(...) { rejected=true; }
    require(rejected,"Two total spans, no silent four-span expansion");
    const auto a=morse(20,"CQ OM0RX",true),b=morse(30,"CQ DL1ABC",true),c=morse(25,"CQ DL1ABC",true);
    std::mt19937 random(728396); std::normal_distribution<float> noise(0,0.002f);
    uint64_t sequence=0,second_sequence=0;
    std::map<std::string,std::string> transcripts;
    std::string mute_target;
    bool muted_during_feed=false;
    bool focus_exercised=false;
    for(size_t first=0;first<96000*10;first+=4096) {
      const size_t count=std::min(size_t(4096),size_t(96000*10)-first);
      std::vector<std::complex<float>> block(count);
      for(size_t i=0;i<count;++i) {
        const size_t n=first+i, audio_index=n/30;
        const auto envelope=[&](const std::vector<float>& e) {
          if(audio_index+1>=e.size()) return 0.0;
          const double f=double(n%30)/30;
          return e[audio_index]*(1-f)+e[audio_index+1]*f;
        };
        block[i]=std::complex<float>(std::polar(envelope(a),2*pi*6200*n/96000)+std::polar(envelope(b),-2*pi*4100*n/96000))+
          std::complex<float>(noise(random),noise(random));
      }
      skimmer.feed(source,7,sequence++,first,96000,block);
      std::vector<std::complex<float>> other(count/2);
      for(size_t i=0;i<other.size();++i) {
        const size_t n=first/2+i,index=n/15;
        double key=0;
        if(index+1<c.size()) { const double f=double(n%15)/15; key=c[index]*(1-f)+c[index+1]*f; }
        other[i]=std::complex<float>(std::polar(key,2*pi*8500*n/48000))+std::complex<float>(noise(random),noise(random));
      }
      skimmer.feed(second_source,9,second_sequence++,first/2,48000,other);
      if(!muted_during_feed && first>=96000*8 && !mute_target.empty()) {
        require(skimmer.mute(source,7,mute_target),"Mute during active source ingestion");muted_during_feed=true;
      }
      require(skimmer.wait_idle(10),"Bounded inference drain");
      for(const auto& event:skimmer.events()) { if(event.kind=="track") std::cout<<"Track "<<event.offset_hz<<" "<<event.state<<"\n"; if(event.kind=="decode") {
        require(!muted_during_feed || event.track_id!=mute_target,"No decode after mute during continued IQ");
        require((event.epoch==7 && event.stream_token==source)||(event.epoch==9&&event.stream_token==second_source),"Original capture identity on multitrack copy");
        require(event.replay,"Replay provenance on derived copy");
        transcripts[event.stream_token==second_source?"second":event.offset_hz>0?"positive":"negative"]=event.copy.text;
        if(event.stream_token==source && event.offset_hz>0) {
          mute_target=event.track_id;
          require(!skimmer.focus(second_source,7,event.track_id,event.track_revision),"Focus cannot cross stream identity");
          require(!skimmer.focus(source,8,event.track_id,event.track_revision),"Focus cannot cross capture epoch");
          require(!skimmer.focus(source,7,event.track_id,UINT64_MAX),"Focus cannot cross track revision");
          require(skimmer.focus(source,7,event.track_id,event.track_revision),"Current native track receives priority");focus_exercised=true;
        }
        std::cout<<"IQ "<<event.offset_hz<<" Hz ["<<event.copy.text<<"]\n";
      } }
    }
    std::cout<<"Final tracks "<<skimmer.metrics().tracks<<" pending "<<skimmer.metrics().pending<<"\n";
    require(transcripts["positive"].find("OM0RX")!=std::string::npos,"Positive IQ carrier independently decoded");
    require(transcripts["negative"].find("DL1ABC")!=std::string::npos,"Negative IQ carrier independently decoded");
    require(transcripts["second"].find("DL1ABC")!=std::string::npos,"Independent second-rate span decoded");
    require(skimmer.metrics().tracks==3,"Independent carrier tracking, no mirrored station");
    require(!mute_target.empty(),"Retained mute target exists");
    require(muted_during_feed,"Mute exercised with continued IQ after admission");
    require(focus_exercised,"Native focused scheduling exercised during two-span decoding");skimmer.clear_focus();
    require(!skimmer.mute(second_source,9,mute_target),"Mute cannot cross stream identity");
    require(!skimmer.mute(source,8,mute_target),"Mute cannot cross capture epoch");
    require(skimmer.mute(source,7,mute_target),"Mute retained track");
    bool muted=false;
    for(const auto& event:skimmer.events()) {
      require(event.kind!="decode" || event.track_id!=mute_target,"Queued muted result cannot escape");
      if(event.track_id==mute_target && event.state=="muted") muted=true;
    }
    require(muted,"Native mute acknowledges exact track");
    skimmer.feed(source,7,sequence+1,960000,96000,std::vector<std::complex<float>>(512));
    require(skimmer.metrics().sources==1,"A sample gap retires only its source");
    skimmer.feed(second_source,9,second_sequence,480000,48000,std::vector<std::complex<float>>(512));
    require(skimmer.metrics().sources==1,"Healthy other span retains continuity");
    require(skimmer.wait_idle(10),"Cancel drain");
    for(const auto& event:skimmer.events()) require(event.kind!="decode"||event.stream_token!=source,"No late copy after source retirement");
    skimmer.stop(); require(skimmer.metrics().sources==0,"Stop retires every span");
    // Independent analytic chirps verify signed RF attribution as a carrier
    // drifts. Offline draining isolates correctness from capacity qualification.
    for(double drift:{8.0,-8.0}) {
      const double initial=drift>0?6200:-6100;
      cw::Skimmer moving(engine,1);moving.open(source,11,96000,-39000,39000,true);
      uint64_t seq=0;size_t copies=0,rf_tokens=0,measured_windows=0;double maximum_error=0,maximum_token_rf_error=0;bool identified=false;
      std::set<std::string> identities;
      for(size_t first=0;first<96000*8;first+=4096) {
        const size_t count=std::min(size_t(4096),size_t(96000*8)-first);
        std::vector<std::complex<float>> block(count);
        for(size_t i=0;i<count;++i) {
          const size_t n=first+i,index=(n/30)%a.size();const double t=double(n)/96000,fraction=double(n%30)/30;
          const double key=a[index]*(1-fraction)+a[(index+1)%a.size()]*fraction;
          block[i]=std::complex<float>(std::polar(key,2*pi*(initial*t+0.5*drift*t*t)));
        }
        moving.feed(source,11,seq++,first,96000,block);require(moving.wait_idle(10),"Drift correctness drain");
        for(const auto& event:moving.events()) {
          if(event.kind=="track") identities.insert(event.track_id);
          if(event.kind!="decode") continue;
          ++copies;const double t=double(event.source_first_sample)/96000+double(event.end_sample)/3200;
          maximum_error=std::max(maximum_error,std::abs(event.offset_hz-(initial+drift*t)));
          require(maximum_error<=10,"Gradual signed drift must update RF attribution within 10 Hz");
          if(event.rf) {
            ++measured_windows;
            require(event.rf->sample<=event.end_sample && event.end_sample-event.rf->sample<=1600,"Current RF retains the actual observation's bounded sample time");
            const double observed_time=double(event.source_first_sample)/96000+double(event.rf->sample)/3200-event.filter_delay_seconds;
            require(std::abs(event.rf->offset_hz-(initial+drift*observed_time))<=10,"Current RF observation follows either signed chirp without borrowing a later carrier");
          }
          if(event.copy.text.find("OM0RX")!=std::string::npos) for(const auto& token:event.copy.tokens) if(token.symbol=='X')
            require(bool(token.rf),"Every completed synthetic self-ID needs measured last-character RF; withholding cannot hide the frequency error");
          for(const auto& token:event.copy.tokens) if(token.rf) {
            require(token.rf->sample<=token.end_sample && token.end_sample-token.rf->sample<=1600,"Carrier observation must precede its token and remain within half a second");
            const double token_time=double(event.source_first_sample)/96000+double(token.end_sample)/3200-event.filter_delay_seconds;
            const double error=std::abs(token.rf->offset_hz-(initial+drift*token_time));
            if(error>10) std::cerr<<"Historical RF error: symbol="<<token.symbol<<" end="<<token.end_sample<<" observed="<<token.rf->sample
              <<" offset="<<token.rf->offset_hz<<" true_at_token="<<(initial+drift*token_time)<<" error="<<error<<"\n";
            maximum_token_rf_error=std::max(maximum_token_rf_error,error);
            require(maximum_token_rf_error<=10,"Historical token RF follows the independent analytic chirp within 10 Hz");++rf_tokens;
          }
          identified=identified || event.copy.text.find("OM0RX")!=std::string::npos;
        }
      }
      require(copies>0 && identified,"Original decoder follows keyed drift without losing copy");
      require(rf_tokens>0,"Historical tokens require measured carrier observations, not the later window frequency");
      require(measured_windows>0,"Signed drift produces actual current RF evidence, not only diagnostic offsets");
      require(identities.size()==1 && moving.metrics().tracks==1,"Drift retains one track, without mirrored or duplicate carriers");
      require(moving.metrics().coalesced==0 && moving.metrics().dropped_events==0,"Drift fixture does not hide lost work");
      const auto complete=moving.metrics();
      require(complete.submitted_jobs==copies && complete.model_jobs_started==copies && complete.model_jobs_completed==copies && complete.invalidated_jobs==0,
        "Every submitted isolated-drift job completes without hidden invalidation");
      std::cout<<"Signed drift "<<drift<<" Hz/s: "<<copies<<" copies, maximum RF error "<<maximum_error<<" Hz, observed tokens="<<rf_tokens
        <<" maximum historical-token RF error="<<maximum_token_rf_error<<" Hz\n";
      moving.stop();
    }
    for(const bool recover:{false,true}) {
    cw::Skimmer converging(engine,1);converging.open(source,12,96000,-39000,39000,true);
    bool conflict_visible=false,fresh_recovered=false;uint64_t converging_sequence=0;size_t recovered_copies=0;
    std::map<std::string,uint64_t> fences;
    const size_t input_samples=96000*(recover?16:8);
    for(size_t first=0;first<input_samples;first+=4096) {
      const size_t count=std::min(size_t(4096),input_samples-first);
      std::vector<std::complex<float>> block(count);
      for(size_t i=0;i<count;++i) {
        const size_t n=first+i;const double t=double(n)/96000,fraction=double(n%30)/30;
        const auto key=[&](const auto& message){const auto at=(n/30)%message.size();return message[at]*(1-fraction)+message[(at+1)%message.size()]*fraction;};
        double displacement=10*t*t;
        if(recover && t>4) {const double u=std::min(t-4,4.0);displacement=160+80*u-10*u*u;}
        block[i]=std::complex<float>(std::polar(key(a),2*pi*(6200*t+displacement))+std::polar(key(b),2*pi*(6600*t-displacement)));
      }
      converging.feed(source,12,converging_sequence++,first,96000,block);
      require(converging.wait_idle(10),"Converging-carrier correctness drain");
      for(const auto& event:converging.events()) {
        if(event.kind=="track" && event.track_revision>0) fences[event.track_id]=std::max(fences[event.track_id],event.end_sample);
        if(event.kind=="track" && event.ambiguous) {
          conflict_visible=true;
          require(event.first_sample==event.end_sample && event.end_sample>0,"Ambiguity revision carries its actual continuity fence");
        }
        if(event.kind=="decode") {
          require(recover,"Converging unresolved carriers must not resume historical copy through frozen offsets");
          const double t=double(event.source_first_sample)/96000+double(event.end_sample)/3200;
          const double gap=t>=8?400:t<=4?400-40*t:240+40*(t-4);
          require(conflict_visible && gap>=300 && fences.count(event.track_id)>0,"Recovery requires fresh separated evidence and a revised track");
          ++recovered_copies;std::string fresh;
          for(const auto& token:event.copy.tokens) if(token.first_sample>=fences.at(event.track_id)) fresh+=token.symbol;
          fresh_recovered=fresh_recovered || fresh.find("OM0RX")!=std::string::npos || fresh.find("DL1ABC")!=std::string::npos;
        }
      }
    }
    require(conflict_visible,"Converging carriers expose their identity conflict");
    if(recover) require(fresh_recovered && converging.metrics().tracks==2,"Separated carriers recover fresh copy on two retained tracks");
    std::cout<<"Converging carriers recovery="<<recover<<": "<<recovered_copies<<" post-conflict copies, fresh="<<fresh_recovered<<"\n";
    converging.stop();
    }
    // Deliberately leave derived output unread, while draining inference. This
    // forces output loss without depending on machine speed or a fake decoder.
    for(const bool drain_inference:{true,false}) {
    cw::Skimmer unread(engine,1);unread.open(source,10,96000,-39000,39000,true);
    uint64_t unread_sequence=0;
    const size_t input_samples=96000*(drain_inference?12:24);
    for(size_t first=0;first<input_samples;first+=4096) {
      const size_t count=std::min(size_t(4096),input_samples-first);
      std::vector<std::complex<float>> block(count);
      for(size_t i=0;i<count;++i) {
        const size_t n=first+i,index=(n/30)%a.size();
        const double fraction=double(n%30)/30;
        const double key=a[index]*(1-fraction)+a[(index+1)%a.size()]*fraction;
        block[i]=std::complex<float>(std::polar(key,2*pi*6200*n/96000));
      }
      unread.feed(source,10,unread_sequence++,first,96000,block);
      require(unread.metrics().pending<=1 && unread.metrics().in_flight<=1,"Injected overload keeps bounded queues");
      if(drain_inference) require(unread.wait_idle(10),"Unread-output inference drain");
    }
    require(unread.wait_idle(10),"Injected overload eventually drains");
    const auto results=unread.events();
    const auto loss=unread.metrics();
    std::cout<<"Injected "<<(drain_inference?"output":"inference")<<" overload: "<<loss.coalesced<<" coalesced / "<<loss.dropped_events
      <<" dropped events, submitted="<<loss.submitted_jobs<<" started="<<loss.model_jobs_started<<" completed="<<loss.model_jobs_completed<<" invalidated="<<loss.invalidated_jobs<<"\n";
    require(loss.model_jobs_completed==loss.model_jobs_started && loss.model_jobs_completed<=loss.submitted_jobs,"Overload ledger retains actual completed model work");
    if(drain_inference) require(loss.coalesced==0 && loss.dropped_events>0,"Real derived output loss was injected");
    else require(loss.coalesced>0 && loss.submitted_jobs>loss.model_jobs_completed,"Real pending inference loss was injected and reported");
    bool revised_copy=false;
    for(const auto& event:results) if(event.kind=="decode") {
      require(event.track_revision>0,"Lost derived copy invalidates track continuity");
      require(!unread.focus(source,10,event.track_id,0),"Pre-loss control revision cannot survive output loss");
      revised_copy=true;
    }
    require(revised_copy,"Post-loss copy reports a fresh continuity revision");unread.stop();
    }
    std::cout<<"Native CW engine checks passed\n";
    return 0;
  } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
