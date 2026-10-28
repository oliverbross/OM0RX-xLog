from pathlib import Path
import re

root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-review-verification-20261028-12824393/native')
lock=(root/'prototype/src-tauri/Cargo.lock').read_text()
names=['serde','serde_json','sha2','tempfile','libc','uuid']
lines=['[package]','name = "review-recorder-verification"','version = "1.3.60"','edition = "2021"','', '[[bin]]','name = "review-recorder-verification"','path = "verify_recorder_store.rs"','', '[dependencies]']
for name in names:
    versions=re.findall(r'^name = "'+re.escape(name)+r'"\nversion = "([^"]+)"',lock,re.M)
    if name=='sha2':versions=[v for v in versions if v.startswith('0.10.')]
    assert len(versions)==1,(name,versions)
    feature=', features = ["derive"]' if name=='serde' else ', features = ["v4"]' if name=='uuid' else ''
    lines.append(name+' = { version = "='+versions[0]+'"'+feature+' }')
(out/'Cargo.toml').write_text('\n'.join(lines)+'\n')
print('Created isolated offline manifest with exact application-lock versions')
