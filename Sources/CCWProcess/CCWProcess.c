// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#include "CCWProcess.h"
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stddef.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int make_pipe(int ends[2]) {
    int raw[2];
    if (pipe(raw) != 0) return errno;
    ends[0] = fcntl(raw[0], F_DUPFD_CLOEXEC, 3);
    int saved = errno;
    ends[1] = ends[0] < 0 ? -1 : fcntl(raw[1], F_DUPFD_CLOEXEC, 3);
    if (ends[1] < 0 && ends[0] >= 0) saved = errno;
    close(raw[0]); close(raw[1]);
    if (ends[0] < 0 || ends[1] < 0) {
        if (ends[0] >= 0) close(ends[0]);
        if (ends[1] >= 0) close(ends[1]);
        ends[0] = ends[1] = -1;
        return saved;
    }
    return 0;
}

int xcw_spawn(const char *executable, const char *model, XCWChild *child) {
    if (!child) return EINVAL;
    *child = (XCWChild){.pid=-1,.input_fd=-1,.output_fd=-1,.error_fd=-1};
    if (!executable || executable[0]!='/' || !model || model[0]!='/' ||
        strnlen(executable,4097)>4096 || strnlen(model,4097)>4096) return EINVAL;
#if defined(__APPLE__) && defined(POSIX_SPAWN_CLOEXEC_DEFAULT)
    int pipes[3][2]={{-1,-1},{-1,-1},{-1,-1}}, result=0;
    for (int i=0;i<3;++i) { result=make_pipe(pipes[i]); if(result) goto done; }
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attributes;
    result=posix_spawn_file_actions_init(&actions);
    if(result) goto done;
    result=posix_spawnattr_init(&attributes);
    if(result) { posix_spawn_file_actions_destroy(&actions); goto done; }
    result=posix_spawnattr_setflags(&attributes,POSIX_SPAWN_CLOEXEC_DEFAULT);
    if(!result) result=posix_spawn_file_actions_adddup2(&actions,pipes[0][0],STDIN_FILENO);
    if(!result) result=posix_spawn_file_actions_adddup2(&actions,pipes[1][1],STDOUT_FILENO);
    if(!result) result=posix_spawn_file_actions_adddup2(&actions,pipes[2][1],STDERR_FILENO);
    for(int i=0;i<3 && !result;++i) for(int j=0;j<2 && !result;++j) result=posix_spawn_file_actions_addclose(&actions,pipes[i][j]);
    char *const arguments[]={(char *)executable,(char *)model,NULL};
    char *const environment[]={"PATH=/usr/bin:/bin","LANG=C","LC_ALL=C",NULL};
    pid_t pid=-1;
    if(!result) result=posix_spawn(&pid,executable,&actions,&attributes,arguments,environment);
    posix_spawnattr_destroy(&attributes); posix_spawn_file_actions_destroy(&actions);
    if(!result) {
        child->pid=(int32_t)pid;
        child->input_fd=pipes[0][1]; pipes[0][1]=-1;
        child->output_fd=pipes[1][0]; pipes[1][0]=-1;
        child->error_fd=pipes[2][0]; pipes[2][0]=-1;
    }
done:
    for(int i=0;i<3;++i) for(int j=0;j<2;++j) if(pipes[i][j]>=0) close(pipes[i][j]);
    return result;
#else
    return ENOTSUP;
#endif
}

int xcw_poll(int32_t pid,int *exit_code) {
    if(pid<=0 || !exit_code) return -EINVAL;
    int status=0; pid_t result;
    do { result=waitpid((pid_t)pid,&status,WNOHANG); } while(result<0 && errno==EINTR);
    if(result==0) return 0;
    if(result<0) return -errno;
    *exit_code=WIFEXITED(status)?WEXITSTATUS(status):WIFSIGNALED(status)?128+WTERMSIG(status):255;
    return 1;
}
int xcw_terminate(int32_t pid,int force) {
    if(pid<=0 || (force!=0 && force!=1)) return EINVAL;
    return kill((pid_t)pid,force?SIGKILL:SIGTERM)==0?0:errno;
}
