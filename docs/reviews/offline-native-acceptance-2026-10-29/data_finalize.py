from pathlib import Path
import datetime, hashlib, json, shutil, sys
stage=Path(__file__).resolve().parent;out=stage/'data-evidence'
root=Path('/private/tmp/xlog-wave1-offline-native-5__wfphw');base=root/'worker/OM0RX-xLog-Integrated Preview'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,v):(out/name).write_text(json.dumps(v,indent=2)+'\n')
def decode(v):
    if isinstance(v,dict) and set(v)=={'hex'}:
        try:return decode(json.loads(bytes.fromhex(v['hex'])))
        except (ValueError,UnicodeDecodeError):return v
    if isinstance(v,str) and v[:1] in ['{','[']:
        try:return decode(json.loads(v))
        except ValueError:return v
    if isinstance(v,dict):return {k:decode(x) for k,x in v.items()}
    if isinstance(v,list):return [decode(x) for x in v]
    return v
data=decode(json.loads((out/'database-inspection.json').read_text()))
main='worker/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite';contest='worker/Contesting/Python/8b9c6663-bccd-4701-9f83-5fbc7c705251/contest.sqlite'
def tables(label,relative):return data['snapshot-copies/'+label+'/'+relative]['tables']
before=tables('before-native-restore',main);after=tables('after-native-restore',main)
draft=before['xlog_operator_draft'][0]['payload'];manual=before['qsos'][0]
save=[r for r in before['xlog_operator_receipts'] if r['action']=='save']
write('native-save-receipts.json',save)
labels=['manual-save-detached','contesting-restart','switch-veto','before-native-restore','after-native-restore']
raw_import=data['selected-package/Contesting/Python/8b9c6663-bccd-4701-9f83-5fbc7c705251/contest.sqlite']['tables']['xlog_adif_import'][0]
checks={
 'normalQSORowsEqualAcrossRequestedSnapshots':all(tables(label,main)['qsos']==before['qsos'] for label in labels),
 'unfinishedDraftPayloadEqualAcrossRequestedSnapshots':all(tables(label,main)['xlog_operator_draft'][0]['payload']==draft for label in labels),
 'actualSaveReceiptMatchesSQLiteIdentityAndTime':len(save)==1 and save[0]['payload']['savedQSO']['id']==manual['local_id'] and save[0]['payload']['savedQSO']['start']+978307200==manual['qso_start'],
 'selectedPackageSettingsMatchAfterRestoreDB':json.loads((out/'selected-package/settings.json').read_text())==after['xlog_integration_settings'][0]['payload']['settings'],
 'selectedMainPackageLogicalTablesMatchBeforeRestore':data['selected-package/OM0RX-xLog.sqlite']['tables']==before,
 'selectedContestPackageLogicalTablesMatchAfterRestore':data['selected-package/Contesting/Python/8b9c6663-bccd-4701-9f83-5fbc7c705251/contest.sqlite']['tables']==tables('after-native-restore',contest),
}
write('identity-assertions.json',{'checks':checks,'historicalImportRecord':raw_import,'reviewedImportSHA256':sha(out/'reviewed-import.adi')})
assert all(checks.values()), checks
contests={label:{'rows':[{k:r[k] for k in ['ID','Call','TS','Freq','Mode','SNT','RCV','SentNr','NR','Comment']} for r in tables(label,contest)['DXLOG']],'session':tables(label,contest)['xlog_session'],'identities':tables(label,contest)['xlog_qso_identity'],'import':tables(label,contest)['xlog_adif_import']} for label in ['contesting-restart','switch-veto','contest-export','before-native-restore','after-native-restore']}
write('contest-identities.json',contests)
directory_inventory={}
for label,p in [('selected-package',base/'Backups/OM0RX-xLog-2026-10-29T11-41-34Z.xlogbackup'),('recovery-package',base/'Recovery/pre-restore-65EF601E-26B7-4EE8-9CCB-928D9F85BB17.xlogbackup')]:
    dirs=[str(x.relative_to(p)) for x in sorted(p.rglob('*')) if x.is_dir()]
    directory_inventory[label]={'directories':dirs,'referenceDirectoryPresent':(p/'Reference Data').is_dir(),'referenceFiles':[str(x.relative_to(p)) for x in (p/'Reference Data').rglob('*') if x.is_file()]}
    for rel in dirs:(out/label/rel).mkdir(parents=True,exist_ok=True)
