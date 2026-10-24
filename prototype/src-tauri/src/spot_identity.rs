//! Native-issued identities bind activation to a retained report, never caller-supplied tuning fields.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct Report { version: String, fields: Value }

pub struct SpotIdentities {
    epoch: String,
    generation: u64,
    reports: HashMap<String, Report>,
}

impl SpotIdentities {
    pub fn new(generation: u64) -> Self {
        Self { epoch: uuid::Uuid::new_v4().to_string(), generation, reports: HashMap::new() }
    }
    pub fn invalidate(&mut self, generation: u64) {
        self.epoch = uuid::Uuid::new_v4().to_string();
        self.generation = generation;
        self.reports.clear();
    }
    pub fn annotate(&mut self, payload: &mut Value, generation: u64) {
        if generation != self.generation { self.invalidate(generation); }
        let mut candidates: HashMap<String, Value> = HashMap::new();
        let mut ambiguous = HashSet::new();
        for pointer in ["/snapshot/spots", "/contest_spots"] {
            let Some(spots) = payload.pointer(pointer).and_then(Value::as_array) else { continue; };
            let mut seen = HashSet::new();
            for spot in spots {
                let Some(id) = spot["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 128).map(str::to_owned) else { continue; };
                if !seen.insert(id.clone()) { ambiguous.insert(id.clone()); }
                let Some(fields) = fields(spot) else { ambiguous.insert(id); continue; };
                if candidates.get(&id).is_some_and(|prior| prior != &fields) { ambiguous.insert(id.clone()); }
                else { candidates.entry(id).or_insert(fields); }
            }
        }
        let mut next = HashMap::new();
        for (id, fields) in candidates.into_iter().filter(|(id, _)| !ambiguous.contains(id)) {
            let report = self.reports.get(&id).filter(|old| old.fields == fields).cloned()
                .unwrap_or_else(|| Report { version: uuid::Uuid::new_v4().to_string(), fields });
            next.insert(id, report);
        }
        for pointer in ["/snapshot/spots", "/contest_spots"] {
            let Some(spots) = payload.pointer_mut(pointer).and_then(Value::as_array_mut) else { continue; };
            for spot in spots {
                if let Some(object) = spot.as_object_mut() { object.remove("activation"); }
                let Some(id) = spot["id"].as_str() else { continue; };
                if let Some(report) = next.get(id) {
                    spot["activation"] = json!({"sourceEpoch":self.epoch,"spotVersion":report.version});
                }
            }
        }
        self.reports = next;
    }
    pub fn resolve(&self, epoch: &str, id: &str, version: &str, generation: u64) -> Result<Value, String> {
        if generation != self.generation || epoch != self.epoch {
            return Err("The cluster session changed. Refresh before selecting this report.".into());
        }
        self.reports.get(id).filter(|report| report.version == version).map(|report| report.fields.clone())
            .ok_or_else(|| "This report changed or is no longer available. Select it again from the current list.".into())
    }
}

fn fields(spot: &Value) -> Option<Value> {
    let call = spot["callsign"].as_str()?.trim().to_uppercase();
    if call.is_empty() || call.len() > 64 || !call.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'/') { return None; }
    let khz = spot["frequencyKHz"].as_f64()?;
    let hz = (khz * 1000.0).round();
    if !hz.is_finite() || !(1.0..=300_000_000_000.0).contains(&hz) { return None; }
    let mode = spot["mode"].as_str().unwrap_or("").trim().to_uppercase();
    if mode.len() > 32 || !mode.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b' ')) { return None; }
    Some(json!({"call":call,"frequencyHz":hz as u64,
        "band":spot["band"].as_str().unwrap_or(""),"mode":mode,
        "country":spot["country"].as_str().unwrap_or(""),"dxcc":spot["adif"].as_u64(),
        "comment":spot["comment"].as_str().unwrap_or(""),
        "specialTags":spot["specialTags"].as_array().cloned().unwrap_or_default()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payload() -> Value { json!({"snapshot":{"spots":[{"id":"one","callsign":"TEST1/P","frequencyKHz":14074.0,"mode":"FT8","band":"20m","comment":"test"}]}}) }
    #[test]
    fn unchanged_report_keeps_identity_but_semantic_change_removal_and_worker_replacement_revoke_it() {
        let mut owner = SpotIdentities::new(1); let mut first = payload(); owner.annotate(&mut first, 1);
        let token = first["snapshot"]["spots"][0]["activation"].clone();
        let epoch = token["sourceEpoch"].as_str().unwrap(); let version = token["spotVersion"].as_str().unwrap();
        let mut repeat = payload(); repeat["snapshot"]["spots"][0]["age"] = json!(55); owner.annotate(&mut repeat, 1);
        assert_eq!(repeat["snapshot"]["spots"][0]["activation"], token);
        assert_eq!(owner.resolve(epoch, "one", version, 1).unwrap()["frequencyHz"], 14_074_000);
        repeat["snapshot"]["spots"][0]["frequencyKHz"] = json!(14075); owner.annotate(&mut repeat, 1);
        assert!(owner.resolve(epoch, "one", version, 1).is_err());
        owner.annotate(&mut payload(), 2); assert!(owner.resolve(epoch, "one", version, 2).is_err());
        owner.annotate(&mut json!({"snapshot":{"spots":[]}}), 2); assert!(owner.reports.is_empty());
    }
    #[test]
    fn invalid_or_duplicate_source_reports_never_authorize_tuning() {
        let mut owner = SpotIdentities::new(0); let mut value = payload();
        value["snapshot"]["spots"][0]["frequencyKHz"] = json!(-1); owner.annotate(&mut value, 0); assert!(owner.reports.is_empty());
        let mut value = payload(); let duplicate = value["snapshot"]["spots"][0].clone();
        value["snapshot"]["spots"].as_array_mut().unwrap().push(duplicate); owner.annotate(&mut value, 0);
        assert!(owner.reports.is_empty());
        let mut conflict = payload(); conflict["contest_spots"] = json!([{"id":"one","callsign":"OTHER1","frequencyKHz":14075.0,"mode":"CW"}]);
        owner.annotate(&mut conflict, 0); assert!(owner.reports.is_empty());
    }
    #[test]
    fn prefilter_projection_and_visible_row_share_one_native_identity() {
        let mut owner = SpotIdentities::new(3); let mut value = payload();
        value["contest_spots"] = json!([value["snapshot"]["spots"][0].clone()]); owner.annotate(&mut value, 3);
        assert_eq!(value["snapshot"]["spots"][0]["activation"], value["contest_spots"][0]["activation"]);
        assert_eq!(owner.reports.len(), 1);
    }
    #[test]
    fn prefilter_only_report_survives_visible_filter_and_ambiguous_rows_lose_old_tokens() {
        let mut owner = SpotIdentities::new(3); let mut value = payload();
        value["contest_spots"] = json!([value["snapshot"]["spots"][0].clone()]);
        owner.annotate(&mut value, 3);
        let token = value["contest_spots"][0]["activation"].clone();
        value["snapshot"]["spots"] = json!([]); owner.annotate(&mut value, 3);
        assert_eq!(value["contest_spots"][0]["activation"], token);
        assert!(owner.resolve(token["sourceEpoch"].as_str().unwrap(), "one", token["spotVersion"].as_str().unwrap(), 3).is_ok());
        value["snapshot"]["spots"] = json!([value["contest_spots"][0].clone()]);
        value["snapshot"]["spots"][0]["frequencyKHz"] = json!(-1);
        owner.annotate(&mut value, 3);
        assert!(owner.reports.is_empty());
        assert!(value["snapshot"]["spots"][0].get("activation").is_none());
        assert!(value["contest_spots"][0].get("activation").is_none());
    }
}
