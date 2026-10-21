//! Bounded Not1MM-compatible WAV profile loading for contest phone output.
//! Audio is decoded by the in-process webview; this module admits only canonical
//! PCM WAV files beneath the operator-selected profile directory.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_PAYLOAD_BYTES: usize = 4_096;
const MAX_PROFILE_PATH_BYTES: usize = 2_048;
const MAX_SEGMENTS: usize = 128;
const MAX_WAV_BYTES: usize = 8 * 1_024 * 1_024;
const MAX_SEGMENT_DURATION_MS: u64 = 60_000;
const MAX_TOTAL_DURATION_MS: u64 = 120_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    schema_version: u8,
    session_id: String,
    workspace_generation: String,
    draft_id: String,
    action_id: String,
    payload: String,
    payload_sha256: String,
    profile_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSegment {
    name: String,
    wav_base64: String,
    duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedVoice {
    session_id: String,
    workspace_generation: String,
    draft_id: String,
    action_id: String,
    payload_sha256: String,
    segments: Vec<PreparedSegment>,
    total_duration_ms: u64,
}

pub fn validate_invoker(
    label: &str,
    isolated: bool,
    exiting: bool,
    contesting_test: bool,
) -> Result<(), String> {
    if contesting_test {
        return Err(
            "Contest phone audio and PTT are disabled in the Contesting Test profile.".into(),
        );
    }
    if isolated || exiting || label != "main" {
        return Err(
            "Contest phone output is available only from the active production contest owner."
                .into(),
        );
    }
    Ok(())
}

pub fn prepare(
    request: PrepareRequest,
    active_session: &str,
    active_workspace: &str,
) -> Result<PreparedVoice, String> {
    validate_request(&request, active_session, active_workspace)?;
    let profile = canonical_profile(&request.profile_path)?;
    let names = wav_names(&request.payload)?;
    let mut total_duration_ms = 0_u64;
    let mut segments = Vec::with_capacity(names.len());
    for name in names {
        let path = admitted_wav_path(&profile, &name)?;
        let bytes =
            fs::read(&path).map_err(|_| format!("Voice WAV {name}.wav could not be read."))?;
        if bytes.len() > MAX_WAV_BYTES {
            return Err(format!(
                "Voice WAV {name}.wav exceeds the 8 MiB safety limit."
            ));
        }
        let duration_ms = pcm_wav_duration_ms(&bytes)?;
        if duration_ms > MAX_SEGMENT_DURATION_MS {
            return Err(format!(
                "Voice WAV {name}.wav exceeds the 60 second safety limit."
            ));
        }
        total_duration_ms = total_duration_ms
            .checked_add(duration_ms)
            .ok_or("Voice WAV duration overflow")?;
        if total_duration_ms > MAX_TOTAL_DURATION_MS {
            return Err("The resolved voice message exceeds the two minute safety limit.".into());
        }
        segments.push(PreparedSegment {
            name,
            wav_base64: STANDARD.encode(bytes),
            duration_ms,
        });
    }
    Ok(PreparedVoice {
        session_id: request.session_id,
        workspace_generation: request.workspace_generation,
        draft_id: request.draft_id,
        action_id: request.action_id,
        payload_sha256: request.payload_sha256,
        segments,
        total_duration_ms,
    })
}

fn validate_request(
    request: &PrepareRequest,
    active_session: &str,
    active_workspace: &str,
) -> Result<(), String> {
    if request.schema_version != 1
        || uuid::Uuid::parse_str(&request.session_id).is_err()
        || uuid::Uuid::parse_str(&request.workspace_generation).is_err()
        || uuid::Uuid::parse_str(&request.draft_id).is_err()
        || request.session_id != active_session
        || request.workspace_generation != active_workspace
    {
        return Err(
            "The contest voice request belongs to a stale or invalid contest context.".into(),
        );
    }
    let (operation, index) = request
        .action_id
        .rsplit_once(':')
        .ok_or("Invalid contest voice action identity")?;
    if uuid::Uuid::parse_str(operation).is_err()
        || index.parse::<usize>().ok().is_none_or(|value| value >= 12)
    {
        return Err("Invalid contest voice action identity".into());
    }
    if request.payload.as_bytes().len() > MAX_PAYLOAD_BYTES
        || request.payload_sha256.len() != 64
        || !request
            .payload_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("Invalid contest voice payload".into());
    }
    let actual = format!("{:x}", Sha256::digest(request.payload.as_bytes()));
    if actual != request.payload_sha256 {
        return Err("The contest voice payload digest does not match the claimed output.".into());
    }
    Ok(())
}

