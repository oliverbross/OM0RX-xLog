import argparse,importlib.util,json,pathlib,subprocess,sys,time,uuid,sqlite3
R=pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog');B=pathlib.Path(__file__).resolve().parent;OLD=R/'.build/quality-mac-s29-observation-20261107';sys.path.insert(0,str(OLD))
s=importlib.util.spec_from_file_location('f',OLD/'fixture-s29.py');f=importlib.util.module_from_spec(s);s.loader.exec_module(f);b=f.budget
p=argparse.ArgumentParser();p.add_argument('action');p.add_argument('arm');p.add_argument('--manifest',type=pathlib.Path);a=p.parse_args();D=B/a.arm;D.mkdir(exist_ok=True,mode=0o700)
def save(name,v):f.save(D/name,v)
if a.action=='init':
 m=json.loads(a.manifest.read_text());assert m['state']=='prepared-closed-no-GUI-launch';save('manifest.json',m)
 app=pathlib.Path(m['app']);build=json.loads((app/'Contents/Resources/NativeBundleBuild.json').read_text());save('pins.json',{'app':str(app),'source':build['sourceCommit'],'version':build['version'],'host':b.sha(app/'Contents/MacOS/xlog-prototype'),'worker':b.sha(app/'Contents/MacOS/xlog-prototype-worker'),'build':b.sha(app/'Contents/Resources/NativeBundleBuild.json')});print(D);sys.exit()
m=json.loads((D/'manifest.json').read_text());pins=json.loads((D/'pins.json').read_text());app=pathlib.Path(pins['app']);b.APP=app;b.HOST=app/'Contents/MacOS/xlog-prototype';b.WORKER=app/'Contents/MacOS/xlog-prototype-worker';b.HOST_SHA=pins['host'];b.WORKER_SHA=pins['worker'];b.SOURCE=pins['source'];b.OBSERVER=B/('visibility-300-'+a.arm)
assert b.sha(app/'Contents/Resources/NativeBundleBuild.json')==pins['build'];assert json.loads((app/'Contents/Resources/NativeBundleBuild.json').read_text())['sourceCommit']==pins['source']
root=pathlib.Path(m['root']);assert json.loads((root/'native/operating-module.json').read_text())=={'version':1,'selected':'normal_logging'};assert json.loads((root/'.xlog-offline-acceptance.json').read_text())=={'schema':1,'id':m['marker'],'connectedLoopback':False};assert m['migratedFixture']['orderedStoredQSOHash']==f.QSO_SHA
if a.action=='launch':
 assert m['state']=='prepared-closed-no-GUI-launch';assert not any(r['path'] in (str(b.HOST),str(b.WORKER)) for r in b.inventory().values());b.run(['/usr/bin/codesign','--verify','--deep','--strict',app])
 argv=['/usr/bin/open','-n','-a',str(app),'--env','CFFIXED_USER_HOME='+str(root/'home'),'--env','XLOG_OPERATING_MODULE=normal_logging','--args',b.FLAG+str(root)];assert not (D/'launch-slot.json').exists();save('launch-slot.json',{'at':f.now(),'argv':argv});m['state']='launch-slot-consumed';save('manifest.json',m);b.run(argv);deadline=time.monotonic()+10;seen=None
 while True:
  rows=b.inventory();hosts=[r for r in rows.values() if r['path']==str(b.HOST)];assert len(hosts)<=1
  if hosts:
   assert seen in (None,hosts[0]['pid']);seen=hosts[0]['pid'];assert b.run(['/bin/ps','-ww','-p',str(seen),'-o','command=']).strip()==str(b.HOST)+' '+b.FLAG+str(root)
   if any(r['path']==str(b.WORKER) and r['ppid']==seen for r in rows.values()):break
  elif seen:raise RuntimeError('Launch exited; hard stop, no UI binding')
  assert time.monotonic()<deadline;time.sleep(.1)
 proof=b.proof(m);save('initial-proof.json',proof);m.update(pid=proof['hostPID'],workerPID=proof['workerPID'],initialProcessProof=proof,allOwnerPIDs=[r['pid'] for r in proof['ownerIdentities']],state='verified');save('manifest.json',m);print('Exact private host/worker/WebKit process proof passed');sys.exit()
