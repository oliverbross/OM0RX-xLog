"""First-party OK/OM DX CW 2026 callbacks for the existing contest authority.

The factual rule/district reference is pinned to the organizer's CW page. Entry,
durable operations, serials and exports remain owned by the existing Python host.
The finite ESM overlay retains the pinned Not1MM WPX callback and GPL provenance.
"""
from copy import deepcopy
from functools import lru_cache
from importlib import import_module
import inspect
import json
from pathlib import Path
import re
from types import SimpleNamespace

PLUGIN_ID = "okom_dx_cw"
DEFINITION_VERSION = "1.0.0"
# Implementation credit revision, separate from the unchanged official edition.
CREDIT_REVISION = 1
RULE_EDITION = "OK-OM DX CW 2026"
RULE_SHA256 = "948be7d0d680a96917856739e3585e12c341486bd3a8258b7d3712c52615d0bd"
REFERENCE = json.loads((Path(__file__).parent / "resources/okom-cw-2026.json").read_text())
DISTRICTS = {key: frozenset(values) for key, values in REFERENCE["districts"].items()}
ANNULLED = frozenset({"EU", "UA", "UA2", "UA9", "RA", "RA2", "R1F", "R1FJ"})
BANDS = frozenset({1.8, 3.5, 7.0, 14.0, 21.0, 28.0})


def country(state, call):
    return state.get("reference", {}).get("countries", {}).get(call, {})


def prefix(info):
    return str(info.get("primary_pfx", "")).lstrip("*")


def normalized_exchange(value):
    return str(value).strip().upper()


def validate_setup(station, settings, countries, require):
    """Require an explicit station operating location, independently of address."""
    require(settings.get("TransmitterCategory") != "TWO",
            "OK/OM MO2T submission is unavailable: explicit per-QSO transmitter identity and per-band/per-transmitter serial ownership are not implemented")
    own = countries.get(station.get("Call", ""), {})
    declared = str(station.get("OperatingCountryPrefix", "")).strip().upper()
    require(bool(declared) and declared == prefix(own).upper(),
            "OK/OM requires an explicit operating-country prefix matching the pinned station callsign country")
    require(own.get("continent") in {"AF", "AN", "AS", "EU", "NA", "OC", "SA"},
            "Resolve the station operating continent for OK/OM")
    exchange = normalized_exchange(settings.get("SentExchange", ""))
    if declared in DISTRICTS:
        require(exchange in DISTRICTS[declared], "OK/OM domestic sent exchange must be a district from the operating country's official list")
    else:
        require(exchange == "#", "OK/OM DX entrants must select # for the authority-reserved serial")
    settings["SentExchange"] = exchange
    station["OperatingCountryPrefix"] = declared


def exchange_error(state, call, value, info=None):
    info = country(state, call) if info is None else info
    token = normalized_exchange(value)
    if not info and not call.endswith("/MM"):
        return "Resolve the contacted station's operating country before accepting an OK/OM exchange"
    area = prefix(info)
    if area in DISTRICTS and not call.endswith("/MM"):
        return None if token in DISTRICTS[area] else "Received district is unknown or does not belong to the station's OK/OM country"
    return None if re.fullmatch(r"[0-9]{1,9}", token) and int(token) > 0 else "Received DX serial must be a positive number of at most nine digits"


def validate_received(state, fields, require):
    error = exchange_error(state, fields["callsign"].upper(), fields["other_2"])
    require(error is None, error or "Invalid OK/OM exchange")
    own = prefix(country(state, state["station"]["Call"]))
    sent = normalized_exchange(fields["other_1"])
    require(sent in DISTRICTS[own] if own in DISTRICTS else
            bool(re.fullmatch(r"[0-9]{1,9}", sent)) and int(sent) > 0,
            "Sent OK/OM exchange must be the station district or a positive reserved DX serial")


def station_snapshot(desk):
    info = country(desk.state, desk.station["Call"])
    return {"schema": 1, "definitionVersion": DEFINITION_VERSION, "ruleSHA256": RULE_SHA256,
            "country": prefix(info), "continent": info.get("continent", ""),
            "operatingCall": desk.station["Call"]}


def in_period(row):
    # Host timestamps are validated canonical UTC. Keep the original timestamp.
    start = REFERENCE["contestStartUTC"].replace("T", " ").removesuffix("Z")
    end = REFERENCE["contestEndExclusiveUTC"].replace("T", " ").removesuffix("Z")
    return start <= str(row.get("TS", "")) < end


