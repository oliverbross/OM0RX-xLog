from pathlib import Path
import subprocess, collections, json

ROOT = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
OUT = Path('/tmp/xlog-review-20261028-4bd554a')
OUT.mkdir(exist_ok=True, parents=True)
files = subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
rows=[]
for name in filter(None,files):
    p=ROOT/name
    data=p.read_bytes() if p.is_file() else b''
    if name.startswith(('vendor/','python/vendor/')):
        scope='vendored; boundary/provenance review only'
    elif name.startswith(('docs/','research/')) or p.suffix.lower() in ('.md','.pdf','.png','.jpg','.xlsx','.docx','.zip'):
        scope='supporting documentation/data/media'
    elif 'Resources/' in name or p.suffix.lower() in ('.csv','.geojson','.xml','.json') and not any(x in name for x in ('package','tsconfig','tauri.conf','capabilities')):
        scope='resource/data; contracts and loaders in scope'
    else:
        scope='first-party source/test/config/tooling'
    rows.append({'path':name,'bytes':len(data),'lines':data.count(b'\n'),'scope':scope,'status':'not reviewed','note':'Pending coverage reconciliation'})
(OUT/'inventory.json').write_text(json.dumps(rows,indent=2))
print('Tracked files:',len(rows))
for scope,count in collections.Counter(r['scope'] for r in rows).items():print(scope,count)
for name in ('Sources','Tests','prototype','python','scripts','.github','tools'):
    subset=[r for r in rows if r['path'].startswith(name+'/') and r['scope']=='first-party source/test/config/tooling']
    print(name,len(subset),'files',sum(r['lines'] for r in subset),'lines')
print('Largest core/app files:')
for r in sorted([r for r in rows if r['path'].startswith(('Sources/XLogCore/','Sources/XLogApp/')) and r['scope']=='first-party source/test/config/tooling'],key=lambda r:r['lines'],reverse=True)[:16]:print(r['path'],r['lines'])
