//! Native feed identities. A renderer can select a retained row, never supply
//! draft fields. Resolve again against the worker's current unexpired feed.
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::{Mutex, OnceLock}};

struct Retained { worker: u64, row: Value, version: String }
struct Feeds { epoch: String, rows: BTreeMap<String, Retained> }
fn feeds() -> &'static Mutex<Feeds> {
    static FEEDS: OnceLock<Mutex<Feeds>> = OnceLock::new();
    FEEDS.get_or_init(|| Mutex::new(Feeds { epoch: uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() }))
}
pub fn owns(epoch: &str) -> bool { feeds().lock().is_ok_and(|feeds| feeds.epoch == epoch) }
pub fn snapshot(request: Value) -> Result<Value, String> {
    let (worker, mut response) = crate::worker::request_with_generation(request)?;
    if response["ok"] != true { return Ok(response); }
    let mut feeds = feeds().lock().map_err(|_| "Opportunity identities unavailable")?;
    retain(&mut feeds, worker, &mut response)?;
    Ok(response)
}
fn retain(feeds: &mut Feeds, worker: u64, response: &mut Value) -> Result<(), String> {
    let rows = response["result"]["items"].as_array_mut().filter(|rows| rows.len() <= 300).ok_or("Opportunity feed response is invalid")?;
    let mut retained = BTreeMap::new();
    for row in rows.iter_mut() {
        let id = row["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 128).ok_or("Opportunity identity is invalid")?.to_owned();
        if retained.contains_key(&id) { return Err("Opportunity identity is ambiguous".into()); }
        let version = feeds.rows.get(&id).filter(|prior| prior.worker == worker && prior.row == *row)
            .map(|prior| prior.version.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        retained.insert(id, Retained { worker, row:row.clone(), version:version.clone() });
        row["activation"] = json!({"sourceEpoch":feeds.epoch,"spotVersion":version});
    }
    feeds.rows = retained;
    Ok(())
}
pub fn resolve(request: &crate::spot_activation::Request) -> Result<Value, String> {
    let (worker, row) = {
        let feeds = feeds().lock().map_err(|_| "Opportunity identities unavailable")?;
        if feeds.epoch != request.source_epoch { return Err("Opportunity source changed. Refresh before selecting again.".into()); }
        let retained = feeds.rows.get(&request.spot_id).filter(|row| row.version == request.spot_version)
            .ok_or("Opportunity changed. Refresh before selecting again.")?;
        (retained.worker, retained.row.clone())
    };
    let id = format!("native-opportunity-{}", uuid::Uuid::new_v4());
    let response = crate::worker::request_existing_generation(json!({"id":id,"method":"opportunities_snapshot","params":{}}), worker)?;
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
        let mut first = response(); retain(&mut feeds, 1, &mut first).unwrap();
        let mut repeated = response(); retain(&mut feeds, 1, &mut repeated).unwrap(); assert_eq!(first, repeated);
        let mut changed = response(); changed["result"]["items"][0]["frequency_hz"] = json!(14075000);
        retain(&mut feeds, 1, &mut changed).unwrap(); assert_ne!(first["result"]["items"][0]["activation"], changed["result"]["items"][0]["activation"]);
        let mut restarted = response(); retain(&mut feeds, 2, &mut restarted).unwrap();
        assert_ne!(first["result"]["items"][0]["activation"], restarted["result"]["items"][0]["activation"]);
        retain(&mut feeds, 2, &mut json!({"result":{"items":[]}})).unwrap(); assert!(feeds.rows.is_empty());
    }
    #[test]
    fn ambiguous_or_unbounded_feed_cannot_replace_canonical_identity_map() {
        let mut feeds = Feeds { epoch:uuid::Uuid::new_v4().to_string(), rows:BTreeMap::new() };
        retain(&mut feeds, 1, &mut response()).unwrap();
        let mut duplicate = response(); duplicate["result"]["items"].as_array_mut().unwrap().push(json!({"id":"pota:1"}));
        assert!(retain(&mut feeds, 1, &mut duplicate).is_err()); assert_eq!(feeds.rows.len(),1);
        assert!(retain(&mut feeds, 1, &mut json!({"result":{"items":vec![json!({"id":"x"});301]}})).is_err());
    }
}
