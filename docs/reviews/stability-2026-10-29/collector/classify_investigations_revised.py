"""Classify retained actual failures; unknown failures stop evidence consolidation."""
import json
from collector_common import TASK, parse_plan, read_json, write_json

NOTES = {
    'BASE-FRONTEND-BUILD': ('REG-P4-001', 'Confirmed clean-install byte-budget failure; repaired by the locked bundler update.'),
    'BASE-STRICT-SWIFT': ('REG-P4-002', 'Confirmed initializer default callback compiler failure; repaired inside actor initialization.'),
    'ITER1-FRONTEND-BUILD': ('rejected control', 'Runtime package alignment still failed the unchanged byte budget; only those investigative changes were restored.'),
    'FINAL-NODE-CHECKS': ('REG-P5-001', 'Introduced production allowlist invariant failure; unchanged assertion caught it; repaired ten-case gate and twelve relocation cases pass.'),
    'ITER3-PROCESS-ACCEPTANCE': ('REG-P4-003 investigation', 'Disposable root spelling did not match macOS tempfile policy; no production guard bypass.'),
    'ITER3-PROCESS-R2': ('REG-P4-003 investigation', 'Python exact private-root policy rejected the /tmp alias.'),
    'ITER3-PROCESS-R3': ('REG-P4-003 investigation', 'Foundation exact private-root probe rejected rewritten /private/tmp spelling.'),
    'ITER3-PROCESS-R4': ('REG-P4-003 investigation', 'Legacy protocol scenario rejected by current Python API; fixture migrated to actual current wire.'),
    'ITER3-CURRENT-PROCESS': ('REG-P4-003 investigation', 'Forged correction field correctly rejected as invalid_request; obsolete fixture error expectation corrected.'),
    'ITER4-NAQP-BEFORE': ('INV-P4-001', 'Initial simulated CQ absent; later viewport/pointer evidence identifies undelivered Arm click.'),
    'ITER4-NAQP-ARM-CONTROL': ('INV-P4-001', 'Panel remained Disarmed after the purported click; no pointer/click delivered.'),
    'ITER4-NAQP-CLICK-CONTROL': ('INV-P4-001', 'Arm control above viewport; empty pointer trace; explicit exact-button scrolling repairs delivery.'),
    'ITER4-NAQP-AFTER': ('INV-P4-001', 'First complete case/exports passed; later session title preceded enabled field; actual-field readiness wait added.'),
    'ITER5-OLD-POLICY-CONTROL': ('expected negative control', 'Preceding lock fails three reviewed dependency patch floors.'),
    'ITER8-ROOTS-NEGATIVE': ('expected negative control', 'Preceding lock fails the fourth reviewed root-certificate floor.'),
    'FINAL-BROWSER-SCP': ('INV-P5-002 open', 'No contest_create reached worker after click; timeout after seven startup frames; deeper cause unassigned.'),
    'FINAL-BROWSER-SCP-R2': ('INV-P5-002 open', 'Actual worker query K1AN1X differs from intended replacement N1X; correct actual-query result fails intended-input assertion.'),
    'CI-FAIL-WINDOWS-RUST': ('log collection failure', 'gh failed to open its cached log zip; not a Windows application test result. R2 retry retained.'),
    'ITER9-PORTABLE-IQ-BEFORE': ('REG-P5-002', 'Actual manifest-declared portable slice lacks required pure IQ types; after repair fifteen unchanged parser/resource cases pass.'),
    'ITER10-CLUSTER-PORTABILITY': ('rejected test oracle', 'New oracle incorrectly required cleanup-before-forward and republished unchanged contact; three failures retained. Production contract requires independent delivery; corrected oracle passes locally.'),
    'STABLE-FRONTEND': ('INV-P5-003 resource-sensitive timing', '4729 passes and two unchanged five-second voice-intent timeouts under compilation load; unchanged idle two-case pass retained. Final full control is separate.'),
    'SEAL-WORKER-BUILD': ('freshness guard rejection', 'Existing scratch correctly rejected. Fresh worker scratch and explicit R2 dependency continuation pass; no bypass.'),
    'SEAL-FRONTEND-TESTS-R2': ('superseded unstarted dependency waiter', 'Parent recorded owned PID/SIGTERM in superseded-validation.json after new CI defects. Actual frontend test had not started; infer neither test pass nor failure.'),
}

