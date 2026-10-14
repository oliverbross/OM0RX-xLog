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
        let Some(spots) = payload["snapshot"]["spots"].as_array_mut() else { return; };
        let mut next = HashMap::new();
        let mut seen = HashSet::new();
        for spot in spots {
            let Some(id) = spot["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 128).map(str::to_owned) else { continue; };
            let Some(fields) = fields(spot) else { continue; };
            // Duplicate source identities are not safe activation targets.
            if !seen.insert(id.clone()) { next.remove(&id); continue; }
            let report = self.reports.get(&id).filter(|old| old.fields == fields).cloned()
                .unwrap_or_else(|| Report { version: uuid::Uuid::new_v4().to_string(), fields });
            spot["activation"] = json!({"sourceEpoch":self.epoch,"spotVersion":report.version});
            next.insert(id, report);
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
    }
}
