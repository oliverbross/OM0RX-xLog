from pathlib import Path
import json
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task=Path('/tmp/xlog-phase5-20261029-721e0705')
base=json.loads((task/'baseline.json').read_text())
assert (root/'.build/phase5-20261029/original-node_modules').stat().st_ino==base['nodeModulesInode']
assert (root/'prototype/node_modules').stat().st_ino!=base['nodeModulesInode']
for src,name in [(root/'prototype/node_modules','cycle1-validated-node_modules'),(root/'prototype/dist','cycle1-built-dist')]:
    target=root/'.build/phase5-20261029'/name
    assert src.is_dir() and not target.exists()
    src.rename(target)
print('Preserved cycle1 dependencies/dist; original user directories remain intact.')
