from pathlib import Path
import subprocess,sys,json,time,uuid,hashlib
import control as c
B=Path(__file__).resolve().parent
def save(name,v):c.b.save(B/name,v)
def verify():
 c.verify_seal();seal=c.read(B/'background-seal.json')
 assert seal['source']==c.SOURCE and seal['seconds']==1800 and seal['boundSeconds']==1815
 for name,digest in seal['SHA256'].items():assert c.b.sha(Path(name))==digest,'Background helper changed'
 return seal
def fresh_proof(tag):
 record,m,path=c.load();assert m['state']=='positively-verified-awaiting-root-marked-Desk-observation'
 proof=c.b.proof(m);c.b.stable(m['initialProcessProof'],proof);p=B/(tag+'-proof-'+uuid.uuid4().hex[:8]+'.json');c.f.save(p,proof);return m,path,proof,p
def metadata(action,proof):
 p=subprocess.run(['/usr/bin/osascript','-l','JavaScript',str(B/'background-metadata.js'),action,str(proof)],capture_output=True,text=True,timeout=15)
 save(action+'-'+uuid.uuid4().hex[:8]+'-receipt.json',{'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr});assert p.returncode==0,p.stderr;return json.loads(p.stdout)
if __name__=='__main__':
 action=sys.argv[1]
 if action=='prepare':
  c.verify_seal();assert not (B/'background-seal.json').exists();m,path,proof,p=fresh_proof('background-admission')
  assert c.b.run(['/usr/bin/defaults','read','com.apple.dock','autohide']).strip()=='0','Dock must have original state; no toggle here'
  hidden=metadata('hide',p);assert hidden['state']['hidden']
  save('background-seal.json',{'source':c.SOURCE,'version':'1.5.31','pinnedUTC':c.f.now(),'protocol':'Real-world hidden-background observation; user may use other applications','strictForegroundProtocol':False,'seconds':1800,'boundSeconds':1815,'warmupSeconds':60,'sampleOffsetsSeconds':[0,300,900,1200,1800],'manifest':str(path),'sameFreshPreparedFixture':True,'originalHelperSealSHA256':c.b.sha(B/'final-helper-seal.json'),'candidateInitialHiddenState':hidden['state'],'SHA256':{str(p):c.b.sha(p) for p in [B/'background.py',B/'background-metadata.js']}});verify();print(json.dumps({'backgroundPrepared':True,'hiddenPID':proof['hostPID'],'seconds':1800,'bound':1815,'installedAppUntouched':True}));sys.exit()
 if action=='run':
  seal=verify();out=B/'background-interval';out.mkdir(mode=0o700);started=time.monotonic();save('background-warmup-start.json',{'UTC':c.f.now(),'seconds':60});time.sleep(60);warmup=time.monotonic()-started
  m,path,initial,p=fresh_proof('background-preflight');state=metadata('state',p);assert state['hidden'],'Candidate no longer hidden before background interval';save('background-preflight.json',{'passed':True,'state':state,'warmupActualSeconds':warmup,'UTC':c.f.now(),'foregroundRequirement':False})
  initial=c.b.proof(m);c.b.stable(m['initialProcessProof'],initial);p=out/'observer-proof.json';c.f.save(p,initial)
  stop=out/'STOP';assert not stop.exists();log=(out/'visibility.jsonl').open('xb');err=(out/'observer.stderr').open('xb');watch=None;samples=[];result={'complete':False,'source':c.SOURCE,'version':'1.5.31','protocol':seal['protocol'],'foregroundQualification':False,'warmupActualSeconds':warmup,'sampleOffsetsSeconds':seal['sampleOffsetsSeconds'],'observerOverheadNotSubtracted':True,'productionDataOpened':False,'productionUIBound':False}
  try:
   watch=subprocess.Popen(['/usr/bin/osascript','-l','JavaScript',str(B/'background-metadata.js'),'watch',str(p),str(stop)],stdout=log,stderr=err);deadline=time.monotonic()+10
   while True:
    assert watch.poll() is None,'Background metadata watcher exited before readiness'
    if any(r.get('type')=='ready' for r in c.b.completed_jsonl(out/'visibility.jsonl')):break
    assert time.monotonic()<deadline;time.sleep(.1)
   epoch=time.monotonic();save('background-interval-start.json',{'UTC':c.f.now(),'epochMonotonic':epoch,'nominalSeconds':1800})
   for offset in (0,300,900,1200,1800):
    while time.monotonic()<epoch+offset:
     assert watch.poll() is None,'Background metadata watcher exited';time.sleep(min(.25,epoch+offset-time.monotonic()))
    assert time.monotonic()-(epoch+offset)<2 and watch.poll() is None
    samples.append(c.b.sample(m,out/('sample-'+str(offset)),initial))
   with stop.open('x') as f:f.write('STOP\n')
   assert watch.wait(timeout=10)==0;log.flush();finish=c.b.completed_jsonl(out/'visibility.jsonl')[-1];assert finish['type']=='finished' and finish['success'] and finish['elapsedSeconds']>=1800
   result.update(complete=True,samples=samples,finalTenMinuteCPU=c.b.cpu(samples[-2],samples[-1]),visibility=finish,finishedUTC=c.f.now());verify();print(json.dumps({'complete':True,'visibility':finish,'finalTenMinuteCPU':result['finalTenMinuteCPU']}),flush=True)
  except BaseException as e:result['error']=str(e);raise
  finally:
   result['samples']=samples
   if watch and watch.poll() is None:
    if not stop.exists():
     with stop.open('x') as f:f.write('STOP\n')
    try:watch.wait(timeout=10)
    except subprocess.TimeoutExpired:result['observerCleanupIncomplete']=True
   if watch:result['observerExit']=watch.poll()
   log.close();err.close();c.f.save(out/'result.json',result)
  sys.exit()
 if action=='quit':
  verify();m,path,proof,p=fresh_proof('background-pre-quit');m['preQuitProof']=proof;c.f.persist(m,path);print(json.dumps(metadata('quit',p)));sys.exit()
 raise RuntimeError('Unknown background action')
