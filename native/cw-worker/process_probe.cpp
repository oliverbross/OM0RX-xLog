// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include <fcntl.h>
#include <cstdlib>
#include <iostream>
#include <cstring>
int main(int argc,char** argv) {
  for(int fd=3;fd<1024;++fd) if(fcntl(fd,F_GETFD)!=-1) { std::cerr<<"Inherited unrelated FD "<<fd<<'\n'; return 1; }
  if(argc!=2 || std::strcmp(argv[1],"/probe") || std::getenv("XCW_PARENT_SECRET")) return 2;
  if(!std::getenv("LC_ALL") || std::strcmp(std::getenv("LC_ALL"),"C")) return 3;
  std::cout<<"XCW_FD_OK\n"; std::cerr<<"isolated-probe\n"; return 0;
}
