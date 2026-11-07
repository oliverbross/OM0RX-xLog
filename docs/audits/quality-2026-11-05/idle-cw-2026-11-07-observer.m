// Read-only, candidate-specific metadata/visibility observer. No AX actions,
// images, event taps, app activation, termination, or signal operations.
#ifndef XLOG_CANDIDATE_SOURCE
#error "Compile with the actual frozen candidate source SHA"
#endif
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <sys/resource.h>
#import <mach/mach_time.h>
#import <unistd.h>
static BOOL done=NO, valid=YES;
static AXUIElementRef targetApp=NULL,targetWindow=NULL;
static pid_t targetPID=0;
static NSDictionary *proof;
static uint64_t startTicks,lastTicks,lastStateTicks;
static double maxGap=0;
static NSUInteger events=0,states=0;
static mach_timebase_info_data_t timebase;
static double seconds(uint64_t ticks){return (double)ticks*timebase.numer/timebase.denom/1e9;}
static void emit(NSDictionary *value){
 NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
 if(!data) exit(3);
 write(STDOUT_FILENO,data.bytes,data.length); write(STDOUT_FILENO,"\n",1);
}
static NSDictionary *identity(pid_t pid){
 struct proc_bsdinfo b={0}; char path[PROC_PIDPATHINFO_MAXSIZE]={0};
 if(pid<=1 || proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=sizeof(b) ||
    b.pbi_pid!=(uint32_t)pid || proc_pidpath(pid,path,sizeof(path))<=0 || !b.pbi_start_tvsec)
  @throw [NSException exceptionWithName:@"Guard" reason:@"Native process identity unavailable" userInfo:nil];
 return @{@"pid":@(pid),@"ppid":@(b.pbi_ppid),@"uid":@(b.pbi_uid),
          @"birthSeconds":@(b.pbi_start_tvsec),@"birthMicroseconds":@(b.pbi_start_tvusec),
          @"nativePath":@(path)};
}
static id attribute(AXUIElementRef e,CFStringRef name){
 CFTypeRef v=NULL; AXError error=AXUIElementCopyAttributeValue(e,name,&v);
 if(error!=kAXErrorSuccess || !v) @throw [NSException exceptionWithName:@"Guard" reason:@"Required AX state unavailable" userInfo:nil];
 return CFBridgingRelease(v);
}
static void finish(NSString *reason,BOOL success){
 if(done)return;done=YES;valid=success;
 struct rusage usage={0};getrusage(RUSAGE_SELF,&usage);
 emit(@{@"type":@"finished",@"success":@(success),@"reason":reason,@"elapsedSeconds":@(seconds(mach_continuous_time()-startTicks)),
        @"events":@(events),@"stateSamples":@(states),@"maximumHeartbeatGapSeconds":@(maxGap),
        @"observerUserSeconds":@(usage.ru_utime.tv_sec+usage.ru_utime.tv_usec/1e6),
        @"observerSystemSeconds":@(usage.ru_stime.tv_sec+usage.ru_stime.tv_usec/1e6),
        @"scope":@"Continuous workspace/AX events plus one-second window-list checks; not continuous pixel occlusion proof"});
 CFRunLoopStop(CFRunLoopGetMain());
}
static NSDictionary *checkState(void){
 for(NSDictionary *owner in proof[@"ownerIdentities"])
  if(![identity([owner[@"pid"] intValue]) isEqual:owner])
   @throw [NSException exceptionWithName:@"Guard" reason:@"Attributed process identity changed" userInfo:nil];
 NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:targetPID];
 if(!app || app.terminated || app.hidden || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=targetPID)
  @throw [NSException exceptionWithName:@"Guard" reason:@"Candidate is not the visible foreground application" userInfo:nil];
 if([attribute(targetWindow,kAXMinimizedAttribute) boolValue] ||
    !CFEqual((__bridge CFTypeRef)attribute(targetApp,kAXFocusedWindowAttribute),targetWindow))
  @throw [NSException exceptionWithName:@"Guard" reason:@"Candidate main window minimized or focus changed" userInfo:nil];
 CGPoint point;CGSize size;
 id p=attribute(targetWindow,kAXPositionAttribute),s=attribute(targetWindow,kAXSizeAttribute);
 if(CFGetTypeID((__bridge CFTypeRef)p)!=AXValueGetTypeID() || CFGetTypeID((__bridge CFTypeRef)s)!=AXValueGetTypeID() ||
    !AXValueGetValue((__bridge AXValueRef)p,kAXValueCGPointType,&point) ||
    !AXValueGetValue((__bridge AXValueRef)s,kAXValueCGSizeType,&size) || size.width<=0 || size.height<=0)
  @throw [NSException exceptionWithName:@"Guard" reason:@"Candidate window geometry unavailable" userInfo:nil];
 CGRect target=CGRectMake(point.x,point.y,size.width,size.height);
 CGDirectDisplayID displays[16];uint32_t count=0;BOOL onDisplay=NO;
 if(CGGetActiveDisplayList(16,displays,&count)!=kCGErrorSuccess || count==0 || count>=16)
  @throw [NSException exceptionWithName:@"Guard" reason:@"Display inventory unavailable" userInfo:nil];
 for(uint32_t i=0;i<count;i++)if(CGRectContainsRect(CGDisplayBounds(displays[i]),target))onDisplay=YES;
 if(!onDisplay)@throw [NSException exceptionWithName:@"Guard" reason:@"Candidate window is not fully on one active display" userInfo:nil];
 NSArray *windows=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly|kCGWindowListExcludeDesktopElements,kCGNullWindowID));
 NSMutableArray *above=[NSMutableArray array];NSDictionary *match=nil;NSUInteger matches=0;
 for(NSDictionary *w in windows){
  CGRect bounds; if(!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)w[(id)kCGWindowBounds],&bounds))continue;
  BOOL same=[w[(id)kCGWindowOwnerPID] intValue]==targetPID && [w[(id)kCGWindowLayer] intValue]==0 &&
    fabs(bounds.origin.x-target.origin.x)<1 && fabs(bounds.origin.y-target.origin.y)<1 &&
    fabs(bounds.size.width-target.size.width)<1 && fabs(bounds.size.height-target.size.height)<1;
  if(same){matches++;if(!match)match=w;}
  else if(!match && [w[(id)kCGWindowAlpha] doubleValue]>0 && CGRectIntersectsRect(target,bounds))
   [above addObject:w];
 }
 if(matches!=1 || ![match[(id)kCGWindowIsOnscreen] boolValue] || [match[(id)kCGWindowAlpha] doubleValue]<0.99 || above.count){
  emit(@{@"type":@"occlusion-diagnostic",@"matches":@(matches),@"above":above,@"match":match?:@{},@"AXTarget":CFBridgingRelease(CGRectCreateDictionaryRepresentation(target))});
  @throw [NSException exceptionWithName:@"Guard" reason:@"Candidate window visibility/occlusion is not established" userInfo:nil];
 }
 return @{@"frontmostPID":@(targetPID),@"windowID":match[(id)kCGWindowNumber],
          @"bounds":match[(id)kCGWindowBounds],@"onscreen":@YES,@"minimized":@NO,@"sampledOcclusion":@NO};
}
static void axEvent(AXObserverRef observer,AXUIElementRef element,CFStringRef name,void *context){
 (void)observer;(void)element;(void)context;
 if(done)return;events++;
 emit(@{@"type":@"ax-event",@"name":(__bridge NSString*)name,@"elapsedSeconds":@(seconds(mach_continuous_time()-startTicks))});
 // A later restored focus readback cannot establish that no intervening change occurred.
 finish(@"Registered window or focus state changed during the steady interval",NO);
}
int main(int argc,const char **argv){@autoreleasepool{
 @try{
  if(argc>=3 && strcmp(argv[1],"identity")==0){
   NSMutableArray *rows=[NSMutableArray array];for(int i=2;i<argc;i++){char *end=NULL;long v=strtol(argv[i],&end,10);if(!end||*end||v<=1||v>INT_MAX)exit(2);[rows addObject:identity((pid_t)v)];}
   emit(@{@"identities":rows});return 0;
  }
  BOOL preflight=argc==3 && strcmp(argv[1],"preflight")==0;
  if(argc!=3 || (!preflight && strcmp(argv[1],"watch")!=0))return 2;
  NSData *data=[NSData dataWithContentsOfFile:@(argv[2])];proof=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if(![proof[@"preUIIdentityProven"] boolValue] || ![proof[@"source"] isEqual:@XLOG_CANDIDATE_SOURCE] ||
     fabs(NSDate.date.timeIntervalSince1970-[proof[@"capturedUnixSeconds"] doubleValue])>10)
   @throw [NSException exceptionWithName:@"Guard" reason:@"Fresh candidate process-only proof required before UI observation" userInfo:nil];
  for(NSDictionary *owner in proof[@"ownerIdentities"])
   if(![identity([owner[@"pid"] intValue]) isEqual:owner])@throw [NSException exceptionWithName:@"Guard" reason:@"Pre-UI owner proof changed" userInfo:nil];
  targetPID=[proof[@"hostPID"] intValue];
  if(!AXIsProcessTrusted())@throw [NSException exceptionWithName:@"Guard" reason:@"Accessibility trust unavailable; no prompt, no interval" userInfo:nil];
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  targetApp=AXUIElementCreateApplication(targetPID);
  if(AXUIElementSetMessagingTimeout(targetApp,1.0)!=kAXErrorSuccess)
   @throw [NSException exceptionWithName:@"Guard" reason:@"Bounded AX read timeout unavailable" userInfo:nil];
  NSArray *windows=attribute(targetApp,kAXWindowsAttribute);NSUInteger found=0;
  for(id window in windows){NSString *title=attribute((__bridge AXUIElementRef)window,kAXTitleAttribute);
   if([title containsString:proof[@"marker"]]){targetWindow=(AXUIElementRef)CFRetain((__bridge CFTypeRef)window);found++;}}
  if(found!=1)@throw [NSException exceptionWithName:@"Guard" reason:@"Unique marked candidate window unavailable" userInfo:nil];
  if(preflight){
   NSDictionary *state=checkState();
   emit(@{@"type":@"preflight",@"success":@YES,@"state":state,@"samePredicateAsWatcher":@YES});
   CFRelease(targetWindow);CFRelease(targetApp);return 0;
  }
  AXObserverRef observer=NULL;
  if(AXObserverCreate(targetPID,axEvent,&observer)!=kAXErrorSuccess)@throw [NSException exceptionWithName:@"Guard" reason:@"AX observer unavailable" userInfo:nil];
  NSArray *appEvents=@[(__bridge NSString*)kAXFocusedWindowChangedNotification,(__bridge NSString*)kAXWindowCreatedNotification];
  NSArray *windowEvents=@[(__bridge NSString*)kAXWindowMiniaturizedNotification,(__bridge NSString*)kAXWindowDeminiaturizedNotification,
   (__bridge NSString*)kAXWindowMovedNotification,(__bridge NSString*)kAXWindowResizedNotification,
   (__bridge NSString*)kAXUIElementDestroyedNotification,(__bridge NSString*)kAXSheetCreatedNotification];
  for(NSString *name in appEvents)if(AXObserverAddNotification(observer,targetApp,(__bridge CFStringRef)name,NULL)!=kAXErrorSuccess)
   @throw [NSException exceptionWithName:@"Guard" reason:@"Mandatory application notification unsupported" userInfo:nil];
  for(NSString *name in windowEvents)if(AXObserverAddNotification(observer,targetWindow,(__bridge CFStringRef)name,NULL)!=kAXErrorSuccess)
   @throw [NSException exceptionWithName:@"Guard" reason:@"Mandatory window notification unsupported" userInfo:nil];
  CFRunLoopAddSource(CFRunLoopGetMain(),AXObserverGetRunLoopSource(observer),kCFRunLoopCommonModes);
  NSMutableArray *tokens=[NSMutableArray array];NSNotificationCenter *center=NSWorkspace.sharedWorkspace.notificationCenter;
  NSArray *global=@[NSWorkspaceActiveSpaceDidChangeNotification,NSWorkspaceScreensDidSleepNotification,NSWorkspaceSessionDidResignActiveNotification,NSWorkspaceWillSleepNotification];
  NSArray *application=@[NSWorkspaceDidActivateApplicationNotification,NSWorkspaceDidDeactivateApplicationNotification,
   NSWorkspaceDidHideApplicationNotification,NSWorkspaceDidUnhideApplicationNotification,NSWorkspaceDidTerminateApplicationNotification];
  for(NSNotificationName name in [global arrayByAddingObjectsFromArray:application]){
   [tokens addObject:[center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note){
    NSRunningApplication *changed=note.userInfo[NSWorkspaceApplicationKey];
    if([global containsObject:note.name] || changed.processIdentifier==targetPID ||
       [note.name isEqual:NSWorkspaceDidActivateApplicationNotification]){
     events++;emit(@{@"type":@"workspace-event",@"name":note.name});finish(@"Workspace focus/visibility/session state changed",NO);
    }
   }]];
  }
  mach_timebase_info(&timebase);startTicks=lastTicks=lastStateTicks=mach_continuous_time();
  NSDictionary *initial=checkState();emit(@{@"type":@"ready",@"observerPID":@(getpid()),@"state":initial,@"mandatoryAXNotificationsRegistered":@YES});
  NSTimer *timer=[NSTimer scheduledTimerWithTimeInterval:.25 repeats:YES block:^(NSTimer *t){
   (void)t;if(done)return;uint64_t now=mach_continuous_time();double gap=seconds(now-lastTicks);lastTicks=now;maxGap=fmax(maxGap,gap);
   if(gap>1.0){finish(@"Visibility observer heartbeat gap exceeds one second",NO);return;}
   if(seconds(now-startTicks)>315){finish(@"Controller did not finish the bounded interval",NO);return;}
   if(seconds(now-lastStateTicks)>=1.0){lastStateTicks=now;@try{NSDictionary *state=checkState();states++;emit(@{@"type":@"state",@"elapsedSeconds":@(seconds(now-startTicks)),@"state":state});}@catch(NSException *e){finish(e.reason,NO);}}
  }];
  NSFileHandle.fileHandleWithStandardInput.readabilityHandler=^(NSFileHandle *handle){
   NSData *input=handle.availableData;dispatch_async(dispatch_get_main_queue(),^{
    NSString *text=[[NSString alloc]initWithData:input encoding:NSUTF8StringEncoding];
    uint64_t now=mach_continuous_time();double finalGap=seconds(now-lastTicks);maxGap=fmax(maxGap,finalGap);
    BOOL complete=input.length>0 && [text isEqual:@"STOP\n"] && seconds(now-startTicks)>=300 && finalGap<=1.0;
    if(complete){@try{
     checkState();double afterReadGap=seconds(mach_continuous_time()-lastTicks);maxGap=fmax(maxGap,afterReadGap);
     if(afterReadGap>1.0){finish(@"Final visibility read exceeded the observation heartbeat bound",NO);return;}
    }@catch(NSException *e){finish(e.reason,NO);return;}}
    finish(complete?@"Completed requested observation":@"Controller closed, stopped early, or lost the observation heartbeat",complete);
   });
  };
  CFRunLoopRun();NSFileHandle.fileHandleWithStandardInput.readabilityHandler=nil;[timer invalidate];
  for(id token in tokens)[center removeObserver:token];CFRelease(observer);CFRelease(targetWindow);CFRelease(targetApp);
  return valid?0:2;
 }@catch(NSException *e){NSRunningApplication *candidate=[NSRunningApplication runningApplicationWithProcessIdentifier:targetPID];emit(@{@"type":@"blocked",@"reason":e.reason?:@"Unknown guard failure",@"targetPID":@(targetPID),@"frontmostPID":@(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),@"targetHidden":@(candidate.hidden),@"targetTerminated":@(candidate.terminated)});return 2;}
}}
