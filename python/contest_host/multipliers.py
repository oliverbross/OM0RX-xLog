"""Read-only family dimensions over plugin-owned rows, checked against its totals.

These describe the pinned show_mults queries; they never assign scoring flags or
re-score a contact. An unreconciled dimension stays unavailable.
"""
from dataclasses import dataclass
import re
import json
import hashlib
from copy import deepcopy
from types import SimpleNamespace
from .plugins import NO_MULTIPLIER_PLUGINS, PLUGIN_REGISTRY
from .upstream import (load_plugin, jidx_credit_keys, jidx_exchange_limit, pacc_multiplier_key,
                       es_open_multiplier_key, CQWS_BRAZILIAN_UNITS)

COUNTRY_UNIVERSE_REFERENCE = "bundled-cty-fnv64-cf9c48a44d4b5e66"
COUNTRY_UNIVERSE_CSV_SHA256 = "e5d907fb16842cfa3dd8502c20ebe6bfc2039c6f5b2cc73f9ea6d3f5915f6d6d"
COUNTRY_UNIVERSE_ENTRIES_SHA256 = "7c2fddb7f9d508b114f040d4d4a8f187f49c3d59394bb50cf225ac1c1cc5eeee"

# Existing reviewed data, not the retired Swift scoring engine. Exact parity
# with naqp-2026-authority.json is checked by the focused analytical tests.
NAQP_LOCATIONS = frozenset("""AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC
AB BC MB NB NL NT NS NU ON PE QC SK YT
4U1/U 6Y 8P C6 CM CY9 CY0 FG FJ FM FO FP FS HH HI HK0 HP HR J3 J6 J7 J8 KG4 KP1 KP2 KP4 KP5 OX PJ5 PJ7 TG TI TI9 V2 V3 V4 VP2E VP2M VP2V VP5 VP9 XE XF4 YN YS YV0 ZF""".split())
NAQP_DATA_REFERENCE = {"id": "ncj-naqp-location-tokens", "version": "2026-10-18",
    "sourceSHA256": "6ea80c5118f0520f95762cc679ff3ee05154d74dc1817a681664e690a01f5a8d",
    "source": "https://ncjweb.com/NAQP-Paper-Log-Form.pdf"}

