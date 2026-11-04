"""Read-only, edition-scoped operating information; QSO evidence is not RF evidence."""
from datetime import datetime, timedelta, timezone
from copy import deepcopy
import hashlib
import json
import re


RULES_URL = "https://cqwpx.com/rules/2026_cqwpx_rules.pdf"
FAQ_URL = "https://cqwpx.com/rules_faq.htm"
PROFILES = {
    "wpx-2026-single-op": {"label": "WPX 2026 Single Operator", "allowanceMinutes": 2160,
                           "minimumOffMinutes": 60},
    "wpx-2026-multi-one": {"label": "WPX 2026 Multi-Single", "bandChangesPerHour": 10},
    "cqww-2026-multi-one": {"label": "CQ WW 2026 Multi-Single", "bandDwellMinutes": 10},
    "wae-2026-single-op": {"label": "WAE 2026 CW/SSB Single Operator", "allowanceMinutes": 2160,
                            "minimumOffMinutes": 60},
    "wae-2026-multi-one": {"label": "WAE 2026 CW/SSB Multi-Single", "bandDwellMinutes": 10},
}
PERIODS = {"cq_wpx_ssb": "2026-03-28", "cq_wpx_cw": "2026-05-30"}
CQWW_PERIODS = {"cq_ww_ssb": "2026-10-24", "cq_ww_cw": "2026-11-28"}
WAE_PERIODS = {"wae_cw": "2026-08-08", "wae_ssb": "2026-09-12"}
SOURCES = {
    "wpx": {"sourceURL": RULES_URL, "interpretationURL": FAQ_URL,
            "sourceDigest": "38dead919408c47483dfdde6a9bd3a9a5e2ae4a54f24b6beba7b4aa2a7f1f624",
            "ruleReferences": ["II Period of Operation", "VI.C.1 Multi-One: 10 changes per UTC clock hour"]},
    "cqww": {"sourceURL": "https://cqww.com/rules/", "interpretationURL": "https://cqww.com/rules/faq.htm",
              "sourceDigest": "4e2f3a2ce732c39ebe215ffa12805a5257e8e7268544b19e02a9d2e485dc8cb6",
              "interpretationDigest": "b77b238ccebb2e9c7a077c7c3d0adac965b1c93e0fe74d0d63b1b6ebb230143f",
              "ruleReferences": ["V.C.1", "FAQ Multi-Single: functional roles and logged whole minutes"]},
    "wae": {"sourceURL": "https://www.darc.de/der-club/referate/conteste/wae-dx-contest/en/wae-rules/",
            "interpretationURL": "https://www.darc.de/der-club/referate/conteste/wae-dx-contest/en/wae-rules/",
            "sourceDigest": "9693e5e843a6bfb054deafe2004d55384c0224a764816c66248f5f13e54c668c",
            "ruleReferences": ["3 Categories: all main-station QSO/QTC/CQ activities", "4 Off Times: no QSO or QTC", "7 QTC Traffic"],
            "displayedRuleEdition": "2025-06-17 / explicit 2026 event dates"},
}
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
    family = "cqww" if profile_id.startswith("cqww-") else "wae" if profile_id.startswith("wae-") else "wpx"
    periods = {"wpx": PERIODS, "cqww": CQWW_PERIODS, "wae": WAE_PERIODS}[family]
    if state.get("pluginID") not in periods:
        return None, "This profile does not cover the selected contest/mode; rules are unverified."
    single = profile_id.endswith("single-op")
    operator = str(settings.get("OperatorCategory", "")).upper()
    transmitter = str(settings.get("TransmitterCategory", "")).upper()
    overlay = str(settings.get("OverlayCategory", "N/A")).upper()
    band = str(settings.get("BandCategory", "")).upper()
    if (single and operator != "SINGLE-OP" or not single and
            (operator != "MULTI-OP" or transmitter != "ONE" or band != "ALL")):
        return None, "Selected rule profile does not match the saved entry category."
    if overlay not in {"N/A", "", "NONE"}:
        return None, "Overlay rules are outside this supported profile; verification is unavailable."
    if single and band not in ({"ALL"} if family == "wae" else {"ALL", *BANDS.values()}):
        return None, "Saved band category is missing or unsupported."
    if family in {"wae", "cqww"} and str(settings.get("PowerCategory", "")).upper() not in {"LOW", "HIGH"}:
        return None, "This timing profile requires the supported LOW or HIGH power category."
    start = _utc(periods[state["pluginID"]] + "T00:00:00Z")
    configured = settings.get("StartDate")
    if not configured or _utc(configured) != start:
        return None, "Saved Start UTC must match this 2026 contest edition."
    return {**profile, "id": profile_id, "edition": "2026", "family": family, "startUTC": _iso(start),
            "endUTCExclusive": _iso(start + timedelta(hours=48)), "sourceURL": RULES_URL,
            "interpretationURL": FAQ_URL, "sourceCheckedUTC": "2026-10-27",
            "categoryBand": band, "scope": "station", "verification": "verified-rule-source",
            **SOURCES.get(family, {}), "sourceCheckedUTC": "2026-11-04"}, None


