from pathlib import Path
import json
out=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend')
p=out/'coverage.json'
d=json.loads(p.read_text())
d['security_followup']={
    'report':'SECURITY_FOLLOWUP.md',
    'new_findings':0,
    'depth':'bounded critical text/URL sink and native activation/journal trace; not exhaustive security audit',
    'sink_inventory':'security-sinks.txt',
    'actual_ranges':[
        {'file':'prototype/src/Map.tsx','ranges':[[327,355],[412,476]],'depth':'complete popup text sink/marker recreation and click callback; static attribution URL search602,740'},
        {'file':'prototype/src/live/DetachedDXpeditionMapSurface.tsx','ranges':[[53,84],[115,164]],'depth':'response bound, URL filter, complete Detail render external URLs and user action controls'},
        {'file':'prototype/src/live/OpportunitiesPanel.tsx','ranges':[[24,32],[213,250],[276,305]],'depth':'URL allowlist, text render, stale async cancellation subset; no full component audit'},
        {'file':'prototype/src/live/AwardsPanel.tsx','ranges':[[1,125]],'depth':'programme normalization, text/URL detail sinks; remainder not reviewed'},
        {'file':'prototype/src/contesting/ContestOperatingInfo.tsx','ranges':[[1,85]],'depth':'asynchronous scope identity and external rule anchors; lower controls not reviewed'},
        {'file':'python/contest_host/operating_rules.py','ranges':[[5,6],[65,66]],'depth':'constant sponsor URL producer searched/read, not full rules module'},
        {'file':'prototype/src/live/settingsSession.ts','ranges':[[1,211]],'depth':'entire state/journal/receipt/retry class source read; no malicious storage fuzzing'},
        {'file':'prototype/src/live/readRadioJournal.ts','ranges':[[1,15]],'depth':'complete invalid and legacy journal parsing'},
        {'file':'prototype/src/live/spotActivation.ts','ranges':[[1,103]],'depth':'complete snapshot validator/editor freeze/readiness/reconcile lifecycle'},
        {'file':'prototype/src/live/mapContext.ts','ranges':[[1,76]],'depth':'complete retained context validation/snapshot ordering/wake lifecycle'},
        {'file':'prototype/src/live/ServiceSettings.tsx','ranges':[[36,84]],'depth':'complete Credential component local secret state/presence/read/save/remove flow'},
        {'file':'prototype/src-tauri/src/main.rs','ranges':[[267,431]],'depth':'native typed activation and read/follow/recovery admission checks'},
        {'file':'prototype/src-tauri/src/radio_read.rs','ranges':[[77,107],[415,427]],'depth':'legacy/scoped recover-only receipt path; not entire read owner'},
        {'file':'prototype/src-tauri/src/spot_activation.rs','ranges':[[10,19],[149,207],[224,243]],'depth':'identity admission, preparation source revalidation, typed control staging'},
        {'file':'prototype/src-tauri/src/spot_activation_backend.rs','ranges':[[230,246],[303,328]],'depth':'native report source resolve and worker/selection checks at tune admission'},
        {'file':'prototype/src-tauri/src/cluster_session.rs','ranges':[[270,313]],'depth':'fresh native retained report identity lookup'},
        {'file':'prototype/src-tauri/src/opportunity_selection.rs','ranges':[[1,102]],'depth':'entire production bounded feed identity pool retain/resolve; initial tests read; remaining tests not reviewed'},
        {'file':'prototype/node_modules/react-dom/cjs/react-dom-client.development.js','ranges':[[3348,3350]],'depth':'local installed sanitizeURL search only; not remote webview runtime proof'}
    ],
    'rejected_leads':['map publisher HTML injection','non-HTTPS protocol from filtered public-feed and lookup URLs','renderer supplied report payload bypassing native retained identity','legacy ReadRadio journal replaying radio effect','normal Settings Credential value entering form journals'],
    'remaining_limits':['external navigation/new-window runtime behavior','complete per-native-command authorization','feed redirect/SSRF policy','full recursive malicious JSON DoS','all Settings/rotor/backup recovery owners','all LiveApp and Not1MM async branches']
}
p.write_text(json.dumps(d,indent=2)+'\n')
