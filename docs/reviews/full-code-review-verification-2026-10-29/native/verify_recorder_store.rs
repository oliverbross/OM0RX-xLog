#[path = "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/src/contest_recorder_store.rs"]
mod store;
use serde_json::json;
use std::collections::BTreeMap;
fn main() {
    let root=std::path::PathBuf::from("/tmp/xlog-review-verification-20261028-12824393/native/recorder-fixture");
    std::fs::create_dir_all(&root).unwrap();
    let root=root.canonicalize().unwrap();
    let config=store::Config{input_id:"fake-input".into(),output_id:"fake-output".into(),channels:1,rate:8000,mapping:"Custom channel mapping".into(),roles:vec!["fixture".into()],route_verified:true,pre_seconds:45,post_seconds:10,reserve_bytes:1<<30,warning_bytes:5<<30};
    let log=uuid::Uuid::new_v4().to_string();
    let mut archive=store::Archive::create(&root,&log,config).unwrap();
    archive.append(&vec![0i16;8000]).unwrap();
    let capture=archive.manifest.capture_id.clone();
    let esm_qso=uuid::Uuid::new_v4().to_string();
    let direct_qso=uuid::Uuid::new_v4().to_string();
    let esm_op=uuid::Uuid::new_v4().to_string();
    let direct_op=uuid::Uuid::new_v4().to_string();
    let when=archive.manifest.start_utc_ms;
    let mut markers=BTreeMap::new();
    markers.insert(esm_op.clone(),(100,when));
    markers.insert(direct_op.clone(),(200,when));
    let page=json!({"engine":"not1mm-python","sessionID":log,"events":[
        {"sequence":1,"qsoID":esm_qso,"operationID":esm_op,"revision":1,"kind":"commit","local":false,"utcMs":when,"after":{"Call":"ESM_FIXTURE"}},
        {"sequence":2,"qsoID":direct_qso,"operationID":direct_op,"revision":2,"kind":"commit","local":true,"utcMs":when,"after":{"Call":"DIRECT_FIXTURE"}}
    ]});
    archive.reconcile(&page,&markers).unwrap();
    let first=json!({"cursor":archive.manifest.cursor,"esmLinked":archive.links.contains_key(&esm_qso),"directLinked":archive.links.contains_key(&direct_qso),"links":archive.links.len()});
    archive.finish("stopped",None).unwrap();
    drop(archive);
    let mut reopened=store::Archive::load(&root,&log,&capture).unwrap();
    reopened.reconcile(&page,&markers).unwrap();
    let after=json!({"cursor":reopened.manifest.cursor,"esmLinked":reopened.links.contains_key(&esm_qso),"directLinked":reopened.links.contains_key(&direct_qso),"links":reopened.links.len()});
    let mut corrected=page.clone();
    corrected["events"][0]["local"]=json!(true);
    reopened.reconcile(&corrected,&markers).unwrap();
    println!("{}",serde_json::to_string_pretty(&json!({"source":"actual unchanged recorder store; synthetic PCM and audit fixtures; no audio device", "initial":first,"reopenReplay":after,"afterReclassifySameSequence":{"cursor":reopened.manifest.cursor,"esmLinked":reopened.links.contains_key(&esm_qso),"links":reopened.links.len()}})).unwrap());
}
