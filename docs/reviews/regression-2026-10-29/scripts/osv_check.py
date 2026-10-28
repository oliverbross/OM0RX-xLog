from pathlib import Path
import datetime, hashlib, json, subprocess, tomllib, urllib.request

root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-phase4-20261029-26f795cb/security-osv-r2')
out.mkdir()
lock=root/'prototype/src-tauri/Cargo.lock'
packages=[p for p in tomllib.loads(lock.read_text())['package'] if p.get('source','').startswith('registry+')]
metadata=subprocess.check_output(['cargo','metadata','--locked','--offline','--format-version','1','--filter-platform','aarch64-apple-darwin','--manifest-path',str(root/'prototype/src-tauri/Cargo.toml')],cwd=root)
(out/'cargo-metadata.json').write_bytes(metadata)
meta=json.loads(metadata)
nodes={n['id']:n for n in meta['resolve']['nodes']}
reachable=set()
def visit(identifier):
    if identifier in reachable:return
    reachable.add(identifier)
    for dep in nodes[identifier]['deps']:visit(dep['pkg'])
visit(meta['resolve']['root'])
selected={(p['name'],p['version']) for p in meta['packages'] if p['id'] in reachable}
rows=[]
def request_json(url,payload=None):
    body=None if payload is None else json.dumps(payload).encode()
    # Use the system curl trust store after the private Python runtime failed
    # certificate verification. TLS verification stays enabled.
    command=['curl','--fail','--silent','--show-error','--proto','=https','--max-time','60','--header','Content-Type: application/json']
    if body is not None:command+=['--data-binary','@-']
    command.append(url)
    result=subprocess.run(command,input=body,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    return json.loads(result.stdout)

for offset in range(0,len(packages),50):
    batch=packages[offset:offset+50]
    queries=[{'package':{'ecosystem':'crates.io','name':p['name']},'version':p['version']} for p in batch]
    payload={'queries':queries}
    result=request_json('https://api.osv.dev/v1/querybatch',payload)
    (out/f'batch-{offset:04d}-request.json').write_text(json.dumps(payload,indent=2)+'\n')
    (out/f'batch-{offset:04d}-response.json').write_text(json.dumps(result,indent=2)+'\n')
    assert len(result['results'])==len(batch)
    for package,response in zip(batch,result['results']):
        ids={v['id'] for v in response.get('vulns',[])}
        token=response.get('next_page_token')
        page=0
        while token:
            page+=1
            query={'package':{'ecosystem':'crates.io','name':package['name']},'version':package['version'],'page_token':token}
            next_result=request_json('https://api.osv.dev/v1/querybatch',{'queries':[query]})
            (out/f'page-{offset}-{package["name"]}-{page}.json').write_text(json.dumps(next_result,indent=2)+'\n')
            next_response=next_result['results'][0]
            ids.update(v['id'] for v in next_response.get('vulns',[]))
            token=next_response.get('next_page_token')
        rows.append({'name':package['name'],'version':package['version'],'selectedMacOSTargetGraph':(package['name'],package['version']) in selected,'advisories':sorted(ids)})
        print(json.dumps({'queried':package['name'],'version':package['version'],'advisories':sorted(ids)}),flush=True)

identifiers=sorted({identifier for row in rows for identifier in row['advisories']})
advisories={}
for identifier in identifiers:
    value=request_json('https://api.osv.dev/v1/vulns/'+identifier)
    advisories[identifier]=value
    (out/(identifier+'.json')).write_text(json.dumps(value,indent=2)+'\n')
result={'queriedUTC':datetime.datetime.now(datetime.UTC).isoformat(),'lockSHA256':hashlib.sha256(lock.read_bytes()).hexdigest(),
    'endpoint':'https://api.osv.dev/v1/querybatch','documentation':'https://google.github.io/osv.dev/post-v1-querybatch/',
    'packages':rows,'packageVersionsQueried':len(rows),'advisoryIDs':identifiers,
    'affectedSelectedMacOSTargetPackages':[r for r in rows if r['advisories'] and r['selectedMacOSTargetGraph']],
    'limitations':'Version/advisory matches, not exploitability proof. Cargo lock includes other platforms; selected graph is separately marked. Includes build/dev dependencies. Native prebuilt ONNX runtime/model and system frameworks are not covered by Cargo queries. Cargo-audit execution was blocked by tool allowlist; no allowlist change or bypass was made.'}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='packages'}))