def validate_plan(plan):
    """Old plans remain byte-shaped; role declarations are explicit, versioned and bounded."""
    if not isinstance(plan, dict) or not {"ruleProfileID", "note"} <= set(plan) or set(plan) - {"ruleProfileID", "note", "schema", "signalRoles"}:
        raise ValueError("Invalid operating plan")
    if plan["ruleProfileID"] not in {"", *PROFILES}:
        raise ValueError("Unsupported operating rule profile; WPX 2027 has no verified published profile")
    if not isinstance(plan["note"], str) or len(plan["note"].encode()) > 4096:
        raise ValueError("Operating note exceeds its limit")
    if "schema" in plan or "signalRoles" in plan:
        if plan.get("schema") != 2 or not isinstance(plan.get("signalRoles"), list) or len(plan["signalRoles"]) > 10000:
            raise ValueError("Invalid signal-role declaration schema")
        seen = set()
        for item in plan["signalRoles"]:
            if not isinstance(item, dict) or set(item) != {"kind", "id", "sourceDigest", "role", "declaredUTC"}:
                raise ValueError("Invalid signal-role declaration")
            if item["kind"] != "qso" or not isinstance(item["id"], str) or not 0 < len(item["id"]) <= 160 or item["id"] in seen:
                raise ValueError("Invalid or duplicate signal-role contact identity")
            if not isinstance(item["sourceDigest"], str) or not re.fullmatch(r"[0-9a-f]{64}", item["sourceDigest"]):
                raise ValueError("Invalid signal-role source digest")
            if item["role"] not in {"run", "multiplier", "main"} or _utc(item["declaredUTC"]) is None:
                raise ValueError("Choose a functional signal role and declaration UTC")
            seen.add(item["id"])
    return deepcopy(plan)


