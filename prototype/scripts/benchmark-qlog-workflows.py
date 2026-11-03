#!/usr/bin/env python3
"""Bounded exact-bundle worker diagnostics on an existing generated fixture only.

No GUI binding, installed-app replacement, live service or operator log access.
The same disposable database copy is reopened for first/warm process measurements.
"""
import argparse,base64,hashlib,json,os,selectors,sqlite3,subprocess,tempfile,time,uuid
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--worker',type=Path,required=True);parser.add_argument('--fixture',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True);parser.add_argument('--baseline',action='store_true')
    args=parser.parse_args()
    worker=args.worker.resolve(strict=True);fixture=args.fixture.resolve(strict=True)
    assert worker.name=='xlog-prototype-worker' and worker.parent.name=='MacOS' and worker.parent.parent.name=='Contents'
    assert '.build' in fixture.parts and fixture.is_file() and not args.out.exists()
    reader=sqlite3.connect(fixture.as_uri()+'?mode=ro',uri=True)
    assert reader.execute('SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL').fetchone()[0]==100000
    assert reader.execute("SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL AND json_extract(record_json,'$.comment') LIKE 'Generated private fixture %'").fetchone()[0]==100000
    root=Path(tempfile.mkdtemp(prefix='xlog-wave1-qlog-benchmark-',dir='/private/tmp')).resolve()
    root.chmod(0o700);(root/'native').mkdir(mode=0o700);(root/'home').mkdir(mode=0o700)
    (root/'.xlog-offline-acceptance.json').write_text(json.dumps({'schema':1,'id':str(uuid.uuid4()),'connectedLoopback':False}))
    (root/'native/operating-module.json').write_text(json.dumps({'version':1,'selected':'normal_logging'}))
    (root/'.xlog-offline-acceptance.json').chmod(0o600);(root/'native/operating-module.json').chmod(0o600)
    results={'schema':1,'worker':str(worker),'workerSHA256':hashlib.sha256(worker.read_bytes()).hexdigest(),'fixture':str(fixture),
        'root':str(root),'baseline':args.baseline,'scope':'Bundled worker on generated data, no GUI or hardware; process-cold/OS-cache-unspecified, not disk-cold','runs':[]}
    process=None
    def launch():
        nonlocal process
        assert root.parent==Path('/private/tmp') and root.name.startswith('xlog-wave1-') and root.stat().st_mode & 0o077 == 0
        assert json.loads((root/'native/operating-module.json').read_text())['selected']=='normal_logging'
        assert uuid.UUID(json.loads((root/'.xlog-offline-acceptance.json').read_text())['id'])
        command=[str(worker),'--offline-contest-acceptance='+str(root)]
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=(root/'worker.stderr.log').open('ab'),
            env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8','CFFIXED_USER_HOME':str(root/'home'),'XLOG_OPERATING_MODULE':'normal_logging'})
        proof=None
        for _ in range(100):
            assert process.poll() is None,'Isolated worker exited before process verification'
            lines=subprocess.check_output(['/bin/ps','-ww','-p',str(process.pid),'-o','pid=,ppid=,command='],text=True,timeout=3).splitlines()
            proof=next((line.split(None,2) for line in lines if len(line.split(None,2))==3 and line.split(None,2)[0]==str(process.pid) and line.split(None,2)[1]==str(os.getpid()) and line.split(None,2)[2]==' '.join(command)),None)
            if proof:break
            time.sleep(.025)
        assert proof is not None,'Exact worker PID/executable/private-root arguments unavailable'
        selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ);buffer=bytearray()
        def request(method,params=None):
            nonlocal buffer
            identity=str(uuid.uuid4());started=time.perf_counter()
            body={'id':identity,'method':method,'params':params or {},'operatingModule':'normal_logging'}
            process.stdin.write(json.dumps(body,separators=(',',':')).encode()+b'\n');process.stdin.flush()
            deadline=time.monotonic()+120
            while b'\n' not in buffer:
                assert time.monotonic()<deadline and process.poll() is None,'Request did not complete: '+method
                if selector.select(timeout=.5):
                    chunk=os.read(process.stdout.fileno(),65536);assert chunk;buffer.extend(chunk)
            line,_,remaining=buffer.partition(b'\n');buffer=bytearray(remaining)
            response=json.loads(line);assert response.get('id')==identity and response.get('ok') is True,response
            return response['result'],round((time.perf_counter()-started)*1000,3)
        return request,proof,selector
    def close(selector):
        nonlocal process
        process.stdin.close();process.wait(timeout=15);assert process.returncode==0;selector.close();process=None
    try:
        request,proof,selector=launch()
        health,_=request('health')
        assert all(health.get(key) is False for key in ['station_io','credentials_accessed','live_cluster','network_contact']),health
        request('workspace_create',{'mode':'empty'});close(selector)
        destination=root/'worker/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite'
        assert destination.is_file()
        writer=sqlite3.connect(destination);reader.backup(writer);writer.close();reader.close()
        for run in range(2):
            request,proof,selector=launch();entry={'phase':'first-process' if run==0 else 'reopened-process','processProof':proof,'timingsMs':{}}
            results['runs'].append(entry)
            status,entry['timingsMs']['open']=request('workspace_status');assert status['qso_count']==100000
            for label,params in [('firstPage',{'limit':20}),('warmPage',{'limit':20}),('legacyText',{'limit':20,'search':'K1T'})]:
                data,entry['timingsMs'][label]=request('logbook_list',params)
                expected=25000 if label=='legacyText' else 100000 # K1T also occurs literally in VK1T.
                assert data['total']==expected,(label,data['total'],expected)
            stats,entry['timingsMs']['statistics']=request('logbook_stats');assert stats['stats']['qso_count']==100000
            if not args.baseline:
                query={'version':1,'join':'all','clauses':[{'field':'band','op':'eq','values':['20m']},{'field':'mode','op':'eq','values':['CW']}]}
                data,entry['timingsMs']['typedFirstPageAndCount']=request('logbook_list',{'limit':20,'query':query});assert data['total']==33334
                data,entry['timingsMs']['typedWarmPageAndCount']=request('logbook_list',{'limit':20,'query':query});assert data['total']==33334
                export,entry['timingsMs']['typedFilteredSnapshot']=request('logbook_export_adif',{'action':'begin','scope':'filtered','query':query});assert export['total']==33334
                chunk,entry['timingsMs']['exportFirstChunk']=request('logbook_export_adif',{'action':'read','token':export['token'],'limit':20});assert chunk['count']==20
                awards,entry['timingsMs']['globalAwardCold']=request('logbook_award_progress',{'programme':'dxcc'});assert awards['workedUnits']==8 and awards['supportingQSOs']==100000
                awards,entry['timingsMs']['globalAwardWarm']=request('logbook_award_progress',{'programme':'dxcc'});assert awards['workedUnits']==8
            export,entry['timingsMs']['filteredSnapshot']=request('logbook_export_adif',{'action':'begin','scope':'filtered','search':'K1T'});assert export['total']==25000
            close(selector)
        results['state']='passed'
    except BaseException as error:
        results.update(state='failed',error=str(error),survivingWorkerPID=process.pid if process and process.poll() is None else None)
        raise
    finally:
        if process and process.poll() is None:
            process.stdin.close()
            try:
                process.wait(timeout=15)
                results['survivingWorkerPID']=None
            except subprocess.TimeoutExpired: results['survivingWorkerPID']=process.pid
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(results,indent=2)+'\n')
        print(json.dumps(results))
if __name__=='__main__':main()
