from pathlib import Path
import gzip, xml.etree.ElementTree as ET, re, json, hashlib
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend')
schema=gzip.decompress((root/'prototype/tests/fixtures/adx317.xsd.gz').read_bytes())
tree=ET.fromstring(schema)
ns={'x':'http://www.w3.org/2001/XMLSchema'}
record=next(e for e in tree.findall('.//x:element',ns) if e.get('name')=='RECORD')
allowed={e.get('name') for e in record.findall('.//x:element',ns)}
source=(root/'prototype/src/live/adifTransfer.ts').read_text()
m=re.search(r'const standardADXFields = new Set\(`(.*?)`\.split',source,re.S)
actual=set(m.group(1).split())
lock=json.loads((root/'prototype/package-lock.json').read_text())['packages']
proof={'schema_sha256':hashlib.sha256(schema).hexdigest(),'schema_record_fields':len(allowed),'renderer_standard_fields':len(actual),'missing_standard':sorted(allowed-actual-{'APP','USERDEF'}),'extra_standard':sorted(actual-allowed),'deprecated_absent':all(x not in actual for x in ['GUEST_OP','VE_PROV']),'rolldown_lock':lock['node_modules/rolldown']['version'],'lock_oxc_types':lock['node_modules/@oxc-project/types']['version'],'binding_versions':{k:v['version'] for k,v in lock.items() if k.startswith('node_modules/@rolldown/binding-')}}
(out/'static-proofs.json').write_text(json.dumps(proof,indent=2)+'\n')
paths=['Sources/XLogApp/AppModel.swift','prototype/package-lock.json','prototype/src/LiveApp.tsx','prototype/src/live/operatorDraftSession.ts','prototype/src/live/QSOEditorCore.tsx','prototype/src/live/OperatorDesk.tsx','prototype/src/live/DetachedQSOSurface.tsx','prototype/src/live/adifTransfer.ts']
(out/'source-sha256.json').write_text(json.dumps({p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths},indent=2)+'\n')
print(json.dumps(proof,indent=2))
