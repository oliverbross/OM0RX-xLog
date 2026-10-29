from pathlib import Path
import datetime, hashlib, json, re, shutil, sqlite3, tempfile
stage=Path(__file__).resolve().parent
facts=json.loads((stage/'entry-facts-final-saves-quit.json').read_text())
saved={item['savedQSO']['call']:item['savedQSO'] for item in facts['saveReceipts']}
assert set(saved)=={'K2AUTO','K3MANUAL','K4AUTO'}
epoch=datetime.datetime(2001,1,1,tzinfo=datetime.timezone.utc)
asdate=lambda value:epoch+datetime.timedelta(seconds=value)
checks={}
for call,label in [('K2AUTO','desk'),('K4AUTO','detached')]:
    low=datetime.datetime.fromisoformat(json.loads((stage/(label+'-before-save-stamp.json')).read_text())['utc'])
    high=datetime.datetime.fromisoformat(json.loads((stage/(label+'-after-save-stamp.json')).read_text())['utc'])
    actual=asdate(saved[call]['start']);assert low<=actual<=high
    checks[call]={'utc':actual.isoformat(),'lowerBound':low.isoformat(),'upperBound':high.isoformat(),'buttonTimeBound':True,'id':saved[call]['id']}
assert asdate(saved['K3MANUAL']['start']).isoformat()=='2026-10-29T12:25:08+00:00'
checks['K3MANUAL']={'utc':asdate(saved['K3MANUAL']['start']).isoformat(),'matchesObservedFullAndDeskTime':True,'id':saved['K3MANUAL']['id']}
assert facts['draft']['qso']['call']=='K5KEEP' and facts['draft']['qso']['comment']=='Final retained unfinished draft'
assert facts['draft']['qso']['id'] not in {item['id'] for item in saved.values()}
replay=json.loads((stage/'replay-final-saves-quit.json').read_text());assert replay['before']==replay['after'] and replay['after']['stats']['qso_count']==3
payload=(stage/'final-backend-logbook.adi').read_bytes();records=[];fields={};offset=0
while offset<len(payload):
    start=payload.find(b'<',offset)
    if start<0:break
    close=payload.index(b'>',start);tag=payload[start+1:close].decode();offset=close+1
    if tag.upper()=='EOH':fields={};continue
    if tag.upper()=='EOR':records.append(fields);fields={};continue
    match=re.fullmatch(r'([^:]+):(\d+)(?::[^:]+)?',tag);assert match,tag
    key,length=match.group(1).upper(),int(match.group(2));fields[key]=payload[offset:offset+length].decode();offset+=length
assert len(records)==3
for record in records:
    expected=asdate(saved[record['CALL']]['start'])
    assert record['QSO_DATE']==expected.strftime('%Y%m%d') and record['TIME_ON']==expected.strftime('%H%M%S'),record
    checks[record['CALL']]['backendADIFDate']=record['QSO_DATE'];checks[record['CALL']]['backendADIFTime']=record['TIME_ON']
integrity=[]
with tempfile.TemporaryDirectory(prefix='xlog-native-evidence-copy-') as temporary:
    for path in sorted((stage/'snapshots').rglob('*.sqlite')):
        if not any(part in {'precision-first-fields','desk-ready-final','desk-saved-final','full-reversal-attempt','detached-ready-final','final-ui-saves','final-saves-quit','final-reopen-quit'} for part in path.parts):continue
        target=Path(temporary)/(str(len(integrity))+'.sqlite');shutil.copy2(path,target)
        db=sqlite3.connect(target)
        result=[list(row) for row in db.execute('PRAGMA integrity_check')];foreign=[list(row) for row in db.execute('PRAGMA foreign_key_check')];db.close()
        assert result==[['ok']] and not foreign
        integrity.append({'source':str(path.relative_to(stage)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'integrity':result,'foreignKeys':foreign})
out={'source':'e6cab56f50953798f08df8d16142bfc90fd193b1','checks':checks,'replayThreeOriginalSaveOperations':True,
    'retainedDraft':facts['draft'],'backendADIFOnlyNotNativeDownload':True,'integrity':integrity}
(stage/'final-entry-verification.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'checks':checks,'replayed':3,'retainedDraftID':facts['draft']['qso']['id'],'copiedDBs':len(integrity)}))
