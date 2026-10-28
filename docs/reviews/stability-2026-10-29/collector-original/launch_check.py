from pathlib import Path
import json, subprocess, sys
p = Path('/tmp/xlog-phase5-20261029-721e0705')
args = sys.argv[1:]
identifier = args[args.index('--id')+1]
with (p/'logs'/f'{identifier}.launcher.log').open('xb') as output:
    child = subprocess.Popen(['python3.12','-B',str(p/'scripts/run_check.py'),*args],stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
print(json.dumps({'dispatched':identifier,'runnerPID':child.pid,'result':str(p/'logs'/f'{identifier}.json')}))
