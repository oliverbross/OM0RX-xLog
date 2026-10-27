"""Reviewed WAE callbacks for the existing Desk and transaction owner.

Manual QTC accounting never calls a station/output transport. A confirmation is
an operator acknowledgement, not evidence of RF delivery or organizer acceptance.
"""
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
from importlib import import_module
import re

PLUGINS = frozenset({"wae_cw", "wae_ssb", "wae_rtty"})
RULE_EDITION = "DARC 2025-06-17 / 2026 event dates"
WAE_EU = frozenset("1A0 3A 4O 4U1I 4U1V 9A 9H C3 CT CU DL E7 EA EA6 EI ER ES EU F G GD GI GJ GM GM/s GU GW HA HB HB0 HV I IS IT JW JW/b JX LA LX LY LZ OE OH OH0 OJ0 OK OM ON OY OZ PA R1F RA RA2 S5 SM SP SV SV/A SV5 SV9 T7 TA1 TF TK UR YL YO YU Z6 Z3 ZA ZB".split())
AREA_COUNTRIES = frozenset({"K", "VE", "VK", "ZL", "ZS", "JA", "BY", "PY"})


def european(info, call=""):
    prefix = str(info.get("primary_pfx", "")).lstrip("*")
    prefix = {"UA": "RA", "UA2": "RA2"}.get(prefix, prefix)
    if prefix in {"I", "IS", "IT"} and info.get("cq") == 33:
        return False
    if prefix == "TA":
        return bool(re.match(r"(?:TA|TB|TC|YM)1", call))
    return prefix in WAE_EU


def identity(state, call):
    return state["reference"]["countries"].get(call, {})


def multiplier(state, row):
    info = identity(state, row["Call"])
    prefix = str(row.get("CountryPrefix") or info.get("primary_pfx", ""))
    if not prefix:
        return None
    if european(info, row["Call"]):
        return {"TA": "TA1", "UA": "RA", "UA2": "RA2"}.get(prefix.lstrip("*"), prefix.lstrip("*"))
    match = re.search(r"\d", row["Call"])
    area = match.group() if match else None
    portable = re.search(r"/(\d)(?:/|$)", row["Call"])
    if portable:
        area = portable.group(1)
    if prefix in AREA_COUNTRIES:
        return prefix + area if area is not None else None
    if prefix in {"UA9", "RA", "UA"} and area in {"8", "9", "0"}:
        return "RA" + area
    return prefix


def qso_eligible(state, row):
    own, other = identity(state, state["station"]["Call"]), identity(state, row["Call"])
    if not own or not other:
        return False
    return state["pluginID"] == "wae_rtty" or european(own, state["station"]["Call"]) != european(other, row["Call"])


def qso_credits(state, rows):
    seen, keys, points = set(), set(), 0
    credits = {}
    for row in rows:
        key = (row["Call"], row["Band"])
        multi = multiplier(state, row)
        fresh = multi is not None and (row["Band"], multi) not in keys
        credits[row["ID"]] = 0
        if key not in seen and qso_eligible(state, row):
            if str(row["NR"]).isdigit() and (int(row["NR"]) > 0 or fresh):
                points += 1
                credits[row["ID"]] = 1
                if multi is not None:
                    keys.add((row["Band"], multi))
        seen.add(key)
    return keys, points, credits


def score(desk):
    rows = desk.database.fetch_all_contacts_asc()
    keys, points, _ = qso_credits(desk.state, rows)
    weighted = sum(4 if band == 3.5 else 3 if band == 7 else 2 for band, _ in keys)
    qtcs = sum(item["status"] == "confirmed" for batch in batches(desk.state) for item in batch["items"])
    unknown = not identity(desk.state, desk.state["station"]["Call"]) or any(not identity(desk.state, row["Call"]) or multiplier(desk.state, row) is None for row in rows)
    return {"qsos": len(rows), "points": points, "qtcPoints": qtcs, "countries": len(keys), "zones": 0,
            "multipliers": weighted, "total": (points + qtcs) * weighted,
            "scoringComplete": not unknown, "scoringLimitation": "Unresolved WAE country/call-area evidence" if unknown else "",
            "ruleEdition": RULE_EDITION}


