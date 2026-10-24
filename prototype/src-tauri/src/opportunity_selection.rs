//! Native feed identities. A renderer can select a retained row, never supply
//! draft fields. Resolve again against the worker's current unexpired feed.
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::{Mutex, OnceLock}};

struct Retained { worker: u64, row: Value, version: String, snapshot_method: String }
// Each projection owns a bounded identity pool. A refresh in Chaser & DX must
// not retire DXpedition Map tokens (or replace a differently projected same ID).
struct Feeds { epoch: String, rows: BTreeMap<(String, String), Retained> }
fn feeds() -> &'static Mutex<Feeds> {
    static FEEDS: OnceLock<Mutex<Feeds>> = OnceLock::new();
    FEEDS.get_or_init(|| Mutex::new(Feeds { epoch: uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() }))
}
pub fn owns(epoch: &str) -> bool { feeds().lock().is_ok_and(|feeds| feeds.epoch == epoch) }
pub fn snapshot(request: Value) -> Result<Value, String> {
    let method = request["method"].as_str().ok_or("Opportunity method is invalid")?.to_owned();
    let (worker, mut response) = crate::worker::request_with_generation(request)?;
    if response["ok"] != true { return Ok(response); }
    let mut feeds = feeds().lock().map_err(|_| "Opportunity identities unavailable")?;
    retain(&mut feeds, worker, &method, &mut response)?;
    Ok(response)
}
fn retain(feeds: &mut Feeds, worker: u64, method: &str, response: &mut Value) -> Result<(), String> {
    let (snapshot_method, limit) = match method {
        "opportunities_snapshot" | "opportunities_refresh" => ("opportunities_snapshot", 300),
        "opportunities_dxpedition_snapshot" | "opportunities_dxpedition_refresh" => ("opportunities_dxpedition_snapshot", 500),
        _ => return Err("Opportunity projection is unavailable".into()),
    };
    let rows = response["result"]["items"].as_array_mut().filter(|rows| rows.len() <= limit).ok_or("Opportunity feed response is invalid")?;
    let mut retained = BTreeMap::new();
    for row in rows.iter_mut() {
        let id = row["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 128).ok_or("Opportunity identity is invalid")?.to_owned();
        let key = (snapshot_method.to_owned(), id);
        if retained.contains_key(&key) { return Err("Opportunity identity is ambiguous".into()); }
        let version = feeds.rows.get(&key).filter(|prior| prior.worker == worker && prior.row == *row)
            .map(|prior| prior.version.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        retained.insert(key, Retained { worker, row:row.clone(), version:version.clone(), snapshot_method:snapshot_method.into() });
        row["activation"] = json!({"sourceEpoch":feeds.epoch,"spotVersion":version});
    }
    // Commit only after validating the entire response; invalid responses cannot
    // erase either pool. A worker replacement invalidates both old pools.
    feeds.rows.retain(|(pool, _), row| pool != snapshot_method && row.worker == worker);
    feeds.rows.extend(retained);
    Ok(())
}
pub fn resolve(request: &crate::spot_activation::Request) -> Result<Value, String> {
    let (worker, row, snapshot_method) = {
        let feeds = feeds().lock().map_err(|_| "Opportunity identities unavailable")?;
        if feeds.epoch != request.source_epoch { return Err("Opportunity source changed. Refresh before selecting again.".into()); }
        let retained = feeds.rows.iter().find(|((_, id), row)| id == &request.spot_id && row.version == request.spot_version)
            .map(|(_, row)| row)
            .ok_or("Opportunity changed. Refresh before selecting again.")?;
        (retained.worker, retained.row.clone(), retained.snapshot_method.clone())
    };
    let id = format!("native-opportunity-{}", uuid::Uuid::new_v4());
    let response = crate::worker::request_existing_generation(json!({"id":id,"method":snapshot_method,"params":{}}), worker)?;
    if response["id"] != id || response["ok"] != true
        || !response["result"]["items"].as_array().is_some_and(|rows| rows.iter().any(|current| *current == row)) {
        return Err("Opportunity expired or changed. Refresh before selecting again.".into());
    }
    crate::worker::require_existing_generation(worker)?;
    Ok(json!({"call":row["callsign"],"frequencyHz":row["frequency_hz"],"mode":row["mode"],
        "band":"", "country":"", "comment":row["comment"],"specialTags":[],
        "opportunity":{"kind":row["kind"],"reference":row["reference"],"referenceKind":row["reference_kind"].as_str().unwrap_or_else(|| row["kind"].as_str().unwrap_or(""))}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn response() -> Value { json!({"ok":true,"result":{"items":[{"id":"pota:1","callsign":"OM0RX/P","frequency_hz":14074000}]}}) }
    #[test]
    fn identities_survive_equal_reads_but_change_with_row_or_worker_and_retire_removed_rows() {
        let mut feeds = Feeds { epoch:uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() };
        let mut first = response(); retain(&mut feeds, 1, "opportunities_snapshot", &mut first).unwrap();
        let mut repeated = response(); retain(&mut feeds, 1, "opportunities_snapshot", &mut repeated).unwrap(); assert_eq!(first, repeated);
        let mut changed = response(); changed["result"]["items"][0]["frequency_hz"] = json!(14075000);
        retain(&mut feeds, 1, "opportunities_snapshot", &mut changed).unwrap(); assert_ne!(first["result"]["items"][0]["activation"], changed["result"]["items"][0]["activation"]);
        let mut restarted = response(); retain(&mut feeds, 2, "opportunities_snapshot", &mut restarted).unwrap();
        assert_ne!(first["result"]["items"][0]["activation"], restarted["result"]["items"][0]["activation"]);
        retain(&mut feeds, 2, "opportunities_snapshot", &mut json!({"result":{"items":[]}})).unwrap(); assert!(feeds.rows.is_empty());
    }
    #[test]
    fn ambiguous_or_unbounded_feed_cannot_replace_canonical_identity_map() {
        let mut feeds = Feeds { epoch:uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() };
        retain(&mut feeds, 1, "opportunities_snapshot", &mut response()).unwrap();
        let mut duplicate = response(); duplicate["result"]["items"].as_array_mut().unwrap().push(json!({"id":"pota:1"}));
        assert!(retain(&mut feeds, 1, "opportunities_snapshot", &mut duplicate).is_err()); assert_eq!(feeds.rows.len(),1);
        assert!(retain(&mut feeds, 1, "opportunities_snapshot", &mut json!({"result":{"items":vec![json!({"id":"x"});301]}})).is_err());
        assert!(retain(&mut feeds, 1, "opportunities_dxpedition_snapshot", &mut json!({"result":{"items":vec![json!({"id":"x"});501]}})).is_err());
    }
    #[test]
    fn refresh_rows_are_revalidated_against_the_read_only_snapshot_method() {
        let mut feeds = Feeds { epoch:uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() };
        let mut standard = response(); retain(&mut feeds, 1, "opportunities_refresh", &mut standard).unwrap();
        assert_eq!(feeds.rows[&("opportunities_snapshot".into(), "pota:1".into())].snapshot_method, "opportunities_snapshot");
        let mut dx = response(); retain(&mut feeds, 1, "opportunities_dxpedition_refresh", &mut dx).unwrap();
        assert_eq!(feeds.rows[&("opportunities_dxpedition_snapshot".into(), "pota:1".into())].snapshot_method, "opportunities_dxpedition_snapshot");
    }
    #[test]
    fn concurrent_views_keep_independent_tokens_for_same_id_and_retire_only_their_own_rows() {
        let mut feeds = Feeds { epoch:uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() };
        let mut standard = response();
        retain(&mut feeds, 1, "opportunities_refresh", &mut standard).unwrap();
        let standard_token = standard["result"]["items"][0]["activation"].clone();
        let mut dx = response(); dx["result"]["items"][0]["callsign"] = json!("TEST1");
        retain(&mut feeds, 1, "opportunities_dxpedition_snapshot", &mut dx).unwrap();
        let dx_token = dx["result"]["items"][0]["activation"].clone();
        assert_ne!(standard_token, dx_token);
        assert_eq!(feeds.rows.len(), 2);
        let mut repeated = response();
        retain(&mut feeds, 1, "opportunities_snapshot", &mut repeated).unwrap();
        assert_eq!(repeated["result"]["items"][0]["activation"], standard_token);
        assert_eq!(feeds.rows[&("opportunities_dxpedition_snapshot".into(), "pota:1".into())].version, dx_token["spotVersion"]);
        retain(&mut feeds, 1, "opportunities_snapshot", &mut json!({"result":{"items":[]}})).unwrap();
        assert_eq!(feeds.rows.len(), 1);
        assert_eq!(feeds.rows[&("opportunities_dxpedition_snapshot".into(), "pota:1".into())].version, dx_token["spotVersion"]);
        retain(&mut feeds, 2, "opportunities_snapshot", &mut response()).unwrap();
        assert_eq!(feeds.rows.len(), 1);
        assert!(!feeds.rows.contains_key(&("opportunities_dxpedition_snapshot".into(), "pota:1".into())));
    }
    #[test]
    fn invalid_projection_cannot_retire_either_views_tokens() {
        let mut feeds = Feeds { epoch:uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() };
        retain(&mut feeds, 1, "opportunities_snapshot", &mut response()).unwrap();
        retain(&mut feeds, 1, "opportunities_dxpedition_snapshot", &mut response()).unwrap();
        let tokens: Vec<_> = feeds.rows.values().map(|row| row.version.clone()).collect();
        assert!(retain(&mut feeds, 1, "unknown", &mut response()).is_err());
        assert!(retain(&mut feeds, 1, "opportunities_dxpedition_refresh", &mut json!({"result":{"items":vec![json!({"id":"x"});501]}})).is_err());
        assert_eq!(feeds.rows.values().map(|row| row.version.clone()).collect::<Vec<_>>(), tokens);
    }
}
