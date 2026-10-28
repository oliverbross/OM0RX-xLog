import hashlib, json, pathlib, subprocess
root=pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=pathlib.Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/radio')
source=root/'Sources/XLogPrototypeSupport/LiveOpportunitiesMethods.swift'
copy=out/'ActualOpportunities.swift'
copy.write_text('@testable import XLogPrototypeSupport\n'+source.read_text())
cmd=['swiftc','-typecheck','-strict-concurrency=complete','-warn-concurrency','-I',str(root/'.build/phase5-20261029/portable-final/out/Products/Debug')]
maps=root/'.build/phase5-20261029/portable-final/out/Intermediates.noindex/GeneratedModuleMaps'
for p in [root/'Sources/CSQLitePrototype/module.modulemap']+[maps/(n+'.modulemap') for n in ['CCurlBackup','CCWProcess','CClusterSocket','CPlatformVault']]:
    cmd += ['-Xcc','-fmodule-map-file='+str(p)]
cmd.append(str(copy))
with (out/'strict-opportunities.log').open('w') as f: result=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT)
(out/'strict-opportunities-receipt.json').write_text(json.dumps({'command':cmd,'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'exitCode':result.returncode,'scope':'Verbatim current opportunities source body plus import of real neighboring internal helpers; not a full package rebuild.'},indent=2)+'\n')
print((out/'strict-opportunities.log').read_text());print('exitCode',result.returncode)
baseline=subprocess.check_output(['git','show','530de4c4e4b23281ec60585cc7a2e5ca011476fb:Sources/XLogPrototypeSupport/LiveOpportunitiesMethods.swift'],cwd=root).decode()
before=out/'BaselineOpportunities.swift';before.write_text('@testable import XLogPrototypeSupport\n'+baseline)
beforecmd=cmd[:-1]+[str(before)]
with (out/'strict-opportunities-before.log').open('w') as f: previous=subprocess.run(beforecmd,stdout=f,stderr=subprocess.STDOUT)
(out/'strict-opportunities-before-receipt.json').write_text(json.dumps({'command':beforecmd,'sourceSHA256':hashlib.sha256(baseline.encode()).hexdigest(),'exitCode':previous.returncode,'scope':'Baseline source body plus same import/context flags.'},indent=2)+'\n')
print((out/'strict-opportunities-before.log').read_text());print('baselineExitCode',previous.returncode)
