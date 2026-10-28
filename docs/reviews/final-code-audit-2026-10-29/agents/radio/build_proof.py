import hashlib, json, pathlib, subprocess
root = pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out = pathlib.Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/radio')
build = root / '.build/phase5-20261029/portable-final/out'
products = build / 'Products/Debug'
for bundle in products.glob('*.bundle'):
    dest = out / bundle.name
    if not dest.exists(): dest.symlink_to(bundle)
fixture = root / 'Tests/XLogPrototypeTests/LiveFlexSessionTests.swift'
lines = fixture.read_text().splitlines(True)
fake = out / 'ExactFlexFixture.swift'
fake.write_text('import Foundation\nimport XCatIntegrationCore\n@testable import XLogPrototypeSupport\n' + ''.join(lines[6:195]))
maps = build / 'Intermediates.noindex/GeneratedModuleMaps'
cmd = ['swiftc', '-parse-as-library', '-I', str(products), '-o', str(out/'proof'), str(out/'Proof.swift'), str(fake)]
cmd += ['-Xcc', '-fmodule-map-file='+str(root/'Sources/CSQLitePrototype/module.modulemap')]
for name in ['CCurlBackup', 'CCWProcess', 'CClusterSocket', 'CPlatformVault']:
    cmd += ['-Xcc', '-fmodule-map-file='+str(maps/(name+'.modulemap'))]
cmd += [str(p) for p in products.glob('*.o') if 'Test' not in p.name]
cmd += ['-lcurl', '-lsqlite3', '-lz']
with (out/'proof-build.log').open('w') as f: result = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
receipt = {'command': cmd, 'buildExitCode':result.returncode, 'sources':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'Sources/XLogPrototypeSupport/NativeDraftPowerGate.swift',root/'Sources/XLogPrototypeSupport/LiveWorker.swift',root/'Sources/XLogPrototypeSupport/LiveStationMethods.swift',root/'Sources/XLogPrototypeSupport/LiveFlexSession.swift',root/'Sources/XCatIntegrationCore/TCIWebSocketSession.swift',fixture]}}
(out/'proof-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print((out/'proof-build.log').read_text())
print('buildExitCode',result.returncode)
if result.returncode == 0:
    with (out/'proof-run.log').open('w') as f: run = subprocess.run([str(out/'proof')],stdout=f,stderr=subprocess.STDOUT,timeout=30)
    print((out/'proof-run.log').read_text()); print('runExitCode',run.returncode)