fn canonical_profile(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.as_bytes().len() > MAX_PROFILE_PATH_BYTES {
        return Err("Choose a bounded voice WAV profile folder in Contest Sound settings.".into());
    }
    let path = fs::canonicalize(value)
        .map_err(|_| "The voice WAV profile folder is unavailable.".to_string())?;
    if !path.is_dir() {
        return Err("The selected voice WAV profile is not a folder.".into());
    }
    Ok(path)
}

fn admitted_wav_path(profile: &Path, name: &str) -> Result<PathBuf, String> {
    let candidate = profile.join(format!("{name}.wav"));
    let canonical = fs::canonicalize(&candidate)
        .map_err(|_| format!("Voice WAV {name}.wav is missing from the selected profile."))?;
    if canonical.parent() != Some(profile) || !canonical.is_file() {
        return Err(format!(
            "Voice WAV {name}.wav escapes the selected profile."
        ));
    }
    Ok(canonical)
}

fn wav_names(payload: &str) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let lowercase = payload.to_lowercase();
    let mut chars = lowercase.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '[' {
            let mut name = String::new();
            loop {
                match chars.next() {
                    Some(']') => break,
                    Some(value) if value.is_ascii_lowercase() || value.is_ascii_digit() || matches!(value, '_' | '-') => {
                        name.push(value);
                        if name.len() > 64 { return Err("A bracketed voice WAV name is too long.".into()); }
                    }
                    _ => return Err("Bracketed voice WAV names may contain only lowercase letters, digits, dash and underscore.".into()),
                }
            }
            if name.is_empty() {
                return Err("A bracketed voice WAV name cannot be empty.".into());
            }
            names.push(name);
        } else if character.is_ascii_lowercase() || character.is_ascii_digit() {
            names.push(character.to_string());
        } else if character == ' ' {
            names.push("space".into());
        }
        if names.len() > MAX_SEGMENTS {
            return Err("The resolved voice message has too many WAV segments.".into());
        }
    }
    if names.is_empty() {
        return Err("The voice message did not resolve to any recorded WAV segments.".into());
    }
    Ok(names)
}

