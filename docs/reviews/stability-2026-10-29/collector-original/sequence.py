from pathlib import Path
import json,subprocess,sys,time
task=Path('/tmp/xlog-phase5-20261029-721e0705')
plan=json.loads(Path(sys.argv[1]).read_text())
deadline=time.monotonic()+1800
for dependency in plan.get('waitFor',[]):
    receipt=task/'logs'/(dependency+'.json')
    while not receipt.exists():
        if time.monotonic()>deadline: raise TimeoutError(dependency)
        time.sleep(5)
    value=json.loads(receipt.read_text())
    assert value['exitCode']==0 and not value['timedOut'],value
for entry in plan['checks']:
    command=['python3.12','-B',str(task/'scripts/run_check.py'),'--id',entry['id'],
             '--cwd',entry.get('cwd','/Users/oliver/Documents/Projects/OM0RX-xLog'),
             '--timeout',str(entry.get('timeout',1200)),'--',*entry['command']]
    subprocess.run(command,check=True)
    value=json.loads((task/'logs'/(entry['id']+'.json')).read_text())
    assert value['exitCode']==0 and not value['timedOut'],value
print(json.dumps({'sequenceComplete':str(sys.argv[1]),'checks':[r['id'] for r in plan['checks']]}))
