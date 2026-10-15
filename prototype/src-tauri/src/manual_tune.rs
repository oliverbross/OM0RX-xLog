//! Manual simplex targets only. No draft, spot activation, polling or reconnect.
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX: u64 = 9_007_199_254_740_991;
pub fn params(value: &Value) -> Result<Value, String> {
    let provider = value["provider"]
        .as_str()
        .filter(|p| crate::station_telemetry::valid_provider(p))
        .ok_or("Select a supported radio before tuning.")?;
    for key in ["connection_generation", "control_revision", "worker_generation"] {
        if value[key]
            .as_u64()
            .is_none_or(|n| n > MAX || key == "worker_generation" && provider != "hamlib" && n == 0)
        {
            return Err("Manual tune requires exact native radio and worker epochs.".into());
        }
    }
    let hz = value["frequency_hz"]
        .as_u64()
        .filter(|n| (100_000..=1_000_000_000).contains(n))
        .ok_or("Tune frequency must be an integer from 100 kHz to 1 GHz.")?;
    let mode = value["mode"]
        .as_str()
        .filter(|m| !m.is_empty() && m.len() <= 16 && m.bytes().all(|b| b.is_ascii_alphanumeric()))
        .ok_or("Choose a supported simplex mode.")?
        .to_uppercase();
    if provider == "hamlib" {
        let mode = radio_mode(&mode, hz);
        Ok(
            json!({"provider":provider,"device":"radio","action":"tune_simplex","hz":hz,"mode":mode,"expected_generation":value["connection_generation"]}),
        )
    } else {
        Ok(
            json!({"provider":provider,"frequency_hz":hz,"mode":mode,"expected_generation":value["connection_generation"]}),
        )
    }
}
fn radio_mode(mode: &str, hz: u64) -> &str {
    match mode {
        "SSB" => {
            if hz < 10_000_000 {
                "LSB"
            } else {
                "USB"
            }
        }
        "FT8" | "FT4" | "FT2" | "PSK" | "DIGI" | "DATA" | "DIGU" => "PKTUSB",
        "DIGL" => "PKTLSB",
        _ => mode,
    }
}
pub fn admission(projection: &Value, descriptor: &Value, now: u64) -> Result<(), String> {
    let age = |v: &Value, scale: f64| {
        v.as_f64().is_some_and(|t| {
            t.is_finite() && (-1000.0..=5000.0).contains(&(now as f64 - t * scale))
        })
    };
    let provider = descriptor["provider"]
        .as_str()
        .ok_or("Missing tune provider")?;
    let snapshot = &projection["snapshot"];
    if projection["available"] != true
        || projection["provider"] != provider
        || projection["selection_id"] != descriptor["selection_id"]
        || projection["selection_generation"] != descriptor["selection_generation"]
        || !age(&projection["received_at_ms"], 1.0)
        || snapshot["generation"] != descriptor["connection_generation"]
    {
        return Err("Radio observation or connection changed before manual tune.".into());
    }
    let fresh = if provider == "hamlib" {
        age(&snapshot["observed_at_ms"], 1.0)
            && age(&snapshot["field_observed_at_ms"]["ptt"], 1.0)
            && snapshot["fields"]["ptt"]["PTT"] == "0"
            && snapshot["fields"]["frequency"].is_object()
            && snapshot["fields"]["mode"].is_object()
    } else {
        snapshot["source"] == provider
            && age(&snapshot["generated_at"], 1000.0)
            && age(&snapshot["radio"]["observed_at"], 1000.0)
            && snapshot["radio"]["connected"] == true
            && snapshot["radio"]["observed"] == true
            && snapshot["radio"]["transmitting"] == false
            && snapshot["station"]["radio_stale"] != true
            && (provider != "direct_flex_lan"
                || snapshot["capabilities"]["supported_commands"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == "station_tune")))
    };
    if !fresh {
        return Err("Manual tune requires a fresh observed receive state.".into());
    }
    Ok(())
}
pub fn confirmed(descriptor: &Value, response: &Value) -> bool {
    if response["result"]["confirmed"] != true {
        return false;
    }
    let Some(hz) = descriptor["frequency_hz"].as_u64() else {
        return false;
    };
    let mode = descriptor["mode"].as_str().unwrap_or("").to_uppercase();
    let result = &response["result"];
    if descriptor["provider"] == "hamlib" {
        return result["generation"] == descriptor["connection_generation"]
            && result["readback"]["frequency"]["Frequency"]
                .as_str()
                .and_then(|v| v.parse::<u64>().ok())
                == Some(hz)
            && result["readback"]["mode"]["Mode"].as_str() == Some(radio_mode(&mode, hz))
            && result["readback"]["ptt"] == false;
    }
    let mode = match mode.as_str() {
        "SSB" => {
            if hz < 10_000_000 {
                "LSB"
            } else {
                "USB"
            }
        }
        "FT8" | "FT4" | "FT2" | "RTTY" | "PSK" | "DIGI" => "DIGU",
        other => other,
    };
    let state = &result["state"];
    let radio = &state["radio"];
    state["source"] == descriptor["provider"]
        && state["generation"] == descriptor["connection_generation"]
        && radio["connected"] == true
        && radio["observed"] == true
        && radio["transmitting"] == false
        && radio["frequency_hz"].as_u64() == Some(hz)
        && radio["transmit_frequency_hz"].as_u64() == Some(hz)
        && radio["mode"].as_str() == Some(mode)
        && radio["receive_vfo"] == "A"
        && radio["transmit_vfo"] == "A"
        && radio["split"] == false
        && radio["vfos"].as_array().is_some_and(|vfos| {
            vfos.iter()
                .any(|v| v["letter"] == "A" && v["receive"] == true && v["transmit"] == true)
        })
}
pub fn execute(
    app: &tauri::AppHandle,
    descriptor: &Value,
    request: Value,
    generation: u64,
    identity: &str,
) -> Result<Value, String> {
    let worker = descriptor["worker_generation"]
        .as_u64()
        .ok_or("Missing worker generation")?;
    let uses_worker = descriptor["provider"] != "hamlib";
    if uses_worker { crate::worker::require_existing_generation(worker)?; }
    let selection = crate::station_selection::owner(app)?;
    let telemetry = crate::station_telemetry::owner(app)?;
    let control = descriptor["control_revision"]
        .as_u64()
        .ok_or("Missing control epoch")?;
    crate::radio_follow::revoke("Manual simplex tuning disabled Follow Radio.");
    crate::auto_rotor::revoke();
    selection.manual_tune(
        request,
        generation,
        identity,
        control,
        || {
            if uses_worker { crate::worker::require_existing_generation(worker)?; }
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Radio clock unavailable")?
                .as_millis() as u64;
            admission(&telemetry.snapshot()?, descriptor, now)?;
            telemetry.control()
        },
        |request| {
            let response = if descriptor["provider"] == "hamlib" {
                crate::hamlib::request(request)
            } else {
                crate::worker::request_existing_generation(request, worker)
            }?;
            if uses_worker { crate::worker::require_existing_generation(worker)?; }
            Ok(response)
        },
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn descriptor(provider: &str) -> Value {
        json!({"provider":provider,"frequency_hz":14074000,"mode":"SSB","connection_generation":7,
        "control_revision":3,"worker_generation":1,"selection_id":"selection","selection_generation":2})
    }
    #[test]
    fn manual_tune_target_normalization_is_native_and_strict() {
        for (mode, expected) in [
            ("SSB", "USB"),
            ("FT8", "PKTUSB"),
            ("DIGL", "PKTLSB"),
            ("CW", "CW"),
        ] {
            let mut target = descriptor("hamlib");
            target["mode"] = json!(mode);
            assert_eq!(params(&target).unwrap()["mode"], expected);
        }
        for (key, value) in [
            ("frequency_hz", json!(true)),
            ("frequency_hz", json!(14074000.5)),
            ("mode", json!("CW;TX")),
            ("provider", json!("other")),
        ] {
            let mut target = descriptor("hamlib");
            target[key] = value;
            assert!(params(&target).is_err());
        }
        let mut local = descriptor("hamlib");
        local["worker_generation"] = json!(0);
        assert!(params(&local).is_ok());
        let mut remote = descriptor("direct_agent");
        remote["worker_generation"] = json!(0);
        assert!(params(&remote).is_err());
    }
    #[test]
    fn admission_fences_connection_selection_staleness_and_transmitting() {
        let target = descriptor("direct_flex_lan");
        let now = 1800000000000u64;
        let projection = json!({"available":true,"provider":"direct_flex_lan","selection_id":"selection","selection_generation":2,"received_at_ms":now,
            "snapshot":{"source":"direct_flex_lan","generation":7,"generated_at":now/1000,"radio":{"connected":true,"observed":true,"transmitting":false,"observed_at":now/1000},"capabilities":{"supported_commands":["station_tune"]}}});
        assert!(admission(&projection, &target, now).is_ok());
        assert!(admission(&projection, &target, now + 5001).is_err());
        let mut changed = projection.clone();
        changed["snapshot"]["generation"] = json!(8);
        assert!(admission(&changed, &target, now).is_err());
        changed = projection.clone();
        changed["snapshot"]["radio"]["transmitting"] = json!(true);
        assert!(admission(&changed, &target, now).is_err());
        changed = projection;
        changed["selection_id"] = json!("replaced");
        assert!(admission(&changed, &target, now).is_err());
    }
    #[test]
    fn acknowledgement_or_wrong_target_cannot_confirm_a_manual_tune() {
        let target = descriptor("direct_flex_lan");
        let reply = json!({"result":{"confirmed":true,"state":{"source":"direct_flex_lan","generation":7,"radio":{"connected":true,"observed":true,"transmitting":false,
            "frequency_hz":14074000,"transmit_frequency_hz":14074000,"mode":"USB","receive_vfo":"A","transmit_vfo":"A","split":false,"vfos":[{"letter":"A","receive":true,"transmit":true}]}}}});
        assert!(confirmed(&target, &reply));
        for path in [
            "/result/confirmed",
            "/result/state/radio/split",
            "/result/state/radio/transmit_vfo",
            "/result/state/radio/mode",
            "/result/state/generation",
            "/result/state/radio/frequency_hz",
        ] {
            let mut wrong = reply.clone();
            *wrong.pointer_mut(path).unwrap() = Value::Null;
            assert!(!confirmed(&target, &wrong), "{path}");
        }
    }
}
