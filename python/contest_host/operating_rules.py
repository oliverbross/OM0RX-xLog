"""Read-only, edition-scoped operating information; QSO evidence is not RF evidence."""
from datetime import datetime, timedelta, timezone


RULES_URL = "https://cqwpx.com/rules/2026_cqwpx_rules.pdf"
FAQ_URL = "https://cqwpx.com/rules_faq.htm"
PROFILES = {
    "wpx-2026-single-op": {"label": "WPX 2026 Single Operator", "allowanceMinutes": 2160,
                           "minimumOffMinutes": 60},
    "wpx-2026-multi-one": {"label": "WPX 2026 Multi-Single", "bandChangesPerHour": 10},
}
PERIODS = {"cq_wpx_ssb": "2026-03-28", "cq_wpx_cw": "2026-05-30"}
BANDS = {"1.8": "160M", "3.5": "80M", "7": "40M", "14": "20M", "21": "15M", "28": "10M"}


def _utc(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        # Store timestamps are explicitly UTC, even though upstream omits the suffix.
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _iso(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _band(value):
    text = str(value).upper()
    if text in BANDS.values():
        return text
    try:
        return BANDS.get(format(float(text), "g"))
    except ValueError:
        return None


def _profile(state, profile_id):
    settings = state.get("settings", {})
    profile = PROFILES.get(profile_id) if isinstance(profile_id, str) else None
    if not profile:
        return None, "Select an identified rule edition/category; rules are unverified."
    if state.get("pluginID") not in PERIODS:
        return None, "This profile covers WPX 2026 CW/SSB only; selected contest is unverified."
    single = profile_id == "wpx-2026-single-op"
    operator = str(settings.get("OperatorCategory", "")).upper()
    transmitter = str(settings.get("TransmitterCategory", "")).upper()
    overlay = str(settings.get("OverlayCategory", "N/A")).upper()
    band = str(settings.get("BandCategory", "")).upper()
    if (single and operator != "SINGLE-OP" or not single and
            (operator != "MULTI-OP" or transmitter != "ONE" or band != "ALL")):
        return None, "Selected rule profile does not match the saved entry category."
    if overlay not in {"N/A", "", "NONE"}:
        return None, "Overlay rules are outside this supported profile; verification is unavailable."
    if single and band not in {"ALL", *BANDS.values()}:
        return None, "Saved band category is missing or unsupported."
    start = _utc(PERIODS[state["pluginID"]] + "T00:00:00Z")
    configured = settings.get("StartDate")
    if not configured or _utc(configured) != start:
        return None, "Saved Start UTC must match this 2026 contest edition."
    return {**profile, "id": profile_id, "edition": "2026", "startUTC": _iso(start),
            "endUTCExclusive": _iso(start + timedelta(hours=48)), "sourceURL": RULES_URL,
            "interpretationURL": FAQ_URL, "sourceCheckedUTC": "2026-10-27",
            "categoryBand": band, "scope": "station", "verification": "verified-rule-source"}, None


def _off_time(rows):
    """Whole occupied minutes, less >=60 consecutive empty minutes between QSOs.

    Only the bounded first/last QSO span is reconstructed. The open tail is
    inactivity, never an asserted off-air interval or a running allowance clock.
    """
    minutes = sorted({int(stamp.timestamp() // 60) for stamp, _row in rows})
    gaps = []
    for left, right in zip(minutes, minutes[1:]):
        empty = right - left - 1
        if empty:
            gaps.append({"startUTC": _iso(datetime.fromtimestamp((left + 1) * 60, timezone.utc)),
                         "endUTCExclusive": _iso(datetime.fromtimestamp(right * 60, timezone.utc)),
                         "emptyMinutes": empty, "qualifiesLogCriterion": empty >= 60})
    off = sum(gap["emptyMinutes"] for gap in gaps if gap["qualifiesLogCriterion"])
    span = minutes[-1] - minutes[0] + 1 if minutes else 0
    return {"basis": "whole-UTC-clock-minutes-through-last-QSO-minute", "minimumOffMinutes": 60,
            "qualifyingLogOffMinutes": off, "reconstructedOperatingMinutes": span - off,
            "gaps": gaps, "observedOffAirMinutes": None}


def _band_changes(rows):
    counts, changes, previous = {}, [], None
    unknown = 0
    # A same-time multi-band pair has no defensible ordering from this evidence.
    groups = {}
    for stamp, row in rows:
        groups.setdefault(stamp, []).append(row)
    for stamp, group in groups.items():
        bands = {_band(row.get("Band")) for row in group}
        if None in bands or len(bands) != 1:
            unknown += len(group)
            previous = None
            continue
        current = next(iter(bands))
        if previous and current != previous:
            hour = _iso(stamp.replace(minute=0, second=0, microsecond=0))
            counts[hour] = counts.get(hour, 0) + 1
            changes.append({"atUTC": _iso(stamp), "fromBand": previous, "toBand": current,
                            "qsoIDs": [str(row.get("ID", "")) for row in group]})
        previous = current
    hours = [{"hourUTC": hour, "changes": count, "limit": 10,
              "status": "over-log-limit" if count > 10 else "at-log-limit" if count == 10 else "below-log-limit"}
             for hour, count in counts.items()]
    return {"basis": "QSO-observed-band-changes-per-UTC-clock-hour", "limit": 10,
            "hours": hours, "changes": changes, "unknownOrderOrBandQSOs": unknown,
            "transmissionEvidence": "unknown", "modeChangesCounted": False,
            "complete": unknown == 0}


def calculate(desk, params):
    """Calculate from the current scoped log; caller supplies the evaluation UTC.

    Params never supply authoritative observations. No caches, writes, clock
    changes, network calls, score corrections or claims of general compliance.
    """
    now = _utc(params.get("now"))
    if now is None:
        raise ValueError("Operating information requires a valid evaluation UTC timestamp")
    state = desk.state
    plan = state.get("operatingPlan") or {}
    profile_id = params.get("profileID", plan.get("ruleProfileID", ""))
    profile, reason = _profile(state, profile_id)
    rows, invalid, outside = [], 0, 0
    start = _utc(profile["startUTC"]) if profile else None
    end = _utc(profile["endUTCExclusive"]) if profile else None
    for row in desk.database.fetch_all_contacts_asc():
        stamp = _utc(row.get("TS"))
        if stamp is None:
            invalid += 1
        elif stamp > now or start and not start <= stamp < end:
            outside += 1
        else:
            rows.append((stamp, row))
    rows.sort(key=lambda item: (item[0], str(item[1].get("ID", ""))))
    latest = rows[-1][0] if rows else None
    result = {"evaluationUTC": _iso(now), "profile": profile, "unverifiedReason": reason,
              "availableProfiles": [{"id": key, "label": value["label"]} for key, value in PROFILES.items()],
              "selectedProfileID": profile_id, "plan": {"ruleProfileID": plan.get("ruleProfileID", ""),
                                                         "note": str(plan.get("note", ""))},
              "qsoCount": len(rows), "invalidTimestampQSOs": invalid, "excludedPeriodOrFutureQSOs": outside,
              "lastQsoUTC": _iso(latest),
              "inferredInactivitySeconds": (now - latest).total_seconds() if latest else None,
              "observedOperatingSeconds": None, "observedStyleSeconds": None,
              "observedOperatorSeconds": None, "observedLaneSeconds": None,
              "receiverEvidence": "unknown", "transmissionEvidence": "unknown",
              "durationNote": "QSO gaps infer inactivity. Observed operating/style/operator/lane durations and receiver/TX activity are unavailable.",
              "compliance": "unverified", "offTime": None, "allowance": None, "bandChanges": None}
    if profile and profile_id == "wpx-2026-single-op":
        off = _off_time(rows)
        used, maximum = off["reconstructedOperatingMinutes"], profile["allowanceMinutes"]
        result["offTime"] = off
        result["allowance"] = {"limitMinutes": maximum, "reconstructedMinutes": used,
                               "remainingMinutes": max(0, maximum - used),
                               "status": "over-log-limit" if used > maximum else "at-log-limit" if used == maximum else "below-log-limit",
                               "basis": "log-reconstruction-through-last-QSO-minute"}
    elif profile:
        result["bandChanges"] = _band_changes(rows)
    return result
