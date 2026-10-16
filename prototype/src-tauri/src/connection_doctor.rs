//! Read-only bridge from retained native telemetry to the Swift allowlist projection.
//! No owner is created, no worker is started, and no source payload is returned.
use serde_json::{json, Map, Value};

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
