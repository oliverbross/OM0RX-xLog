//! One bounded normal-message compiler; output is the existing TLF/keyer plan.
use serde_json::{json, Value};
use crate::winkeyer::Sequence;

pub fn compile(source: &str, context: &Value, limit: usize, preserve_edges: bool) -> Result<Sequence, String> {
    if source.is_empty() || source.len() > 512 || !(1..=128).contains(&limit) {
        return Err("Use 1–512 template characters within this output's message limit.".into());
    }
    let mut rest = source;
    let mut segments = Vec::new();
    let mut text = String::new();
    let mut speed = false;
    while let Some(start) = rest.find('{') {
        append(&mut text, &rest[..start])?;
        let after = &rest[start + 1..];
        let end = after.find('}').ok_or("Close the CW placeholder with }.")?;
        let token = &after[..end];
        if let Some(value) = token.strip_prefix("WPM:") {
            flush(&mut text, &mut segments);
            if value == "BASE" { segments.push(json!({"kind":"restore"})); speed = false; }
            else {
                if !(1..=2).contains(&value.len()) || !value.bytes().all(|b| b.is_ascii_digit()) { return Err("CW speed must be 5–99 WPM or BASE.".into()); }
                let wpm = value.parse::<u8>().ok().filter(|n| (5..=99).contains(n))
                    .ok_or("CW speed must be 5–99 WPM or BASE.")?;
                segments.push(json!({"kind":"speed","wpm":wpm})); speed = true;
            }
        } else if let Some(value) = token.strip_prefix("PROSIGN:") {
            if !["AR", "AS", "BT", "SK", "KN"].contains(&value) { return Err("Use a supported typed prosign: AR, AS, BT, SK or KN.".into()); }
            flush(&mut text, &mut segments);
            segments.push(json!({"kind":"prosign","value":value}));
        } else {
            if !["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL", "SENTNR", "EXCHANGE"].contains(&token) {
                return Err(format!("Unknown CW placeholder: {{{token}}}."));
            }
            let value = context[token].as_str().unwrap_or("").trim();
            if value.is_empty() { return Err(format!("Fill {token} before sending this message.")); }
            append(&mut text, value)?;
        }
        rest = &after[end + 1..];
    }
    append(&mut text, rest)?;
    flush(&mut text, &mut segments);
    if !preserve_edges {
        if let Some(first) = segments.first_mut().filter(|s| s["kind"] == "text") {
            first["text"] = json!(first["text"].as_str().unwrap().trim_start());
        }
        if let Some(last) = segments.last_mut().filter(|s| s["kind"] == "text") {
            last["text"] = json!(last["text"].as_str().unwrap().trim_end());
        }
        segments.retain(|s| s["kind"] != "text" || s["text"] != "");
    }
    if speed { segments.push(json!({"kind":"restore"})); }
    let count: usize = segments.iter().map(|s| match s["kind"].as_str() {
        Some("text") => s["text"].as_str().unwrap().len(), Some("prosign") => 2, _ => 0,
    }).sum();
    if count == 0 || count > limit { return Err(format!("Expanded CW is {count} characters; this output allows {limit}.")); }
    Sequence::parse(&json!({"schema":1,"segments":segments}))
}

fn append(text: &mut String, value: &str) -> Result<(), String> {
    for byte in value.bytes() {
        if !(byte.is_ascii_alphanumeric() || b" /?=+.,-".contains(&byte)) {
            return Err("Use supported CW characters and typed tokens; raw control bytes are unavailable.".into());
        }
        if byte != b' ' || !text.ends_with(' ') { text.push(byte.to_ascii_uppercase() as char); }
    }
    Ok(())
}
fn flush(text: &mut String, segments: &mut Vec<Value>) {
    if !text.is_empty() { segments.push(json!({"kind":"text","text":std::mem::take(text)})); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compiler_keeps_literal_portable_call_typed_operations_and_restoration() {
        let sequence = compile(" {CALL} {WPM:18}5NN {SERIAL}{WPM:BASE} {PROSIGN:AR} ",
            &json!({"CALL":"ea8/om0rx/p","SERIAL":"TT1"}), 128, false).unwrap();
        assert_eq!(serde_json::to_value(sequence).unwrap(), json!({"schema":1,"segments":[
            {"kind":"text","text":"EA8/OM0RX/P "},{"kind":"speed","wpm":18},
            {"kind":"text","text":"5NN TT1"},{"kind":"restore"},{"kind":"text","text":" "},
            {"kind":"prosign","value":"AR"}]}));
    }
    #[test]
    fn delta_preserves_word_boundaries_and_raw_bytes_cannot_become_commands() {
        let sequence = compile("CQ ", &json!({}), 128, true).unwrap();
        assert_eq!(sequence.text(), "CQ ");
        for invalid in ["CQ\nCQ", "CQ\u{1b}AR", "{WPM:0}CQ", "{PROSIGN:ZZ}", "{CALL}", "{UNKNOWN}", "CQ}"] {
            assert!(compile(invalid,&json!({}),128,false).is_err(), "{invalid}");
        }
        assert!(compile("{CALL}",&json!({"CALL":"CQ{WPM:99}"}),128,false).is_err());
        assert!(compile(&"X".repeat(129),&json!({}),128,false).is_err());
        let sequence=compile("{WPM:15}CQ",&json!({}),128,false).unwrap();
        assert_eq!(serde_json::to_value(sequence).unwrap()["segments"][2],json!({"kind":"restore"}));
    }
}