def main():
    plan = parse_plan()
    notes = dict(NOTES)
    for name, value in plan.get('failureClassifications', {}).items():
        assert isinstance(value, dict) and value.get('classification') and value.get('disposition'), (name, value)
        notes[name] = (value['classification'], value['disposition'])
    failures = []
    for path in sorted((TASK / 'logs').glob('*.json')):
        if '.running.' in path.name:
            continue
        value = read_json(path)
        if value.get('exitCode') in (None, 0):
            continue
        name = path.stem
        if name in notes:
            classification, disposition = notes[name]
        elif any(str(arg).endswith('/sequence.py') for arg in value.get('command', [])):
            text = (TASK / 'logs' / (name + '.log')).read_text(errors='replace')
            assert 'AssertionError' in text and ('exitCode' in text or 'timedOut' in text), ('Unexplained orchestration failure', name)
            classification = 'dependency/orchestration stopped'
            disposition = 'Retained dependency failure stopped orchestration. Unstarted dependent checks are neither passes nor application test failures; explicit continuation receipts have their own outcomes.'
        else:
            raise AssertionError(('Unclassified failure; investigate and explicitly add plan classification', name, value))
        failures.append({'id': name, 'exitCode': value['exitCode'], 'classification': classification, 'disposition': disposition})
    profile = json.loads((TASK / 'logs/FINAL-CW-SUSTAINED.log').read_text().splitlines()[0])
    data = {'sourceHead': plan['head'], 'failedCommands': failures,
            'scpBoundary': {'status': 'Not Fixed / deeper cause and origin unassigned',
                            'failed': ['FINAL-BROWSER-SCP', 'FINAL-BROWSER-SCP-R2'],
                            'instrumentedPass': 'INV-SCP-DIAGNOSTIC, diagnostic-only dirty source; not final clean acceptance',
                            'unchangedCleanPass': 'FINAL-BROWSER-SCP-R3, 22.399 seconds',
                            'noTimeoutOrAssertionChange': True,
                            'nextApproach': 'Capture DOM values and input/click delivery without changing admission timing; compare replacement methods in disposable fixtures before patching application behavior.'},
            'voiceTimingBoundary': {'status': 'Observed resource-sensitive timing; final full control has its own receipt',
                                    'failed': 'STABLE-FRONTEND: two5s timeouts/4729passes under compilerload',
                                    'idleControl': 'Two unchanged cases pass in8.990s total; no deadline/assertion weakening'},
            'cwBoundary': {'boundedSyntheticProfile': profile,
                           'remaining': 'Previous overload deadline miss, multi-hour contention, whole-app and live-audio qualification remain open.'},
            'ciBoundary': plan.get('ciEvidence', {'status': 'not supplied; no remote pass inferred'}),
            'priorCIBoundaries': ['79ddc92 prototype acquired no hosted runner and ran zero steps; dependent platform runtime jobs skipped.',
                                 'bcfb669c platform jobs executed: portable IQ slice fails, Windows publication Access Denied.',
                                 '0b47e167 actual Windows helper3/module/restart cases pass before stale shutdownCount6-vs7 guard fails; Linux cluster fixture and Windows CoreFoundation compile failures remain separate.'],
            'directCargoUpdates': {'commands': ['cargo update --manifest-path prototype/src-tauri/Cargo.toml -p rustls --precise 0.23.46',
                                                'cargo update --manifest-path prototype/src-tauri/Cargo.toml -p rustls-webpki --precise 0.103.16',
                                                'cargo update --manifest-path prototype/src-tauri/Cargo.toml -p tokio --precise 1.53.3'],
                                   'boundary': 'Direct session exit0; exact update timings/raw output not saved by durable collector. Lock diff and subsequent locked compile/tests/advisory metadata retained.'}}
    write_json(TASK / 'investigations.json', data)
    print(json.dumps({'classifiedFailures': len(failures), 'sourceHead': plan['head']}))

if __name__ == '__main__':
    main()
