from pathlib import Path
import csv, gzip, hashlib, json, re, shutil, subprocess
from collections import Counter

REPO=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
SCRATCH=Path('/tmp/xlog-review-verification-20261028-12824393')
DEST=REPO/'docs/reviews/full-code-review-verification-2026-10-29'
FIRST=REPO/'docs/reviews/full-code-review-2026-10-28'
DEST.mkdir(parents=True,exist_ok=True)
rank={'not reviewed':0,'scanned only':1,'partially reviewed':2,'fully reviewed':3,'excluded':-1}
depth_map={'full':'fully reviewed','partial':'partially reviewed','scanned':'scanned only','not-reviewed':'not reviewed','excluded':'excluded'}
with (FIRST/'REVIEW_INVENTORY.tsv').open() as f:
    reader=csv.DictReader(f,delimiter='\t');fields=reader.fieldnames;rows=list(reader)
assert len(rows)==2347
by_path={r[fields[0]]:r for r in rows}
increments=[];outside=[]
for area,name in [('root','coverage.json'),('native','coverage.json'),('frontend','coverage-increments.json'),('contest','coverage-increments.json')]:
    data=json.loads((SCRATCH/area/name).read_text())
    for item in data if isinstance(data,list) else data['files']:
        path=item['path'];status=item.get('status') or depth_map[item['depth']]
        if path not in by_path:
            outside.append({'area':area,**item});continue
        if status=='not reviewed' or (area=='native' and path=='Sources/XLogPrototypeSupport/WorkerProtocol.swift'):
            outside.append({'area':area,'reason':'No new manual source inspection; baseline depth retained',**item});continue
        row=by_path[path];old=row['depth']
        # Executing tests or revisiting an already reviewed source does not itself
        # upgrade text coverage. Excluded vendor bodies retain their baseline limit.
        if old!='excluded' and status!='excluded' and rank[status]>rank[old]:row['depth']=status
        ranges=item.get('ranges',item.get('addedRanges',''))
        if isinstance(ranges,list):ranges=', '.join(ranges)
        note=item.get('notes') or item.get('cumulativeScope') or item.get('focus','')
        row['inspection_note']+=' | verification '+area+': '+str(ranges)+'; '+note
        increments.append({'area':area,'path':path,'baselineDepth':old,'reportedPassDepth':status,'cumulativeDepth':row['depth'],'ranges':ranges})
with (DEST/'REVIEW_INVENTORY.tsv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=fields,delimiter='\t',lineterminator='\n');w.writeheader();w.writerows(rows)
summary={
 'applicationSource':'4bd554a25951ddc995b4bef1715d3df12918a07b',
 'verificationHEAD':'12824393f2799f21c223fadcb19d03305a5bf2f8',
 'totalFiles':len(rows),'depthCounts':dict(Counter(r['depth'] for r in rows)),
 'firstPartyDepthCounts':dict(Counter(r['depth'] for r in rows if r['scope']=='first-party source/test/config/tooling')),
 'scopeCounts':dict(Counter(r['scope'] for r in rows)),
 'filesWithSecondPassInspection':len({i['path'] for i in increments}),
 'depthChangedFiles':sum(a['depth']!=b['depth'] for a,b in zip(csv.DictReader((FIRST/'REVIEW_INVENTORY.tsv').open(),delimiter='\t'),rows)),
 'reviewOnlyFilesAtVerificationHEAD':62,
 'inventoryPolicy':'Frozen2347 application/support baseline;62 first-pass review-only files at12824393 plus new second-pass artifacts excluded from denominator; no scope expansion from repeated reports.'
}
(DEST/'coverage-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
(DEST/'coverage-merge.json').write_text(json.dumps({'increments':increments,'nonBaselineContextOnly':outside},indent=2)+'\n')

manifest=[]
allowed={'.md','.json','.py','.swift','.rs','.ts','.tsx','.toml','.lock','.xsd','.adx','.modulemap','.stderr','.log'}
for area in ['root','frontend','contest','native']:
    directory=SCRATCH/area
    paths=sorted(p for p in directory.iterdir() if p.is_file() and not p.is_symlink() and p.suffix in allowed)
    for src in paths:
        data=src.read_bytes()
        if len(data)>2_000_000:raise RuntimeError('Unexpected large evidence '+str(src))
        name=src.name
        if src.suffix in {'.xsd','.adx'}:
            # Preserve primary-source and exact writer bytes in gzip, without
            # adding thousands of CRLF/trailing-space lines to a source diff.
            target=DEST/area/(name+'.gz');target.parent.mkdir(exist_ok=True)
            target.write_bytes(gzip.compress(data,mtime=0))
            prior=DEST/area/name
            if prior.exists():prior.unlink()
            manifest.append({'source':str(src),'destination':str(target.relative_to(DEST)),'encoding':'gzip exact raw bytes','uncompressedSHA256':hashlib.sha256(data).hexdigest()})
            continue
        if src.suffix in {'.log','.stderr'}:
            name+='.txt'
            clean=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',data).replace(b'\r\n',b'\n')
            clean=b'\n'.join(line.rstrip() for line in clean.splitlines()).rstrip()+b'\n' if clean.strip() else b''
            target=DEST/area/name;target.parent.mkdir(exist_ok=True);target.write_bytes(clean)
            raw=target.with_name(target.name+'.gz');raw.write_bytes(gzip.compress(data,mtime=0))
            manifest.append({'source':str(src),'destination':str(target.relative_to(DEST)),'rawGzip':str(raw.relative_to(DEST)),'rawSHA256':hashlib.sha256(data).hexdigest(),'readableSHA256':hashlib.sha256(clean).hexdigest()})
        else:
            target=DEST/area/name;target.parent.mkdir(exist_ok=True);target.write_bytes(data)
            manifest.append({'source':str(src),'destination':str(target.relative_to(DEST)),'sha256':hashlib.sha256(data).hexdigest()})
(DEST/'copy-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

provenance={
 'verificationHEAD':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),
 'branch':subprocess.check_output(['git','branch','--show-current'],cwd=REPO,text=True).strip(),
 'applicationDiffFromFirstPass':subprocess.check_output(['git','diff','4bd554a25951ddc995b4bef1715d3df12918a07b','HEAD','--','Sources','Tests','prototype','python','tools','scripts','Resources','.github','Package.swift'],cwd=REPO,text=True),
 'schemaSHA256':hashlib.sha256((SCRATCH/'root/adx317-independent.xsd').read_bytes()).hexdigest(),
 'firstPassEvidenceUnmodified':subprocess.check_output(['git','diff','HEAD','--',str(FIRST)],cwd=REPO,text=True)==''
}
assert not provenance['applicationDiffFromFirstPass']
assert provenance['firstPassEvidenceUnmodified']
(DEST/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(summary,indent=2))
