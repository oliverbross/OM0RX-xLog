import hashlib,json,pathlib,subprocess
root=pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog');out=pathlib.Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/persistence')
build=root/'.build/phase5-20261029/portable-final/out';products=build/'Products/Debug';maps=build/'Intermediates.noindex/GeneratedModuleMaps'
for bundle in products.glob('*.bundle'):
 dest=out/bundle.name
 if not dest.exists():dest.symlink_to(bundle)
cmd=['swiftc','-parse-as-library','-I',str(products),'-o',str(out/'restore-probe'),str(out/'RestoreProbe.swift'),'-Xcc','-fmodule-map-file='+str(root/'Sources/CSQLitePrototype/module.modulemap')]
for name in ['CCurlBackup','CCWProcess','CClusterSocket','CPlatformVault']:cmd+=['-Xcc','-fmodule-map-file='+str(maps/(name+'.modulemap'))]
cmd += [str(p) for p in products.glob('*.o') if 'Test' not in p.name]+['-lcurl','-lsqlite3','-lz']
with (out/'restore-probe-build.log').open('w') as f:result=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT)
receipt={'command':cmd,'buildExitCode':result.returncode,'sources':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'Sources/XLogApp/AppModel.swift',root/'Sources/XLogApp/SettingsView.swift',root/'Sources/XLogCore/BackupManager.swift',root/'Sources/XLogCore/LogbookDatabase.swift',root/'Sources/XLogCore/SyncEngine.swift']},'boundary':'Real cached core backup/install/merge, retained caller source traced separately; no GUI, network or credentials'}
if result.returncode==0:
 with (out/'restore-probe-run.log').open('w') as f:run=subprocess.run([str(out/'restore-probe')],stdout=f,stderr=subprocess.STDOUT,timeout=30)
 receipt['runExitCode']=run.returncode
(out/'restore-probe-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('buildExitCode',result.returncode)
print((out/('restore-probe-run.log' if result.returncode==0 else 'restore-probe-build.log')).read_text())
