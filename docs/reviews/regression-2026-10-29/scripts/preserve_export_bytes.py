from pathlib import Path
import gzip,hashlib,json
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task=Path('/tmp/xlog-phase4-20261029-26f795cb')
out=root/'docs/reviews/regression-2026-10-29'
receipts=[]
for source in sorted(task.glob('browser-*/exports/*')):
 if not source.is_file():continue
 relative=source.relative_to(task)
 archived=out/relative
 assert archived.exists(),relative
 raw=source.read_bytes()
 trace=json.loads((source.parent.parent/'evidence/acceptance.json').read_text())
 matches=[r for r in trace['exports'] if (r.get('path') or r.get('filename'))==source.name]
 assert len(matches)==1,(str(relative),matches)
 sha=hashlib.sha256(raw).hexdigest()
 assert matches[0]['sha256']==sha
 assert (matches[0].get('size') or matches[0].get('byteLength'))==len(raw)
 zipped=archived.with_name(archived.name+'.gz'); assert not zipped.exists()
 zipped.write_bytes(gzip.compress(raw,mtime=0)); assert gzip.decompress(zipped.read_bytes())==raw
 receipts.append({'archive':str(zipped.relative_to(out)),'uncompressedBytes':len(raw),'uncompressedSHA256':sha,'matchesBrowserExportReceipt':True})
 archived.unlink()
(out/'export-byte-verification.json').write_text(json.dumps(receipts,indent=2)+'\n')
(out/'scripts/preserve_export_bytes.py').write_bytes(Path(__file__).read_bytes())
readme=out/'README.md'
readme.write_text(readme.read_text().rstrip()+'\n\nAll synthetic ADIF and Cabrillo exports are gzip-compressed from their original bytes, preserving CRLF and matching each browser export size/SHA256. export-byte-verification.json records every match. The initial staged whitespace gate rejected plain CRLF ADIF artifacts; no commit proceeded. Archiving original bytes avoids changing interchange evidence or weakening the whitespace check.\n')
incidents=out/'collector-incidents.json'; data=json.loads(incidents.read_text())
data['otherIncidents'].append({'id':'staged evidence whitespace gate','result':'git diff --cached --check rejected raw CRLF ADIF artifacts before commit. All ADIF/Cabrillo exports were re-archived as gzip directly from original scratch bytes, and every size/SHA256 was checked against the browser receipt. No application output, expected result or whitespace policy was changed. The final staged gate is required to pass.'})
incidents.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'exportsPreservedByteExactly':len(receipts)}))
