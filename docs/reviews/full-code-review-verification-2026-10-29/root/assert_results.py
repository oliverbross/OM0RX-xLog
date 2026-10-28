from pathlib import Path
import hashlib,json
root=Path('/tmp/xlog-review-verification-20261028-12824393/root')
r=json.loads((root/'recorder-independent.json').read_text())
for name in ['initial','reopenReplay']:
    assert r[name]=={'cursor':2,'esmLinked':False,'directLinked':True,'links':1},r
assert r['afterReclassifySameSequence']=={'cursor':2,'esmLinked':False,'links':1},r
legacy=json.loads((root/'legacy-methods.json').read_text())
assert (legacy['totalDatabaseCount'],legacy['visibleCount'],legacy['exportedCount'])==(2003,2000,2000)
assert (legacy['firstCount'],legacy['repeatCount'])==(1,2)
assert legacy['firstBanner']==legacy['nilDatabaseBanner']=='Imported 2 ADIF records'
manual=json.loads((root/'manual-service.json').read_text())
assert manual['automaticBeforeSave'] is False and manual['savedStart']!=manual['requestedStart']
assert manual['receiptReopenedEqual'] and manual['replayedReceiptEqual'] and manual['rowCount']==1
assert manual['savedDurationSeconds']<0
assert hashlib.sha256((root/'adx317-independent.xsd').read_bytes()).hexdigest()=='ce7a86832f7be4a232d2c1ae7432925feb2be8506cba24345b7e3ad994a87331'
print('PASS: actual Rust recorder independent rerun, legacy method and service counterexample results, independently retrieved schema hash')