fn pcm_wav_duration_ms(bytes: &[u8]) -> Result<u64, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Voice profile files must be RIFF/WAVE audio.".into());
    }
    let mut offset = 12_usize;
    let mut format: Option<(u16, u16, u32, u32, u16)> = None;
    let mut data_bytes: Option<u32> = None;
    while offset.checked_add(8).is_some_and(|end| end <= bytes.len()) {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start.checked_add(size).ok_or("Invalid WAV chunk size")?;
        if end > bytes.len() {
            return Err("Voice WAV contains a truncated chunk.".into());
        }
        if id == b"fmt " {
            if size < 16 {
                return Err("Voice WAV has an invalid format chunk.".into());
            }
            format = Some((
                u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap()),
                u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()),
                u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()),
                u32::from_le_bytes(bytes[start + 8..start + 12].try_into().unwrap()),
                u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()),
            ));
        } else if id == b"data" {
            data_bytes = Some(size as u32);
        }
        offset = end + (size & 1);
    }
    let (encoding, channels, sample_rate, byte_rate, bits) =
        format.ok_or("Voice WAV is missing its format chunk.")?;
    let data_bytes = data_bytes
        .filter(|value| *value > 0)
        .ok_or("Voice WAV has no audio data.")?;
    let expected_rate = u64::from(sample_rate) * u64::from(channels) * u64::from(bits) / 8;
    if encoding != 1
        || !(1..=2).contains(&channels)
        || !(8_000..=192_000).contains(&sample_rate)
        || !matches!(bits, 8 | 16 | 24 | 32)
        || byte_rate == 0
        || u64::from(byte_rate) != expected_rate
    {
        return Err(
            "Voice WAV must be mono/stereo PCM at 8–192 kHz with a valid byte rate.".into(),
        );
    }
    Ok((u64::from(data_bytes) * 1_000).div_ceil(u64::from(byte_rate)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SESSION: &str = "10000000-0000-4000-8000-000000000001";
    const WORKSPACE: &str = "20000000-0000-4000-8000-000000000002";
    const DRAFT: &str = "30000000-0000-4000-8000-000000000003";
    const OPERATION: &str = "40000000-0000-4000-8000-000000000004";

    fn wav(milliseconds: u32) -> Vec<u8> {
        let byte_rate = 8_000_u32 * 2;
        let data_len = byte_rate * milliseconds / 1_000;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.resize(bytes.len() + data_len as usize, 0);
        bytes
    }

    fn request(profile: &Path, payload: &str) -> PrepareRequest {
        PrepareRequest {
            schema_version: 1,
            session_id: SESSION.into(),
            workspace_generation: WORKSPACE.into(),
            draft_id: DRAFT.into(),
            action_id: format!("{OPERATION}:0"),
            payload: payload.into(),
            payload_sha256: format!("{:x}", Sha256::digest(payload.as_bytes())),
            profile_path: profile.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn resolves_not1mm_character_and_bracket_wavs_in_order() {
        let profile = tempfile::tempdir().unwrap();
        for name in ["c", "q", "space", "again"] {
            fs::File::create(profile.path().join(format!("{name}.wav")))
                .unwrap()
                .write_all(&wav(100))
                .unwrap();
        }
        let prepared = prepare(request(profile.path(), "CQ [again]"), SESSION, WORKSPACE).unwrap();
        assert_eq!(
            prepared
                .segments
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["c", "q", "space", "again"]
        );
        assert_eq!(prepared.total_duration_ms, 400);
    }

    #[test]
    fn stale_context_digest_missing_or_malformed_audio_fail_closed() {
        let profile = tempfile::tempdir().unwrap();
        fs::write(profile.path().join("c.wav"), wav(100)).unwrap();
        assert!(prepare(
            request(profile.path(), "c"),
            "50000000-0000-4000-8000-000000000005",
            WORKSPACE
        )
        .unwrap_err()
        .contains("stale"));
        let mut bad_digest = request(profile.path(), "c");
        bad_digest.payload_sha256 = "0".repeat(64);
        assert!(prepare(bad_digest, SESSION, WORKSPACE)
            .unwrap_err()
            .contains("digest"));
        assert!(prepare(request(profile.path(), "cq"), SESSION, WORKSPACE)
            .unwrap_err()
            .contains("q.wav is missing"));
        fs::write(profile.path().join("q.wav"), b"not wave").unwrap();
        assert!(prepare(request(profile.path(), "cq"), SESSION, WORKSPACE)
            .unwrap_err()
            .contains("RIFF/WAVE"));
    }

    #[test]
    fn test_profile_and_non_owner_never_admit_io() {
        assert!(validate_invoker("main", false, false, true)
            .unwrap_err()
            .contains("disabled"));
        assert!(validate_invoker("contest--active-qso", false, false, false).is_err());
        assert!(validate_invoker("main", true, false, false).is_err());
        assert!(validate_invoker("main", false, true, false).is_err());
        assert!(validate_invoker("main", false, false, false).is_ok());
    }
}