def row_points(state, row):
    """Single-contact arithmetic; duplicate credit is applied by ordered history."""
    if not in_period(row) or row.get("Band") not in BANDS or row.get("Mode") not in {"CW", "CWR", "CW-R", "CW-U", "CW-L"}:
        return 0
    try:
        own = json.loads(row.get("MiscText", ""))
    except (ValueError, TypeError):
        return 0  # Unknown historical location must never be invented.
    if own.get("definitionVersion") != DEFINITION_VERSION or own.get("ruleSHA256") != RULE_SHA256:
        return 0
    their = {"primary_pfx": row.get("CountryPrefix", ""), "continent": row.get("Continent", "")}
    other_country = prefix(their)
    if own.get("country") in ANNULLED or other_country in ANNULLED:
        return 0
    if exchange_error(state, row["Call"], row.get("NR", ""), their):
        return 0
    if row["Call"].endswith("/MM"):
        return 5
    if not other_country or not own.get("country") or not own.get("continent") or not their.get("continent"):
        return 0
    if own["country"] not in DISTRICTS and other_country in DISTRICTS:
        return 10
    if own["country"] == other_country:
        return 2 if own["country"] in DISTRICTS else 1
    return 3 if own["continent"] == their["continent"] else 5


def credit_keys(row):
    if row.get("Points", 0) <= 0 or row["Call"].endswith("/MM"):
        return ()
    area = str(row.get("CountryPrefix", "")).lstrip("*")
    if not area:
        return ()
    result = [("country", row["Band"], area)]
    district = normalized_exchange(row.get("NR", ""))
    if area in DISTRICTS and district in DISTRICTS[area]:
        result.append(("district", row["Band"], district))
    return tuple(result)


def score(desk):
    rows = desk.database.fetch_all_contacts_asc()
    credited = [row for row in rows if in_period(row)
                and desk.database.score_band in (None, row.get("Band"))]
    keys = {key for row in credited for key in credit_keys(row)}
    countries = sum(key[0] == "country" for key in keys)
    districts = len(keys) - countries
    points = sum(row.get("Points", 0) for row in credited)
    complete = True
    for row in rows:
        try:
            saved = json.loads(row.get("MiscText", ""))
            complete = complete and saved.get("definitionVersion") == DEFINITION_VERSION and saved.get("ruleSHA256") == RULE_SHA256
        except (TypeError, ValueError):
            complete = False
        complete = complete and bool(row.get("CountryPrefix") and row.get("Continent") or row["Call"].endswith("/MM"))
    limitations = [] if complete else ["A retained contact lacks pinned operating-location or country evidence; review before a submission claim"]
    if rows and desk.state.get("okomCreditRevision") != CREDIT_REVISION:
        limitations.append("Retained OK/OM credit requires explicit per-contest Recalculate before a complete submission claim; contacts and sent exchanges are preserved")
    if desk.contest_settings.get("TransmitterCategory") == "TWO":
        limitations.append("OK/OM MO2T submission unavailable: actual per-QSO transmitter identity and permitted serial scope are missing; historical exchanges are preserved")
    return {"qsos": len(rows), "points": points, "countries": countries, "districts": districts,
            "zones": 0, "multipliers": len(keys), "total": points * len(keys),
            "ruleEdition": RULE_EDITION, "scoringComplete": not limitations,
            "scoringLimitation": "; ".join(limitations),
            "scoringLimitations": limitations,
            "multiplierSummaryLabels": [f"{countries} DXCC / WAE countries", f"{districts} OK / OM districts"]}


def is_valid_dupe(desk, call, band):
    rows = desk.database.exec_sql_mult("SELECT * FROM DXLOG WHERE ContestNR=? AND Call=? AND Band=? AND Points>0",
                                      (desk.database.current_contest, call, band))
    return any(row_points(desk.state, row) > 0 for row in rows)


def points(desk):
    return 0 if is_valid_dupe(desk, desk.contact["Call"], desk.contact["Band"]) else row_points(desk.state, desk.contact)


def recalculate_mults(desk):
    # AppendRows intentionally limits enumeration during an append; prior
    # identities still come from the complete transaction's SQL-backed store.
    for row in desk.database.fetch_all_contacts_asc():
        prior = desk.database.exec_sql_mult("SELECT * FROM DXLOG WHERE ContestNR=? AND (TS<? OR (TS=? AND rowid<(SELECT rowid FROM DXLOG WHERE ID=?))) ORDER BY TS,rowid",
            (desk.database.current_contest, row["TS"], row["TS"], row["ID"]))
        seen = {key for previous in prior for key in credit_keys(previous)}
        row["IsMultiplier1"] = row["IsMultiplier2"] = 0
        for key in credit_keys(row):
            if key not in seen:
                row["IsMultiplier1" if key[0] == "district" else "IsMultiplier2"] = 1
        desk.database.change_contact(row)


def esm_exchange_valid(desk):
    return exchange_error(desk.state, desk.callsign.text().upper(), desk.other_2.text()) is None