if a.action in ('standard','inspect','dock-toggle','quit'):
 assert m['state']=='verified';proof=b.proof(m);b.stable(m['initialProcessProof'],proof);tag=a.action+'-'+uuid.uuid4().hex[:8];save(tag+'-proof.json',proof)
 if a.action=='quit':m['preQuitProof']=proof;save('manifest.json',m)
 r=subprocess.run([str(B/('local-'+a.arm)),a.action,str(D/(tag+'-proof.json'))],capture_output=True,text=True,timeout=45);save(tag+'-result.json',{'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr});assert r.returncode==0,r.stdout;print(json.dumps({'action':a.action,'exit':r.returncode,'record':tag+'-result.json'}));sys.exit()
if a.action=='measure':
 assert m['state']=='verified';out=D/'measure';out.mkdir(mode=0o700);time.sleep(60);initial=b.proof(m);b.stable(m['initialProcessProof'],initial);b.save(out/'proof.json',initial);b.save(out/'preflight.json',json.loads(b.run([b.OBSERVER,'preflight',out/'proof.json'])));log=(out/'visibility.jsonl').open('xb');watch=subprocess.Popen([str(b.OBSERVER),'watch',str(out/'proof.json')],stdin=subprocess.PIPE,stdout=log,stderr=subprocess.PIPE);deadline=time.monotonic()+10
 while True:
  assert watch.poll() is None,'Watcher failed before ready'
  if any(r.get('type')=='ready' for r in b.completed_jsonl(out/'visibility.jsonl')):break
  assert time.monotonic()<deadline;time.sleep(.1)
 start=b.sample(m,out/'start',initial);deadline=time.monotonic()+300
 while time.monotonic()<deadline:
  assert watch.poll() is None,'Visibility failed; interval invalid';time.sleep(min(5,max(0,deadline-time.monotonic())))
 end=b.sample(m,out/'end',initial);watch.stdin.write(b'STOP\n');watch.stdin.flush();watch.stdin.close();rc=watch.wait(timeout=10);log.close();finish=b.completed_jsonl(out/'visibility.jsonl')[-1];assert rc==0 and finish['type']=='finished' and finish['success'],finish
 result={'diagnosticOnly':True,'warmupSeconds':60,'nominalSeconds':300,'CPU':b.cpu(start,end),'samples':[start,end],'visibility':finish,'source':pins['source'],'version':pins['version'],'noProfilerBuildTestsGUIActionsDuringInterval':True};b.save(out/'result.json',result);print(json.dumps({'CPU':result['CPU'],'visibility':finish}));sys.exit()
if a.action=='close':
 assert m.get('preQuitProof');f.no_target(m);before=json.loads(b.run([OLD/'exited-capture']));scan=f.coalition_scan(m);save('closure-scan-'+uuid.uuid4().hex[:8]+'.json',scan);assert not scan['survivors'] and {r['pid'] for r in scan['unresolved']}<={79847},scan;assert before==json.loads(b.run([OLD/'exited-capture'])) and before['zombieVerified'];assert b.native({r['pid'] for r in m['preQuitProof']['ambientIdentities']})==m['preQuitProof']['ambientIdentities'];save('absence.json',{'allCandidateOwnersAbsent':True,'specificExitedZombie':before,'scan':scan,'at':f.now()})
 reader,_=f.read_closed(pathlib.Path(m['database']));out=D/'closed.sqlite';assert not out.exists();writer=sqlite3.connect(out);reader.backup(writer);writer.execute('pragma journal_mode=DELETE');writer.close();reader.close();qso=f.qso_evidence(out);settings=f.settings_snapshot(out);assert qso['orderedStoredQSOHash']==f.QSO_SHA and settings['rows']==m['settingsBeforeGUI']['rows'];save('preservation.json',{'qso':qso,'settingsPreserved':True});m['state']='closed';save('manifest.json',m);print('All attributed owners absent; 100k QSOs/settings preserved');sys.exit()
raise RuntimeError('Unknown action')
