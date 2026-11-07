ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function run(argv) {
  var mode=argv[0], path=argv[1];
  var proof=JSON.parse($.NSString.stringWithContentsOfFileEncodingError(path,$.NSUTF8StringEncoding,null).js);
  if (!proof.preUIIdentityProven || proof.source!=='84d38f7e9cf6b63a5c9d07b610f9fcf0dab42639' || Math.abs(Date.now()/1000-proof.capturedUnixSeconds)>10) throw Error('Fresh exact private process proof required');
  var app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(proof.hostPID);
  var expected=proof.ownerIdentities.filter(function(r){return r.pid===proof.hostPID;})[0];
  if (Number(app.processIdentifier)!==proof.hostPID || app.executableURL.path.js!==expected.nativePath || app.isTerminated) throw Error('Original exact candidate unavailable; never launch');
  function state() {
    if (app.isTerminated || app.executableURL.path.js!==expected.nativePath) throw Error('Candidate terminated or identity changed');
    var all=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(16,0))), windows=[];
    all.forEach(function(w){if(Number(w.kCGWindowOwnerPID)===proof.hostPID) windows.push({id:w.kCGWindowNumber,onscreen:!!w.kCGWindowIsOnscreen,layer:w.kCGWindowLayer,bounds:w.kCGWindowBounds});});
    return {hostPID:proof.hostPID,hidden:!!app.isHidden,active:!!app.isActive,frontmostPID:Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),candidateWindows:windows,metadataOnly:true,noCapture:true};
  }
  if(mode==='hide') {var alreadyHidden=!!app.isHidden,accepted=alreadyHidden||!!app.hide; $.NSThread.sleepForTimeInterval(.2);var s=state();if(!accepted||!s.hidden)throw Error('Candidate hide was not confirmed');return JSON.stringify({action:'hide-private-candidate',accepted:accepted,alreadyHidden:alreadyHidden,state:s});}
  if(mode==='quit') {if(!app.terminate)throw Error('Ordinary Quit rejected; no force fallback');return JSON.stringify({ordinaryQuitRequested:true,pid:proof.hostPID,force:false});}
  if(mode==='state')return JSON.stringify(state());
  if(mode!=='watch'||argv.length!==3)throw Error('Unsupported metadata action');
  var stop=argv[2], start=Number($.NSProcessInfo.processInfo.systemUptime),last=start,lastWall=Date.now()/1000,lastState=start,maximumGap=0,states=0,hiddenStates=0,activeStates=0,focusTransitions=0,lastFocus=null;
  var output=$.NSFileHandle.fileHandleWithStandardOutput;
  function emit(x){output.writeData($(JSON.stringify(x)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
  var initial=state();emit({type:'ready',observerPID:Number($.NSProcessInfo.processInfo.processIdentifier),state:initial,scope:'Background protocol: sampled window/focus metadata, no foreground predicate or AX event subscription'});
  var success=false,reason='';
  try {
    while(true){
      $.NSThread.sleepForTimeInterval(.25);
      var now=Number($.NSProcessInfo.processInfo.systemUptime),wall=Date.now()/1000,gap=Math.max(now-last,wall-lastWall);last=now;lastWall=wall;maximumGap=Math.max(maximumGap,gap);
      if(gap>1)throw Error('Metadata observer heartbeat gap exceeded one second');
      if(now-start>1815)throw Error('Background observation exceeded its 1815-second bound');
      if(now-lastState>=1){
        var current=state();lastState=now;states++;if(current.hidden)hiddenStates++;if(current.active)activeStates++;if(lastFocus!==null&&lastFocus!==current.frontmostPID)focusTransitions++;lastFocus=current.frontmostPID;
        emit({type:'state',elapsedSeconds:now-start,state:current});
      }
      if($.NSFileManager.defaultManager.fileExistsAtPath(stop)){
        var text=$.NSString.stringWithContentsOfFileEncodingError(stop,$.NSUTF8StringEncoding,null).js;
        if(text!=='STOP\n'||now-start<1800)throw Error('Missing or premature background STOP');
        state();success=true;reason='Completed requested background observation';break;
      }
    }
  }catch(e){reason=String(e);}
  emit({type:'finished',success:success,reason:reason,elapsedSeconds:Number($.NSProcessInfo.processInfo.systemUptime)-start,stateSamples:states,hiddenStateSamples:hiddenStates,activeStateSamples:activeStates,observedForegroundTransitions:focusTransitions,maximumHeartbeatGapSeconds:maximumGap,metadataNominalIntervalSeconds:1,heartbeatIntervalSeconds:.25,foregroundRequired:false,continuousAXOrWorkspaceEventSubscription:false,pixelOcclusionProof:false});
  return '';
}
