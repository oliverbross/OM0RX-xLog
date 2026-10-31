//! HM Control is a display of existing owners, never another station session.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

pub fn validate(label: &str) -> Result<(), String> {
    if label == "hm-control" { Ok(()) } else { Err("HM Control data belongs to its display window.".into()) }
}

pub fn snapshot(app: &tauri::AppHandle, isolated: bool) -> Result<Value, String> {
    let context = if isolated { crate::map_context::acceptance_snapshot()? } else { crate::map_context::snapshot(app)? };
    let generation = crate::worker::generation();
    let id = uuid::Uuid::new_v4().to_string();
    let response = crate::worker::request_existing(json!({"id":id,"method":"hm_control_logbook","params":{}}))?;
    if response["id"] != id || response["ok"] != true || crate::worker::generation() != generation
        || response["result"]["generation"] != context["metadata"]["generation"] {
        return Err("HM Control workspace changed; reconnecting to the current log.".into());
    }
    Ok(json!({"context":context,"log":response["result"],"offline":isolated}))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeedRequest { pub feed: String, pub latitude: Option<f64>, pub longitude: Option<f64> }

fn feed_url(request: &FeedRequest) -> Result<(String, Duration), String> {
    let lifetime = Duration::from_secs(900);
    let coordinates = || -> Result<(f64, f64), String> {
        match (request.latitude, request.longitude) {
            (Some(lat), Some(lon)) if lat.is_finite() && lon.is_finite() && lat.abs() <= 90.0 && lon.abs() <= 180.0 => Ok((lat,lon)),
            _ => Err("A valid station location is required.".into()),
        }
    };
    match request.feed.as_str() {
        "satellites" => Ok(("https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle".into(), Duration::from_secs(21600))),
        "sfi" => Ok(("https://services.swpc.noaa.gov/json/f107_cm_flux.json".into(), lifetime)),
        "kp" => Ok(("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json".into(), lifetime)),
        "xray" => Ok(("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json".into(), lifetime)),
        "weather" => { let (lat,lon) = coordinates()?; Ok((format!("https://api.open-meteo.com/v1/forecast?latitude={lat:.4}&longitude={lon:.4}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=1"), lifetime)) },
        "alerts" => { let (lat,lon) = coordinates()?; Ok((format!("https://api.weather.gov/alerts/active?point={lat:.4},{lon:.4}"), lifetime)) },
        _ => Err("Unknown HM Control public feed.".into()),
    }
}

type FeedCache = Mutex<HashMap<String, (Instant, String)>>;
static CACHE: OnceLock<FeedCache> = OnceLock::new();
pub async fn fetch(request: FeedRequest) -> Result<String, String> {
    crate::runtime_profile::require_external_io_disabled()?;
    let (url, lifetime) = feed_url(&request)?;
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((at, value)) = cache.lock().map_err(|_| "Public feed cache unavailable")?.get(&url) {
        if at.elapsed() < lifetime { return Ok(value.clone()); }
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none()).user_agent("OM0RX-xLog HM-Control (github.com/oliverbross/OM0RX-xLog)")
        .build().map_err(|_| "Public feed client unavailable")?;
    let mut response = client.get(&url).send().await.map_err(|_| "Public feed unavailable; retrying on its normal schedule")?
        .error_for_status().map_err(|_| "Public feed returned an error")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Public feed download failed")? {
        if bytes.len() + chunk.len() > 2_000_000 { return Err("Public feed exceeded its display limit".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let value = String::from_utf8(bytes).map_err(|_| "Public feed encoding unavailable")?;
    let mut retained = cache.lock().map_err(|_| "Public feed cache unavailable")?;
    if retained.len() >= 32 { retained.clear(); }
    retained.insert(url, (Instant::now(), value.clone()));
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn display_role_is_exact() {
        assert!(validate("hm-control").is_ok());
        for role in ["main", "world-map", "contest--hm-control", "", "unknown"] { assert!(validate(role).is_err()); }
    }
    #[test] fn public_feed_never_accepts_an_arbitrary_url_or_bad_coordinates() {
        for feed in ["http://localhost:8088", "file:///etc/passwd", "https://services.swpc.noaa.gov/"] {
            assert!(feed_url(&FeedRequest { feed:feed.into(), latitude:None, longitude:None }).is_err());
        }
        for latitude in [None, Some(f64::NAN), Some(91.0)] {
            assert!(feed_url(&FeedRequest { feed:"weather".into(), latitude, longitude:Some(0.0) }).is_err());
        }
        let (url, ttl) = feed_url(&FeedRequest { feed:"weather".into(), latitude:Some(48.0), longitude:Some(19.0) }).unwrap();
        assert!(url.starts_with("https://api.open-meteo.com/v1/forecast?")); assert_eq!(ttl.as_secs(), 900);
    }
}