SST_US=frozenset('AL AR AZ CA CO CT DC DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split())
SST_CA=frozenset('AB BC LB MB NB NF NS NT NU ON PE QC SK YT'.split())
SST_REFERENCE={'id':'k1usn-sst-subdivision-tokens','version':'2026-10-18','source':'https://www.k1usn.com/sst_faq.html',
               'sourceSHA256':'e942c3ccfb46bd7391fb982f5c666863172c8287fdd0ebcb35f8b2989903126f',
               'embeddedTableSHA256':'36ee41e13cae55ca81e7fbba3f48836b682167a3d859753d1c91553ae8a35920',
               'rulesSHA256':'2a54b5ad26aa0342ee6036e07bf39df5c22d4176f6c91913fe5bcf4b3ebe04b8'}

# The ARRL 2026 multiplier-table tokens are different from NAQP's provinces:
# retain LB/NF here; never canonicalize a stored Sect/NR to change its score.
ARRL_STATE_PROVINCE_CODES = frozenset("""AL AZ AR CA CO CT DC DE FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY
AB BC LB MB NB NF NS NT NU ON PE QC SK YT""".split())
ARRL_DATA_REFERENCE = {"id": "arrl-us-ve-multiplier-tokens", "version": "1.2.0@2026-10-18",
    "sourceSHA256": "373e94e5000238caa6dead3ed7e2e6c0b0afddb9c2fa745872bf89ec3196aa1b",
    "source": "https://contests.arrl.org/contestmultipliers.php?a=ve",
    "additionalSourceSHA256": "eb10a31063f9c85b5a9516b076e73085f57bebb33be50d33fe64e95bcbf3c190"}

# Reuse the reviewed ARRL/RAC table already pinned in Cabrillo.swift. Unknown
# historical section aliases remain outside this reference and are not merged.
ARRL_SECTIONS = frozenset("""CT EMA ME NH RI VT WMA ENY NLI NNJ NNY SNJ WNY DE EPA MDC WPA
AL GA KY NC NFL SC SFL TN VA WCF AR LA MS NM NTX OK STX WTX EB LAX ORG SB SCV SDG SF SJV SV
AZ EWA ID MT NV OR UT WWA WY MI OH WV IL IN WI CO IA KS MN MO NE ND SD
AB BC GH MB NB NL NS ONE ONN ONS PE QC SK TER AK PR VI PAC""".split())
ARRL_SECTION_REFERENCE = {"id": "arrl-rac-section-tokens", "version": "1.2.0@2026-10-18",
    "source": "https://contests.arrl.org/contestmultipliers.php?a=wve",
    "sourceSHA256": "5618ceeeb46494dd94313f32a9f33f2fd5a8d5be96693a502de5b147f927ebe6"}


def validate_multiplier_universe(value, reference_id, require):
    """Optional new-session coordinate over the exact existing bundled CTY rows.

    Length-prefixed UTF-8 value/label/continent records are sorted by primary
    prefix. This binds all 346 rows, including leading-* named entities; it is
    deliberately unrelated to the mutable per-call resolution cache.
    """
    if value is None:
        return None
    valid = lambda condition, message: require(condition, message, "invalid_reference_universe")
    valid(isinstance(value, dict) and set(value) == {"schema", "referenceID", "source", "sourceSHA256", "entriesSHA256", "entries"}, "Invalid multiplier-universe coordinate")
    valid(type(value["schema"]) is int and value["schema"] == 1 and value["referenceID"] == reference_id == COUNTRY_UNIVERSE_REFERENCE,
          "Multiplier universe does not match the pinned session reference")
    valid(value["source"] == "bundled-cty-primary-prefixes" and value["sourceSHA256"] == COUNTRY_UNIVERSE_CSV_SHA256
          and value["entriesSHA256"] == COUNTRY_UNIVERSE_ENTRIES_SHA256, "Multiplier-universe source digest is not the reviewed bundled snapshot")
    entries = value["entries"]
    valid(isinstance(entries, list) and len(entries) == 346, "Multiplier universe must contain the complete 346-row primary-prefix mapping")
    for entry in entries:
        valid(isinstance(entry, dict) and set(entry) == {"value", "label", "continent"}, "Invalid multiplier-universe entry")
        valid(all(isinstance(entry[key], str) and 0 < len(entry[key].encode()) <= 128 and not any(char in entry[key] for char in "\r\n\t\0") for key in entry), "Invalid multiplier-universe text")
        valid(re.fullmatch(r"\*?[A-Z0-9/]{1,31}", entry["value"]) is not None and entry["continent"] in {"AF", "AN", "AS", "EU", "NA", "OC", "SA"}, "Invalid primary-prefix identity")
    entries = sorted(entries, key=lambda item: item["value"])
    valid(len({entry["value"] for entry in entries}) == 346, "Multiplier universe contains duplicate primary prefixes")
    canonical = bytearray()
    for entry in entries:
        for field in ("value", "label", "continent"):
            data = entry[field].encode()
            canonical.extend(str(len(data)).encode() + b":" + data)
        canonical.extend(b"\n")
    valid(hashlib.sha256(canonical).hexdigest() == COUNTRY_UNIVERSE_ENTRIES_SHA256,
          "Multiplier universe is incomplete or its primary-prefix mapping has drifted")
    return {**deepcopy(value), "entries": deepcopy(entries)}


def _global_countries(state):
    def check(condition, message, code):
        if not condition: raise ValueError(message)
    try:
        return validate_multiplier_universe(state["reference"].get("multiplierUniverse"), state["reference"]["id"], check)
    except (ValueError, KeyError, TypeError):
        return None


@dataclass(frozen=True)
class Dimension:
    id: str
    label: str
    field: str
    scope: str
    total: str = ""
    criterion: str = "all"
    universe: tuple = ()


PREFIX = Dimension("prefix", "WPX prefixes", "WPXPrefix", "contest", "prefixes")
SECTION = Dimension("section", "ARRL/RAC sections", "Sect", "contest", "sections")
SPC = Dimension("spc", "State / province / country", "Sect", "band", "sections", "not-dx")
CALL = Dimension("call", "Unique calls", "Call", "contest", "uniqueCalls")
COUNTRY = Dimension("country", "Countries", "CountryPrefix", "band", "countries", "cq")
ZONE = Dimension("zone", "CQ zones", "ZN", "band", "zones", "cq", tuple(map(str, range(1, 41))))
STATE = Dimension("state", "States / VE areas", "Exchange1", "band", "states", "cq-state")

FAMILIES = {
    **{key: (PREFIX,) for key in ("cq_wpx_cw", "cq_wpx_ssb", "cq_wpx_rtty")},
    **{key: (SECTION,) for key in ("arrl_ss_cw", "arrl_ss_phone")},
    **{key: (SPC,) for key in ("naqp_cw", "naqp_ssb", "naqp_rtty", "phone_weekly_test", "k1usn_sst")},
    **{key: (CALL,) for key in ("cwt", "cwo", "icwc_mst", "weekly_rtty")},
    "cq_ww_rtty": (COUNTRY, ZONE, STATE),
    "iaru_hf": (Dimension("ituZone", "ITU zones", "ZN", "band/mode", "zones", "itu", tuple(map(str, range(1, 91)))),
                Dimension("hq", "IARU headquarters", "ZN", "band/mode", "headquarters", "hq")),
}


def _add(ids, *definitions):
    FAMILIES.update({plugin: definitions for plugin in ids.split()})


_add("cq_ww_cw cq_ww_ssb", COUNTRY, ZONE)
_add("euhfc", Dimension("year", "Licence years", "NR", "band", universe=tuple(map(str, range(100)))))
_add("arrl_vhf_jan arrl_vhf_jun arrl_vhf_sep cq_ww_vhf vhf_sprint",
     Dimension("grid", "Received grid squares", "NR", "band", criterion="text"))
_add("ssa_mt_cw ssa_mt_ssb", Dimension("grid", "Received locator squares", "@grid4", "band"))
_add("labre_rs_digi", Dimension("gridField", "Received grid fields", "@gridField", "band", criterion="text"))
_add("nac_vhf", Dimension("grid", "Received large squares", "@grid4", "contest", "gridSquares"))
_add("qso_party_rst qso_party_sn ca_qso_party", Dimension("county", "Received counties / regions", "Exchange1", "contest", criterion="not-dx"))
_add("canada_day spdx", Dimension("region", "Received provinces / regions", "NR", "band/mode", criterion="text"))
_add("ari_40_80", Dimension("province", "Automobile province codes", "Exchange1", "band/mode"))
_add("ok1wc", Dimension("letter", "Callsign last letters", "@lastLetter", "band"))
_add("arrl_field_day winter_field_day", Dimension("bandMode", "Operating band / mode combinations", "Mode", "band"))
_add("jidx_cw jidx_ph", Dimension("number", "Received prefectures / CQ zones", "NR", "contest"))
_add("oceania_dx_cw oceania_dx_ssb", Dimension("prefix", "Credited WPX prefixes", "WPXPrefix", "band", criterion="flag1"))
_add("iaru_fieldday_r1_cw iaru_fieldday_r1_ssb", Dimension("country", "Credited countries", "CountryPrefix", "band", criterion="flag1"))
_add("cq_160_cw cq_160_ssb", Dimension("region", "Credited states / provinces / entities", "@cq160", "contest", criterion="flag1"))
_add("helvetia ref_cw ref_ssb", Dimension("region", "Credited canton / department", "NR", "band", criterion="flag1"),
     Dimension("country", "Credited countries", "CountryPrefix", "band", criterion="flag2"))
_add("lz-dx", Dimension("district", "Credited Bulgarian districts", "NR", "band", criterion="flag1"),
     Dimension("country", "Credited countries", "CountryPrefix", "band", criterion="flag2"))
_add("darc_xmas", Dimension("prefix", "Credited WPX prefixes", "WPXPrefix", "contest", criterion="flag1"),
     Dimension("dok", "Credited German DOKs", "NR", "band", criterion="flag2"))
_add("wag", Dimension("region", "Credited DOK groups / countries", "@wag", "band", criterion="flag1"))
_add("agcw_qrp", Dimension("member", "Credited QRP members", "@member", "band", criterion="flag1"))
_add("ea_majestad_cw ea_majestad_ssb", Dimension("province", "Received provinces", "NR", "band", criterion="text"),
     Dimension("country", "Countries", "CountryPrefix", "band"))
_add("ari_dx", Dimension("province", "Received Italian provinces", "NR", "band", criterion="text"),
     Dimension("country", "Non-Italian countries", "CountryPrefix", "band", criterion="not-italy"))
_add("ea_rtty", Dimension("province", "Received Spanish provinces", "NR", "band", criterion="text"),
     Dimension("country", "EADX entities", "CountryPrefix", "band"),
     Dimension("callArea", "K/VE/VK/JA call areas", "@countryLastDigit", "band", criterion="call-area-country"),
     Dimension("special", "EA4URE band credit", "Call", "band", criterion="call-EA4URE"))
_add("eudx", Dimension("region", "EU region exchanges", "NR", "mode", criterion="eu-region"),
     Dimension("country", "Countries", "CountryPrefix", "mode"))
_add("rsgb_iota", Dimension("iota", "Received IOTA references", "@iota", "band/mode"))
_add("ukeidx", Dimension("country", "Non-UK/EI countries", "CountryPrefix", "contest", criterion="not-uk-ei"),
     Dimension("district", "Received district suffixes", "@suffix2", "contest", criterion="text"))


def _context(state):
    return SimpleNamespace(station=state["station"], state=state,
        cty_lookup=lambda call: {"identity": state["reference"]["countries"][call.upper()]}
        if call.upper() in state["reference"]["countries"] else None)


def _own(state):
    return state["reference"]["countries"].get(state["station"]["Call"], {})


def dimensions(state):
    plugin = state["pluginID"]
    if plugin in {"arrl_dx_cw", "arrl_dx_ssb"}:
        country = state["reference"]["countries"].get(state["station"]["Call"], {}).get("primary_pfx")
        return ((Dimension("country", "DX countries", "CountryPrefix", "band", "countries", "three-points"),)
                if country in {"K", "VE"} else
                (Dimension("state", "US states / VE provinces", "NR", "band", "states", "three-points"),))
    if plugin in {"jidx_cw", "jidx_ph"} and state.get("scoringRevision") == "26.10.26":
        if jidx_exchange_limit(_own(state).get("primary_pfx"), state["station"]["Call"]) == 50:
            return (Dimension("country", "DXCC countries", "@jidx-country", "band", "countries", "positive"),
                    Dimension("zone", "CQ zones", "@jidx-zone", "band", "zones", "positive", tuple(map(str, range(1, 41)))))
        return (Dimension("prefecture", "Japanese prefectures / JD1 islands", "@jidx-prefecture", "band", "prefectures", "positive", tuple(map(str, range(1, 51)))),)
    if plugin in {"aadx_cw", "aadx_ssb"}:
        return (Dimension("country" if _own(state).get("continent") == "AS" else "prefix", "Credited Asian/DX identities",
                          "CountryPrefix" if _own(state).get("continent") == "AS" else "WPXPrefix", "band", criterion="flag1"),)
    if plugin in {"sac_cw", "sac_ssb"}:
        scandinavian = _own(state).get("primary_pfx") in {"LA", "SM", "OZ", "OH", "OH0", "OY", "TF", "JW", "JX", "OX"}
        return (Dimension("country" if scandinavian else "area", "SAC country / call areas", "CountryPrefix" if scandinavian else "@sacArea", "band"),)
    if plugin == "pacc":
        return (Dimension("region", "PACC country / call areas" if _own(state).get("primary_pfx") == "PA" else "Dutch provinces",
            "@pacc" if _own(state).get("primary_pfx") == "PA" and state.get("scoringRevision") == "26.10.26" else
            "CountryPrefix" if _own(state).get("primary_pfx") == "PA" else "NR", "band/mode", criterion="positive" if _own(state).get("primary_pfx") == "PA" and state.get("scoringRevision") == "26.10.26" else "all" if _own(state).get("primary_pfx") == "PA" else "pacc-province",
            universe=() if _own(state).get("primary_pfx") == "PA" else ("DR", "FL", "FR", "GD", "GR", "LB", "NB", "NH", "OV", "UT", "ZH", "ZL")),)
    if plugin == "hadx":
        return (Dimension("county", "Hungarian counties", "NR", "band", criterion="ha-county"),
                Dimension("country", "DXCC / WAE countries", "CountryPrefix", "band", criterion="integer"))
    if plugin in {"ea_majestad_cw", "ea_majestad_ssb"}:
        return (*FAMILIES[plugin], Dimension("special", "EF0F/8 band credit", "Call", "band", criterion="call-EF0F/8"))
    if plugin == "es_field_day":
        return (Dimension("region", "Estonian regions", "@suffix2", "band/mode", criterion="es-region", universe=tuple(sorted(load_plugin(plugin).estonian_regions))),)
    if plugin in {"arrl_10m", "arrl_rtty_ru"}:
        defs = [Dimension("region", "State / province exchanges", "NR", "mode", criterion="text"),
                Dimension("country", "DX countries", "CountryPrefix", "mode", criterion="integer-not-mm" if plugin == "arrl_10m" else "integer")]
        if plugin == "arrl_10m":
            defs.append(Dimension("maritime", "Maritime regions", "NR", "mode", criterion="integer-mm"))
        return tuple(defs)
    if plugin == "arrl_160m":
        return (Dimension("section", "Received section exchanges", "Exchange1", "contest"),
                *((Dimension("country", "Countries", "CountryPrefix", "contest"),)
                  if load_plugin(plugin).can_claim_dxcc(_context(state)) else ()))
    if plugin in {"rda_contest", "rdxc"}:
        scope = "contest" if plugin == "rda_contest" else "band"
        return (Dimension("district", "Russian districts / oblasts", "NR", scope, criterion="russian"),
                *((Dimension("country", "Countries (UA/UA9 combined)", "@russianCountry", scope, criterion="not-mm"),)
                  if plugin == "rdxc" or _own(state).get("primary_pfx") in {"UA", "UA9", "UA2"} else ()))
    if plugin == "cqws" and state.get("scoringRevision") == "26.10.26":
        return (Dimension("country", "Countries", "CountryPrefix", "contest", "countries", "positive"),
                Dimension("uf", "Explicit Brazilian federal units", "Exchange1", "band", "exchangeBandMultipliers", "brazil-uf", tuple(sorted(CQWS_BRAZILIAN_UNITS))))
    if plugin in {"es_open", "es_ll_kv", "es_manual_key"}:
        return (Dimension("region", "Estonian call regions", "@esRegion" if plugin == "es_open" and state.get("scoringRevision") == "26.10.26" else "@callArea",
                          "band/mode", criterion="positive" if plugin == "es_open" and state.get("scoringRevision") == "26.10.26" else "es-other", universe=tuple(map(str, range(10)))),)
    if plugin in {"trans_tasman", "john_moyle_field_day"}:
        return (Dimension("prefix", "Eligible prefixes", "WPXPrefix", "band/block" if plugin == "trans_tasman" else "band/mode/block", criterion=plugin),)
    return FAMILIES.get(plugin, ())


def _value(row, state, definition):
    field, plugin = definition.field, state["pluginID"]
    if not field.startswith("@"):
        return row.get(field)
    if field.startswith("@jidx-"):
        return next((key[2] for key in jidx_credit_keys(_context(state), row) if key[0] == field[6:]), None)
    nr, prefix = str(row.get("NR") or ""), str(row.get("CountryPrefix") or "")
    if field == "@grid4": return str(row.get("Exchange1") or "")[:4]
    if field == "@gridField": return nr[:2]
    if field == "@lastLetter": return str(row.get("Call") or "")[-1:]
    if field == "@member": return nr.split("/")[-1]
    if field == "@suffix2": return nr[-2:]
    if field == "@iota": return nr.split(" ", 1)[1] if " " in nr else None
    if field == "@cq160": return row.get("Exchange1") if prefix in {"K", "VE"} else prefix
    if field == "@countryLastDigit": return prefix + ":" + str(row.get("WPXPrefix") or "")[-1:]
    if field == "@pacc": return pacc_multiplier_key(row)
    if field == "@russianCountry": return "R" if prefix in {"UA", "UA9"} else prefix
    if field == "@callArea": return str(row.get("WPXPrefix") or "")[2:3]
    if field == "@sacArea": return prefix + ":" + str(row.get("WPXPrefix") or "")[2:3]
    if field == "@esRegion":
        key = es_open_multiplier_key(row)
        return key[0] if key else None
    if field == "@wag":
        return prefix if _own(state).get("primary_pfx") == "DL" else load_plugin(plugin).get_district(nr)
    return None


def _eligible(row, value, dimension, state):
    condition, nr, prefix = dimension.criterion, row.get("NR"), str(row.get("CountryPrefix") or "")
    mm = "/MM" in str(row.get("Call") or "")
    if condition.startswith("flag"): return bool(row.get("IsMultiplier" + condition[-1]))
    if condition == "positive": return row.get("Points", 0) > 0
    if condition == "pacc-province": return value in dimension.universe
    if condition == "not-italy": return prefix not in {"I", "IS"}
    if condition.startswith("call-"): return row.get("Call") == condition[5:]
    if condition == "call-area-country": return prefix in {"K", "VE", "VK", "JA"}
    if condition == "es-region": return prefix == "ES" and value in dimension.universe and bool(re.search("[A-Z]", str(nr)))
    if condition == "es-other": return prefix == "ES" and row.get("WPXPrefix") != load_plugin(state["pluginID"]).calculate_wpx_prefix(state["station"]["Call"])
    if condition == "text": return isinstance(nr, str)
    if condition == "integer": return isinstance(nr, int)
    if condition == "integer-mm": return isinstance(nr, int) and mm
    if condition == "integer-not-mm": return isinstance(nr, int) and not mm
    if condition == "ha-county": return isinstance(nr, str) and row.get("Points") == 10
    if condition == "russian": return prefix in {"UA", "UA9", "UA2"}
    if condition == "not-mm": return not mm
    if condition == "not-uk-ei": return prefix not in {"EI", "G", "GD", "GI", "GJ", "GM", "GU", "GW"}
    if condition == "brazil-uf": return row.get("Points", 0) > 0 and prefix.startswith("PY") and value in CQWS_BRAZILIAN_UNITS
    if condition == "eu-region": return bool(re.fullmatch(r"[A-Za-z]{2}[0-9]{2}", str(value)))
    if condition == "trans_tasman": return row.get("Points", 0) > 0 and str(row.get("WPXPrefix") or "").startswith(("VK", "ZL", "ZK", "ZM"))
    if condition == "john_moyle_field_day": return prefix in {"VK", "ZL", "P2"}
    return True


def _scope(row, definition, state, band_labels):
    scope = definition.scope
    if scope == "contest": return "Contest"
    if scope == "mode": return str(row.get("Mode"))
    parts = [band_labels.get(row["Band"], str(row["Band"]))]
    if "mode" in scope:
        mode = str(row.get("Mode"))
        if state["pluginID"] == "john_moyle_field_day":
            mode = "PH" if mode in {"LSB", "USB", "SSB", "FM", "AM"} else "CW" if mode.startswith("CW") else "OTHER"
        parts.append(mode)
    if "block" in scope:
        hour = int(row["TS"][11:13])
        block = max(0, min(2, (hour - 8) // 2)) if state["pluginID"] == "trans_tasman" else 7 if hour < 1 else (hour - 1) // 3
        parts.append("UTC block " + str(block))
    return " / ".join(parts)


def project(rows, state, score, band_labels):
    """Return bounded worked ledgers and immutable per-contact support keys."""
    views, support = [], {row["ID"]: [] for row in rows}
    definitions = dimensions(state)
    if not definitions:
        return views, support, False
    cq_seen = set()
    cq_eligible = set()
    for row in sorted(rows, key=lambda row: row.get("source_order", 0)) if any(d.criterion.startswith("cq") for d in definitions) else ():
        key = (row["Call"], row["Band"])
        if row.get("CountryPrefix") and key not in cq_seen:
            cq_eligible.add(row["ID"])
        cq_seen.add(key)
    for dimension in definitions:
        groups = {}
        for row in rows:
            raw = _value(row, state, dimension)
            value = str(raw if raw is not None else "").strip()
            if not value:
                continue
            condition = dimension.criterion
            if not _eligible(row, value, dimension, state):
                continue
            if condition == "not-dx" and value == "DX" or condition == "three-points" and row["Points"] != 3:
                continue
            if condition in {"cq", "cq-state"} and row["ID"] not in cq_eligible:
                continue
            if condition == "cq-state" and value == "DX":
                continue
            if condition == "itu" and not isinstance(raw, int) or condition == "hq" and isinstance(raw, int):
                continue
            scope = _scope(row, dimension, state, band_labels)
            key = (value, scope)
            groups.setdefault(key, []).append(row["ID"])
        expected = score.get(dimension.total)
        reconciled = expected is None or len(groups) == expected
        view = {"id": dimension.id, "label": dimension.label, "scope": dimension.scope,
                "status": "supported" if reconciled else "not-implemented", "total": len(groups) if expected is None else expected,
                "reason": "Worked identities; open-ended or entrant-dependent needed lists are not inferred."
                if reconciled else "Worked identities do not reconcile with the plugin total; view unavailable.",
                "rows": [{"value": value, "scope": scope, "qsos": len(ids)}
                         for (value, scope), ids in sorted(groups.items())] if reconciled and len(groups) <= 3000 else []}
        if reconciled and len(groups) > 3000:
            view.update(status="not-implemented", reason="Worked ledger exceeds the 3,000-identity view limit; plugin total retained.")
        if reconciled and any(len(f"{dimension.label} {value} · {scope}") > 256 for value, scope in groups):
            view.update(status="not-implemented", rows=[], reason="A lossless identity exceeds the analytical key limit; plugin total retained.")
        views.append(view)
        if reconciled:
            for (value, scope), ids in groups.items():
                for qso_id in ids:
                    support[qso_id].append(f"{dimension.label} {value} · {scope}")
    reconciled_total = sum(view["total"] for view in views) == score.get("multipliers")
    if not reconciled_total:
        for view in views:
            view.update(status="not-implemented", rows=[], reason="Worked identities do not reconcile with the plugin multiplier total; acquisition is unavailable.")
    available = bool(views) and reconciled_total and all(view["status"] == "supported" for view in views)
    return views, support if available else {row["ID"]: [] for row in rows}, available


def _country_domain(definition, state, coordinate):
    """Only explicit pinned counter predicates, never all-countries-by-default."""
    if coordinate is None:
        return (), None
    plugin, field = state["pluginID"], definition.field
    values = {entry["value"] for entry in coordinate["entries"]}
    policy = None
    if field == "CountryPrefix":
        if plugin in {"cq_ww_cw", "cq_ww_ssb", "cq_ww_rtty"}:
            policy = "Pinned CQ country/band identities, including zero-point support"
        elif plugin == "arrl_160m":
            policy = "Pinned ARRL 160 can_claim_dxcc entrant branch and all distinct CountryPrefix identities, including territory entrants"
        elif plugin in {"arrl_dx_cw", "arrl_dx_ssb"} and definition.criterion == "three-points":
            values -= {"K", "VE"}
            policy = "ARRL DX K/VE entrant: only countries whose valid land contact has three-point credit"
        elif plugin == "ari_dx" and definition.criterion == "not-italy":
            values -= {"I", "IS"}
            policy = "Pinned ARI non-Italian CountryPrefix predicate"
        elif plugin in {"ea_majestad_cw", "ea_majestad_ssb", "eudx", "ea_rtty", "helvetia", "lz-dx", "iaru_fieldday_r1_cw", "iaru_fieldday_r1_ssb"}:
            policy = "Pinned distinct-country/first-country query; source eligibility is separate from QSO points"
        elif plugin == "hadx" and definition.criterion == "integer":
            values.discard("HA")
            policy = "Pinned HA DX numeric-serial country branch; Hungarian county exchanges are separate"
        elif plugin == "ukeidx" and definition.criterion == "not-uk-ei":
            values -= {"EI", "G", "GD", "GI", "GJ", "GM", "GU", "GW"}
            policy = "Pinned UKEI literal primary-prefix exclusion query"
        elif plugin == "cqws" and state.get("scoringRevision") == "26.10.26":
            policy = "Marked CQWS positive-point countries; incomplete scoring still blocks Needed"
    elif field == "@jidx-country":
        from .upstream import jidx_japanese_prefix
        values = {value for value in values if not jidx_japanese_prefix(value)}
        policy = "Marked Japanese JIDX entrant: DX land entities only; maritime contacts give no entity credit"
    elif field == "@russianCountry":
        values = {"R" if value in {"UA", "UA9"} else value for value in values}
        policy = "Pinned Russian-country predicate: UA/UA9 share R; maritime contacts cannot support countries"
    elif field == "@wag" and _own(state).get("primary_pfx") == "DL":
        policy = "Pinned German WAG entrant country/band branch"
    elif field == "@pacc" and _own(state).get("primary_pfx") == "PA":
        areas = set()
        for value in values - {"PA"}:
            if value in {"UA9", "CE", "JA", "LU", "PY", "VE", "K", "VK", "ZS", "ZL"}:
                stems = ("VE", "VO", "VY") if value == "VE" else ("UA" if value == "UA9" else value,)
                areas.update(stem + str(area) for stem in stems for area in range(10))
            else:
                areas.add(value)
        values = areas
        policy = "Marked Dutch PACC entrant: exact named country/call-area families; Dutch zero-point contacts excluded"
    return (tuple(sorted(values)), policy) if policy else ((), None)


def needed_views(rows, state, views, band_labels):
    """Finite lists from executable contracts, with their exact bounded scope."""
    result, coordinate = [], _global_countries(state)
    for definition, view in zip(dimensions(state), views):
        universe, provenance = definition.universe, "Pinned host/plugin numeric exchange contract"
        source_coordinate, universe_scope, complete = None, "bounded-exchange-contract", True
        if not universe:
            universe, country_policy = _country_domain(definition, state, coordinate)
            if country_policy:
                provenance = country_policy + "; complete primary-prefix data is pinned to this session, not inferred from lookup calls"
                source_coordinate = {key: coordinate[key] for key in ("source", "referenceID", "sourceSHA256", "entriesSHA256")}
                universe_scope = "eligible-pinned-primary-prefix-keys"
        if state["pluginID"] in {"naqp_cw", "naqp_ssb", "naqp_rtty"} and definition.id == "spc":
            universe = tuple(sorted(NAQP_LOCATIONS))
            provenance = "NCJ 2026 paper-form location tokens; pinned raw Sect identities and aliases are retained without rescoring"
            source_coordinate = NAQP_DATA_REFERENCE
            universe_scope = "published-location-tokens-as-pinned-Sect-keys"
        if state['pluginID']=='k1usn_sst' and definition.id=='spc':
            valid=all(str(row.get('Sect',''))=='DX' and bool(row.get('CountryPrefix')) and str(row.get('CountryPrefix')) not in {'K','VE'} or
                      str(row.get('CountryPrefix',''))=='K' and str(row.get('Sect','')) in SST_US or
                      str(row.get('CountryPrefix',''))=='VE' and str(row.get('Sect','')) in SST_CA for row in rows)
            universe=tuple(sorted(SST_US|SST_CA)) if valid else ()
            complete=False;source_coordinate=SST_REFERENCE;universe_scope='reviewed-subdivisions-only-pinned-raw-Sect'
            provenance='Reviewed K1USN 49 lower-48/DC and 14 Canadian logger tokens only. Official DXCC branch is absent from the pinned Python scorer; NL alias is not merged. This limited list is not complete official scoring.'
        if state["pluginID"] in {"arrl_ss_cw", "arrl_ss_phone", "arrl_160m"} and definition.id == "section":
            universe, source_coordinate = tuple(sorted(ARRL_SECTIONS)), ARRL_SECTION_REFERENCE
            provenance = "Existing reviewed ARRL/RAC section tokens; exact received Sect/Exchange1 keys, without merging historical aliases"
            universe_scope = "published-section-tokens-as-pinned-exchange-keys"
            if state["pluginID"] == "arrl_160m":
                universe = tuple(sorted(ARRL_SECTIONS | {str(zone) for zone in range(1, 41)}))
                provenance += "; ARRL 160 also counts received DX CQ-zone strings 1–40 as whole Exchange1 identities"
                universe_scope = "published-sections-and-numeric-CQ-zone-tokens"
        if definition.field == "NR" and definition.id == "state" and state["pluginID"] in {"arrl_dx_cw", "arrl_dx_ssb"}:
            universe, source_coordinate = tuple(sorted(ARRL_STATE_PROVINCE_CODES)), ARRL_DATA_REFERENCE
            provenance = "ARRL 2026 state/province token tables; only the three-point DX-entrant branch; heard aliases are not merged"
        if state["pluginID"] == "arrl_rtty_ru" and definition.id == "region":
            universe, source_coordinate = tuple(sorted(ARRL_STATE_PROVINCE_CODES)), ARRL_DATA_REFERENCE
            provenance = "ARRL RTTY state/province token tables; received serial/country branch remains separate"
        if state["pluginID"] == "helvetia" and definition.id == "region":
            universe = tuple(sorted(load_plugin("helvetia").cantons))
            provenance = "Exact pinned helvetia.cantons tokens, including CH; not a generic political-canton count"
        if state["pluginID"] in {"arrl_field_day", "winter_field_day"} and definition.field == "Mode":
            universe = tuple(PLUGIN_REGISTRY[state["pluginID"]].modes)
            provenance = "Registered operating-mode keys in the pinned unique-band/mode scoring query"
        if definition.field == "@wag" and _own(state).get("primary_pfx") != "DL":
            universe = tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
            provenance = "Pinned wag.get_district first ASCII letter (including special DOKs), not an invented list of club DOKs"
        if definition.field == "@lastLetter":
            universe = tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/")
            provenance = "Pinned last-character query over the host's admitted ASCII callsign alphabet; includes digits and slash without changing stored calls"
            universe_scope = "host-callsign-last-character-contract"
        if state["pluginID"] == "ca_qso_party":
            plugin = load_plugin("ca_qso_party")
            universe = tuple(sorted(plugin.CA_MULTS | plugin.CA_COUNTIES))
            provenance = "Literal codes admitted by pinned CA_MULTS / CA_COUNTIES; compound Exchange1 keys are not enumerated; credit is capped at 58"
            complete, universe_scope = False, "single-literal-exchange-codes-only"
        metadata = {"id": definition.id, "label": definition.label, "scope": definition.scope,
                    "universeSize": len(universe) if universe else None, "universeComplete": complete if universe else False,
                    "universeScope": universe_scope, "referenceID": state["reference"]["id"],
                    **({"universeReference": source_coordinate} if source_coordinate is not None else {}),
                    "category": {"band": state["settings"].get("BandCategory"), "mode": state["settings"].get("ModeCategory")}}
        if not universe:
            opened = definition.id in {"prefix", "call"}
            reason = ("This identity class is open-ended; a complete finite enumeration is not defined. Candidate Needed remains a separate capability." if opened else
                      "The retained optional universe is incompatible with this session/reference version; ordinary logging is unchanged and no universe migration is inferred." if definition.id == "country" and coordinate is None and "multiplierUniverse" in state["reference"] else
                      "No immutable complete country universe is pinned to this session; its per-call lookup cache is not a country universe." if definition.id == "country" and coordinate is None else
                      "The complete reference is available, but this family's eligible country subset is not established; a global list alone does not prove eligibility." if definition.id == "country" else
                      "No verified eligible finite list is supplied for this dimension; a list is not inferred from arbitrary possible exchanges/grids.")
            result.append({**metadata, "status": "NOT APPLICABLE" if opened else "UNVERIFIED", "reason": reason, "rows": []})
            continue
        if view["status"] != "supported":
            result.append({**metadata, "status": "UNVERIFIED",
                           "reason": "Worked identities must reconcile before Needed can be established.", "rows": []})
            continue
        scopes = sorted({item["scope"] for item in view["rows"]})
        bands = list(PLUGIN_REGISTRY[state["pluginID"]].bands)
        category = str(state["settings"].get("BandCategory", "ALL")).lower()
        if category in bands: bands = [category]
        mode_category = str(state["settings"].get("ModeCategory", "MIXED"))
        modes = [mode_category] if mode_category in PLUGIN_REGISTRY[state["pluginID"]].modes else list(PLUGIN_REGISTRY[state["pluginID"]].modes)
        if definition.scope == "contest": scopes = ["Contest"]
        elif definition.scope == "band": scopes = bands
        elif definition.scope == "band/mode": scopes = sorted(set(scopes) | {f"{band} / {mode}" for band in bands for mode in modes})
        elif definition.scope == "mode": scopes = sorted(set(scopes) | set(modes))
        if not scopes:
            result.append({**metadata, "status": "UNVERIFIED",
                           "reason": "This finite dimension has no established scope in the copied log yet.", "rows": []})
            continue
        if len(universe) > 2000 or len(scopes) * len(universe) > 10000:
            result.append({**metadata, "status": "UNVERIFIED",
                           "reason": "The finite universe exceeds the bounded 10,000-cell/2,000-value analytical copy; no partial Needed list is presented.", "rows": []})
            continue
        worked = {(item["scope"], item["value"]) for item in view["rows"]}
        if any(value not in universe for _, value in worked):
            result.append({**metadata, "status": "UNVERIFIED",
                           "reason": "A stored worked identity lies outside the finite exchange contract; historical data is retained without inventing Needed values.", "rows": []})
            continue
        result.append({**metadata, "status": "PASS", "reason": provenance,
                       "rows": [{"scope": scope, "worked": [value for value in universe if (scope, value) in worked],
                                 "needed": [value for value in universe if (scope, value) not in worked]} for scope in scopes]})
        if state["pluginID"] == "ca_qso_party":
            result[-1]["remainingCreditSlots"] = max(0, 58 - view["total"])
            if not result[-1]["remainingCreditSlots"]:
                for row in result[-1]["rows"]: row["needed"] = []
        if len(json.dumps(result, ensure_ascii=False).encode()) > 512 * 1024:
            result[-1].update(status="UNVERIFIED", reason="Finite Needed data exceeds the 512 KiB snapshot budget; no truncated universe is presented.", rows=[])
    return result


def view_status(state):
    ids = {dimension.id for dimension in dimensions(state)}
    if state["pluginID"] in {"cq_ww_cw", "cq_ww_ssb", "cq_ww_rtty"}:
        return {"countries": "supported", "zones": "supported"}
    if state["pluginID"] in NO_MULTIPLIER_PLUGINS:
        return {"countries": "not-applicable", "zones": "not-applicable"}
    known = bool(ids)
    return {"countries": "not-implemented" if "country" in ids or not known else "not-applicable",
            "zones": "not-implemented" if "ituZone" in ids or not known else "not-applicable"}
