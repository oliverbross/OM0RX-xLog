import os,sys,json,tempfile
from pathlib import Path
from copy import deepcopy
os.environ['XLOG_CONTEST_N1MM_UDP_ALLOWED']='0';os.environ['XLOG_CONTEST_ALLOW_UDP']='0'
root=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/persistence/runtime');root.mkdir(exist_ok=True);tempfile.tempdir=str(root.resolve())
sys.dont_write_bytecode=True
sys.path[:0]=['/Users/oliver/Documents/Projects/OM0RX-xLog/python','/Users/oliver/Documents/Projects/OM0RX-xLog/python/tests']
from test_remediation_import_replica import ImportedReplicaTests
from contest_host.host import Host,HostError
t=ImportedReplicaTests();t.setUp()
try:
 master,replica=t.hosts
 def imported(call,serial,time):
  params=t.params(master)
  country=deepcopy(t.config['reference']['countries']['K1ABC'])
  assert call not in replica.database(t.session).state(t.session)['reference']['countries']
  params.update(action='adif_import',record={'raw':{'CONTEST_ID':'CQ-WPX-CW','STATION_CALLSIGN':t.config['station']['Call'],'CALL':call,'QSO_DATE':'20261021','TIME_ON':time,'FREQ':'14.025','MODE':'CW','RST_SENT':'599','RST_RCVD':'579','STX':str(serial),'SRX':'202','OPERATOR':t.config['station']['Call']},'metadata':None,'sourceSHA256':'a'*64},countries={call:country},referenceID=t.config['reference']['id'])
  return t.call(master,'strategy_apply',**params)['waveResult']['qsoID']
 first=imported('K9XYZ',101,'100000');t.sync();t.assert_same(first)
 print('first enriched import sync, exact row/identity PASS')
 second=imported('K8XYZ',102,'100100');t.sync()
 def rows(h):return h.database(t.session).exec_sql_mult('SELECT ID,Call,Points,IsMultiplier1 FROM DXLOG ORDER BY TS')
 print('master rows',json.dumps(rows(master),sort_keys=True));print('replica rows',json.dumps(rows(replica),sort_keys=True))
 print('scores',json.dumps([t.call(h,'projection',sessionID=t.session)['projection']['score'] for h in t.hosts],sort_keys=True))
 print('country durable in replica identity',replica.replica_identity(replica.database(t.session),first)['country'])
 print('country in replica reference','K9XYZ' in replica.database(t.session).state(t.session)['reference']['countries'])
 t.correct(first)
 before_failure=tuple(replica.database(t.session).conn.iterdump())
 try:t.sync();print('followup correction unexpectedly accepted')
 except HostError as e:print('followup correction rejected',e.code,str(e))
 print('failed correction preserves replica tables',tuple(replica.database(t.session).conn.iterdump())==before_failure)
 for index,path in enumerate(t.roots):t.hosts[index].close();t.hosts[index]=Host(path)
 print('reopen rows',json.dumps([rows(h) for h in t.hosts],sort_keys=True))
finally:t.doCleanups()