def plugin(plugin_id, base):
    """Reuse the proven serial entry/ESM callbacks; replace contest rules only."""
    value = SimpleNamespace(**{key: val for key, val in vars(base).items() if not key.startswith("__")})
    value.name = "WAE " + plugin_id[4:].upper()
    value.cabrillo_name = "WAE-DX-" + plugin_id[4:].upper()
    value.mode = plugin_id[4:].upper()
    def set_contact_vars(desk):
        desk.contact.update(SNT=desk.sent.text(), RCV=desk.receive.text(), SentNr=desk.other_1.text(), NR=desk.other_2.text(), IsMultiplier1=0)
    value.set_contact_vars = set_contact_vars
    value.points = lambda desk: qso_credits(desk.state, [*desk.database.fetch_all_contacts_asc(), desk.contact])[2].get(desk.contact["ID"], 0)
    value.recalculate_mults = lambda desk: None
    value.show_mults = lambda desk: score(desk)["multipliers"]
    value.calc_score = lambda desk: score(desk)["total"]
    value.adif = lambda desk: import_module("not1mm.lib.plugin_common").gen_adif(desk, value.cabrillo_name, value.cabrillo_name)
    return value


def batches(state):
    value = state.get("qtc", {"schema": 1, "batches": []})
    if not isinstance(value, dict) or value.get("schema") != 1 or not isinstance(value.get("batches"), list):
        raise ValueError("Saved QTC journal is unreadable; preserve it before recovery")
    result = value["batches"]
    valid = len(result) <= 500
    identities = set()
    for batch in result:
        if not isinstance(batch, dict):
            valid = False
            break
        valid = valid and isinstance(batch.get("id"), str) and batch["id"] not in identities
        identities.add(batch.get("id"))
        valid = valid and batch.get("direction") in {"send", "receive"} and batch.get("status") in {"open", "cancelled"}
        valid = valid and type(batch.get("number")) is int and type(batch.get("count")) is int and 1 <= batch["count"] <= 10
        valid = valid and isinstance(batch.get("items"), list) and len(batch["items"]) == batch["count"]
        valid = valid and isinstance(batch.get("counterpart"), str) and isinstance(batch.get("timestamp"), str) and type(batch.get("frequencyHz")) is int
        for item in batch.get("items", []):
            valid = valid and isinstance(item, dict) and item.get("status") in {"pending", "confirmed"}
            valid = valid and all(isinstance(item.get(key), str) for key in ("time", "callsign", "serial"))
            valid = valid and isinstance(item.get("repeats"), list) and len(item["repeats"]) <= 100
    if not valid:
        raise ValueError("Saved QTC journal is unreadable; preserve it before recovery")
    return deepcopy(result)


def eligibility(state, counterpart, direction):
    own, other = identity(state, state["station"]["Call"]), identity(state, counterpart)
    if not own or not other or not own.get("continent") or not other.get("continent"):
        return "Resolve both station continents/countries before QTC exchange"
    if counterpart == state["station"]["Call"]:
        return "Cannot exchange QTCs with the same station"
    if state["pluginID"] == "wae_rtty":
        return "RTTY QTCs require different continents" if own["continent"] == other["continent"] else None
    if european(own, state["station"]["Call"]) == european(other, counterpart):
        return "CW/SSB QTCs require a WAE European and a non-European participant"
    if (direction == "receive") != european(own, state["station"]["Call"]):
        return "CW/SSB European stations receive QTCs; non-European stations send"
    return None


def available(desk, counterpart):
    # Even cancelled, unacknowledged items remain reserved until explicitly
    # reconciled. A lost acknowledgement never silently licenses another send.
    used = {item["sourceQSOID"] for batch in batches(desk.state) if batch["direction"] == "send"
            for item in batch["items"] if item.get("sourceQSOID")}
    rows, seen, eligible = desk.database.fetch_all_contacts_asc(), set(), []
    for row in rows:
        key = (row["Call"], row["Band"])
        if key not in seen:
            eligible.append(row)
        seen.add(key)
    return [{"sourceQSOID": row["ID"], "time": row["TS"][11:16].replace(":", ""),
             "callsign": row["Call"], "serial": str(row["NR"])}
            for row in eligible
            if row["ID"] not in used and row["Call"] != counterpart and qso_eligible(desk.state, row)
            and str(row["NR"]).isdigit() and int(row["NR"]) > 0]


def projection(desk, params):
    if desk.state["pluginID"] not in PLUGINS:
        return {"available": False, "reason": "QTC accounting requires a WAE contest definition", "batches": []}
    counterpart = str(params.get("counterpart", "")).strip().upper()
    direction = params.get("direction", "receive")
    return {"available": True, "ruleEdition": RULE_EDITION, "batches": batches(desk.state), "score": score(desk),
            "eligibility": eligibility(desk.state, counterpart, direction), "eligibleSources": available(desk, counterpart),
            "output": "Manual acknowledgement only; no output transport is armed"}


