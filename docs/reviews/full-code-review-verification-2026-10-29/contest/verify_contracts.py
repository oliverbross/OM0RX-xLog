"""Second-pass verification against unchanged application Host code.

All data is synthetic and stays below this evidence directory. No sockets,
native GUI, radio, audio device, credential, account or output transport is used.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

REPO=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
OUT=Path(__file__).resolve().parent
sys.path[:0]=[str(REPO/'python'),str(REPO/'python/tests')]
os.environ['XLOG_CONTEST_N1MM_UDP_ALLOWED']='0'
from contest_host.host import Host, HostError
from contest_host.store import canonical
from contest_host.upstream import load_plugin

SEEDS=json.loads((REPO/'python/tests/fixtures/all_contests_lifecycle.json').read_text())
uid=lambda:str(uuid.uuid4())
RUN=OUT/('data-'+uid())
RUN.mkdir(mode=0o700)
hosts=[]
def call(h,method,params):return h.dispatch({'id':uid(),'method':method,'params':deepcopy(params)})
def read(h,scope,method,**extra):return call(h,method,{'sessionID':scope['sessionID'],**extra})
def projection(h,scope):return read(h,scope,'projection')['projection']
def mutation(h,scope,method,**extra):
    p=projection(h,scope)
    params={'sessionID':scope['sessionID'],'workspaceGeneration':scope['workspaceGeneration'],
            'operationID':uid(),'expectedRevision':p['revision'],**extra}
    return call(h,method,params),params
def make(plugin,name):
    source=SEEDS[plugin]['state']
    root=RUN/name;h=Host(root);hosts.append(h)
    scope={'sessionID':uid(),'workspaceGeneration':uid()}
    created=call(h,'session_create',{**scope,'operationID':uid(),'expectedRevision':0,
        'pluginID':plugin,'station':deepcopy(source['station']),'settings':deepcopy(source['settings']),
        'reference':deepcopy(source['reference']),'frequencyHz':source['draft']['frequencyHz'],
        'mode':source.get('operatingMode',load_plugin(plugin).mode if load_plugin(plugin).mode!='BOTH' else 'CW')})
    assert h.n1mm_udp_allowed is False
    return h,scope,root,created
def reopen(h,root):
    h.close();hosts.remove(h);h=Host(root);hosts.append(h);assert h.n1mm_udp_allowed is False
    return h
def group_setup(h,scope,master):
    setup=read(h,scope,'setup_get')['setup']
    setup['network'].update(multiEnabled=True,multiMaster=master,stationName='MASTER' if master else 'CLIENT')
    mutation(h,scope,'setup_save',setup=setup)
def record(h,scope,serial='101'):
    p=projection(h,scope);state=h.database(scope['sessionID']).state(scope['sessionID'])
    return {'raw':{'CONTEST_ID':load_plugin(p['pluginID']).cabrillo_name,
       'STATION_CALLSIGN':state['station']['Call'],'CALL':'K1ABC','QSO_DATE':'20261021',
       'TIME_ON':'100000','FREQ':'14.025','MODE':'CW','RST_SENT':'599','RST_RCVD':'579',
       'STX':serial,'STX_STRING':serial.zfill(3),'SRX':'202'},'metadata':None,'sourceSHA256':'a'*64}
def import_record(h,scope,rec):return mutation(h,scope,'strategy_apply',action='adif_import',record=rec)
def reserve(h,scope,request=None):return read(h,scope,'multi_serial_reserve',
    workspaceGeneration=scope['workspaceGeneration'],requestID=request or uid(),frequencyHz=14025000)
def changes(h,scope,cursor=None):
    cursor=cursor or {'revision':0,'sequence':0}
    return read(h,scope,'multi_changes',workspaceGeneration=scope['workspaceGeneration'],requestID=uid(),
                afterRevision=cursor['revision'],afterSequence=cursor['sequence'],limit=25)
def apply(h,scope,page,reservation=None):
    p=projection(h,scope)
    params={**scope,'operationID':uid(),'expectedRevision':p['revision'],'authority':page['authority'],
        'fromCursor':p.get('replicaCursor') or {'revision':0,'sequence':0},
        'toCursor':{'revision':page['nextRevision'],'sequence':page['nextSequence']},
        'historyComplete':not page['hasMore'],'changes':page['changes']}
    if reservation is not None:params['nextReservation']={key:deepcopy(reservation[key]) for key in
        ('requestID','scope','serial','sentExchange','allocatedFieldID','authority')}
    return params
TABLES=['DXLOG','xlog_session','xlog_serial','xlog_operation','xlog_qso_identity','xlog_qso_audit',
        'xlog_replica','xlog_replica_stage','xlog_replica_stage_qso','xlog_replica_stage_audit']
def snapshot(h,scope):
    store=h.database(scope['sessionID'])
    return {table:store.exec_sql_mult('SELECT rowid,* FROM '+table+' ORDER BY rowid') for table in TABLES}
def reject_unchanged(h,scope,method,params,expected_code=None,expected_message=None):
    before=snapshot(h,scope)
    try:call(h,method,params)
    except HostError as exc:error={'code':exc.code,'message':str(exc)}
    else:raise AssertionError('Expected rejection: '+method)
    if expected_code:assert error['code']==expected_code,error
    if expected_message:assert error['message']==expected_message,error
    assert snapshot(h,scope)==before,'Rejected operation changed durable rows'
    assert not h.database(scope['sessionID']).conn.in_transaction
    return error

results={}
try:
    # CR-004: prove clean paired baseline first, using independent roots.
    master,ms,mroot,_=make('cq_wpx_cw','cr004-master')
    replica,rs,rroot,_=make('cq_wpx_cw','cr004-replica')
    group_setup(master,ms,True);group_setup(replica,rs,False)
    initial=changes(master,ms);grant=reserve(master,ms)
    baseline_params=apply(replica,rs,initial,grant)
    baseline=call(replica,'multi_replica_apply',baseline_params)
    assert baseline['projection']['authoritySerialRequestID']==grant['requestID']
    assert baseline['actions']==[]
    imported,ip=import_record(master,ms,record(master,ms))
    repeated=call(master,'strategy_apply',ip)
    assert repeated['replayed'] and repeated['actions']==[]
    assert read(master,ms,'log')['total']==1
    page=changes(master,ms,baseline['projection']['replicaCursor'])
    assert [x['kind'] for x in page['changes']]==['adif_import']
    assert page['changes'][0]['afterIdentity'] is None
    pp=apply(replica,rs,page)
    failure=reject_unchanged(replica,rs,'multi_replica_apply',pp,
        expected_code='invalid_request',expected_message='Replica change kind is invalid')
    assert read(replica,rs,'operation_receipt',operationID=pp['operationID'])['found'] is False
    master=reopen(master,mroot);replica=reopen(replica,rroot)
    replay=call(master,'strategy_apply',ip)
    assert replay['replayed'] and read(master,ms,'log')['total']==1
    page2=changes(master,ms,projection(replica,rs)['replicaCursor'])
    assert page2['changes']==page['changes']
    fail_after_reopen=reject_unchanged(replica,rs,'multi_replica_apply',pp,expected_code='invalid_request')
    wrong=apply(replica,rs,page2);wrong['authority']['coordinationDigest']='0'*64
    wrong_authority=reject_unchanged(replica,rs,'multi_replica_apply',wrong,expected_code='authority_mismatch')
    results['CR-004']={'baselinePairedSync':'PASS','independentRoots':True,'masterNetworkRole':'master',
       'replicaNetworkRole':'client','importReplayedWithoutNewContact':True,'reopenPreservesSameInvalidPage':True,
       'failure':failure,'failureAfterReopen':fail_after_reopen,'wrongAuthorityRejected':wrong_authority,
       'rejectedApplyPreservesAllCoreTablesAndHasNoReceipt':True,'masterContacts':read(master,ms,'log')['total'],
       'replicaContacts':read(replica,rs,'log')['total'],'auditKind':page['changes'][0]['kind'],
       'afterIdentity':page['changes'][0]['afterIdentity']}

    # CR-005: valid master setup, import floor, immutable bad receipt, rollback.
    h,s,root,_=make('cq_wpx_cw','cr005-master');group_setup(h,s,True)
    import_record(h,s,record(h,s,'2'))
    grant=reserve(h,s);assert grant['serial']==2
    repeat=reserve(h,s,grant['requestID']);assert repeat['replayed'] and repeat['serial']==2
    p=projection(h,s)
    cp={**s,'requestID':uid(),'action':'commit','qsoID':uid(),'timestamp':'2026-10-21 10:01:00',
       'frequencyHz':14025000,'serialRequestID':grant['requestID'],'fields':{'callsign':'DL1ABC','other_2':'314'}}
    failure=reject_unchanged(h,s,'multi_contact_apply',cp,expected_code='historical_serial_conflict')
    h=reopen(h,root);repeat_after=reserve(h,s,grant['requestID'])
    assert repeat_after['replayed'] and repeat_after['serial']==2
    reject_unchanged(h,s,'multi_contact_apply',cp,expected_code='historical_serial_conflict')
    # New grants advance, but do not rewrite the unusable prior receipt.
    following=reserve(h,s);assert following['serial']==3
    # A separate local allocation control proves the other policy honors floor.
    local,ls,lroot,_=make('cq_wpx_cw','cr005-local-control')
    import_record(local,ls,record(local,ls,'2'))
    committed,_=mutation(local,ls,'qso_commit',qsoID=uid(),timestamp='2026-10-21 10:02:00',fields={'callsign':'DL1ABC','other_2':'314'})
    assert committed['projection']['reservedSerial']==3
    results['CR-005']={'masterNetworkEnabled':True,'historicalFloor':2,'grantedSerial':grant['serial'],
       'replaySerial':repeat['serial'],'reopenReplaySerial':repeat_after['serial'],'rejectedCommit':failure,
       'commitRollbackAllCoreTables':True,'followingNewGrant':following['serial'],
       'localNextSerialControl':committed['projection']['reservedSerial'],'physicalTransmissionTested':False}

    # CR-006: each actual WAE mode, a portable-override control, correction,
    # stable restart/replay, and actual Cabrillo claimed-score bytes.
    wae=[]
    for plugin in ('wae_cw','wae_ssb','wae_rtty'):
        h,s,root,_=make(plugin,'cr006-'+plugin)
        country={'entity':'Japan','continent':'AS','cq':25,'itu':45,'primary_pfx':'JA'}
        ids=[];params=[]
        for i,calltext in enumerate(('JR4AAA','7K4ABC','7M4XYZ')):
            q=uid();ids.append(q)
            value,mp=mutation(h,s,'qso_commit',qsoID=q,timestamp=f'2026-10-21 11:0{i}:00',
                fields={'callsign':calltext,'other_2':str(i+1)},
                referenceID=SEEDS[plugin]['state']['reference']['id'],countries={calltext:country})
            params.append(mp)
        before=read(h,s,'score')['score'];assert before['total']==12 and before['scoringComplete'] is True
        cabrillo=read(h,s,'export')['content'];assert 'CLAIMED-SCORE: 12\r\n' in cabrillo
        correction,_=mutation(h,s,'qso_correct',qsoID=ids[1],fields={'callsign':'7K4ABC/4'},
            referenceID=SEEDS[plugin]['state']['reference']['id'],countries={'7K4ABC/4':country})
        one_portable=read(h,s,'score')['score'];assert one_portable['total']==12
        mutation(h,s,'qso_correct',qsoID=ids[2],fields={'callsign':'7M4XYZ/4'},
            referenceID=SEEDS[plugin]['state']['reference']['id'],countries={'7M4XYZ/4':country})
        portable=read(h,s,'score')['score'];assert portable['total']==6
        # Restore original call to demonstrate actual correction reintroduces bug.
        mutation(h,s,'qso_correct',qsoID=ids[2],fields={'callsign':'7M4XYZ'})
        h=reopen(h,root);after=read(h,s,'score')['score'];assert after['total']==12
        receipt=call(h,'qso_commit',params[2]);assert receipt['replayed'] and receipt['actions']==[]
        assert read(h,s,'log')['total']==3
        wae.append({'plugin':plugin,'score':before,'cabrilloClaimedScore':12,'expected':6,
           'bothExplicitPortableOverridesScore':portable['total'],'reopenScore':after['total'],
           'originalCommitReplayAddsNoRowsOrActions':True})
    rules=REPO/'.build/wave5/rules/darc-wae-rules.html'
    html=rules.read_bytes();sha=hashlib.sha256(html).hexdigest()
    expected=json.loads((REPO/'docs/contesting/WAE_2026_RULE_REFERENCE.json').read_text())['sha256']
    assert sha==expected
    assert b'JR4, 7M4 und 7K4 count as JA4' in html
    cty=(REPO/'Sources/XLogCore/Resources/cty.csv').read_text()
    japan=next(line for line in cty.splitlines() if line.startswith('JA,Japan,'))
    assert all(token in japan for token in ('7K','7M','JR'))
    results['CR-006']={'modes':wae,'retainedOfficialRulesSHA256':sha,'matchesTrackedReference':True,
       'ruleExample':'JR4, 7M4 und 7K4 count as JA4','bundledJapanCTYRow':japan,
       'currentLiveSponsorRetrieval':'Not repeated; retained hash-verified official edition is application-pinned authority'}

    # CR-007: ordinary Enter with ESM on/off and a saved LOGIT F-key;
    # classify only real committed audit events, reject invalid input atomically.
    rec=[]
    for mode in ('enabled','disabled','logit'):
        h,s,root,_=make('cq_ww_ssb','cr007-'+mode)
        setup=read(h,s,'setup_get')['setup'];setup['preferences']['useESM']=mode!='disabled'
        if mode=='logit':setup['macros']=[{'mode':'S','key':'F12','label':'Local log','template':'{LOGIT}'}]
        mutation(h,s,'setup_save',setup=setup)
        if mode=='enabled':
            mutation(h,s,'esm',field='callsign',fields={'callsign':'K1ABC'})
            committed,mp=mutation(h,s,'esm',field='other_2',fields={'other_2':'5'})
        elif mode=='disabled':
            committed,mp=mutation(h,s,'esm',field='other_2',fields={'callsign':'K1ABC','other_2':'5'})
        else:
            committed,mp=mutation(h,s,'function_key',key='F12',fields={'callsign':'K1ABC','other_2':'5'})
        assert read(h,s,'log')['total']==1
        page=read(h,s,'recorder_changes',afterSequence=0,limit=200)
        assert len(page['events'])==1 and page['events'][0]['kind']=='commit' and page['events'][0]['local'] is False
        event=page['events'][0]
        replay=call(h,mp and ('function_key' if mode=='logit' else 'esm'),mp)
        assert replay['replayed'] and replay['actions']==[]
        h=reopen(h,root)
        assert read(h,s,'recorder_changes',afterSequence=0,limit=200)==page
        assert read(h,s,'recorder_changes',afterSequence=event['sequence'],limit=200)['events']==[]
        assert read(h,s,'log')['total']==1
        rec.append({'route':mode,'operationMethod':'function_key' if mode=='logit' else 'esm',
                    'auditKind':event['kind'],'local':event['local'],'replayedActions':[],
                    'reopenAuditIdentical':True,'contacts':1})
    results['CR-007']={'routes':rec,'physicalRecorderOrOutputTested':False,
       'nativeStoreConsumerVerification':'Coordinated native agent owns actual unchanged Rust consumer harness'}
    results['source']={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),
       'runDataRoot':str(RUN),'applicationMutation':False,'realTransportsUsed':False}
    (OUT/'verification-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2))
finally:
    for h in hosts:
        h.close()
