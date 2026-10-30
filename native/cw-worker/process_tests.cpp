// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "CCWProcess.h"
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <cerrno>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <chrono>

std::string read_pipe(int fd) {
  std::string text; char bytes[512];
  while(true) {
    pollfd item{fd,POLLIN,0};
    if(poll(&item,1,2000)<=0) throw std::runtime_error("Pipe timeout");
    const auto count=read(fd,bytes,sizeof(bytes));
    if(count<0) throw std::runtime_error("Read failed");
    if(count==0) break;
    text.append(bytes,size_t(count));
    if(text.size()>4096) throw std::runtime_error("Unexpected probe output");
  }
  close(fd); return text;
}
int main(int argc,char** argv) {
  try {
    if(argc!=2) throw std::runtime_error("Probe path required");
    uint64_t resident=19;
    if(xcw_resident_bytes(-1,&resident)!=EINVAL || resident!=19 || xcw_resident_bytes(getpid(),nullptr)!=EINVAL) throw std::runtime_error("Invalid memory query changed evidence");
    if(xcw_resident_bytes(getpid(),&resident)!=0 || resident==0) throw std::runtime_error("Resident memory sample unavailable");
    setenv("XCW_PARENT_SECRET","must-not-cross-process-boundary",1);
    const int unrelated=open("/dev/null",O_RDONLY); // deliberately no CLOEXEC
    XCWChild child;
    if(xcw_spawn(argv[1],"/probe",&child)) throw std::runtime_error("Spawn failed");
    const auto output=read_pipe(child.output_fd),error=read_pipe(child.error_fd);
    close(unrelated);
    int status=-1,result=0;
    for(int i=0;i<200 && result==0;++i) { result=xcw_poll(child.pid,&status); std::this_thread::sleep_for(std::chrono::milliseconds(5)); }
    if(result!=1 || status!=0 || output!="XCW_FD_OK\n" || error!="isolated-probe\n") throw std::runtime_error("Child isolation/reap check failed: "+error);
    errno=0;
    if(write(child.input_fd,"x",1)!=-1 || errno!=EPIPE) throw std::runtime_error("Closed child pipe must report EPIPE without killing parent");
    close(child.input_fd);
    if(xcw_spawn("/definitely/missing/xlog-cw-worker","/probe",&child)!=ENOENT || child.pid!=-1) throw std::runtime_error("Spawn failure leaked child state");
    if(xcw_terminate(-1,1)!=EINVAL || xcw_poll(-1,&status)!=-EINVAL) throw std::runtime_error("Invalid PID guard");
    std::cout<<"Explicit FD/environment inheritance and child reap checks passed\n";
    return 0;
  } catch(const std::exception& error) { std::cerr<<error.what()<<'\n'; return 1; }
}
