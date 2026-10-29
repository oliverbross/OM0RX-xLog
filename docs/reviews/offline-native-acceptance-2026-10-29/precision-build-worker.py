from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess

repo = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
stage = repo / '.build/offline-native-acceptance-20261029-6e8bc944'
destination = stage / 'precision-worker'
scratch = repo / '.build/remediation-followup-20261029-86a971e0/restore-release-clean'
swift = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift'
assert scratch.exists(), scratch
assert not destination.exists(), destination
def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo)
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
paths = [Path(path) for path in git('ls-files', 'Package.swift', 'Sources').decode().splitlines() if (repo / path).is_file()]
inputs = {str(path): digest(repo / path) for path in paths}
head = git('rev-parse', 'HEAD').decode().strip()
diff = git('diff', '--', 'Package.swift', 'Sources')
(stage / 'precision-worker-source.diff').write_bytes(diff)
(stage / 'precision-worker-inputs.json').write_text(json.dumps(inputs, indent=2, sort_keys=True) + '\n')
command = [swift, 'build', '--build-system', 'xcode', '-j', '2', '--scratch-path', str(scratch), '-c', 'release', '--product', 'xlog-prototype-worker']
environment = {key: value for key, value in os.environ.items() if not key.startswith(('XLOG_', 'XCW_'))}
environment['XLOG_PORTABLE_ONLY'] = '1'
log = stage / 'precision-worker-build.log'
assert not log.exists(), log
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
with log.open('wb') as stream:
    result = subprocess.run(command, cwd=repo, env=environment, stdout=stream, stderr=subprocess.STDOUT, timeout=900)
receipt = {'sourceHead': head, 'sourceHeadAfterBuild': git('rev-parse', 'HEAD').decode().strip(), 'toolchain': subprocess.check_output([swift, '--version']).decode().strip(), 'command': command, 'environment': {'XLOG_PORTABLE_ONLY': '1'}, 'cwd': str(repo), 'startedUTC': started, 'finishedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': result.returncode, 'logSHA256': digest(log), 'sourceDiffSHA256': hashlib.sha256(diff).hexdigest(), 'sourceInputs': str(stage / 'precision-worker-inputs.json'), 'sourceInputsUnchanged': all(digest(repo / path) == sha for path, sha in inputs.items()), 'candidate': False, 'installed': False}
if result.returncode == 0:
    built_worker = scratch / 'apple/Products/Release/xlog-prototype-worker'
    destination.mkdir(mode=0o700)
    worker = destination / built_worker.name
    shutil.copy2(built_worker, worker)
    assert digest(worker) == digest(built_worker)
    receipt['worker'] = {'path': str(worker), 'buildPath': str(built_worker), 'sha256': digest(worker), 'size': worker.stat().st_size}
    receipt['resources'] = {}
    for name in ['OM0RXXLogPrototype_XLogCore.bundle', 'OM0RXXLogPrototype_XContestCore.bundle']:
        shutil.copytree(built_worker.parent / name, destination / name)
        bundle = worker.parent / name
        receipt['resources'][name] = {'path': str(bundle), 'files': {str(path.relative_to(bundle)): digest(path) for path in sorted(bundle.rglob('*')) if path.is_file()}}
(stage / 'precision-worker-build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: value for key, value in receipt.items() if key != 'resources'}), flush=True)
assert receipt['sourceInputsUnchanged'], 'Build inputs changed'
raise SystemExit(result.returncode)
