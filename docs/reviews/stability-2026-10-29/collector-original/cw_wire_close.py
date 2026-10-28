from pathlib import Path
import datetime, hashlib, json, os, subprocess

task = Path('/tmp/xlog-phase5-20261029-721e0705')
root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
binding = root / '.build/cw-native'
preserved = root / '.build/phase5-20261029/original-cw-native'
fresh = task / 'cw-native'
runtime = root / '.build/cw-package/runtime/lib/libonnxruntime.1.24.3.dylib'
pins = {
    root / 'vendor/deepcw-engine/model.onnx': 'ef120799457bca042d4690944f0faf93268eb4654e7f50f28784ad63bdc1fe02',
    runtime: '81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217',
}
for path, expected in pins.items():
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, path
assert not binding.is_symlink() and binding.is_dir()
assert not preserved.exists()
assert all((fresh / name).is_file() for name in ('xlog-cw-worker', 'cw-process-probe'))
inode = binding.stat().st_ino
assert inode == 589158794, inode
receipt = {'startedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'originalInode': inode, 'binding': str(binding), 'fresh': str(fresh),
           'pins': {str(k): v for k, v in pins.items()}, 'restored': False}
binding.rename(preserved)
try:
    binding.symlink_to(fresh, target_is_directory=True)
    assert binding.resolve() == fresh.resolve()
    command = ['python3.12', '-B', str(task / 'scripts/run_check.py'), '--id',
               'CLOSE-CW-WIRE', '--cwd', str(root), '--timeout', '400', '--',
               '/usr/bin/time', '-l', 'env', 'XLOG_PORTABLE_ONLY=1',
               'XCW_TEST_RUNTIME=' + str(runtime), 'swift', 'test', '--package-path',
               'native/cw-worker', '--scratch-path',
               str(root / '.build/phase5-20261029/cw-wire-close'), '--jobs', '2', '--no-parallel']
    subprocess.run(command, check=True)
    result = json.loads((task / 'logs/CLOSE-CW-WIRE.json').read_text())
    assert result['exitCode'] == 0 and not result['timedOut'], result
finally:
    assert binding.is_symlink() and binding.resolve() == fresh.resolve()
    binding.unlink()
    preserved.rename(binding)
    assert not binding.is_symlink() and binding.stat().st_ino == inode
    receipt['restored'] = True
    receipt['restoredUTC'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (task / 'cw-binding-close.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