reference=base/'Reference Data'
directory_inventory['live-private-reference']={'exists':reference.is_dir(),'files':[str(x.relative_to(reference)) for x in reference.rglob('*') if x.is_file()]}
write('reference-directory-evidence.json',directory_inventory)
settings=json.loads((out/'selected-package/settings.json').read_text())
actualsettings=before['xlog_integration_settings']
write('settings-destination-evidence.json',{'selectedSettings':settings,'beforeIntegrationSettings':actualsettings,'afterIntegrationSettings':after['xlog_integration_settings'],'afterRestoreAuthority':after['xlog_restore_authority'],'syncCounts':{label:{t:len(tables(label,main)[t]) for t in ['sync_outbox','xlog_sync_runs','xlog_online_log_enrollments','xlog_online_log_deliveries']} for label in ['before-native-restore','after-native-restore']},'scope':'Actual fixture local logbook, automaticSync=false, stationID=0, configured URL string retained. No credential discovery or sync dispatch performed.'})
inputs=json.loads((out/'input-sha256.json').read_text())
copy_maintenance=[]
for original,record in inputs.items():
    source=Path(original);target=out/record['copy']
    assert sha(source)==record['sha256'], original
    if not target.is_file() or sha(target)!=record['sha256']:
        item={'copy':record['copy'],'afterInspectionExists':target.is_file(),'reason':'SQLite inspection can checkpoint or remove WAL/SHM files on the disposable copy; freeze again from unchanged exact source bytes.'}
        if target.is_file():
            retained=out/'post-inspection-working-files'/record['copy'];retained.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,retained)
            item['postInspectionSHA256']=sha(target);item['retainedWorkingCopy']=str(retained.relative_to(out))
        shutil.copy2(source,target)
        assert sha(target)==record['sha256']
        copy_maintenance.append(item)
