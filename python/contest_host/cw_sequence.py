"""Versioned provider-neutral CW sequence, shared by preview and dispatch.

Only declared tokens are controls. Substituted contact values are opaque text;
they are never parsed a second time. This module cannot reserve serials or send.
"""
import re

TOKEN = re.compile(r"\{([^{}]+)\}|#")
SPEED = re.compile(r"WPM:(BASE|[1-9][0-9]?)\Z")
DEFAULTS = {"cwRSTFormat": "5NN", "cwSerialPaddingCharacter": "T",
            "cwSerialPaddingLength": 3, "cwSerialOne": "1", "cwSerialNine": "9", "cwSerialZero": "0"}


def format_serial(value, preferences):
    if not value:
        return ""
    # Missing preview values remain visibly unavailable, never invented numbers.
    if not value.isascii() or not value.isdigit():
        return value
    result = value.lstrip("0")
    result = result.replace("1", preferences["cwSerialOne"]).replace("9", preferences["cwSerialNine"]).replace("0", preferences["cwSerialZero"])
    return result.rjust(preferences["cwSerialPaddingLength"], preferences["cwSerialPaddingCharacter"])


def compile_sequence(template, values, preferences=None):
    preferences = {**DEFAULTS, **(preferences or {})}
    if not isinstance(template, str) or len(template) > 1024:
        raise ValueError("CW template exceeds 1024 characters")
    values = dict(values)
    rst = str(values.get("RST", ""))
    style = preferences["cwRSTFormat"]
    if style == "ENN" and rst == "599":
        rst = "ENN"
    elif style in {"5NN", "ENN"}:
        rst = rst.replace("9", "N")
    values["RST"] = values["SNT"] = rst
    serial = format_serial(str(values.get("SERIAL", values.get("SENTNR", ""))), preferences)
    values["SENTNR"] = format_serial(str(values.get("SENTNR", "")), preferences)
    values["SERIAL"] = serial
    values["PREVNR"] = format_serial(str(values.get("PREVNR", "")), preferences)
    values["HISCALL"] = values.get("CALL", "")
    values["EXCH"] = values.get("EXCHANGE", "")
    segments, used_speed = [], False

    def append(value):
        if not isinstance(value, str) or len(value) > 16384:
            raise ValueError("Invalid CW substitution")
        if value:
            if segments and segments[-1]["kind"] == "text":
                segments[-1]["text"] += value.upper()
            else:
                segments.append({"kind": "text", "text": value.upper()})

    cursor = 0
    for match in TOKEN.finditer(template):
        append(template[cursor:match.start()])
        token = match[1]
        if token is None:
            append(serial)
        elif token.startswith("WPM:"):
            speed = SPEED.fullmatch(token)
            if not speed or speed[1] != "BASE" and not 5 <= int(speed[1]) <= 99:
                raise ValueError("CW speed must be {WPM:5}–{WPM:99} or {WPM:BASE}")
            segments.append({"kind": "restore"} if speed[1] == "BASE" else {"kind": "speed", "wpm": int(speed[1])})
            used_speed = speed[1] != "BASE"
        elif token.startswith("PROSIGN:"):
            value = token[8:]
            if value not in {"AR", "AS", "BT", "SK", "KN"}:
                raise ValueError("Unsupported typed CW prosign")
            segments.append({"kind": "prosign", "value": value})
        elif token in {"LOGIT", "RUN", "SANDP", "WIPE"}:
            pass  # The existing host owns these actions, never this compiler.
        elif token in values:
            value = str(values[token])
            append(value.replace("#", serial) if token in {"EXCHANGE", "EXCH"} else value)
        else:
            raise ValueError(f"Unsupported CW token {{{token}}}")
        cursor = match.end()
    append(template[cursor:])
    if used_speed and (not segments or segments[-1]["kind"] != "restore"):
        segments.append({"kind": "restore"})
    rendered = sequence_text({"segments": segments})
    if len(rendered) > 16384 or len(segments) > 128:
        raise ValueError("CW sequence exceeds its bounded size")
    return {"schema": 1, "segments": segments}


def sequence_text(sequence):
    return "".join(segment["text"] if segment["kind"] == "text" else f"<{segment['value']}>" if segment["kind"] == "prosign" else ""
                   for segment in sequence["segments"])


def action_values(action):
    fields = action.get("fields", {})
    return {"MYCALL": action.get("stationCall", ""), "CALL": fields.get("callsign", ""),
            "RST": fields.get("sent", ""), "EXCHANGE": action.get("sentExchange", ""),
            "SENTNR": action.get("sentSerial", ""), "PREVNR": action.get("previousSerial", ""),
            "OTHER1": fields.get("other_1", ""), "OTHER2": fields.get("other_2", "")}
