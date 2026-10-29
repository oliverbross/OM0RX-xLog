from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time
repo=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
stage=Path(__file__).resolve().parent
label=sys.argv[1] if len(sys.argv)>1 else 'initial'
assert label in {'initial','queued-final','queued-final-r2','queued-final-r3'}
log_name='frontend-build' if label=='initial' else 'frontend-'+label+'-build'
original=repo/'prototype/dist'; retained=stage/'original-dist-during-frontend-check'; built=stage/('frontend-e1570231' if label=='initial' else 'frontend-'+label)
assert original.is_dir() and not retained.exists() and not built.exists()
def hashes(path):return {str(p.relative_to(path)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(path.rglob('*')) if p.is_file()}
before=hashes(original); inode=original.stat().st_ino
started=datetime.datetime.now(datetime.timezone.utc).isoformat(); began=time.monotonic()
original.rename(retained)
try:
    with (stage/(log_name+'.log')).open('wb') as log:
        result=subprocess.run(['npm','run','build'],cwd=repo/'prototype',stdout=log,stderr=subprocess.STDOUT)
finally:
    if original.exists():original.rename(built)
    retained.rename(original)
    assert original.stat().st_ino==inode and hashes(original)==before
receipt={'argv':['npm','run','build'],'cwd':str(repo/'prototype'),'startedUTC':started,
    'finishedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-began,
    'exit':result.returncode,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'frontendInputs':{str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((repo/'prototype/src').rglob('*')) if p.is_file()},
    'originalDistInode':inode,'originalDistHashes':before,'originalDistRestored':True,'builtFiles':hashes(built)}
(stage/(log_name+'-command.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'exit':result.returncode,'originalDistRestored':True,'output':str(built)}))
raise SystemExit(result.returncode)