if copy_maintenance:write('copy-inspection-maintenance.json',{'changes':copy_maintenance,'originalSourceBytesPreserved':True,'scope':'Only disposable copied SQLite/WAL/SHM artifacts; no original package/snapshot/private database opened for checks.'})
preservation={p:{'stillExists':Path(p).is_file(),'matchesCapture':Path(p).is_file() and sha(Path(p))==record['sha256'],'copiedBytesMatchCapture':sha(out/record['copy'])==record['sha256']} for p,record in inputs.items()}
write('source-preservation-recheck.json',preservation)
normal_candidates=[str(p) for parent in [root,stage] for p in parent.rglob('*.adi') if '.app/' not in str(p) and '/data-evidence/' not in str(p)]
write('normal-export-boundary.json',{'searchedOnly':[str(root),str(stage)],'adiPaths':normal_candidates,'normalExportArtifactFound':False,'reason':'No normal ADIF artifact exists in the allowed private root/stage. Renderer LogbookPanel.tsx:381-387 emits an in-memory Blob download and then reports success. Backend returns in-memory text; there is no evidence of an NSSavePanel for this route. UI action/notice are separate root-agent observations.','manualSaveUTC':datetime.datetime.fromtimestamp(manual['qso_start'],datetime.timezone.utc).isoformat(),'manualSaveID':manual['local_id']})
archived=['docs/reviews/remediation-fa010-fa017-2026-10-29/README.md','docs/reviews/remediation-fa010-fa017-2026-10-29/agents/restore/closing-source.json','docs/reviews/remediation-fa010-fa017-2026-10-29/agents/restore/modern-negative-source.json','docs/reviews/remediation-fa010-fa017-2026-10-29/final-integrity-r2/integrity.json','docs/reviews/remediation-fa010-fa017-2026-10-29/final-integrity-r2/native-restore-evidence.tar.gz']
write('archived-restore-evidence.json',{'reusedWithoutRerunning':{p:sha(stage.parents[1]/p) for p in archived},'scope':'Existing FA015/FA016 source-swap and controlled owned-child interruption evidence is fixture/native-owner evidence. Current modern Tauri GUI restore does not qualify separate SwiftUI caller, incomplete-restore GUI recovery, physical power loss, credentials or live providers.'})
claims={
 'contestNativeSavedBytes':'PASS: retained1853-byte native ADIF equals independent candidate PythonHost export of exact retained revision6 snapshot, sameQSOIDs. Native prepared receipt was not retained.',
 'manualSaveTime':'PASS: UI-issued saved receipt and SQLite K1MANUAL ID6448E40C-5FD2-468D-93BE-EBD65D64C789 retain2026-10-29T11:12:42Z.',
 'unfinishedDraftRetention':'PASS: K1UNFIN IDBAA9E0E1-0399-4D13-AA92-8D7A8FE1C205 full payload equal acrossmanual-save-detached,contesting-restart,switch-veto,before/after-native-restore.',
 'selectedAndRecoveryPackageSeals':'PASS: each complete5-payload seal matches sizes andSHA256; main+contest+settings+preferences components equal.',
 'sqliteIntegrity':'PASS:24 copied databases integrity_check=ok; foreign_key_check=[]; originals not opened for these checks.',
 'restoreComponentIdentity':'PASS: main all tables equal except newly installedxlog_restore_authority; every contest table equal; normalQSO/draft retained,2contest rows retained.',
 'selectedDestinationAndSettings':'PASS: actual fixture local/automaticSyncfalse,stationID0; before/after DB integration settings equal and selected payload retained; no sync dispatch.',
 'preferences':'PASS package payload seals/equality and GUI restore success; UNVERIFIED independent post-restore live UserDefaults value read under copy-only scope.',
 'references':'PASS empty-reference case: selected,recovery,andlive Reference Data directories exist and contain0files; UNVERIFIED nonempty reference restoration in this GUI run.',
 'restoreIncompleteMarkers':'PASS positive-private-root has0markers atcapture andfinalization; archived controlled-child markers preserved separately.',
 'normalExportPersistedBytes':'UNVERIFIED: actualUI initiation/successnotice observed byroot; no downloaded normalADIF in allowedprivateRoot/stage. No normalNSSavePanel claim.',
 'separateNativeGUIRecovery':'UNVERIFIED: currentmodernTauriGUI does not qualify separateSwiftUIcallerorincompleteGUIrecovery; reusedarchivedFA015/016fixtureevidence.'}
write('acceptance-outcomes.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'claims':claims,'identityAssertions':checks,'noSourceApplicationTestsReportsChanged':True,'restoreIncompleteMarkers':[str(x.relative_to(root)) for x in root.rglob('.restore-incomplete')],'originalCapturedFilesStillMatch':all(v['matchesCapture'] for v in preservation.values()),'commands':[{'argv':['/opt/local/bin/python3.12',str(stage/'data_capture.py')],'exit':0,'outcomes':'46 files copied; 24 databases inspected on copies'},{'argv':['/opt/local/bin/python3.12',str(stage/'data_verify.py')],'exit':0,'outcomes':'Seals/identity/independent export PASS; rerun refreshed typed JSON only and preserved first independent receipt'},{'argv':sys.argv,'outcomes':'Finalizing evidence manifest'}]})
write('execution-sources.json',{str(p):sha(p) for p in [stage/'data_capture.py',stage/'data_verify.py',stage/'data_finalize.py']})
write('evidence-sha256.json',{str(p.relative_to(out)):{'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='evidence-sha256.json'})
print(json.dumps({'checks':checks,'originalCapturedFilesStillMatch':all(v['matchesCapture'] for v in preservation.values()),'copiedFilesStillMatchCapture':all(v['copiedBytesMatchCapture'] for v in preservation.values()),'changedCopies':[p for p,v in preservation.items() if not v['copiedBytesMatchCapture']]},indent=2))
