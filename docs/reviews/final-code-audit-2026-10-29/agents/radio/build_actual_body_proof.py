import hashlib, json, pathlib, subprocess
root = pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out = pathlib.Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/radio')
receipt = json.loads((out/'proof-receipt.json').read_text())
text = (out/'Proof.swift').read_text()
a = text.index('        let root = URL(')
b = text.index('        let socket = ProofSocket()', a)
replacement = '''        let box = FlexFixtureBox()
        let owner = LiveFlexSession(readbackTimeout: .milliseconds(50)) { _, state, snapshot in
            let radio = FakeFlexRadio(snapshot: XCatIntegrationCore.RadioSnapshot(frequencyHz: 14_074_000), onState: state, onSnapshot: snapshot)
            box.store(radio); return radio
        }
        _ = try await owner.handle("station_connect", params: ["provider": "direct_flex_lan", "host": "192.168.1.20", "station_name": "fixture", "allow_transmit": true])
        for _ in 0..<1000 {
            let state = try await owner.handle("station_snapshot", params: ["provider": "direct_flex_lan"])
            if state["available"] as? Bool == true { break }; await Task.yield()
        }
        _ = try await owner.handle("station_radio_control", params: ["provider": "direct_flex_lan", "control": "ptt", "enabled": true])
        guard let radio = box.get() else { throw ProofError.timeout }
        await radio.setObserveRelease(false)
        await owner.terminate()
        print("FLEX actualBodyTerminate ownerStillAttached=\\(await owner.isAttached()) commands=\\(await radio.commandLog())")
        do { _ = try await owner.handle("station_radio_control", params: ["provider": "direct_flex_lan", "control": "ptt", "enabled": false]); print("FLEX retry unexpectedly admitted") }
        catch { print("FLEX retry after terminal=\\(error)") }

'''
proof = out/'ActualBodyProof.swift'
proof.write_text(text[:a]+replacement+text[b:])
source_paths = [root/'Sources/XLogPrototypeSupport/NativeDraftPowerGate.swift', root/'Sources/XLogPrototypeSupport/LiveFlexSession.swift', root/'Sources/XCatIntegrationCore/TCIWebSocketSession.swift',root/'Sources/XCatIntegrationCore/TCIProtocol.swift',root/'Sources/XCatIntegrationCore/TCIIQFrame.swift',root/'Sources/XCatIntegrationCore/TCIIQSubscription.swift']
copies = []
for p in source_paths:
    dest = out/('Actual'+p.name)
    # Import unchanged neighboring internal support types; the audited function
    # bodies below are verbatim, not substituted or edited.
    prefix = '@testable import XLogPrototypeSupport\n' if p.name=='LiveFlexSession.swift' else ''
    dest.write_text(prefix+p.read_text()); copies.append(dest)
cmd = receipt['command'].copy()
cmd[cmd.index(str(out/'Proof.swift'))] = str(proof)
cmd[cmd.index(str(out/'proof'))] = str(out/'actual-body-proof')
cmd += [str(p) for p in copies]
with (out/'actual-body-proof-build.log').open('w') as f: built = subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT)
print((out/'actual-body-proof-build.log').read_text()); print('buildExitCode',built.returncode)
result = {'command':cmd,'exitCode':built.returncode,'actualSourceSHA256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths},'bodyPreservation':'Verbatim current files; LiveFlexSession copy adds only @testable import for neighboring real support types.'}
if built.returncode == 0:
    with (out/'actual-body-proof-run.log').open('w') as f: run = subprocess.run([str(out/'actual-body-proof')],stdout=f,stderr=subprocess.STDOUT,timeout=30)
    result['runExitCode']=run.returncode
    print((out/'actual-body-proof-run.log').read_text()); print('runExitCode',run.returncode)
(out/'actual-body-proof-receipt.json').write_text(json.dumps(result,indent=2)+'\n')
