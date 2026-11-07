#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/proc.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/sysctl.h>
int main(void){struct kinfo_proc k={0};size_t n=sizeof(k);int mib[]={CTL_KERN,KERN_PROC,KERN_PROC_PID,79847};int result=sysctl(mib,4,&k,&n,NULL,0);char path[PROC_PIDPATHINFO_MAXSIZE]={0};int p=proc_pidpath(79847,path,sizeof(path));int pathError=errno;
 int verified=result==0&&n==sizeof(k)&&k.kp_proc.p_pid==79847&&k.kp_eproc.e_ppid==79485&&k.kp_eproc.e_ucred.cr_uid==getuid()&&k.kp_proc.p_stat==SZOMB&&p==0;
 printf("{\"pid\":%d,\"ppid\":%d,\"uid\":%u,\"sysctlResult\":%d,\"kernelBytes\":%zu,\"kernelStatus\":%d,\"SZOMB\":%d,\"pathBytes\":%d,\"pathErrno\":%d,\"birthSeconds\":%lld,\"birthMicroseconds\":%d,\"zombieVerified\":%s}\n",k.kp_proc.p_pid,k.kp_eproc.e_ppid,k.kp_eproc.e_ucred.cr_uid,result,n,k.kp_proc.p_stat,SZOMB,p,pathError,(long long)k.kp_proc.p_starttime.tv_sec,k.kp_proc.p_starttime.tv_usec,verified?"true":"false");
 return verified?0:2;
}
