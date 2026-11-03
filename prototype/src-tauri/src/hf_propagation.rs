use serde::Deserialize;
use std::{time::{Duration, Instant}, sync::OnceLock, collections::HashMap};
use tauri::async_runtime::Mutex;

// One retained provider cycle across every native webview. Consumers own their
// visibility timers; there is no second background poller to keep alive.
type RbnCache = HashMap<String, (Instant, Result<String, String>)>;
static RBN_CACHE: OnceLock<Mutex<RbnCache>> = OnceLock::new();
async fn retained_rbn<F, Fut>(call: String, fetcher: F) -> Result<String, String>
where F: FnOnce() -> Fut, Fut: std::future::Future<Output = Result<String, String>> {
    let mut cache = RBN_CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock().await;
    let previous = cache.get(&call).and_then(|(_, result)| result.as_ref().ok()).cloned();
    if let Some((at, result)) = cache.get(&call) {
        if at.elapsed() < Duration::from_secs(120) { return result.clone(); }
    }
    cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(3600));
    if cache.len() >= 8 { cache.clear(); }
    let result = fetcher().await.map(|incoming| previous.as_ref().map(|old| retain_rbn_payload(old, &incoming)).unwrap_or(incoming));
    cache.insert(call, (Instant::now(), result.clone()));
    result
}
fn retain_rbn_payload(previous: &str, incoming: &str) -> String {
    let (Ok(old), Ok(mut next)) = (serde_json::from_str::<serde_json::Value>(previous), serde_json::from_str::<serde_json::Value>(incoming)) else { return incoming.into(); };
    let Some(old_spots) = old["spots"].as_object() else { return incoming.into(); };
    let Some(spots) = next["spots"].as_object_mut() else { return incoming.into(); };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|v| v.as_secs()).unwrap_or(0) as f64;
    let time = |row: &serde_json::Value| row[10].as_f64().or_else(|| row[10].as_str().and_then(|v| v.parse::<f64>().ok())).unwrap_or(0.0);
    for (id, row) in old_spots {
        if time(row) >= now - 3600.0 && time(row) <= now + 60.0 && spots.get(id).map(|current| time(row) > time(current)).unwrap_or(true) { spots.insert(id.clone(), row.clone()); }
    }
    let mut rows: Vec<_> = spots.iter().filter(|(_, row)| time(row) >= now - 3600.0 && time(row) <= now + 60.0).map(|(id,row)| (id.clone(),row.clone())).collect();
    rows.sort_by(|a,b| time(&b.1).total_cmp(&time(&a.1)).then(a.0.cmp(&b.0)));
    *spots = rows.into_iter().take(2000).collect();
    if let (Some(old_info), Some(info)) = (old["call_info"].as_object(), next["call_info"].as_object_mut()) {
        for (call, value) in old_info { info.entry(call.clone()).or_insert_with(|| value.clone()); }
    }
    let merged = next.to_string();
    if merged.len() <= MAX_RESPONSE_BYTES { merged } else { incoming.into() }
}
fn checked_rbn_call(value: Option<String>) -> Result<String, String> {
    let call = value.unwrap_or_default().trim().to_ascii_uppercase();
    if !(3..=16).contains(&call.len()) || !call.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '/') {
        return Err("Enter an exact on-air callsign for RBN monitoring".into());
    }
    Ok(call)
}

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const WSPR_BANDS: [i16; 17] = [-1, 0, 1, 3, 5, 7, 10, 14, 18, 21, 24, 28, 50, 70, 144, 432, 1296];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    source: String,
    since_seconds: Option<u32>,
    bands: Option<Vec<i16>>,
    own_call: Option<String>,
}

fn checked_seconds(value: Option<u32>) -> Result<u32, String> {
    Ok(value.unwrap_or(180).clamp(120, 3600))
}

fn checked_bands(value: Option<Vec<i16>>) -> Result<Vec<i16>, String> {
    let mut bands = value.unwrap_or_default();
    if bands.is_empty() || bands.len() > WSPR_BANDS.len() || bands.iter().any(|band| !WSPR_BANDS.contains(band)) {
        return Err("Invalid propagation band selection".into());
    }
    bands.sort_unstable(); bands.dedup(); Ok(bands)
}

fn checked_call(value: Option<String>) -> Result<String, String> {
    let call: String = value.unwrap_or_default().to_ascii_uppercase().chars().filter(|ch| ch.is_ascii_alphanumeric() || *ch == '/').take(16).collect();
    if call.len() < 3 { return Err("Own callsign is required for propagation activity".into()); }
    Ok(call)
}

