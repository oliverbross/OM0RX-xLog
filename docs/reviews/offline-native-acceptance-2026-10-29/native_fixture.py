"""Private fixture preparation and process-only identity/data receipts. Never controls production."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import selectors
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.parse import quote

repo = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
stage = repo / '.build/offline-native-acceptance-20261029-6e8bc944'
app_profile = os.environ.get('NATIVE_ACCEPTANCE_APP', 'original')
assert app_profile in {'original', 'precision'}
app = stage / ('XLog Offline Precision Development.app' if app_profile == 'precision' else 'XLog Offline Development.app')
executable = app / 'Contents/MacOS/xlog-prototype'
worker = app / 'Contents/MacOS/xlog-prototype-worker'
profile = os.environ.get('NATIVE_ACCEPTANCE_PROFILE', 'seed')
assert profile in {'seed', 'entry'}
seed_path = stage / (profile + '.json')
def uid(): return str(uuid.uuid4())
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(name, value):
    (stage / name).write_text(json.dumps(value, indent=2, default=lambda value: {'hex': bytes(value).hex()}) + '\n')
def environment():
    result = {key: value for key, value in os.environ.items() if not key.startswith(('XLOG_', 'XCW_'))}
    result.update(TMPDIR='/tmp/', PYTHONDONTWRITEBYTECODE='1')
    return result
class Worker:
    def __init__(self, root, transcript_name=None):
        self.transcript_name=transcript_name or profile
        self.err = (stage / (self.transcript_name + '-worker.stderr')).open('ab')
        self.process = subprocess.Popen([str(worker), '--offline-contest-acceptance=' + str(root)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, env=environment(), bufsize=0)
        self.buffer = b''
        self.transcript = []
    def request(self, method, **params):
        packet = {'id': uid(), 'method': method, 'params': params}
        self.process.stdin.write((json.dumps(packet) + '\n').encode())
        deadline = time.monotonic() + 30
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            while b'\n' not in self.buffer:
                if not selector.select(max(0, deadline - time.monotonic())):
                    raise TimeoutError(method)
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk: raise RuntimeError('Private fixture worker exited: ' + method)
                self.buffer += chunk
                if len(self.buffer) > 8_000_000: raise RuntimeError('Oversize private response')
        line, self.buffer = self.buffer.split(b'\n', 1)
        response = json.loads(line)
        self.transcript.append({'request': packet, 'response': response})
        assert response['id'] == packet['id'] and response['ok'], response
        return response['result']
    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=20)
        self.err.close()
        write(self.transcript_name + '-transcript.json', self.transcript)
        assert self.process.returncode == 0
def processes():
    output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,comm=,args='], text=True)
    records = []
    for line in output.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            records.append({'pid': int(parts[0]), 'ppid': int(parts[1]), 'details': parts[2]})
    return records
def own_processes():
    return [value for value in processes() if str(executable) in value['details'] or str(worker) in value['details']]

mode = sys.argv[1]
if mode == 'seed-entry':
    assert profile == 'entry' and not seed_path.exists() and not own_processes()
    root=Path(tempfile.mkdtemp(prefix='xlog-wave1-offline-entry-',dir='/private/tmp')).resolve()
    os.chmod(root,0o700)
    marker={'schema':1,'id':uid(),'connectedLoopback':False}
    (root/'.xlog-offline-acceptance.json').write_text(json.dumps(marker));os.chmod(root/'.xlog-offline-acceptance.json',0o600)
    service=Worker(root)
    try:
        health=service.request('health');assert health['station_io'] is False and health['network_contact'] is False
        service.request('workspace_create',mode='empty')
        status=service.request('workspace_status');draft=service.request('logbook_operator_draft')
    finally:service.close()
    native=root/'native';native.mkdir(exist_ok=True)
    (native/'operating-module.json').write_text(json.dumps({'version':1,'selected':'normal_logging'}))
    write(seed_path.name,{'utc':utc(),'root':str(root),'marker':marker,'app':str(app),'executable':str(executable),
        'worker':str(worker),'health':health,'workspace':status,'normalDraft':draft})
    print(json.dumps({'root':str(root),'webKitID':marker['id'],'draft':draft,'workerSHA256':hashlib.sha256(worker.read_bytes()).hexdigest()}))
elif mode == 'seed':
    assert (stage / 'development-receipt.json').is_file() and not (stage / 'seed.json').exists()
    assert not own_processes()
    root = Path(tempfile.mkdtemp(prefix='xlog-wave1-offline-native-', dir='/private/tmp')).resolve()
    os.chmod(root, 0o700)
    marker = {'schema': 1, 'id': uid(), 'connectedLoopback': False}
    marker_path = root / '.xlog-offline-acceptance.json'
    marker_path.write_text(json.dumps(marker)); os.chmod(marker_path, 0o600)
    assert root.parent == Path('/private/tmp') and root.stat().st_mode & 0o077 == 0
    service = Worker(root)
    try:
        health = service.request('health')
        assert health['station_io'] is False and health['network_contact'] is False
        service.request('workspace_create', mode='empty')
        status = service.request('workspace_status')
        draft = service.request('logbook_operator_draft')
        fixture = json.loads((repo / 'python/tests/fixtures/all_contests_lifecycle.json').read_text())['cq_wpx_cw']['state']
        session = uid()
        projection = service.request('contest_create', sessionID=session, workspaceGeneration=status['generation'],
            operationID=uid(), expectedRevision=0, pluginID='cq_wpx_cw', name='OFFLINE NATIVE ACCEPTANCE',
            station=fixture['station'], settings=fixture['settings'], frequencyHz=14025000, mode='CW')['projection']
        projection = service.request('contest_draft_apply', sessionID=session, workspaceGeneration=status['generation'],
            operationID=uid(), expectedRevision=projection['revision'], fields={'callsign':'K1SAFE', 'other_2':'314'})['projection']
        projection = service.request('contest_qso_commit', sessionID=session, workspaceGeneration=status['generation'],
            operationID=uid(), expectedRevision=projection['revision'], draftID=projection['draftID'])['projection']
        projection = service.request('contest_draft_apply', sessionID=session, workspaceGeneration=status['generation'],
            operationID=uid(), expectedRevision=projection['revision'], fields={'callsign':'K1KEEP', 'other_2':'315'})['projection']
    finally:
        service.close()
    native = root / 'native'; native.mkdir(exist_ok=True)
    # Owning Rust enum accepts exactly normal_logging and contesting.
    (native / 'operating-module.json').write_text(json.dumps({'version':1, 'selected':'normal_logging'}))
    fields = {'CONTEST_ID':'CQ-WPX-CW','STATION_CALLSIGN':fixture['station']['Call'],'CALL':'K2IMP',
              'QSO_DATE':'20261017','TIME_ON':'100001','FREQ':'14.025','BAND':'20m','MODE':'CW',
              'RST_SENT':'599','RST_RCVD':'579','STX_STRING':'003','SRX_STRING':'316',
              'OPERATOR':'TESTOP','COMMENT':'Reviewed offline native import'}
    adif = 'Offline native acceptance\r\n<ADIF_VER:5>3.1.5<EOH>\r\n' + ''.join(f'<{key}:{len(value)}>{value}' for key,value in fields.items()) + '<EOR>\r\n'
    import_path = stage / 'reviewed-import.adi'; import_path.write_bytes(adif.encode())
    write('seed.json', {'utc':utc(),'root':str(root),'marker':marker,'app':str(app),'executable':str(executable),
                       'worker':str(worker),'health':health,'workspace':status,'normalDraft':draft,
                       'contestSession':session,'contestProjection':projection,'importFields':fields,
                       'importPath':str(import_path),'importSHA256':hashlib.sha256(adif.encode()).hexdigest()})
    print(json.dumps({'seeded':True,'root':str(root),'webKitID':marker['id'],'normalDraft':draft,'contestSession':session}))
elif mode == 'abort-failed-launch':
    import signal
    label = sys.argv[2]
    seed = json.loads(seed_path.read_text())
    launch = json.loads((stage / (label + '-launch.json')).read_text())
    assert (stage / (label + '-hard-stop.json')).exists()
    records = own_processes()
    apps=[item for item in records if item['pid']==launch['pid']]
    assert len(apps)==1 and str(executable) + ' --offline-contest-acceptance=' + seed['root'] in apps[0]['details'],records
    assert all(item['pid']==launch['pid'] or (item['ppid']==launch['pid'] and str(worker)+' --offline-contest-acceptance='+seed['root'] in item['details']) for item in records),records
    os.kill(launch['pid'], signal.SIGTERM)
    deadline = time.monotonic() + 10
    while own_processes() and time.monotonic() < deadline: time.sleep(0.1)
    assert not own_processes(), 'No escalation; preserve failed-launch process evidence'
    write(label + '-aborted.json', {'utc':utc(),'previousProcess':records,'signal':'SIGTERM',
        'ordinaryQuit':False,'GUIBindingUsed':False,'remainingProcesses':own_processes()})
    print(json.dumps({'failedLaunchCleaned':True,'pid':launch['pid'],'guiBindingUsed':False}))
elif mode == 'dev-server':
    result = subprocess.run(['lsof','-nP','-iTCP:1420','-sTCP:LISTEN'],capture_output=True,text=True)
    assert not result.stdout.strip(), 'Existing listener is not this fixture; do not replace it'
    assert not (stage / 'dev-server.json').exists()
    with (stage / 'dev-server.log').open('wb') as log:
        process = subprocess.Popen(['npm','run','dev'],cwd=repo/'prototype',stdout=log,stderr=log,
            env=environment(),start_new_session=True)
    write('dev-server.json', {'utc':utc(),'pid':process.pid,'cwd':str(repo/'prototype'),
        'argv':['npm','run','dev'],'supportedScript':'vite --host 127.0.0.1 --port 1420 --strictPort'})
    print(json.dumps({'serverLauncherPID':process.pid,'loopback':'127.0.0.1:1420'}))
elif mode == 'stop-dev-server':
    import signal
    assert not any(str(stage/name/'Contents/MacOS/xlog-prototype') in item['details']
        for item in processes() for name in ['XLog Offline Development.app','XLog Offline Precision Development.app'])
    server=json.loads((stage/'dev-server.json').read_text());records=processes()
    parents=[item for item in records if item['pid']==server['pid']]
    children=[item for item in records if item['ppid']==server['pid']]
    assert len(parents)==1 and 'npm run dev' in parents[0]['details'],parents
    assert len(children)==1 and 'vite' in children[0]['details'] and '--host 127.0.0.1 --port 1420 --strictPort' in children[0]['details'],children
    assert os.getpgid(server['pid'])==server['pid']
    os.killpg(server['pid'],signal.SIGTERM)
    deadline=time.monotonic()+10
    while any(item['pid'] in {server['pid'],children[0]['pid']} for item in processes()) and time.monotonic()<deadline:time.sleep(.1)
    listener=subprocess.run(['lsof','-nP','-iTCP:1420','-sTCP:LISTEN'],capture_output=True,text=True)
    assert not listener.stdout.strip(),listener.stdout
    write('dev-server-stopped.json',{'utc':utc(),'identifiedProcesses':parents+children,'listenerRemaining':False,'signal':'SIGTERM','privateAppsStopped':True})
    print(json.dumps({'privateAppsStopped':True,'ownLoopbackServerStopped':True}))
elif mode == 'replace-dev-with-preview':
    import signal
    assert not own_processes(), 'Never change a frontend under a live native acceptance sequence'
    previous=json.loads((stage/'dev-server.json').read_text())
    records=processes()
    parent=[item for item in records if item['pid']==previous['pid']]
    children=[item for item in records if item['ppid']==previous['pid']]
    assert len(parent)==1 and 'npm run dev' in parent[0]['details'],parent
    assert len(children)==1 and 'vite' in children[0]['details'] and '--host 127.0.0.1 --port 1420 --strictPort' in children[0]['details'],children
    os.killpg(previous['pid'],signal.SIGTERM)
    deadline=time.monotonic()+10
    while any(item['pid'] in {previous['pid'],children[0]['pid']} for item in processes()) and time.monotonic()<deadline:time.sleep(.1)
    assert not subprocess.run(['lsof','-nP','-iTCP:1420','-sTCP:LISTEN'],capture_output=True,text=True).stdout.strip()
    argv=['npm','run','preview','--','--outDir',str(stage/'consumed-frontend-dist'),'--port','1420','--strictPort']
    with (stage/'preview-server.log').open('wb') as log:
        process=subprocess.Popen(argv,cwd=repo/'prototype',stdout=log,stderr=log,env=environment(),start_new_session=True)
    write('preview-server.json',{'utc':utc(),'pid':process.pid,'cwd':str(repo/'prototype'),'argv':argv,
        'previousServer':parent+children,'frontend':'exact repaired production assets; no React refresh inline preamble'})
    print(json.dumps({'previewLauncherPID':process.pid,'loopback':'127.0.0.1:1420'}))
elif mode == 'launch':
    seed = json.loads(seed_path.read_text()); root = Path(seed['root'])
    assert not own_processes(), 'Existing development process must be resolved, never replaced'
    label = sys.argv[2]
    assert not (stage / (label + '-launch.json')).exists()
    before = [record['pid'] for record in processes() if 'com.apple.WebKit.' in record['details']]
    with (stage / (label + '-native.log')).open('wb') as log:
        process = subprocess.Popen([str(executable), '--offline-contest-acceptance=' + str(root)],
            stdout=log, stderr=log, env=environment(), start_new_session=True)
    write(label + '-launch.json', {'utc':utc(),'pid':process.pid,'root':str(root),'app':str(app),
                                  'webKitID':seed['marker']['id'],'webKitPIDsBefore':before})
    print(json.dumps({'launchedPID':process.pid,'explicitArguments':['--offline-contest-acceptance=' + str(root)],'label':label}))
elif mode == 'record-restart':
    previous,label=sys.argv[2:4]
    seed=json.loads(seed_path.read_text())
    launch=json.loads((stage/(previous+'-launch.json')).read_text())
    prior=json.loads((stage/(previous+'-process-proof.json')).read_text())
    records=own_processes()
    apps=[item for item in records if str(executable)+' ' in item['details']]
    assert len(apps)==1 and apps[0]['pid']!=launch['pid'],records
    assert not {item['pid'] for item in prior['processes']} & {item['pid'] for item in records},records
    assert all('--offline-contest-acceptance='+seed['root'] in item['details'] for item in records),records
    assert not (stage/(label+'-launch.json')).exists()
    write(label+'-launch.json',{'utc':utc(),'pid':apps[0]['pid'],'root':seed['root'],'app':str(app),
        'webKitID':seed['marker']['id'],'webKitPIDsBefore':launch['webKitPIDsBefore'],
        'automaticRestartFrom':previous,'previousProcesses':prior['processes'],'currentProcesses':records,
        'explicitLaunchPerformedByHarness':False})
    print(json.dumps({'recordedAutomaticRestart':label,'previousPID':launch['pid'],'currentPID':apps[0]['pid']}))
elif mode == 'verify':
    seed = json.loads(seed_path.read_text()); label = sys.argv[2]
    launch = json.loads((stage / (label + '-launch.json')).read_text())
    coordinate = '--offline-contest-acceptance=' + seed['root']
    records = own_processes()
    apps = [record for record in records if str(executable) + ' ' in record['details']]
    workers = [record for record in records if str(worker) + ' ' in record['details']]
    try:
        assert len(apps) == len(workers) == 1, records
        assert apps[0]['pid'] == launch['pid'] and workers[0]['ppid'] == apps[0]['pid'], records
        assert all(coordinate in record['details'] for record in records), records
        candidates = [record for record in processes() if 'com.apple.WebKit.' in record['details']
                      and record['pid'] not in launch['webKitPIDsBefore']]
        webkit = []
        for record in candidates:
            result = subprocess.run(['lsof','-n','-p',str(record['pid'])], capture_output=True, text=True)
            matches = [line for line in result.stdout.splitlines() if seed['marker']['id'].lower() in line.lower()
                       or seed['marker']['id'].replace('-','').lower() in line.lower()]
            if matches: webkit.append({'process':record,'matchingHandles':matches})
        assert webkit, 'No live WebKit handle positively binds the marker UUID; no GUI binding is permitted'
    except Exception as error:
        write(label + '-hard-stop.json', {'utc':utc(),'processes':records,'error':str(error),'guiBindingPermitted':False})
        raise
    write(label + '-process-proof.json', {'utc':utc(),'processes':records,'webKit':webkit,'guiBindingPermitted':True})
    print(json.dumps({'verified':True,'appPID':apps[0]['pid'],'workerPID':workers[0]['pid'],
                      'root':seed['root'],'webKitProcesses':[record['process']['pid'] for record in webkit],
                      'webKitID':seed['marker']['id']}))
elif mode == 'snapshot':
    seed = json.loads(seed_path.read_text()); root = Path(seed['root']); label = sys.argv[2]
    target = stage / 'snapshots' / label; target.mkdir(parents=True, exist_ok=False)
    stores = {}
    for path in sorted(root.rglob('*.sqlite')):
        relative = path.relative_to(root); copy = target / relative; copy.parent.mkdir(parents=True, exist_ok=True)
        source = sqlite3.connect('file:' + quote(str(path)) + '?mode=ro', uri=True)
        destination = sqlite3.connect(copy)
        try:
            source.backup(destination)
            tables = [row[0] for row in destination.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            stores[str(relative)] = {table: [list(row) for row in destination.execute('SELECT * FROM "' + table.replace('"','""') + '"')] for table in tables}
        finally: destination.close(); source.close()
    write('snapshot-' + label + '.json', {'utc':utc(),'processes':own_processes(),'stores':stores,
        'module':json.loads((root / 'native/operating-module.json').read_text()),
        'recoveryMarkers':[str(path.relative_to(root)) for path in root.rglob('.restore-incomplete')]})
    print(json.dumps({'snapshot':label,'databases':len(stores),'root':str(root)}))
elif mode == 'stamp':
    label=sys.argv[2];assert not (stage/(label+'-stamp.json')).exists()
    value={'utc':utc(),'processes':own_processes(),'seed':str(seed_path),
        'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()}
    write(label+'-stamp.json',value);print(json.dumps(value))
elif mode == 'entry-facts':
    label=sys.argv[2]
    paths=list((stage/'snapshots'/label).glob('worker/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite'))
    assert len(paths)==1
    db=sqlite3.connect('file:'+quote(str(paths[0]))+'?mode=ro',uri=True)
    draft=json.loads(db.execute('SELECT payload FROM xlog_operator_draft').fetchone()[0])
    receipts=[json.loads(row[0]) for row in db.execute('SELECT payload FROM xlog_operator_receipts ORDER BY revision')]
    output={'snapshot':label,'draft':draft,'saveReceipts':[item for item in receipts if item['mutation']['action']=='save'],
        'mutations':[{'operationID':item['mutation']['operationID'],'action':item['mutation']['action'],
        'revision':item['draft']['revision'],'call':item['draft']['qso']['call'],'start':item['draft']['qso']['start'],
        'automaticStart':item['draft']['automaticStart']} for item in receipts]}
    db.close();write('entry-facts-'+label+'.json',output)
    print(json.dumps({'snapshot':label,'draft':{key:draft[key] for key in ['revision','automaticStart']},
        'draftQSO':{key:draft['qso'].get(key) for key in ['id','call','start','comment']},
        'savedQSOs':[{key:item['savedQSO'].get(key) for key in ['id','call','start','comment']} for item in output['saveReceipts']],
        'mutations':output['mutations']},indent=2))
elif mode == 'entry-export':
    assert profile=='entry' and not own_processes()
    seed=json.loads(seed_path.read_text())
    service=Worker(Path(seed['root']),transcript_name='entry-backend-export')
    try:
        opened=service.request('logbook_export_adif',action='begin',scope='all')
        exported=service.request('logbook_export_adif',action='read',token=opened['token'],offset=0,limit=25)
        assert exported['count']==exported['total']==opened['total']==3
    finally:service.close()
    payload=exported['text'].encode();(stage/'final-backend-logbook.adi').write_bytes(payload)
    write('entry-backend-export.json',{'utc':utc(),'source':'actual worker begin/read on UI-created QSOs; not a native Blob download receipt',
        'byteCount':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),'opened':opened,'exported':exported})
    print(json.dumps({'backendExportCount':3,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}))
elif mode == 'replay-saves':
    assert profile=='entry' and not own_processes()
    seed=json.loads(seed_path.read_text());label=sys.argv[2]
    facts=json.loads((stage/('entry-facts-'+label+'.json')).read_text())
    assert facts['saveReceipts']
    service=Worker(Path(seed['root']),transcript_name='replay-'+label)
    try:
        before=service.request('logbook_stats')
        results=[]
        for receipt in facts['saveReceipts']:
            result=service.request('logbook_operator_draft_apply',generation=seed['workspace']['generation'],**receipt['mutation'])
            assert result['status']=='applied'
            assert result['receipt']['savedQSO']['id'].lower()==receipt['savedQSO']['id'].lower()
            results.append(result)
        after=service.request('logbook_stats')
        assert before==after,(before,after)
    finally:service.close()
    # Preserve the exact maintained fixture transcript under a separate name;
    # no original seed transcript or issued receipt is replaced.
    write('replay-'+label+'.json',{'utc':utc(),'before':before,'after':after,'results':results,
        'requests':service.transcript,'generationSource':'entry.json original UI profile, no intervening restore'})
    print(json.dumps({'replayedUIOriginSaves':len(results),'before':before['stats'],'after':after['stats']}))
elif mode == 'summary':
    label=sys.argv[2]
    output={}
    for path in (stage/'snapshots'/label).rglob('*.sqlite'):
        db=sqlite3.connect('file:'+quote(str(path))+'?mode=ro',uri=True)
        tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        selected={}
        for table in tables:
            if not any(key in table.lower() for key in ['qso','draft','receipt','restore','rotor_configuration','contact','workspace_metadata']):continue
            cursor=db.execute('SELECT * FROM "'+table.replace('"','""')+'" LIMIT 10')
            rows=[]
            for row in cursor:
                values=[]
                for value in row:
                    if isinstance(value,bytes):
                        try:value=json.loads(value)
                        except (ValueError,UnicodeDecodeError):value={'bytes':len(value)}
                    values.append(value)
                rows.append(dict(zip([column[0] for column in cursor.description],values)))
            if rows:selected[table]=rows
        db.close()
        output[str(path.relative_to(stage/'snapshots'/label))]=selected
    write('summary-'+label+'.json',output)
    brief={}
    for store,tables in output.items():
        brief[store]={}
        for table,rows in tables.items():
            if table=='xlog_operator_draft':brief[store][table]=rows
            elif table=='xlog_operator_receipts':brief[store][table]=[{'operationID':row['operation_id'],'action':row['action'],'revision':row['revision'],'start':row['payload']['mutation'].get('qso',{}).get('start'),'automaticStart':row['payload']['draft']['automaticStart'],'savedQSO':row['payload'].get('savedQSO')} for row in rows]
    print(json.dumps(brief,indent=2))
elif mode == 'check':
    label=sys.argv[2]; argv=sys.argv[3:]
    assert label and argv and not (stage/(label+'-command.json')).exists()
    started=utc(); began=time.monotonic()
    with (stage/(label+'.log')).open('wb') as log:
        result=subprocess.run(argv,cwd=repo/'prototype',stdout=log,stderr=subprocess.STDOUT,env=environment())
    write(label+'-command.json',{'argv':argv,'cwd':str(repo/'prototype'),'startedUTC':started,'finishedUTC':utc(),
        'elapsedSeconds':time.monotonic()-began,'exit':result.returncode,
        'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
        'diff':subprocess.check_output(['git','diff','--','prototype/src/live/rotorConfigurationSession.ts','prototype/src/live/rotorConfigurationSession.test.ts'],cwd=repo,text=True)})
    print(json.dumps({'label':label,'exit':result.returncode,'log':str(stage/(label+'.log'))}))
    sys.exit(result.returncode)
elif mode == 'stopped':
    records = own_processes()
    write(sys.argv[2] + '-stopped.json', {'utc':utc(),'processes':records,'stopped':not records})
    assert not records, 'Original development app/worker still alive; do not query or relaunch its binding'
    print(json.dumps({'stopped':True,'queriedGUI':False}))
else:
    raise SystemExit('Unsupported bounded fixture operation')
