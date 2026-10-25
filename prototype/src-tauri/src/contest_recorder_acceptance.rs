//! Explicit signed-candidate fixture. Never opens a Core Audio stream, station
//! service, production log, native preferences, or the application's singleton.
use crate::contest_recorder_store::{self as store, Archive, Config, Result};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn bounded_output(command: &mut Command) -> Result<Vec<u8>> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let output = child.stdout.take().ok_or("Fixture output unavailable")?;
    let reading = std::thread::spawn(move || {
        let mut bytes = vec![];
        output
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(45);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reading.join();
            return Err("Isolated recorder fixture timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let bytes = reading
        .join()
        .map_err(|_| "Fixture reader failed")?
        .map_err(|e| e.to_string())?;
    if !status.success() || bytes.len() > 1_048_576 {
        return Err(format!("Isolated recorder fixture failed ({status})"));
    }
    Ok(bytes)
}

pub fn run() -> Result<Value> {
    let began = Instant::now();
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let macos = executable
        .parent()
        .ok_or("Candidate directory unavailable")?;
    let bytes = bounded_output(
        Command::new(macos.join("xlog-prototype-worker")).arg("--recorder-acceptance"),
    )?;
    let frame: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("Fixture response: {e}"))?;
    if frame["ok"] != true || frame["result"]["engine"] != "not1mm-python" {
        return Err("Fixture did not use the bundled not1mm-python engine".into());
    }
    let fixture = &frame["result"];
    let commit = &fixture["commit"];
    let events = commit["events"]
        .as_array()
        .ok_or("Missing committed audit")?;
    if events.len() != 1 {
        return Err("Retry created more than one committed contact".into());
    }
    let event = &events[0];
    let log = commit["sessionID"]
        .as_str()
        .ok_or("Missing durable log ID")?;
    let qso = event["qsoID"].as_str().ok_or("Missing durable QSO ID")?;
    let operation = event["operationID"]
        .as_str()
        .ok_or("Missing commit receipt")?;
    if fixture["analytics"]["rows"][0]["id"] != qso {
        return Err("Analytics lost the exact committed contact identity".into());
    }
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let root = temp.path().canonicalize().map_err(|e| e.to_string())?;
    let config = Config {
        input_id: "controlled-callback-fixture (no device)".into(),
        output_id: "controlled-render-fixture (no device)".into(),
        channels: 2,
        rate: 8000,
        mapping: "Custom channel mapping".into(),
        roles: vec!["Counter L fixture".into(), "Counter R fixture".into()],
        route_verified: true,
        pre_seconds: 1,
        post_seconds: 1,
        reserve_bytes: 1 << 30,
        warning_bytes: 5 << 30,
    };
    let samples = crate::contest_recorder_audio::fixture_input()?;
    let mut a = Archive::create(&root, log, config)?;
    a.segment_frames = 1000;
    a.append(&samples[..8000])?;
    a.flush_tail()?;
    let frozen = a.snapshot();
    let end = frozen.manifest.frames;
    a.append(&samples[8000..])?;
    if frozen.read_pcm(0, end)? != samples[..8000] {
        return Err("Frozen replay interval changed while capture advanced".into());
    }
    let marker = a.manifest.frames / 2;
    let utc = a.manifest.start_utc_ms + marker * 1000 / 8000;
    let markers = BTreeMap::from([(operation.to_owned(), (marker, utc))]);
    a.reconcile(commit, &markers)?;
    a.reconcile(commit, &markers)?;
    if a.links.len() != 1 || a.links[qso].frame != marker {
        return Err("Committed QSO bookmark lost its admission marker/idempotency".into());
    }
    let original = a.links[qso].original.clone();
    a.reconcile(&fixture["correction"], &markers)?;
    if a.links[qso].frame != marker
        || a.links[qso].original != original
        || a.links[qso].current["Call"] != "DL1ABC"
    {
        return Err("Correction changed the original audio anchor".into());
    }
    a.reconcile(&fixture["deletion"], &markers)?;
    if !a.links[qso].deleted {
        return Err("Contact deletion did not tombstone its audio link".into());
    }
    a.finish(
        "stopped",
        Some("Controlled fixture end; no physical audio coverage"),
    )?;
    let inventory = serde_json::to_value(&a.manifest.segments).map_err(|e| e.to_string())?;
    let export = a.snapshot().export(&root, false)?;
    let python = macos
        .parent()
        .ok_or("Candidate Contents unavailable")?
        .join("Frameworks/Python.framework/Versions/3.12/bin/python3.12");
    let script="import json,wave,struct,sys,pathlib\np=pathlib.Path(sys.argv[1]);m=json.loads((p/'manifest.json').read_text());samples=[]\nfor s in m['segments']:\n f=wave.open(str(p/(str(s['id']).zfill(6)+'.wav'))); assert f.getnchannels()==2 and f.getframerate()==8000;b=f.readframes(f.getnframes());samples.extend(struct.unpack('<'+'h'*(len(b)//2),b))\nexpected=[v for i in range(8000) for v in (i%1000,-(i%1000)-100)]\nassert samples==expected;assert m['gaps'];print(json.dumps({'decodedFrames':8000,'channels':2,'exactSamples':True}))";
    let decoded = bounded_output(
        Command::new(&python)
            .args(["-I", "-B", "-c", script])
            .arg(&export),
    )?;
    let decoded: Value = serde_json::from_slice(&decoded).map_err(|e| e.to_string())?;
    if inventory != serde_json::to_value(&a.manifest.segments).map_err(|e| e.to_string())? {
        return Err("Export modified original inventory".into());
    }
    let capture = a.manifest.capture_id.clone();
    drop(a);
    let loaded = Archive::load(&root, log, &capture)?;
    if loaded.links[qso].frame != marker || loaded.snapshot().read_pcm(0, 8000)? != samples {
        return Err("Recorder restart lost metadata or samples".into());
    }
    // A real partial write, then a fresh native load/repair to a NEW WAV.
    let mut partial = Archive::create(&root, log, loaded.manifest.config.clone())?;
    partial.append(&samples)?;
    partial.flush_tail()?;
    let partial_id = partial.manifest.capture_id.clone();
    let partial_path = store::segment_path(&partial.dir, 0, true);
    drop(partial);
    let retained = std::fs::read(&partial_path).map_err(|e| e.to_string())?;
    let mut recovered = Archive::load(&root, log, &partial_id)?;
    recovered.recover()?;
    if recovered.snapshot().read_pcm(0, 8000)? != samples
        || std::fs::read(&partial_path).map_err(|e| e.to_string())? != retained
    {
        return Err("Recovery changed original partial media".into());
    }
    Ok(
        json!({"schema":1,"ok":true,"version":env!("CARGO_PKG_VERSION"),"sourceCommit":option_env!("XLOG_SOURCE_COMMIT"),
        "engine":"not1mm-python","audioEvidence":"Generated input traversed the native callback queue and archive; no physical device opened",
        "checks":{"callbackSamples":true,"segmentContinuity":true,"frozenReplay":true,"realPythonCommit":true,"retryIdempotency":true,"stableCorrectionAnchor":true,"tombstonePreservesAudio":true,"analyticsContactIdentity":true,"restart":true,"crashTailRecovery":true,"immutableOriginals":true,"independentExportDecode":decoded["exactSamples"],"noStationOwnerConstructed":true},
        "decoded":decoded,"elapsedMs":began.elapsed().as_millis(),"captureOpened":false,"outputOpened":false,"productionDataOpened":false,"physicalAcceptance":"Pending — operator audio disconnected"}),
    )
}