fn endpoint(request: &FetchRequest) -> Result<(String, Option<String>), String> {
    let fixed = match request.source.as_str() {
        "pskr" => Some("https://retrieve.pskreporter.info/query?lastseqno=0&modify=grid&flowStartSeconds=-900"),
        "dxheat" => Some("https://dxheat.com/source/spots/?a=500"),
        "swpc_sfi" => Some("https://services.swpc.noaa.gov/products/summary/10cm-flux.json"),
        "swpc_kp" => Some("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),
        "swpc_wind" => Some("https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json"),
        "swpc_xray" => Some("https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json"),
        "swpc_ssn" => Some("https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"),
        "swpc_kp_forecast" => Some("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"),
        "swpc_forecast" => Some("https://services.swpc.noaa.gov/text/3-day-forecast.txt"),
        _ => None,
    };
    if let Some(url) = fixed { return Ok((url.into(), None)); }
    let seconds = checked_seconds(request.since_seconds)?;
    let bands = checked_bands(request.bands.clone())?;
    let band_list = bands.iter().map(ToString::to_string).collect::<Vec<_>>().join(",");
    let sql = match request.source.as_str() {
        "wspr" => format!("SELECT toStartOfInterval(time, INTERVAL 2 MINUTE) AS bucket, band, tx_sign, rx_sign, any(distance) AS distance FROM wspr.rx WHERE time >= now() - INTERVAL {seconds} SECOND AND band IN ({band_list}) GROUP BY bucket, band, tx_sign, rx_sign FORMAT JSONCompact"),
        "own_wspr" => {
            let call = checked_call(request.own_call.clone())?;
            format!("SELECT time, band, tx_sign, rx_sign, snr FROM wspr.rx WHERE (tx_sign = '{call}' OR rx_sign = '{call}') AND band IN ({band_list}) AND time >= now() - INTERVAL {seconds} SECOND FORMAT JSONCompact")
        }
        _ => return Err("Unknown propagation source".into()),
    };
    Ok(("https://db1.wspr.live/".into(), Some(sql)))
}

pub async fn fetch(window_label: &str, request: FetchRequest) -> Result<String, String> {
    if !matches!(window_label, "main" | "hf-propagation-live") && !(request.source == "own_rbn" && crate::workspace_windows::surface_role(window_label) == "world-map") {
        return Err("Only the HF propagation surfaces can fetch propagation data".into());
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(22)).user_agent("OM0RX-xLog/1.2.23 HF-Propagation").build().map_err(|_| "Propagation HTTP client unavailable".to_string())?;
    if request.source == "own_rbn" {
        let call = checked_rbn_call(request.own_call.clone())?;
        return retained_rbn(call, || fetch_own_rbn(&client, &request)).await;
    }
    let (url, query) = endpoint(&request)?;
    let mut outbound = client.get(url).header("Accept", if request.source == "pskr" { "application/xml,text/xml;q=0.9,*/*;q=0.5" } else { "application/json,text/plain;q=0.8,*/*;q=0.5" });
    if let Some(sql) = query { outbound = outbound.query(&[("query", sql)]); }
    let response = outbound.send().await.map_err(|error| format!("{} fetch failed: {error}", request.source))?.error_for_status().map_err(|error| format!("{} returned {error}", request.source))?;
    if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err("Propagation source response was too large".into()); }
    let bytes = response.bytes().await.map_err(|error| format!("{} response failed: {error}", request.source))?;
    if bytes.len() > MAX_RESPONSE_BYTES { return Err("Propagation source response was too large".into()); }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Propagation source returned invalid text".into())
}