def mutate(desk, params, require):
    state = desk.state
    require(state["pluginID"] in PLUGINS, "Select a WAE definition before recording QTCs")
    journal = batches(state)
    action = params["action"]
    if action == "qtc_create":
        require(len(journal) < 500, "QTC journal capacity reached; preserve this log")
        require(isinstance(params.get("counterpart"), str), "Enter a QTC counterpart")
        counterpart = params["counterpart"].strip().upper()
        direction = params.get("direction")
        require(direction in {"send", "receive"}, "Choose QTC direction")
        reason = eligibility(state, counterpart, direction)
        require(reason is None, reason or "QTC counterpart is ineligible")
        batch_id, number = params.get("batchID"), params.get("number")
        require(isinstance(batch_id, str) and re.fullmatch(r"[A-Za-z0-9-]{1,64}", batch_id) is not None, "Invalid QTC batch identity")
        require(type(number) is int and 1 <= number <= 99999, "QTC series number must be positive")
        require(not any(batch["id"] == batch_id or (batch["direction"] == direction and batch["number"] == number and
                    (direction == "send" or batch["counterpart"] == counterpart)) for batch in journal), "QTC series identity already exists")
        items = params.get("items")
        require(isinstance(items, list) and 1 <= len(items) <= 10, "A QTC series contains one to ten items")
        existing = sum(len(batch["items"]) for batch in journal if batch["counterpart"] == counterpart)
        require(existing + len(items) <= 10, "The combined sent/received counterpart quota is ten, including unresolved items")
        if direction == "send":
            sources = {row["sourceQSOID"]: row for row in available(desk, counterpart)}
            require(all(isinstance(item, dict) and set(item) == {"sourceQSOID"} and item["sourceQSOID"] in sources for item in items),
                    "A selected source is already reserved, duplicate, ineligible or the counterpart")
            require(len({item["sourceQSOID"] for item in items}) == len(items), "Repeated QTC source")
            items = [sources[item["sourceQSOID"]] for item in items]
        else:
            for item in items:
                require(isinstance(item, dict) and set(item) == {"time", "callsign", "serial"}, "Enter time/call/serial for each received QTC")
                require(isinstance(item["time"], str) and re.fullmatch(r"(?:[01]\d|2[0-3])[0-5]\d", item["time"]) is not None, "QTC time must be HHMM UTC")
                require(isinstance(item["callsign"], str) and re.fullmatch(r"[A-Z0-9/]{3,32}", item["callsign"]) is not None, "Invalid QTC callsign")
                require(item["callsign"] != state["station"]["Call"], "QTC cannot report the receiving station")
                require(isinstance(item["serial"], str) and item["serial"].isdigit() and 0 < int(item["serial"]) <= 999999999, "Invalid QTC serial")
            signatures = [(item["time"], item["callsign"], item["serial"]) for item in items]
            prior = {(item["time"], item["callsign"], item["serial"]) for batch in journal if batch["counterpart"] == counterpart and batch["direction"] == "receive" for item in batch["items"]}
            require(len(set(signatures)) == len(items) and not prior.intersection(signatures), "Received QTC was already recorded")
        timestamp = params.get("timestamp", "")
        try:
            require(datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == timestamp, "Enter the QTC transfer UTC")
        except (ValueError, TypeError):
            require(False, "Enter the QTC transfer UTC")
        frequency = params.get("frequencyHz")
        require(type(frequency) is int, "Enter QTC transfer frequency")
        desk.contest_band(frequency)
        journal.append({"id": batch_id, "number": number, "count": len(items), "counterpart": counterpart,
                        "direction": direction, "timestamp": timestamp, "frequencyHz": frequency, "mode": state["pluginID"][4:].upper(),
                        "items": [{**deepcopy(item), "status": "pending", "repeats": []} for item in items], "status": "open"})
    else:
        batch = next((value for value in journal if value["id"] == params.get("batchID")), None)
        require(batch is not None, "QTC batch no longer exists")
        if action == "qtc_cancel":
            require(batch["status"] == "open", "QTC batch is already closed")
            batch["status"] = "cancelled"
        elif action in {"qtc_confirm", "qtc_repeat"}:
            index = params.get("index")
            require(type(index) is int and 0 <= index < len(batch["items"]), "Select a QTC item")
            item = batch["items"][index]
            if action == "qtc_confirm":
                require(batch["status"] == "open", "Reconcile the cancelled batch before acknowledging more items")
                item["status"] = "confirmed"
            else:
                require(len(item["repeats"]) < 100, "QTC repeat history is full")
                fields = params.get("fields", "all")
                require(fields in {"all", "time", "callsign", "serial", "header"}, "Choose the repeated field")
                item["repeats"].append(fields)
        elif action == "qtc_resume":
            require(batch["status"] == "cancelled", "This batch is not cancelled")
            batch["status"] = "open"
        elif action == "qtc_item":
            index = params.get("index")
            require(batch["direction"] == "receive" and batch["status"] == "open" and type(index) is int
                    and 0 <= index < len(batch["items"]) and batch["items"][index]["status"] == "pending", "Only unconfirmed received items can be corrected")
            item = params.get("item")
            require(isinstance(item, dict) and set(item) == {"time", "callsign", "serial"}, "Enter time/call/serial")
            require(isinstance(item["time"], str) and re.fullmatch(r"(?:[01]\d|2[0-3])[0-5]\d", item["time"]) is not None, "QTC time must be HHMM UTC")
            require(isinstance(item["callsign"], str) and re.fullmatch(r"[A-Z0-9/]{3,32}", item["callsign"]) is not None
                    and item["callsign"] != state["station"]["Call"], "Invalid QTC callsign")
            require(isinstance(item["serial"], str) and item["serial"].isdigit() and 0 < int(item["serial"]) <= 999999999, "Invalid QTC serial")
            require(not any(other["time"] == item["time"] and other["callsign"] == item["callsign"] and other["serial"] == item["serial"]
                    for series in journal if series["direction"] == "receive" and series["counterpart"] == batch["counterpart"]
                    for position, other in enumerate(series["items"]) if series is not batch or position != index), "Received QTC was already recorded")
            batch["items"][index].update(item)
        elif action == "qtc_header":
            require(not any(item["status"] == "confirmed" for item in batch["items"]), "Confirmed transfer headers are immutable")
            number = params.get("number")
            require(type(number) is int and 1 <= number <= 99999 and not any(other is not batch and other["number"] == number and
                    other["direction"] == batch["direction"] and (batch["direction"] == "send" or other["counterpart"] == batch["counterpart"]) for other in journal), "QTC header number conflicts")
            batch["number"] = number
        else:
            require(False, "Unsupported QTC action")
    state["qtc"] = {"schema": 1, "batches": journal}
    return projection(desk, params)


