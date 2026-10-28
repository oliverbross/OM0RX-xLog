from pathlib import Path
import json,uuid
from test_host import HostTests, uid
h=HostTests(); h.setUp()
try:
 rows={}
 rows['create']=h.read('session_open')
 rows['apply']=h.mutate('draft_apply',fields={'callsign':'K1ABC','other_2':'5'})
 qso=uid();op=uid();params={'sessionID':h.session,'operationID':op,'expectedRevision':h.revision,'qsoID':qso,'timestamp':'2026-10-17 03:02:00','frequencyHz':14025000}
 rows['commit']=h.call('qso_commit',params)
 rows['log']=h.read('log');rows['score']=h.read('score');rows['receipt']=h.read('receipt',operationID=op)
 rows['correct']=h.mutate('qso_correct',qsoID=qso,fields={'callsign':'DL1ABC','other_2':'14'},reason='Synthetic correction')
 rows['delete']=h.mutate('qso_delete',qsoID=qso,reason='Synthetic deletion')
 (Path('/tmp/xlog-phase5-20261029-721e0705')/'python-contract.json').write_text(json.dumps(rows,indent=2)+'\n')
 for key,value in rows.items(): print(key,str(value)[:1900])
finally:h.tearDown()
