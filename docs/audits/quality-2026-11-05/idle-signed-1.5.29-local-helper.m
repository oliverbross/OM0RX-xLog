#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <libproc.h>
#import <sys/proc_info.h>
static void need(BOOL x,NSString *s){if(!x)@throw [NSException exceptionWithName:@"Guard" reason:s userInfo:nil];}
static id attr(AXUIElementRef e,CFStringRef k){CFTypeRef v=NULL;if(AXUIElementCopyAttributeValue(e,k,&v)!=kAXErrorSuccess||!v)return nil;return CFBridgingRelease(v);}
static NSDictionary *identity(pid_t pid){struct proc_bsdinfo b={0};char path[PROC_PIDPATHINFO_MAXSIZE]={0};need(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))==sizeof(b)&&proc_pidpath(pid,path,sizeof(path))>0,@"Native identity unavailable");return @{@"pid":@(pid),@"ppid":@(b.pbi_ppid),@"uid":@(b.pbi_uid),@"birthSeconds":@(b.pbi_start_tvsec),@"birthMicroseconds":@(b.pbi_start_tvusec),@"nativePath":@(path)};}
static void emit(id x){NSData *d=[NSJSONSerialization dataWithJSONObject:x options:0 error:nil];need(d!=nil,@"JSON encoding failed");write(1,d.bytes,d.length);write(1,"\n",1);}
static void visit(AXUIElementRef e,NSMutableArray *rows,NSMutableSet *seen,int depth){
 if(depth>45||rows.count>6000||[seen containsObject:(__bridge id)e])return;[seen addObject:(__bridge id)e];
 NSString *role=attr(e,kAXRoleAttribute)?:@"",*title=attr(e,kAXTitleAttribute)?:@"",*desc=attr(e,kAXDescriptionAttribute)?:@"";id value=attr(e,kAXValueAttribute);
 [rows addObject:@{@"element":(__bridge id)e,@"role":role,@"title":title,@"description":desc,@"value":([value isKindOfClass:NSString.class]||[value isKindOfClass:NSNumber.class])?value:@""}];
 NSArray *children=attr(e,kAXChildrenAttribute);for(id child in children)visit((__bridge AXUIElementRef)child,rows,seen,depth+1);
}
static NSArray *tree(AXUIElementRef e){NSMutableArray *rows=[NSMutableArray array];visit(e,rows,[NSMutableSet set],0);return rows;}
static NSArray *named(NSArray *rows,NSString *text){NSPredicate *p=[NSPredicate predicateWithBlock:^BOOL(NSDictionary *r,NSDictionary *unused){return [r[@"description"] isEqual:text]||[r[@"title"] isEqual:text];}];return [rows filteredArrayUsingPredicate:p];}
static NSArray *publicRows(NSArray *rows){NSMutableArray *out=[NSMutableArray array];for(NSDictionary *r in rows){NSMutableDictionary *v=[r mutableCopy];[v removeObjectForKey:@"element"];[out addObject:v];}return out;}
static NSArray *surfaces(pid_t pid){NSArray *all=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly|kCGWindowListExcludeDesktopElements,kCGNullWindowID));NSMutableArray *out=[NSMutableArray array];for(NSDictionary *w in all){NSString *owner=w[(id)kCGWindowOwnerName]?:@"",*name=w[(id)kCGWindowName]?:@"";if([owner containsString:@"Computer Use"]||[name isEqual:@"Software Cursor"]||[owner isEqual:@"Dock"]||[w[(id)kCGWindowOwnerPID] intValue]==pid)[out addObject:w];}return out;}
int main(int argc,const char **argv){@autoreleasepool{@try{
 need(argc>=2,@"Action required");NSString *action=@(argv[1]);
 if([action isEqual:@"context"]){emit(@{@"metadataOnly":@YES,@"noScreenCapture":@YES,@"surfaces":surfaces(-1)});return 0;}
 need(argc==3,@"Fresh process-only proof required");NSDictionary *proof=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[2])] options:0 error:nil];
 need([proof[@"preUIIdentityProven"] boolValue]&&[proof[@"source"] isEqual:@"78681662f9104264d0903329996d15962c395711"]&&fabs(NSDate.date.timeIntervalSince1970-[proof[@"capturedUnixSeconds"] doubleValue])<10,@"Fresh exact-source process proof required");
 for(NSDictionary *r in proof[@"ownerIdentities"])need([identity([r[@"pid"] intValue]) isEqual:r],@"Proven process identity changed");
 pid_t pid=[proof[@"hostPID"] intValue];need(AXIsProcessTrusted(),@"AX trust unavailable; no prompt");
 NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:pid];need(app&&!app.terminated,@"Original candidate unavailable; never launch");
 if([action isEqual:@"dock-toggle"]){
  need(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier==pid,@"Candidate must remain foreground for normal Dock shortcut");
  NSDictionary *keys=CFBridgingRelease(CFPreferencesCopyAppValue(CFSTR("AppleSymbolicHotKeys"),CFSTR("com.apple.symbolichotkeys")));NSDictionary *key=keys[@"52"];
  need([key[@"enabled"] boolValue]&&[key[@"value"][@"parameters"] isEqual:@[@100,@2,@1572864]],@"Normal Dock shortcut mapping differs; no input");
  BOOL before=[CFBridgingRelease(CFPreferencesCopyAppValue(CFSTR("autohide"),CFSTR("com.apple.dock"))) boolValue];
  CGEventRef down=CGEventCreateKeyboardEvent(NULL,2,true),up=CGEventCreateKeyboardEvent(NULL,2,false);need(down&&up,@"Dock shortcut events unavailable");
  CGEventSetFlags(down,kCGEventFlagMaskCommand|kCGEventFlagMaskAlternate);CGEventSetFlags(up,kCGEventFlagMaskCommand|kCGEventFlagMaskAlternate);CGEventPost(kCGHIDEventTap,down);CGEventPost(kCGHIDEventTap,up);CFRelease(down);CFRelease(up);
  NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];BOOL after=before;do{[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.1]];CFPreferencesAppSynchronize(CFSTR("com.apple.dock"));after=[CFBridgingRelease(CFPreferencesCopyAppValue(CFSTR("autohide"),CFSTR("com.apple.dock"))) boolValue];}while(after==before&&deadline.timeIntervalSinceNow>0);
  need(after!=before,@"Dock preference did not change; no shortcut retry");emit(@{@"action":action,@"autohideBefore":@(before),@"autohideAfter":@(after),@"normalVerifiedShortcut":@YES,@"noScreenCapture":@YES,@"surfaces":surfaces(pid)});return 0;
 }
 AXUIElementRef ax=AXUIElementCreateApplication(pid);need(AXUIElementSetMessagingTimeout(ax,1)==kAXErrorSuccess,@"Bounded AX timeout unavailable");
 NSArray *windows=attr(ax,kAXWindowsAttribute);NSMutableArray *marked=[NSMutableArray array];for(id w in windows)if([attr((__bridge AXUIElementRef)w,kAXTitleAttribute) containsString:proof[@"marker"]])[marked addObject:w];need(marked.count==1,@"Unique marked window required");
 if([action isEqual:@"quit"]){need([app terminate],@"Ordinary Quit request rejected; no force fallback");emit(@{@"ordinaryQuitRequested":@YES,@"pid":@(pid),@"force":@NO});CFRelease(ax);return 0;}
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];need([app activateWithOptions:NSApplicationActivateIgnoringOtherApps],@"OS declined activation");need(AXUIElementPerformAction((__bridge AXUIElementRef)marked[0],kAXRaiseAction)==kAXErrorSuccess,@"Marked window raise failed");
 NSArray *rows=tree(ax);NSArray *map=named(rows,@"Map appearance");
 if([action isEqual:@"standard"]){need(map.count==1,@"Unique current Map appearance control required");NSDictionary *control=map[0];
  if(![control[@"value"] isEqual:@"Standard"]){NSMutableArray *choices=[NSMutableArray array];for(NSDictionary *r in rows)if([r[@"title"] isEqual:@"Standard"]&&[r[@"role"] isEqual:@"AXMenuItem"])[choices addObject:r];
   if(choices.count==0){need(AXUIElementPerformAction((__bridge AXUIElementRef)control[@"element"],kAXPressAction)==kAXErrorSuccess,@"Open map selector failed");NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];do{[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.05]];rows=tree(ax);[choices removeAllObjects];for(NSDictionary *r in rows)if([r[@"title"] isEqual:@"Standard"]&&[r[@"role"] isEqual:@"AXMenuItem"])[choices addObject:r];}while(choices.count==0&&deadline.timeIntervalSinceNow>0);}
   need(choices.count==1,@"Unique currently exposed Standard menu item required; preserve menu on failure");need(AXUIElementPerformAction((__bridge AXUIElementRef)choices[0][@"element"],kAXPressAction)==kAXErrorSuccess,@"Select Standard failed");
  }
  NSDate *settle=[NSDate dateWithTimeIntervalSinceNow:3];do{[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.05]];rows=tree(ax);map=named(rows,@"Map appearance");}while(!(map.count==1&&[map[0][@"value"] isEqual:@"Standard"])&&settle.timeIntervalSinceNow>0);need(map.count==1&&[map[0][@"value"] isEqual:@"Standard"],@"Standard map readback differs");
 }
 NSMutableArray *selected=[NSMutableArray array];NSArray *names=@[@"Desk layout",@"Desk Callsign",@"Desk UTC date",@"Desk UTC time",@"Map appearance",@"Map preset",@"Map overlay",@"Heard me",@"Sun",@"Greyline",@"Desk map and logbook view",@"Map and tools width",@"Operator Desk",@"Interactive world map, arrow keys pan, plus and minus zoom"];
 for(NSDictionary *r in rows)if([names containsObject:r[@"description"]]||[names containsObject:r[@"title"]]||[@[@"Standard",@"Hybrid",@"Satellite"] containsObject:r[@"title"]]||[@[@"Standard",@"Hybrid",@"Satellite"] containsObject:r[@"value"]]||[r[@"role"] isEqual:@"AXMenu"]||([r[@"value"] isKindOfClass:NSString.class]&&[r[@"value"] containsString:@"WebGL"])){
  NSMutableDictionary *detail=[r mutableCopy];CFArrayRef actions=NULL;AXUIElementCopyActionNames((__bridge AXUIElementRef)r[@"element"],&actions);detail[@"actions"]=CFBridgingRelease(actions)?:@[];Boolean settable=NO;AXUIElementIsAttributeSettable((__bridge AXUIElementRef)r[@"element"],kAXValueAttribute,&settable);detail[@"valueSettable"]=@(settable);[selected addObject:detail];
 }
 if([action isEqual:@"standard"]){CGDirectDisplayID displays[16];uint32_t count=0;need(CGGetActiveDisplayList(16,displays,&count)==kCGErrorSuccess&&count>0,@"Active display unavailable");CGRect display=CGDisplayBounds(displays[0]);CGPoint point=CGPointMake(display.origin.x+12,display.origin.y+12);need(CGWarpMouseCursorPosition(point)==kCGErrorSuccess,@"Pointer parking failed");}
 emit(@{@"action":action,@"pid":@(pid),@"noLaunch":@YES,@"noScreenCapture":@YES,@"frontmostPID":@(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),@"windowTitle":attr((__bridge AXUIElementRef)marked[0],kAXTitleAttribute),@"controls":publicRows(selected),@"surfaces":surfaces(pid)});CFRelease(ax);return 0;
 }@catch(NSException *e){emit(@{@"blocked":@YES,@"reason":e.reason?:@"Unknown guard"});return 2;}}}
