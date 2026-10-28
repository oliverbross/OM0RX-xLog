from pathlib import Path
import argparse, datetime, json, os, signal, subprocess, time

p = argparse.ArgumentParser()
p.add_argument('--id', required=True)
p.add_argument('--cwd', required=True)
p.add_argument('--timeout', type=int, default=1800)
p.add_argument('command', nargs=argparse.REMAINDER)
args = p.parse_args()
command = args.command[1:] if args.command[:1] == ['--'] else args.command
root = Path('/tmp/xlog-phase4-20261029-26f795cb')
log = root/'logs'/f'{args.id}.log'
result = root/'logs'/f'{args.id}.json'
assert not log.exists() and not result.exists(), args.id
start = time.monotonic()
metadata = {'id':args.id,'command':command,'cwd':args.cwd,'startedUTC':datetime.datetime.now(datetime.UTC).isoformat(),'log':str(log)}
with log.open('wb') as output:
    process = subprocess.Popen(command, cwd=args.cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    metadata['pid'] = process.pid
    (root/'logs'/f'{args.id}.running.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'id':args.id,'startedPID':process.pid}),flush=True)
    try:
        deadline = start + args.timeout
        while True:
            try:
                metadata['exitCode'] = process.wait(timeout=min(20,max(1,deadline-time.monotonic())))
                break
            except subprocess.TimeoutExpired:
                if time.monotonic() >= deadline: raise
                print(json.dumps({'id':args.id,'runningSeconds':round(time.monotonic()-start)}),flush=True)
        metadata['timedOut'] = False
    except subprocess.TimeoutExpired:
        metadata['timedOut'] = True
        os.killpg(process.pid, signal.SIGTERM)
        try: metadata['exitCode'] = process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            metadata['requiresIntervention'] = True
            metadata['exitCode'] = None
metadata['durationSeconds'] = round(time.monotonic()-start,3)
metadata['finishedUTC'] = datetime.datetime.now(datetime.UTC).isoformat()
result.write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata))
