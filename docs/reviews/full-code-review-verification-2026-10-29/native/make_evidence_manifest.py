from pathlib import Path
import hashlib,json
root=Path('/tmp/xlog-review-verification-20261028-12824393/native')
files=[]
for path in sorted(root.iterdir()):
    if not path.is_file() or path.name in {'evidence-manifest.json','libReviewNative.dylib','verify_recorder_store'}:continue
    if path.suffix not in {'.md','.json','.swift','.py','.rs','.log','.toml','.lock','.modulemap'}:continue
    files.append({'path':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
value={'documentationHEAD':'12824393f2799f21c223fadcb19d03305a5bf2f8','applicationBaseline':'4bd554a25951ddc995b4bef1715d3df12918a07b','files':files,'excludedGeneratedArtifacts':['libReviewNative.dylib and compiled native probe executable','cargo-target build outputs','private worker and fldigi fixture stores','loopback runtime marker directories','synthetic PCM recorder fixture audio/journals'],'dispositions':[{'finding':'CR-002','disposition':'confirmed with narrowed module-switch trigger','severity':'High','evidence':'actual-module shutdown state plus connected loopback TCI; output cleanup consequence remains source-supported, no RF proof'},{'finding':'CR-003','disposition':'confirmed','severity':'Medium','evidence':'actual-module eight-case fake-RPC matrix, no neighboring stubs'},{'finding':'CR-007-native','disposition':'confirmed','severity':'Medium','evidence':'unchanged Rust store with synthetic PCM; local-origin gating and durable cursor skip reproduced'}]}
(root/'evidence-manifest.json').write_text(json.dumps(value,indent=2)+'\n')
print(len(files),'small evidence files;',sum(x['bytes'] for x in files),'bytes total')