def export(desk):
    state, result = desk.state, score(desk)
    lines = ["START-OF-LOG: 3.0", "CALLSIGN: " + state["station"]["Call"], "CONTEST: " + desk.contest.cabrillo_name,
             "CATEGORY-OPERATOR: " + str(state["settings"].get("OperatorCategory", "CHECKLOG")),
             "CATEGORY-BAND: " + str(state["settings"].get("BandCategory", "ALL")),
             "CATEGORY-MODE: " + state["pluginID"][4:].upper(),
             "CATEGORY-POWER: " + str(state["settings"].get("PowerCategory", "")), "CLAIMED-SCORE: " + str(result["total"])]
    mode = {"wae_cw": "CW", "wae_ssb": "PH", "wae_rtty": "RY"}[state["pluginID"]]
    for row in desk.database.fetch_all_contacts_asc():
        lines.append(f'QSO: {int(float(row["Freq"])):5} {mode} {row["TS"][:10]} {row["TS"][11:16].replace(":", "")} {row["StationPrefix"]} {row["SNT"]} {row["SentNr"]} {row["Call"]} {row["RCV"]} {row["NR"]}')
    for batch in batches(state):
        receiver, sender = (batch["counterpart"], state["station"]["Call"]) if batch["direction"] == "send" else (state["station"]["Call"], batch["counterpart"])
        for item in batch["items"]:
            if item["status"] == "confirmed":
                lines.append(f'QTC: {batch["frequencyHz"] // 1000:5} {mode} {batch["timestamp"][:10]} {batch["timestamp"][11:16].replace(":", "")} {receiver} {batch["number"]}/{batch["count"]} {sender} {item["time"]} {item["callsign"]} {item["serial"]}')
    if any(item["status"] != "confirmed" for batch in batches(state) for item in batch["items"]):
        lines.append("SOAPBOX: Partial QTC series: pending items excluded; reconcile before submission.")
    lines.append("END-OF-LOG:")
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")