@lru_cache(maxsize=1)
def esm_callback(base):
    """Keep the pinned WPX state machine, adapting only its numeric admission."""
    source = inspect.getsource(base)
    token = "self.other_2.text().isnumeric()"
    if source.count(token) != 2:
        raise RuntimeError("Pinned OK/OM ESM overlay no longer matches WPX")
    source = source.replace(token, "okom_exchange_valid(self)")
    namespace = {**base.__globals__, "okom_exchange_valid": esm_exchange_valid}
    exec(compile(source, base.__code__.co_filename + ":okom-exchange-overlay", "exec"), namespace)
    return namespace["process_esm"]


def export(desk, encoding):
    if not score(desk)["scoringComplete"]:
        from .host import require
        require(False, score(desk)["scoringLimitation"], "scoring_review_required")
    rows = desk.database.fetch_all_contacts_asc()
    station, settings = desk.station, desk.contest_settings
    lines = ["START-OF-LOG: 3.0", "CREATED-BY: OM0RX-xLog", "CONTEST: OK-OM-DX", f"CALLSIGN: {station['Call']}"]
    for label, field in (("OPERATOR", "OperatorCategory"), ("BAND", "BandCategory"), ("POWER", "PowerCategory"),
                         ("MODE", "ModeCategory"), ("TRANSMITTER", "TransmitterCategory"), ("ASSISTED", "AssistedCategory")):
        lines.append(f"CATEGORY-{label}: {settings.get(field, '')}")
    lines += [f"CLAIMED-SCORE: {score(desk)['total']}", f"NAME: {station.get('Name', '')}",
              f"ADDRESS: {station.get('Street1', '')}", f"ADDRESS-CITY: {station.get('City', '')}",
              f"ADDRESS-COUNTRY: {station.get('Country', '')}", f"EMAIL: {station.get('Email', '')}",
              f"OPERATORS: {', '.join(sorted({row.get('Operator', '') for row in rows if row.get('Operator')}))}",
              f"SOAPBOX: {RULE_EDITION}, definition {DEFINITION_VERSION}; organizer calculates final score."]
    for row in rows:
        sent = str(row.get("SentNr", ""))
        received = str(row.get("NR", ""))
        sent = sent.zfill(3) if sent.isdigit() else sent
        received = received.zfill(3) if received.isdigit() else received
        lines.append(f"QSO: {round(row['Freq']):5d} CW {row['TS'][:10]} {row['TS'][11:16].replace(':', '')} "
                     f"{row.get('StationPrefix', ''):<13} {str(row['SNT']):<3} {sent:<6} "
                     f"{row['Call']:<13} {str(row['RCV']):<3} {received:<6}")
    lines.append("END-OF-LOG:")
    path = Path(desk.export_directory) / (station["Call"].replace("/", "-") + "-OK-OM-DX.log")
    path.write_bytes(("\r\n".join(lines) + "\r\n").encode(encoding))


def plugin(base):
    value = SimpleNamespace(**{key: val for key, val in vars(base).items() if not key.startswith("__")})
    value.name, value.cabrillo_name, value.mode = "OK/OM DX CW", "OK-OM-DX", "CW"
    value.dupe_type = 5
    value.specific_contest_check_dupe = lambda desk, call: {"isdupe": is_valid_dupe(desk, call, desk.contact["Band"])}
    def init_contest(desk):
        base.init_contest(desk)
        desk.other_label.setText("Sent district / serial")
        desk.exch_label.setText("Received district / serial")
        desk.field3.setAccessibleName("Sent district or reserved serial")
        desk.field4.setAccessibleName("Received district or serial")
        if prefix(country(desk.state, desk.station["Call"])) in DISTRICTS:
            saved = normalized_exchange(desk.contest_settings["SentExchange"])
            desk.other_1.setText(saved)
            desk.other_1.setReadOnly(True)
            desk.state["draft"]["fields"]["other_1"] = saved
    def set_contact_vars(desk):
        desk.contact.update(SNT=desk.sent.text(), RCV=desk.receive.text(), SentNr=desk.other_1.text(),
                            NR=normalized_exchange(desk.other_2.text()), IsMultiplier1=0, IsMultiplier2=0)
        if not desk.contact.get("MiscText"):
            desk.contact["MiscText"] = json.dumps(station_snapshot(desk), sort_keys=True, separators=(",", ":"))
    value.init_contest, value.set_contact_vars = init_contest, set_contact_vars
    value.prefill = lambda desk: None
    value.points, value.recalculate_mults = points, recalculate_mults
    value.show_mults = lambda desk: score(desk)["multipliers"]
    value.calc_score = lambda desk: score(desk)["total"]
    value.process_esm = esm_callback(base.process_esm)
    value.cabrillo = export
    value.adif = lambda desk: import_module("not1mm.lib.plugin_common").gen_adif(desk, value.cabrillo_name, value.cabrillo_name)
    return value
