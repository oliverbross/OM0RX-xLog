//! Read-only bridge from retained native telemetry to the Swift allowlist projection.
//! No owner is created, no worker is started, and no source payload is returned.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

// Closed enums deliberately cannot carry source strings, even from forged IPC.
macro_rules! export_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Deserialize, Serialize, PartialEq)]
        pub enum $name { $(#[serde(rename = $value)] $variant),+ }
    };
}
export_enum!(Provider { Agent => "direct_agent", Flex => "direct_flex_lan", Tci => "direct_tci", Hamlib => "hamlib", Unknown => "unknown" });
export_enum!(Configuration { Unknown => "unknown", Configured => "configured", Missing => "missing", Invalid => "invalid" });
export_enum!(Transport { Stopped => "stopped", Connecting => "connecting", Synchronizing => "synchronizing", Ready => "ready", Unknown => "unknown" });
export_enum!(Freshness { Fresh => "fresh", Stale => "stale", Unavailable => "unavailable", Unknown => "unknown" });
export_enum!(Evidence { Retained => "retained-worker-state-only" });
export_enum!(Capability { Observe => "observe", Tune => "tune", Ptt => "ptt", Cw => "cw", RfPower => "rfPower" });
export_enum!(Stage { Provider => "provider", Configuration => "configuration", Connection => "connection", Freshness => "freshness", Capabilities => "capabilities" });
export_enum!(Status { Passed => "passed", Attention => "attention", Unknown => "unknown" });
export_enum!(Reason {
    ProviderRecognized => "providerRecognized", ProviderUnknown => "providerUnknown",
    ConfigurationRetained => "configurationRetained", ConfigurationMissing => "configurationMissing",
    ConfigurationInvalid => "configurationInvalid", ConfigurationUnknown => "configurationUnknown",
    Connected => "connected", ConnectionPending => "connectionPending", Disconnected => "disconnected", ConnectionUnknown => "connectionUnknown",
    ObservationFresh => "observationFresh", ObservationStale => "observationStale", ObservationUnavailable => "observationUnavailable",
    ObservationTimeUnknown => "observationTimeUnknown", ReadOnly => "readOnly", CapabilitiesAdvertised => "capabilitiesAdvertised", CapabilitiesUnknown => "capabilitiesUnknown",
});
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExportCheck {
    stage: Stage,
    status: Status,
    reason: Reason,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportPreview {
    schema_version: u8,
    evidence: Evidence,
    provider: Provider,
    configuration: Configuration,
    transport: Transport,
    freshness: Freshness,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    read_only: Option<bool>,
    advertised_capabilities: Vec<Capability>,
    checks: Vec<ExportCheck>,
}
impl ExportPreview {
    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        let stages = [
            Stage::Provider,
            Stage::Configuration,
            Stage::Connection,
            Stage::Freshness,
            Stage::Capabilities,
        ];
        if self.schema_version != 1
            || self.checks.len() != stages.len()
            || !self
                .checks
                .iter()
                .zip(stages)
                .all(|(check, stage)| check.stage == stage)
            || self.advertised_capabilities.len() > 5
            || self
                .advertised_capabilities
                .iter()
                .enumerate()
                .any(|(index, item)| self.advertised_capabilities[..index].contains(item))
        {
            return Err("Connection Doctor report could not be verified.".into());
        }
        let mut bytes = serde_json::to_vec_pretty(self)
            .map_err(|_| "Connection Doctor report could not be encoded.")?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

pub fn prepare_export(
    label: &str,
    isolated: bool,
    exiting: bool,
    preview: &ExportPreview,
) -> Result<Vec<u8>, String> {
    validate(label, isolated, exiting)?;
    preview.bytes()
}

static EXPORT_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub struct ExportLease;
impl ExportLease {
    pub fn acquire() -> Result<Self, String> {
        EXPORT_PENDING
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .map(|_| Self)
            .map_err(|_| "A Connection Doctor export is already open.".into())
    }
}
impl Drop for ExportLease {
    fn drop(&mut self) {
        EXPORT_PENDING.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// A native-selected path stays native; cancellation never creates a file.
pub fn save_export(path: Option<std::path::PathBuf>, bytes: &[u8]) -> Result<bool, String> {
    use std::io::Write;
    let Some(path) = path else {
        return Ok(false);
    };
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        let mut file =
            tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing export directory")?)?;
        file.write_all(bytes)?;
        file.as_file().sync_all()?;
        file.persist(path)?;
        Ok(())
    };
    write().map_err(|_| "Redacted report could not be saved.".to_string())?;
    Ok(true)
}

const METHOD: &str = "connection_doctor_project";

pub fn validate(label: &str, isolated: bool, exiting: bool) -> Result<(), String> {
    if label != "connection-doctor" || isolated || exiting {
        return Err("Connection Doctor is unavailable in this window.".into());
    }
    Ok(())
}

fn boolean(value: &Value) -> Value {
    value.as_bool().map(Value::Bool).unwrap_or(Value::Null)
}

fn strings(value: &Value) -> Value {
    Value::Array(
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item.as_str())
            .filter(|item| {
                item.len() <= 64
                    && item
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            })
            .map(|item| Value::String(item.into()))
            .take(32)
            .collect(),
    )
}

fn reduced_snapshot(context: &Value) -> Value {
    let provider = context["selection"]["provider"]
        .as_str()
        .filter(|value| {
            matches!(
                *value,
                "direct_agent" | "direct_flex_lan" | "direct_tci" | "hamlib"
            )
        })
        .unwrap_or("unknown");
    let envelope = &context["radio"];
    let coherent = envelope["provider"] == provider
        && envelope["available"].as_bool() == Some(true)
        && envelope["snapshot"].is_object();
    let retained = coherent
        .then_some(&envelope["snapshot"])
        .unwrap_or(&Value::Null);
    let received = envelope["received_at_ms"]
        .as_u64()
        .filter(|_| coherent)
        .map(|value| json!(value as f64 / 1000.0))
        .unwrap_or(Value::Null);
    let transport = retained["transport_state"]
        .as_str()
        .filter(|value| matches!(*value, "stopped" | "connecting" | "synchronizing" | "ready"))
        .unwrap_or(if coherent {
            "ready"
        } else if provider == "unknown" {
            "unknown"
        } else {
            "stopped"
        });
    let mut station = Map::new();
    station.insert(
        "radio_known".into(),
        boolean(&retained["station"]["radio_known"]),
    );
    station.insert(
        "radio_stale".into(),
        boolean(&retained["station"]["radio_stale"]),
    );
    station.insert(
        "supported_commands".into(),
        strings(&retained["station"]["supported_commands"]),
    );
    let mut capabilities = Map::new();
    capabilities.insert(
        "read_only".into(),
        boolean(&retained["capabilities"]["read_only"]),
    );
    capabilities.insert(
        "supported_commands".into(),
        strings(&retained["capabilities"]["supported_commands"]),
    );
    json!({
        "source": provider,
        "available": coherent,
        "transport_state": transport,
        "radio": {
            "connected": boolean(&retained["radio"]["connected"]),
            "observed": boolean(&retained["radio"]["observed"]),
            "received_at": received,
        },
        "station": station,
        "capabilities": capabilities,
    })
}

fn request(context: Value, now: f64) -> Value {
    json!({"id":uuid::Uuid::new_v4().to_string(),"method":METHOD,
        "params":{"snapshot":reduced_snapshot(&context),"now":now}})
}

pub fn snapshot(
    context: Value,
    now: f64,
    project: impl FnOnce(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    if !now.is_finite() || now < 0.0 {
        return Err("Connection Doctor clock is unavailable.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut message = request(context, now);
    message["id"] = json!(id);
    let response = project(message)?;
    if response["id"] != id || response["ok"] != true || !response["result"].is_object() {
        return Err("Connection Doctor preview is unavailable.".into());
    }
    Ok(response["result"].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn export_preview() -> Value {
        json!({"schemaVersion":1,"evidence":"retained-worker-state-only","provider":"direct_tci",
            "configuration":"unknown","transport":"ready","freshness":"fresh","readOnly":true,
            "advertisedCapabilities":["observe"],"checks":[
                {"stage":"provider","status":"passed","reason":"providerRecognized"},
                {"stage":"configuration","status":"unknown","reason":"configurationUnknown"},
                {"stage":"connection","status":"passed","reason":"connected"},
                {"stage":"freshness","status":"passed","reason":"observationFresh"},
                {"stage":"capabilities","status":"passed","reason":"readOnly"}]})
    }
    #[test]
    fn export_is_deterministic_and_rejects_all_untyped_source_content() {
        let value = export_preview();
        let parsed: ExportPreview = serde_json::from_value(value.clone()).unwrap();
        let bytes = parsed.bytes().unwrap();
        assert_eq!(parsed.bytes().unwrap(), bytes);
        assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), value);
        for key in [
            "secret",
            "endpoint",
            "selection_id",
            "error",
            "frequency_hz",
            "timestamp",
            "logs",
        ] {
            let mut bad = value.clone();
            bad[key] = json!("PRIVATE-SOURCE");
            assert!(
                serde_json::from_value::<ExportPreview>(bad).is_err(),
                "{key}"
            );
        }
        for key in [
            "evidence",
            "provider",
            "configuration",
            "transport",
            "freshness",
            "readOnly",
            "schemaVersion",
        ] {
            let mut bad = value.clone();
            bad[key] = json!("PRIVATE-SOURCE");
            assert!(
                serde_json::from_value::<ExportPreview>(bad).is_err(),
                "{key}"
            );
        }
        for key in ["stage", "status", "reason", "error"] {
            let mut bad = value.clone();
            bad["checks"][0][key] = json!("PRIVATE-SOURCE");
            assert!(
                serde_json::from_value::<ExportPreview>(bad).is_err(),
                "{key}"
            );
        }
        let mut bad = value.clone();
        bad["advertisedCapabilities"] = json!(["PRIVATE-SOURCE"]);
        assert!(serde_json::from_value::<ExportPreview>(bad).is_err());
        for field in ["schemaVersion", "checks", "advertisedCapabilities"] {
            let mut bad = value.clone();
            bad[field] = match field {
                "schemaVersion" => json!(2),
                "checks" => json!([]),
                _ => json!(["observe", "observe"]),
            };
            assert!(serde_json::from_value::<ExportPreview>(bad)
                .unwrap()
                .bytes()
                .is_err());
        }
    }
    #[test]
    fn native_export_cancellation_write_failure_and_exclusive_ownership() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = serde_json::from_value::<ExportPreview>(export_preview())
            .unwrap()
            .bytes()
            .unwrap();
        assert!(!save_export(None, &bytes).unwrap());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        let path = directory.path().join("report.json");
        assert!(save_export(Some(path.clone()), &bytes).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let error = save_export(
            Some(directory.path().join("PRIVATE-SOURCE/no-directory.json")),
            &bytes,
        )
        .unwrap_err();
        assert_eq!(error, "Redacted report could not be saved.");
        let lease = ExportLease::acquire().unwrap();
        assert!(ExportLease::acquire().is_err());
        drop(lease);
        assert!(ExportLease::acquire().is_ok());
    }
    #[test]
    fn export_authorization_requires_exact_doctor_window_before_any_dialog_or_write() {
        let preview = serde_json::from_value::<ExportPreview>(export_preview()).unwrap();
        assert!(prepare_export("connection-doctor", false, false, &preview).is_ok());
        for label in [
            "main",
            "monitor",
            "settings",
            "station-status",
            "logbook",
            "connection-doctor-1",
            "unknown",
        ] {
            assert!(
                prepare_export(label, false, false, &preview).is_err(),
                "{label}"
            );
        }
        assert!(prepare_export("connection-doctor", true, false, &preview).is_err());
        assert!(prepare_export("connection-doctor", false, true, &preview).is_err());
        let mut invalid = export_preview();
        invalid["schemaVersion"] = json!(2);
        let invalid = serde_json::from_value::<ExportPreview>(invalid).unwrap();
        assert!(prepare_export("connection-doctor", false, false, &invalid).is_err());
    }
    #[test]
    fn adapter_strips_identifiers_values_errors_and_secrets_before_projection() {
        let secret = "https://user:secret@example.invalid/?token=private";
        let context = json!({"selection":{"provider":"direct_agent","selection_id":secret,"generation":9},
            "radio":{"provider":"direct_agent","available":true,"received_at_ms":100000,"selection_id":secret,
                "snapshot":{"source":"direct_agent","transport_state":"ready","endpoint":secret,"error":secret,
                    "radio":{"connected":true,"observed":true,"frequency_hz":14074000,"mode":"USB"},
                    "station":{"radio_known":true,"radio_stale":false,"alarm_summary":secret,"supported_commands":["station_tune"]},
                    "capabilities":{"supported_commands":["station_tune"],"token":secret}}}});
        let request = request(context, 101.0);
        let encoded = request.to_string();
        assert!(!encoded.contains(secret));
        assert!(!encoded.contains("14074000"));
        assert!(!encoded.contains("USB"));
        assert_eq!(request["params"]["snapshot"]["source"], "direct_agent");
        assert_eq!(request["params"]["snapshot"]["radio"]["received_at"], 100.0);
        assert_eq!(
            request["params"]["snapshot"]["station"]["supported_commands"],
            json!(["station_tune"])
        );
    }

    #[test]
    fn incoherent_or_unselected_context_fails_closed_without_source_values() {
        let context = json!({"selection":{"provider":"direct_tci"},"radio":{"provider":"direct_agent","available":true,
            "received_at_ms":100000,"snapshot":{"radio":{"connected":true,"observed":true},"token":"private"}}});
        let reduced = reduced_snapshot(&context);
        assert_eq!(reduced["source"], "direct_tci");
        assert_eq!(reduced["available"], false);
        assert_eq!(reduced["transport_state"], "stopped");
        assert_eq!(reduced["radio"]["received_at"], Value::Null);
        assert!(!reduced.to_string().contains("private"));
    }

    #[test]
    fn validates_exact_surface_and_returns_only_correlated_projected_result() {
        assert!(validate("connection-doctor", false, false).is_ok());
        for label in ["main", "station-status", "settings", "unknown"] {
            assert!(validate(label, false, false).is_err());
        }
        assert!(validate("connection-doctor", true, false).is_err());
        assert!(validate("connection-doctor", false, true).is_err());
        let result = snapshot(json!({}), 1.0, |request| {
            Ok(json!({"id":request["id"],"ok":true,"result":{"schemaVersion":1}}))
        })
        .unwrap();
        assert_eq!(result, json!({"schemaVersion":1}));
        assert!(snapshot(json!({}), 1.0, |_| Ok(
            json!({"id":"wrong","ok":true,"result":{}})
        ))
        .is_err());
    }
}
