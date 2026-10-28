import os,sys,json,uuid,tempfile
from pathlib import Path
from tempfile import TemporaryDirectory
os.environ['XLOG_CONTEST_N1MM_UDP_ALLOWED']='0'
os.environ['XLOG_CONTEST_ALLOW_UDP']='0'
runtime=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/persistence/runtime');runtime.mkdir(exist_ok=True)
tempfile.tempdir=str(runtime.resolve())
sys.dont_write_bytecode=True
sys.path[:0]=['/Users/oliver/Documents/Projects/OM0RX-xLog/python','/Users/oliver/Documents/Projects/OM0RX-xLog/python/tests']
from contest_host.host import Host,HostError
from test_remediation_wae import WAEAreaTests
def uid():return str(uuid.uuid4())
t=WAEAreaTests();t.setUp()
try:
 t.create_wae('wae_cw');t.populate();master=t.host
 state=master.database(t.session).state(t.session);workspace=state['workspaceGeneration']
 with TemporaryDirectory() as tmp:
  replica=Host(Path(tmp).resolve()/'replica')
  def call(h,method,**p):return h.dispatch({'id':uid(),'method':method,'params':p})
  def params(h):return dict(sessionID=t.session,workspaceGeneration=workspace,operationID=uid(),expectedRevision=h.database(t.session).state(t.session)['revision'])
  call(replica,'session_create',sessionID=t.session,workspaceGeneration=workspace,operationID=uid(),expectedRevision=0,pluginID='wae_cw',station=state['station'],settings=state['settings'],reference=state['reference'],frequencyHz=state['draft']['frequencyHz'],mode='CW')
  for h,is_master in [(master,True),(replica,False)]:
   setup=call(h,'setup_get',sessionID=t.session)['setup'];setup['network'].update(multiEnabled=True,multiMaster=is_master,stationName='MASTER' if is_master else 'CLIENT')
   call(h,'setup_save',**params(h),setup=setup)
   s=h.database(t.session).state(t.session);s['definitionVersion']='1.0.0';h.database(t.session).save_state(s);h.database(t.session).conn.commit()
  def page(cursor):return call(master,'multi_changes',sessionID=t.session,workspaceGeneration=workspace,requestID=uid(),afterRevision=cursor['revision'],afterSequence=cursor['sequence'],limit=100)
  cursor={'revision':0,'sequence':0};p=page(cursor)
  grant=call(master,'multi_serial_reserve',sessionID=t.session,workspaceGeneration=workspace,requestID=uid(),frequencyHz=state['draft']['frequencyHz'])
  reservation={k:grant[k] for k in ['requestID','scope','serial','sentExchange','allocatedFieldID','authority']}
  end={'revision':p['nextRevision'],'sequence':p['nextSequence']}
  call(replica,'multi_replica_apply',**params(replica),authority=p['authority'],fromCursor=cursor,toCursor=end,historyComplete=True,changes=p['changes'],nextReservation=reservation)
  old_authority=p['authority'];print('baseline legacy pairing PASS, contacts:',len(p['changes']))
  call(master,'recalculate',**params(master));p=page(end)
  print('definition digest changed:',old_authority['coordinationDigest']!=p['authority']['coordinationDigest'])
  for label,method,extra in [('catchup','multi_replica_apply',dict(authority=p['authority'],fromCursor=end,toCursor={'revision':p['nextRevision'],'sequence':p['nextSequence']},historyComplete=True,changes=p['changes'])),('local adoption','recalculate',{})]:
   try:call(replica,method,**params(replica),**extra);print(label,'unexpectedly accepted')
   except HostError as e:print(label,'rejected:',e.code,str(e))
  print('master version',master.database(t.session).state(t.session)['definitionVersion'],'replica version',replica.database(t.session).state(t.session)['definitionVersion'])
  print('replica contacts retained:',replica.database(t.session).exec_sql('SELECT count(*) AS n FROM DXLOG')['n'])
  fresh=Host(Path(tmp).resolve()/'fresh-client');fresh_session,fresh_workspace=uid(),uid()
  call(fresh,'session_create',sessionID=fresh_session,workspaceGeneration=fresh_workspace,operationID=uid(),expectedRevision=0,pluginID='wae_cw',station=state['station'],settings=state['settings'],reference=state['reference'],frequencyHz=state['draft']['frequencyHz'],mode='CW')
  def fresh_params():return dict(sessionID=fresh_session,workspaceGeneration=fresh_workspace,operationID=uid(),expectedRevision=fresh.database(fresh_session).state(fresh_session)['revision'])
  setup=call(fresh,'setup_get',sessionID=fresh_session)['setup'];setup['network'].update(multiEnabled=True,multiMaster=False,stationName='FRESH')
  call(fresh,'setup_save',**fresh_params(),setup=setup)
  p=page({'revision':0,'sequence':0})
  grant=call(master,'multi_serial_reserve',sessionID=t.session,workspaceGeneration=workspace,requestID=uid(),frequencyHz=state['draft']['frequencyHz'])
  reservation={k:grant[k] for k in ['requestID','scope','serial','sentExchange','allocatedFieldID','authority']}
  call(fresh,'multi_replica_apply',**fresh_params(),authority=p['authority'],fromCursor={'revision':0,'sequence':0},toCursor={'revision':p['nextRevision'],'sequence':p['nextSequence']},historyComplete=True,changes=p['changes'],nextReservation=reservation)
  projection=call(fresh,'projection',sessionID=fresh_session)['projection']
  print('documented fresh matching client baseline PASS,contacts:',fresh.database(fresh_session).exec_sql('SELECT count(*) AS n FROM DXLOG')['n'],'score:',projection['score']['total'])
  print('old replica still retained:',replica.database(t.session).exec_sql('SELECT count(*) AS n FROM DXLOG')['n'])
  fresh.close()
  replica.close()
finally:t.tearDown()