async fn fetch_own_rbn(client: &reqwest::Client, request: &FetchRequest) -> Result<String, String> {
    let call = checked_rbn_call(request.own_call.clone())?;
    // Always retrieve the same bounded hour so sidebar/map display windows can
    // share the cycle; freshness is evaluated from each report's source time.
    let age = "3600".to_string();
    let base = "https://www.reversebeacon.net/spots.php";
    let request_once = |hash: Option<&str>| {
        let mut query = vec![("cdx", call.as_str()), ("ma", age.as_str()), ("r", "200"), ("s", "0")];
        if let Some(value) = hash { query.push(("h", value)); }
        client.get(base).query(&query).header("Accept", "application/json")
    };
    let first = request_once(None).send().await.map_err(|error| format!("RBN fetch failed: {error}"))?;
    let first_status = first.status();
    if first.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err("RBN response was too large".into()); }
    let first_bytes = first.bytes().await.map_err(|error| format!("RBN response failed: {error}"))?;
    if first_bytes.len() > MAX_RESPONSE_BYTES { return Err("RBN response was too large".into()); }
    let first_text = String::from_utf8(first_bytes.to_vec()).map_err(|_| "RBN returned invalid text".to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&first_text).map_err(|_| "RBN returned invalid JSON".to_string())?;
    let Some(hash) = rbn_verification_hash(&parsed) else {
        return if first_status.is_success() { Ok(first_text) } else { Err(format!("RBN returned {first_status}")) };
    };
    let response = request_once(Some(hash)).send().await.map_err(|error| format!("RBN fetch failed: {error}"))?.error_for_status().map_err(|error| format!("RBN returned {error}"))?;
    if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err("RBN response was too large".into()); }
    let bytes = response.bytes().await.map_err(|error| format!("RBN response failed: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES { return Err("RBN response was too large".into()); }
    String::from_utf8(bytes.to_vec()).map_err(|_| "RBN returned invalid text".into())
}

fn rbn_verification_hash(payload: &serde_json::Value) -> Option<&str> {
    (payload.get("error").and_then(serde_json::Value::as_u64) == Some(888))
        .then(|| payload.get("ver_h").and_then(serde_json::Value::as_str))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rbn_native_windows_share_one_retained_cycle() {
        let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let jobs: Vec<_> = (0..2).map(|_| {
            let count = count.clone(); let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                tauri::async_runtime::block_on(retained_rbn("FIXTURE/P".into(), || async {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(20));
                    Ok("retained source timestamp".into())
                })).unwrap()
            })
        }).collect();
        for job in jobs { assert_eq!(job.join().unwrap(), "retained source timestamp"); }
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(checked_rbn_call(Some(" om0rx/p ".into())).unwrap(), "OM0RX/P");
        assert!(checked_rbn_call(Some("OM0 RX".into())).is_err());
    }
    #[test]
    fn rbn_late_payload_cannot_replace_newer_retained_reports() {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let previous = serde_json::json!({"spots":{"a":["RX",14025,"OM0RX",0,null,"",0,0,0,1,now]},"call_info":{"RX":[null,null,null,null,null,null,null,null,"JN88AA"]}});
        let incoming = serde_json::json!({"spots":{"a":["RX",14025,"OM0RX",1,null,"",0,0,0,1,now-10]},"call_info":{}});
        let merged: serde_json::Value = serde_json::from_str(&retain_rbn_payload(&previous.to_string(),&incoming.to_string())).unwrap();
        assert_eq!(merged["spots"]["a"][10], now);
        assert_eq!(merged["spots"]["a"][3],0);
        assert_eq!(merged["call_info"]["RX"][8],"JN88AA");
    }
    #[test]
    fn endpoints_are_allowlisted_and_wspr_inputs_are_bounded() {
        let fixed = FetchRequest { source: "swpc_kp".into(), since_seconds: None, bands: None, own_call: None };
        assert_eq!(endpoint(&fixed).unwrap().0, "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
        let wspr = FetchRequest { source: "wspr".into(), since_seconds: Some(9999), bands: Some(vec![14, 7, 14]), own_call: None };
        let (_, sql) = endpoint(&wspr).unwrap(); let sql = sql.unwrap();
        assert!(sql.contains("INTERVAL 3600 SECOND")); assert!(sql.contains("band IN (7,14)"));
        let unknown = FetchRequest { source: "https://example.com".into(), since_seconds: None, bands: None, own_call: None };
        assert!(endpoint(&unknown).is_err());
    }
    #[test]
    fn own_call_is_sanitized_before_entering_clickhouse() {
        assert_eq!(checked_call(Some(" om0rx/p;DROP ".into())).unwrap(), "OM0RX/PDROP");
        assert!(checked_call(Some("x".into())).is_err());
    }
    #[test]
    fn rbn_verification_challenge_is_recognized_without_masking_other_errors() {
        let challenge = serde_json::json!({ "error": 888, "ver_h": "43326f" });
        assert_eq!(rbn_verification_hash(&challenge), Some("43326f"));
        assert_eq!(rbn_verification_hash(&serde_json::json!({ "error": 500, "ver_h": "bad" })), None);
    }
}
