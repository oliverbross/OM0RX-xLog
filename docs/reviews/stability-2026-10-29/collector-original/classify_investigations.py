from pathlib import Path
import hashlib, json

task = Path('/tmp/xlog-phase5-20261029-721e0705')
root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
notes = {
    'BASE-FRONTEND-BUILD': ('REG-P4-001','confirmed baseline failure; repaired by locked bundler update'),
    'BASE-STRICT-SWIFT': ('REG-P4-002','confirmed baseline compiler failure; callback construction repaired'),
    'ITER1-FRONTEND-BUILD': ('rejected control','runtime package alignment did not fix emission size; only own changes restored'),
    'FINAL-NODE-CHECKS': ('REG-P5-001','introduced production allowlist invariant failure; unchanged assertion caught it; repaired and all ten checks pass'),
    'ITER3-PROCESS-ACCEPTANCE': ('REG-P4-003 investigation','acceptance storage guard rejected /private/tmp because macOS tempfile root differed; narrow disposable roots added'),
    'ITER3-PROCESS-R2': ('REG-P4-003 investigation','Python exact private-root guard rejects /tmp alias; guard preserved'),
    'ITER3-PROCESS-R3': ('REG-P4-003 investigation','Foundation exact private-root probe rejects rewritten /private/tmp spelling; guard preserved'),
    'ITER3-PROCESS-R4': ('REG-P4-003 investigation','legacy protocol scenario fails against current Python API; migrated semantic checks to actual current wire'),
    'ITER3-CURRENT-PROCESS': ('REG-P4-003 investigation','forged correction field correctly returns invalid_request, Unknown correction field; obsolete error-code expectation corrected'),
    'ITER4-NAQP-BEFORE': ('INV-P4-001','missing initial simulated CQ; later pointer/viewport evidence identifies missing Arm click'),
    'ITER4-NAQP-ARM-CONTROL': ('INV-P4-001','instrumented initial arm remains Disarmed; no actual pointer/click delivered'),
    'ITER4-NAQP-CLICK-CONTROL': ('INV-P4-001','pointer trace is empty and Arm is above viewport; explicit observed-button scrolling repairs delivery'),
    'ITER4-NAQP-AFTER': ('INV-P4-001','first full case and exports pass, then next session title precedes its select; actual field readiness now awaited'),
    'ITER5-OLD-POLICY-CONTROL': ('expected negative control','previous committed Cargo.lock fails all three reviewed patch floors'),
    'ITER8-ROOTS-NEGATIVE': ('expected negative control','pre-root-certificate lock fails the newly reviewed fourth patch floor; compatible certificate-list update repairs it'),
    'FINAL-BROWSER-SCP': ('INV-P5-002 open','timeout awaiting initial Plain Log screen; seven startup frames, no contest_create request; root cause unassigned'),
    'FINAL-BROWSER-SCP-R2': ('INV-P5-002 open','worker receives K1AN1X after intended N1X replacement; correct query result fails assertion; root cause unassigned'),
}
failures = []
for path in sorted((task / 'logs').glob('*.json')):
    if '.running.' in path.name:
        continue
    value = json.loads(path.read_text())
    if value.get('exitCode') in [0,None]:
        continue
    if path.stem.endswith('-SEQUENCE') or path.stem in {'FINAL-IDLE-SEQUENCE'}:
        classification, note = 'orchestration stopped', 'Dependency failed; do not count an unstarted dependent check as an application test failure or pass. Explicit independent continuation receipts are retained.'
    else:
        assert path.stem in notes, ('Unclassified failure', path)
        classification, note = notes[path.stem]
    failures.append({'id':path.stem,'exitCode':value['exitCode'],'classification':classification,'disposition':note})

data = {'failedCommands':failures,
        'scpBoundary':{'status':'Not Fixed / deeper cause and origin unassigned',
                       'failed':['FINAL-BROWSER-SCP','FINAL-BROWSER-SCP-R2'],
                       'instrumentedPass':'INV-SCP-DIAGNOSTIC (dirty diagnostic-only source; not final clean acceptance)',
                       'unchangedCleanPass':'FINAL-BROWSER-SCP-R3',
                       'noTimeoutOrAssertionChange':True,
                       'nextApproach':'Capture DOM field values and input/click events without changing admission timing; compare semantic CLI replacement against direct browser/user input in a disposable controlled-input fixture before patching application behavior.'},
        'cwBoundary':{'boundedSyntheticProfile':json.loads((task/'logs/FINAL-CW-SUSTAINED.log').read_text().splitlines()[0]),
                      'remaining':'Previous overload deadline miss, multi-hour contention, whole-app and live-audio qualification remain open; no confirmed source regression.'},
        'ciBoundary':'Exact-commit CI Swift test/package/resources succeeds; prototype has zero steps because no hosted runner acquired the job; dependent Windows/Linux jobs skipped.',
        'directCargoUpdates':{'commands':['cargo update --manifest-path prototype/src-tauri/Cargo.toml -p rustls --precise 0.23.46',
                                         'cargo update --manifest-path prototype/src-tauri/Cargo.toml -p rustls-webpki --precise 0.103.16',
                                         'cargo update --manifest-path prototype/src-tauri/Cargo.toml -p tokio --precise 1.53.3'],
                              'result':'Direct tool session completed with exit 0; exact timings/raw update output were not saved by the durable collector. Git lock diff and subsequent locked compile/tests/advisory metadata are retained.'}}
(task/'investigations.json').write_text(json.dumps(data,indent=2)+'\n')
paths = [root/'vendor/deepcw-engine/model.onnx',root/'vendor/deepcw-engine/model.onnx.json',
         root/'.build/cw-package/runtime/lib/libonnxruntime.1.24.3.dylib',
         task/'cw-native/xlog-cw-worker', task/'cw-native/cw-process-probe',task/'cw-native/cw-load-profile']
pins = [{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
assert [p['sha256'] for p in pins[:3]] == [
    'ef120799457bca042d4690944f0faf93268eb4654e7f50f28784ad63bdc1fe02',
    'b4342157b90229ee7380e165f3d8036179b80d1e6ae02f2557388b7fcd558c01',
    '81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217']
(task/'cw-provenance-final.json').write_text(json.dumps(pins,indent=2)+'\n')
print(json.dumps({'classifiedFailures':len(failures),'cwProvenanceFiles':len(pins)}))