def _row_digest(row):
    # Any timing, band, call or multiplier-fact edit invalidates the old declaration.
    facts = {key: row.get(key) for key in ("ID", "TS", "Band", "Call", "CountryPrefix", "ZN", "Mode")}
    return hashlib.sha256(json.dumps(facts, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _role(row, declarations):
    item = declarations.get(str(row.get("ID", "")))
    return item["role"] if item and item["sourceDigest"] == _row_digest(row) else None


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


def _qtc_activity(state, now, start, end):
    """Stored transfer headers are declarations, including unconfirmed/abandoned traffic.

    Item HHMM is the historical reported QSO, never the QTC transfer time.
    A pending header cannot establish RF, but must not certify an empty minute.
    """
    result, invalid = [], 0
    journal = state.get("qtc", {})
    supplemental = state.get("qtcOperating", {})
    if not isinstance(journal, dict) or journal.get("schema", 1) != 1 or not isinstance(journal.get("batches", []), list):
        return [], 1
    if any(not isinstance(batch, dict) for batch in journal.get("batches", [])):
        return [], 1
    records = [({"timestamp": batch.get("timestamp"), "frequencyHz": batch.get("frequencyHz"),
                 "id": "header:" + str(batch.get("id", ""))}) for batch in journal.get("batches", [])]
    if not isinstance(supplemental, dict) or supplemental and supplemental.get("schema") != 1 or \
            isinstance(supplemental, dict) and any(not isinstance(supplemental.get(key, []), list) for key in ("attempts", "activities")):
        invalid += 1
    else:
        if supplemental.get("activityCoverageComplete") is False:
            invalid += 1
        batches = {batch.get("id"): batch for batch in journal.get("batches", [])}
        for attempt in supplemental.get("attempts", []):
            if not isinstance(attempt, dict):
                invalid += 1
                continue
            batch = batches.get(attempt.get("batchID"), {})
            records.append({"timestamp": attempt.get("requestedUTC"), "frequencyHz": batch.get("frequencyHz"),
                            "id": "attempt:" + str(attempt.get("operationID", ""))})
        for event in supplemental.get("activities", []):
            if not isinstance(event, dict):
                invalid += 1
                continue
            batch = batches.get(event.get("batchID"), {})
            records.append({"timestamp": event.get("atUTC"), "frequencyHz": event.get("frequencyHz", batch.get("frequencyHz")),
                            "id": "activity:" + str(event.get("operationID", ""))})
    for batch in records:
        stamp = _utc(batch.get("timestamp"))
        if stamp is None:
            invalid += 1
        elif start <= stamp < end and stamp <= now:
            frequency = batch.get("frequencyHz")
            band = next((name for lower, upper, name in ((3500000, 4000000, "80M"), (7000000, 7300000, "40M"),
                          (14000000, 14350000, "20M"), (21000000, 21450000, "15M"), (28000000, 29700000, "10M"))
                         if type(frequency) is int and lower <= frequency <= upper), None)
            result.append((stamp, {"ID": "qtc:" + str(batch.get("id", "")), "Band": band,
                                   "activityKind": "qtc", "declaredRole": "main"}))
    return result, invalid


def _dwell(rows, now, family, declarations):
    names = ("run", "multiplier") if family == "cqww" else ("main",)
    clocks = {role: {"role": role, "band": None, "startedUTC": None, "eligibleUTC": None,
                     "remainingSeconds": None, "basis": "logged-whole-UTC-minute" if family == "cqww" else "declared-logged-activity-UTC"}
              for role in names}
    unknown, events = [], []
    countries, zones = {}, {}
    for stamp, row in rows:
        band = _band(row.get("Band"))
        role = row.get("declaredRole") or _role(row, declarations)
        country, zone = str(row.get("CountryPrefix") or "").upper(), str(row.get("ZN") or "")
        known_multiplier = bool(country and zone.isdigit() and 1 <= int(zone) <= 40 and band)
        new_multiplier = known_multiplier and (country not in countries.get(band, set()) or int(zone) not in zones.get(band, set()))
        if known_multiplier:
            countries.setdefault(band, set()).add(country)
            zones.setdefault(band, set()).add(int(zone))
        if not band or role not in {*names, "multiplier"}:
            unknown.append(str(row.get("ID", "")))
            continue
        if family == "wae" and role == "multiplier":
            # A declaration cannot establish the multiplier exception's validity.
            events.append({"id": str(row.get("ID", "")), "role": role, "atUTC": _iso(stamp),
                           "status": "declared-multiplier-exception-unverified"})
            continue
        if family == "cqww" and role == "multiplier" and not new_multiplier:
            events.append({"id": str(row.get("ID", "")), "role": role, "atUTC": _iso(stamp),
                           "status": "not-a-new-multiplier" if known_multiplier else "multiplier-facts-unknown"})
            if not known_multiplier:
                unknown.append(str(row.get("ID", "")))
            continue
        clock = clocks[role]
        at = stamp.replace(second=0, microsecond=0) if family == "cqww" else stamp
        if clock["band"] == band:
            continue
        previous_eligibility = _utc(clock["eligibleUTC"])
        events.append({"id": str(row.get("ID", "")), "role": role, "atUTC": _iso(at),
                       "fromBand": clock["band"], "toBand": band,
                       "status": "early-band-change" if previous_eligibility and at < previous_eligibility else "clock-start",
                       "previousEligibleUTC": clock["eligibleUTC"]})
        clock.update(band=band, startedUTC=_iso(at), eligibleUTC=_iso(at + timedelta(minutes=10)))
    for clock in clocks.values():
        eligible = _utc(clock["eligibleUTC"])
        clock["remainingSeconds"] = max(0, int((eligible - now).total_seconds())) if eligible else None
    return {"limitMinutes": 10, "clocks": list(clocks.values()), "events": events,
            "unknownRoleOrBandIDs": unknown, "complete": not unknown,
            "roleEvidence": "operator-declared-per-source-digest; never radio/lane number",
            "transmissionEvidence": "unknown", "unobservedCQActivity": "unknown" if family == "wae" else None}


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
    declarations = {item["id"]: item for item in plan.get("signalRoles", [])
                    if isinstance(item, dict) and set(item) >= {"id", "sourceDigest", "role"}}
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
              "selectedProfileID": profile_id, "plan": deepcopy(plan) if plan else {"ruleProfileID": "", "note": ""},
              "qsoCount": len(rows), "invalidTimestampQSOs": invalid, "excludedPeriodOrFutureQSOs": outside,
              "lastQsoUTC": _iso(latest),
              "inferredInactivitySeconds": (now - latest).total_seconds() if latest else None,
              "observedOperatingSeconds": None, "observedStyleSeconds": None,
              "observedOperatorSeconds": None, "observedLaneSeconds": None,
              "receiverEvidence": "unknown", "transmissionEvidence": "unknown",
              "durationNote": "QSO gaps infer inactivity. Observed operating/style/operator/lane durations and receiver/TX activity are unavailable.",
              "compliance": "unverified", "offTime": None, "allowance": None, "bandChanges": None,
              "bandDwell": None, "qtcActivityCount": 0, "invalidQTCActivity": 0,
              "roleCandidates": [{"id": str(row.get("ID", "")), "callsign": str(row.get("Call", "")),
                                  "atUTC": _iso(stamp), "band": _band(row.get("Band")),
                                  "sourceDigest": _row_digest(row), "role": _role(row, declarations)} for stamp, row in rows[-100:]],
              "publicationCandidates": [{"id": "wpx-2027", "status": "no-verified-profile",
                  "checkedUTC": "2026-11-04", "sourceURL": "https://cqwpx.com/rules/",
                  "reason": "Official current page and linked rules still identify 2026; no published 2027 edition was verified."}]}
    activity = list(rows)
    if profile and profile["family"] == "wae":
        qtc_rows, invalid_qtc = _qtc_activity(state, now, start, end)
        activity.extend(qtc_rows)
        activity.sort(key=lambda item: (item[0], str(item[1].get("ID", ""))))
        result.update(qtcActivityCount=len(qtc_rows), invalidQTCActivity=invalid_qtc)
        result["durationNote"] += " WAE includes declared QTC headers, prepared/submitted output attempts and operator activity records, even pending/cancelled series; these conservatively interrupt alleged off-time without establishing transmission. Historical item HHMM is not transfer time. Unlogged activity remains unknown."
    if profile and profile_id.endswith("single-op"):
        off = _off_time(activity)
        used, maximum = off["reconstructedOperatingMinutes"], profile["allowanceMinutes"]
        result["offTime"] = off
        off["completeLogTimestamps"] = not invalid and not result["invalidQTCActivity"]
        result["allowance"] = {"limitMinutes": maximum, "reconstructedMinutes": used,
                               "remainingMinutes": max(0, maximum - used),
                               "status": "over-log-limit" if used > maximum else "at-log-limit" if used == maximum else "below-log-limit",
                               "basis": "log-reconstruction-through-last-QSO-minute"}
        if profile["family"] == "wae":
            result["allowance"]["basis"] = "QSO-and-declared-QTC-reconstruction-through-last-activity-minute"
    elif profile and profile["family"] == "wpx":
        result["bandChanges"] = _band_changes(rows)
    elif profile:
        result["bandDwell"] = _dwell(activity, now, profile["family"], declarations)
    return result
