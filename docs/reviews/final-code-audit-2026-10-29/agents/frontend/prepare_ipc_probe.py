from pathlib import Path
import hashlib,json
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend')
lines=(root/'prototype/src-tauri/src/worker.rs').read_text().splitlines(True)
# Exact complete production bodies; the surface-role adapter is the identity
# for literal native labels main/log-qso, not an approximation of authorization.
body=''.join(lines[19:177])+ '\n'+''.join(lines[235:503])
(out/'ipc-validator-source.json').write_text(json.dumps({'worker_sha256':hashlib.sha256((root/'prototype/src-tauri/src/worker.rs').read_bytes()).hexdigest(),'extracted_ranges':[[20,177],[236,503]],'extracted_sha256':hashlib.sha256(body.encode()).hexdigest(),'stub':'workspace_windows::surface_role(label) returns label; literal main and log-qso are already canonical surface roles'},indent=2)+'\n')
s='''use serde_json::Value;
const MAX_REQUEST:usize=32768;
mod workspace_windows { pub fn surface_role(label:&str)->&str { label } }
'''+body+'''
fn main() {
    let request=serde_json::json!({"id":"phase6-duplicate","method":"logbook_duplicate","params":{"call":"K1ABC","band":"20m","mode":"CW"}});
    let main=validate_surface("main",&request);
    let detached=validate_surface("log-qso",&request);
    println!("main={main:?} log-qso={detached:?}");
    assert!(main.is_ok()); assert!(detached.is_err());
}
'''
(out/'ipc-validator.rs').write_text(s)
