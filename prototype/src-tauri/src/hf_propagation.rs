use serde::Deserialize;
use std::time::Duration;

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
    if call.len() < 3 { return Err("Own callsign is required for WSPR activity".into()); }
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
    if !matches!(window_label, "main" | "hf-propagation-live") {
        return Err("Only the HF propagation surfaces can fetch propagation data".into());
    }
    let (url, query) = endpoint(&request)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(22)).user_agent("OM0RX-xLog/1.2.21 HF-Propagation").build().map_err(|_| "Propagation HTTP client unavailable".to_string())?;
    let mut outbound = client.get(url).header("Accept", if request.source == "pskr" { "application/xml,text/xml;q=0.9,*/*;q=0.5" } else { "application/json,text/plain;q=0.8,*/*;q=0.5" });
    if let Some(sql) = query { outbound = outbound.query(&[("query", sql)]); }
    let response = outbound.send().await.map_err(|error| format!("{} fetch failed: {error}", request.source))?.error_for_status().map_err(|error| format!("{} returned {error}", request.source))?;
    if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err("Propagation source response was too large".into()); }
    let bytes = response.bytes().await.map_err(|error| format!("{} response failed: {error}", request.source))?;
    if bytes.len() > MAX_RESPONSE_BYTES { return Err("Propagation source response was too large".into()); }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Propagation source returned invalid text".into())
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
