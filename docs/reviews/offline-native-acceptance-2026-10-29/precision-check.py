from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys

repo = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
stage = repo / '.build/offline-native-acceptance-20261029-6e8bc944'
swift = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift'
name, selection = sys.argv[1:]
command = [swift, 'test', '-c', 'release', '--scratch-path', str(repo / '.build/remediation-followup-20261029-86a971e0/restore-release-clean'), '--jobs', '2', '--no-parallel', '--filter', selection]
environment = {key: value for key, value in os.environ.items() if not key.startswith(('XLOG_', 'XCW_'))}
environment['XLOG_PORTABLE_ONLY'] = '1'
log = stage / (name + '.log')
assert not log.exists(), log
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
source_paths = ['Sources/XLogCore/LogbookDatabase.swift', 'Sources/XLogPrototypeSupport/LiveLogbookMethods.swift', 'Tests/XLogPrototypeTests/OperatorDraftReversalAcceptanceTests.swift']
inputs = {path: hashlib.sha256((repo / path).read_bytes()).hexdigest() for path in source_paths}
diff = subprocess.check_output(['git', 'diff', '--', *source_paths], cwd=repo)
(stage / (name + '-source.diff')).write_bytes(diff)
with log.open('wb') as stream:
    result = subprocess.run(command, cwd=repo, env=environment, stdout=stream, stderr=subprocess.STDOUT, timeout=900)
receipt = {'command': command, 'environment': {'XLOG_PORTABLE_ONLY': '1'}, 'cwd': str(repo), 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo).decode().strip(), 'startedUTC': started, 'finishedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': result.returncode, 'log': str(log), 'logSHA256': hashlib.sha256(log.read_bytes()).hexdigest(), 'diffSHA256': hashlib.sha256(diff).hexdigest()}
receipt['sourceInputs'] = inputs
receipt['sourceInputsUnchanged'] = all(hashlib.sha256((repo / path).read_bytes()).hexdigest() == sha for path, sha in inputs.items())
(stage / (name + '-receipt.json')).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
print('\n'.join(log.read_text().splitlines()[-50:]), flush=True)
assert receipt['sourceInputsUnchanged'], 'Test inputs changed'
raise SystemExit(result.returncode)
