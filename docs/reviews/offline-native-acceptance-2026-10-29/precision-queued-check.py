from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, sys

repo = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
stage = repo / '.build/offline-native-acceptance-20261029-6e8bc944'
node = shutil.which('node')
name, kind = sys.argv[1:]
if kind == 'negative':
    command = [node, 'node_modules/vitest/vitest.mjs', 'run', 'src/live/operatorDraftSession.test.ts', '--maxWorkers=1', '-t', 'queued automatic UTC receipt merge']
elif kind == 'focused':
    command = [node, 'node_modules/vitest/vitest.mjs', 'run', 'src/live/operatorDraftSession.test.ts', 'src/live/operatorDraftPowerSession.test.ts', 'src/live/operatorDraftWindows.test.ts', 'src/live/operatorDraftTransport.test.ts', 'src/live/operatorDraftHealth.test.tsx', 'src/live/OperatorDraftTime.test.tsx', 'src/live/spotActivation.test.ts', 'src/live/spotEditorRegistration.test.ts', 'src/live/spotEditorInput.test.tsx', '--maxWorkers=1']
elif kind == 'typescript':
    command = [node, 'node_modules/typescript/bin/tsc', '--noEmit']
else:
    raise ValueError(kind)
paths = ['prototype/src/live/operatorDraftSession.ts', 'prototype/src/live/operatorDraftSession.test.ts']
inputs = {path: hashlib.sha256((repo / path).read_bytes()).hexdigest() for path in paths}
diff = subprocess.check_output(['git', 'diff', '--', *paths], cwd=repo)
(stage / (name + '-source.diff')).write_bytes(diff)
log = stage / (name + '.log')
assert not log.exists(), log
environment = {key: value for key, value in os.environ.items() if not key.startswith(('XLOG_', 'XCW_'))}
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
with log.open('wb') as stream:
    result = subprocess.run(command, cwd=repo / 'prototype', env=environment, stdout=stream, stderr=subprocess.STDOUT, timeout=180)
receipt = {'command': command, 'nodeVersion': subprocess.check_output([node, '--version']).decode().strip(), 'cwd': str(repo / 'prototype'), 'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo).decode().strip(), 'startedUTC': started, 'finishedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': result.returncode, 'sourceInputs': inputs, 'sourceInputsUnchanged': all(hashlib.sha256((repo / path).read_bytes()).hexdigest() == sha for path, sha in inputs.items()), 'diffSHA256': hashlib.sha256(diff).hexdigest(), 'logSHA256': hashlib.sha256(log.read_bytes()).hexdigest(), 'log': str(log)}
(stage / (name + '-receipt.json')).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
print('\n'.join(log.read_text().splitlines()[-75:]), flush=True)
assert receipt['sourceInputsUnchanged'], 'Source inputs changed'
raise SystemExit(result.returncode)
