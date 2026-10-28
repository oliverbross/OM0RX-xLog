from pathlib import Path
import json,hashlib
out=Path(__file__).parent
coverage=json.loads((out/'coverage-increments.json').read_text())
matrix=json.loads((out/'finding-verification-matrix.json').read_text())
paths=[p for p in out.iterdir() if p.is_file() and p.name!='artifact-hashes.json']
manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
(out/'artifact-hashes.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
print('coverage entries',len(coverage),'disposition entries',len(matrix),'artifact hashes',len(manifest))
for row in matrix:print(row['id'],row['disposition'])
