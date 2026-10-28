from pathlib import Path
import datetime, hashlib, json, subprocess

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task = Path('/tmp/xlog-phase5-20261029-721e0705')
owned = root / '.build/phase5-20261029'
baseline = json.loads((task / 'baseline.json').read_text())
for name in ['STABLE-FRONTEND', 'STABLE-PYTHON', 'STABLE-PORTABLE',
             'STABLE-NATIVE', 'STABLE-RUST', 'STABLE-RUST-FEATURE',
             'STABLE-PROCESS','STABLE-RUST-RELEASE','FINAL-IDLE-R2', 'FINAL-BROWSER-SCP-R3']:
    value = json.loads((task / 'logs' / (name + '.json')).read_text())
    assert value['exitCode'] == 0 and not value['timedOut'], value
source = json.loads((task / 'final-source-sha256.json').read_text())
for name, expected in source.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
original_node = owned / 'original-node_modules'
current_node = root / 'prototype/node_modules'
final_node = owned / 'final-validated-node_modules'
original_dist = owned / 'original-dist'
current_dist = root / 'prototype/dist'
final_dist = owned / 'final-built-dist'
assert original_node.is_dir() and not original_node.is_symlink()
assert original_node.stat().st_ino == baseline['nodeModulesInode']
assert current_node.is_dir() and not current_node.is_symlink()
assert not final_node.exists() and not final_dist.exists()
def hashes(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in directory.rglob('*') if p.is_file()}
assert hashes(original_dist) == baseline['distHashes']
fresh_hashes = hashes(current_dist)
current_node.rename(final_node)
original_node.rename(current_node)
current_dist.rename(final_dist)
original_dist.rename(current_dist)
assert current_node.stat().st_ino == baseline['nodeModulesInode']
assert hashes(current_dist) == baseline['distHashes']
assert (root / '.build/cw-native').stat().st_ino == 589158794
assert not (root / '.build/cw-native').is_symlink()
receipt = {'restoredUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'nodeModulesOriginalInode': current_node.stat().st_ino,
           'originalDistFiles': len(baseline['distHashes']), 'originalDistHashesMatch': True,
           'cwOriginalInode': (root / '.build/cw-native').stat().st_ino,
           'freshNodeModulesPreserved': str(final_node), 'freshDistPreserved': str(final_dist),
           'freshDistHashes': fresh_hashes, 'finalSourceFilesVerified': len(source)}
(task / 'restoration-final.json').write_text(json.dumps(receipt,indent=2) + '\n')
print(json.dumps({k:v for k,v in receipt.items() if k != 'freshDistHashes'}))
