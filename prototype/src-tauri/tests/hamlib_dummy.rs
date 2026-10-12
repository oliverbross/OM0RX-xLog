// Opt-in local dummy integration; no serial path, live radio, or rotor is opened.
#[path = "../src/hamlib.rs"]
mod hamlib;

use serde_json::{json, Value};
use std::net::{Ipv4Addr, TcpListener};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

struct Dummy(Child);
impl Drop for Dummy {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(binary: &str) -> (Dummy, u16) {
    let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = reservation.local_addr().unwrap().port();
    drop(reservation);
    let child = Command::new(binary)
        .args(["-m", "1", "-T", "127.0.0.1", "-t", &port.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    (Dummy(child), port)
}

fn call(id: &str, method: &str, params: Value) -> Value {
    hamlib::request(json!({"id":id,"method":method,"params":params})).unwrap()
}

#[test]
fn opt_in_dummy_daemons_read_back_radio_and_rotor() {
    let (Ok(rig), Ok(rotor)) = (
        std::env::var("XLOG_TEST_RIGCTLD"),
        std::env::var("XLOG_TEST_ROTCTLD"),
    ) else {
        return; // CI without staged Hamlib still runs parser and safety tests.
    };
    let rig_models = call("models-rig", "hamlib_models", json!({"device":"radio"}));
    let rotor_models = call("models-rotor", "hamlib_models", json!({"device":"rotor"}));
    assert_eq!(rig_models["ok"], true, "{rig_models}");
    assert_eq!(rotor_models["ok"], true, "{rotor_models}");
    assert!(rig_models["result"]["models"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == 1 && m["maturity"] == "Stable"));
    assert!(rotor_models["result"]["models"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == 1 && m["maturity"] == "Stable"));
    for device in ["radio", "rotor"] {
        let ports = call("ports", "hamlib_serial_ports", json!({"device":device}));
        assert_eq!(ports["ok"], true, "{ports}");
        assert_eq!(ports["result"]["inventory_only"], true);
        assert!(ports["result"]["ports"].is_array());
        let caps = call(
            "caps",
            "hamlib_capabilities",
            json!({"device":device,"model":1}),
        );
        assert_eq!(caps["ok"], true, "{caps}");
        assert_eq!(caps["result"]["source"], "bundled_model");
        assert!(caps["result"]["text"].as_str().unwrap().contains("Model"));
        assert!(caps["result"]["capabilities"].as_object().unwrap().len() > 3);
    }
    let (rig_process, rig_port) = start(&rig);
    let (_rotor, rotor_port) = start(&rotor);
    let mut connected = false;
    let mut last = Value::Null;
    for _ in 0..40 {
        let response = call(
            "r1",
            "hamlib_connect",
            json!({"device":"radio","mode":"external","port":rig_port}),
        );
        if response["ok"] == true {
            connected = true;
            break;
        }
        last = response;
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(connected, "dummy radio did not become ready: {last}");
    connected = false;
    for _ in 0..40 {
        let response = call(
            "r2",
            "hamlib_connect",
            json!({"device":"rotor","mode":"external","port":rotor_port}),
        );
        if response["ok"] == true {
            connected = true;
            break;
        }
        last = response;
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(connected, "dummy rotor did not become ready: {last}");
    let status = call("status", "hamlib_status", json!({"device":"radio"}));
    assert_eq!(status["result"]["connected"], true, "{status}");
    assert_eq!(status["result"]["state"], "responsive");
    let remote_caps = call(
        "remote-caps",
        "hamlib_capabilities",
        json!({"device":"radio"}),
    );
    assert_eq!(remote_caps["ok"], true, "{remote_caps}");
    assert_eq!(remote_caps["result"]["source"], "connected_daemon");

    let mut snapshot = Value::Null;
    for index in 0..8 {
        snapshot = call(
            &format!("s{index}"),
            "hamlib_snapshot",
            json!({"device":"radio"}),
        )["result"]
            .clone();
    }
    assert_eq!(snapshot["fields"]["frequency"]["Frequency"], "145000000");
    assert_eq!(snapshot["fields"]["mode"]["Mode"], "FM");
    assert_eq!(snapshot["fields"]["split"]["Split"], "0");
    assert_eq!(snapshot["fields"]["split"]["TX VFO"], "None");
    assert!(snapshot["fields"]["rf_power"]["RFPOWER"].as_str().is_some());
    assert_eq!(
        call(
            "tx",
            "hamlib_control",
            json!({"device":"radio","action":"ptt","on":true})
        )["ok"],
        false
    );

    let tuned = call(
        "r3",
        "hamlib_control",
        json!({"device":"radio","action":"frequency","hz":14_074_000}),
    );
    assert_eq!(tuned["ok"], true, "{tuned}");
    assert_eq!(
        tuned["result"]["readback"]["fields"]["Frequency"],
        "14074000"
    );
    let split_on = call(
        "split-on",
        "hamlib_control",
        json!({"device":"radio","action":"split","enabled":true,"tx_vfo":"VFOB"}),
    );
    assert_eq!(split_on["ok"], true, "{split_on}");
    let simplex = call(
        "simplex",
        "hamlib_control",
        json!({"device":"radio","action":"tune_simplex","hz":14_195_000,"mode":"USB"}),
    );
    assert_eq!(simplex["ok"], true, "{simplex}");
    assert_eq!(simplex["result"]["confirmed"], true, "{simplex}");
    let moved = call(
        "r4",
        "hamlib_control",
        json!({"device":"rotor","action":"goto","azimuth":12,"elevation":6}),
    );
    assert_eq!(moved["ok"], true, "{moved}");
    assert!(moved["result"]["readback"]["fields"]["Azimuth"]
        .as_str()
        .unwrap()
        .parse::<f64>()
        .is_ok());
    drop(rig_process); // Only the test-owned dummy process is stopped.
    let lost = call("lost", "hamlib_status", json!({"device":"radio"}));
    assert_eq!(lost["result"]["connected"], false, "{lost}");
    assert_eq!(lost["result"]["reconnect_required"], true);
    assert_eq!(
        call("r5", "hamlib_disconnect", json!({"device":"radio"}))["ok"],
        true
    );
    assert_eq!(
        call("r6", "hamlib_disconnect", json!({"device":"rotor"}))["ok"],
        true
    );
    let managed_radio = call(
        "m1",
        "hamlib_connect",
        json!({"device":"radio","mode":"managed","model":1}),
    );
    assert_eq!(managed_radio["ok"], true, "{managed_radio}");
    let managed_radio_port = managed_radio["result"]["port"].as_u64().unwrap() as u16;
    let first_generation = managed_radio["result"]["generation"].as_u64().unwrap();
    let refused = call(
        "invalid-reconnect",
        "hamlib_reconnect",
        json!({"device":"radio","mode":"managed","model":2}),
    );
    assert_eq!(refused["ok"], false);
    let still_live = call("still-live", "hamlib_status", json!({"device":"radio"}));
    assert_eq!(still_live["result"]["connected"], true, "{still_live}");
    assert_eq!(still_live["result"]["generation"], first_generation);
    let reconnected = call(
        "reconnect",
        "hamlib_reconnect",
        json!({"device":"radio","mode":"managed","model":1}),
    );
    assert_eq!(reconnected["ok"], true, "{reconnected}");
    assert!(reconnected["result"]["generation"].as_u64().unwrap() > first_generation);
    assert_eq!(reconnected["result"]["tx_enabled"], false);
    let managed_rotor = call(
        "m2",
        "hamlib_connect",
        json!({"device":"rotor","mode":"managed","model":1}),
    );
    assert_eq!(managed_rotor["ok"], true, "{managed_rotor}");
    let managed_rotor_port = managed_rotor["result"]["port"].as_u64().unwrap() as u16;
    assert_eq!(
        call("m3", "hamlib_disconnect", json!({"device":"radio"}))["ok"],
        true
    );
    assert_eq!(
        call("m4", "hamlib_disconnect", json!({"device":"rotor"}))["ok"],
        true
    );
    assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, managed_radio_port)).is_ok());
    assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, managed_rotor_port)).is_ok());
    hamlib::shutdown();
}
