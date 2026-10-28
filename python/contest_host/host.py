"""Bounded application adapter: pinned plugins own rules, xLog owns output."""
from copy import deepcopy
from datetime import datetime, UTC
import base64
import hashlib
from html import escape as xml_escape
import ipaddress
import json
import logging
import math
import os
from pathlib import Path
import re
import socket
import sqlite3
from tempfile import TemporaryDirectory
import uuid
from xml.etree import ElementTree

from .store import CALLHISTORY_COLUMNS, Store, canonical
from .rates import calculate_rates
from .analytics import AnalyticsCopies
from .legacy_import import LegacyImportError, inspect_source, row_digest
from .n1mm import N1MMOutput
from .wae import DEFINITION_VERSION as WAE_DEFINITION_VERSION, RULE_EDITION as WAE_RULE_EDITION, PLUGINS as WAE_PLUGINS
from .plugins import (AADX_PLUGINS, ARRL_DX_PLUGINS, ARRL_VHF_PLUGINS, CENTRAL_EUROPEAN_PLUGINS,
                      CONDITIONAL_SERIAL_PLUGINS,
                      CONFIGURED_SENTNR_PLUGINS, CQ_160_PLUGINS,
                      CQ_WW_PLUGINS,
                      DISPLAY_SENTNR_PLUGINS, EA_MAJESTAD_PLUGINS,
                      ESTONIAN_PLUGINS, EUROPEAN_DX_PLUGINS, EUROPEAN_HF_PLUGINS,
                      JIDX_PLUGINS,
                      NO_MULTIPLIER_PLUGINS, QSO_PARTY_PLUGINS,
                      NAME_SPC_ENTRY_PLUGINS, NAME_SPC_PLUGINS, PLUGIN_REGISTRY,
                      PLUGINS, REF_PLUGINS, RSGB_PLUGINS, RTTY_MODES, RTTY_PLUGINS, SENTNR_FIELD_PLUGINS, SERIAL_PLUGINS,
                      SENT_FIELD_SERIAL_PLUGINS, SIMPLE_MULTIPLIER_PLUGINS, SSA_MT_PLUGINS, TEN_TEN_PLUGINS,
                      TYPE4_UTILITY_PLUGINS)
from .statistics import calculate_statistics
from .statistics_dupes import duplicate_flags
from .multipliers import (dimensions as multiplier_definitions, project as multiplier_dimensions,
                          view_status as multiplier_view_status, validate_multiplier_universe)
from .upstream import (CQWS_UF_LIMITATION, adapt_cw_template, cqws_multiplier_counts,
                       jidx_exchange_limit, load_plugin, load_cw_macros, pinned_band_definitions,
                       split_macro_template, verify_source)

PLUGIN_ID = "cq_ww_cw"
SCORING_REVISION_PLUGINS = frozenset({"hadx", "pacc", "rsgb_iota", "ref_cw", "ref_ssb", "es_open", "cqws", "jidx_cw", "jidx_ph"})
_NEW_SCORING_REVISION = object()
SOURCE_REVISION = "7c8b499225a73f7f8f792246881bd7aefc05452f"
INPUTS = ("callsign", "sent", "receive", "other_1", "other_2")
CONTACT_METADATA_FIELDS = {"Name": 20, "QTH": 25, "Comment": 60}
FIELDS = INPUTS + ("snt_label", "rcv_label", "other_label", "exch_label", "history_info")
BAND_DEFINITIONS = pinned_band_definitions()
BAND_LABELS = {definition["value"]: definition["id"] for definition in BAND_DEFINITIONS}
SINGLE_BAND_SCORE_VALUES = {label.upper(): value for value, label in BAND_LABELS.items()}
CQWS_EXCHANGES = frozenset({
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RS", "RO", "RN", "RR", "SC", "SP", "SE",
    "TO", "CL", "HQ", "RA", "DX", "PT", "BP", "RE", "GE", "DB", "FD", "YL", "QRP", "WS",
})
VOICE_INTENT_PLUGINS = {"arrl_ss_phone", "cq_wpx_ssb", "cq_ww_ssb", "ea_majestad_ssb", "ref_ssb",
                        "arrl_field_day", *ARRL_VHF_PLUGINS, *CENTRAL_EUROPEAN_PLUGINS,
                        *EUROPEAN_HF_PLUGINS, "ca_qso_party", "canada_day", "cqws",
                        "darc_schwaben", "winter_field_day", "rda_contest", "rdxc",
                        "rsgb_iota", "ukeidx", "wia_remembrance", "cq_ww_vhf", "darc_vhf",
                        "john_moyle_field_day", "nac_vhf", "ta_vhf_uhf_contest", "vhf_sprint"}
MIXED_MODE_PLUGINS = {"euhfc", "iaru_hf", "arrl_10m", "arrl_field_day", *ARRL_VHF_PLUGINS,
                      "es_field_day", "es_ll_kv", "es_open", *EUROPEAN_DX_PLUGINS,
                      *CENTRAL_EUROPEAN_PLUGINS, "ari_40_80", "ca_qso_party", "canada_day",
                      "cqws", "darc_schwaben", "winter_field_day"}
MIXED_MODE_PLUGINS |= {"rda_contest", "rdxc", "rsgb_iota", "ukeidx", "wia_remembrance",
                       "cq_ww_vhf", "darc_vhf", "john_moyle_field_day", "nac_vhf",
                       "ta_vhf_uhf_contest", "vhf_sprint"}
GRID4_EXCHANGE_PLUGINS = frozenset({"cq_ww_vhf", "labre_rs_digi", "vhf_sprint"})
SERIAL_GRID6_PLUGINS = frozenset({"darc_vhf", "nac_vhf", "ta_vhf_uhf_contest"})
FINAL_VHF_PLUGINS = GRID4_EXCHANGE_PLUGINS | SERIAL_GRID6_PLUGINS | frozenset({"john_moyle_field_day"})
# These pinned callbacks assign multipliers from earlier rows. A chronological
# append cannot change an existing row; corrections and tied/older inserts can.
APPEND_RECALCULATION_PLUGINS = frozenset({
    "trans_tasman", "oceania_dx_cw", "oceania_dx_ssb", *AADX_PLUGINS,
    *CQ_160_PLUGINS, *ESTONIAN_PLUGINS, *EUROPEAN_DX_PLUGINS,
    *CENTRAL_EUROPEAN_PLUGINS, *EUROPEAN_HF_PLUGINS, *QSO_PARTY_PLUGINS,
    "ca_qso_party", "canada_day", "cqws", "winter_field_day", "agcw_qrp",
    "rda_contest", "rdxc", *FINAL_VHF_PLUGINS,
})
# The block callback can reassign an earlier flag after tied contacts. Preserve
# the full-rebuild authority until a bounded append rule proves row equivalence.
FULL_REBUILD_APPEND_PLUGINS = frozenset({"john_moyle_field_day"})
APPEND_RECALCULATION_PLUGINS |= frozenset({"wae_cw", "wae_ssb", "wae_rtty"})
FULL_REBUILD_APPEND_PLUGINS |= frozenset({"wae_cw", "wae_ssb", "wae_rtty"})
ESTONIAN_REGIONS = frozenset({
    "HM", "HR", "IV", "JG", "JR", "LN", "LV", "PL",
    "PU", "RP", "SR", "TA", "TL", "VC", "VO", "VP",
})
VOICE_PAYLOAD_MAXIMUM = 4_096
DIGITAL_OUTPUT_MODES = frozenset({"RTTY", "USB-D", "LSB-D", "PKTLSB", "PKTUSB", "DIGI-U", "DIGI-L"})
ESM_ROLES = {"CQ": "esmCQ", "EXCH": "esmExchange", "QRZ": "esmQRZ", "AGN": "esmAGN",
             "HISCALL": "esmHisCall", "MYCALL": "esmMyCall", "QSOB4": "esmQsoB4"}
# Pre-settings host sessions always used these assignments. Materialize only
# missing values on restore; new setup documents explicitly choose upstream defaults.
LEGACY_ESM = {"useESM": True, "sendCorrectedCall": True, "esmCQ": "F1", "esmExchange": "F3",
              "esmQRZ": "F4", "esmAGN": "F9", "esmHisCall": "F2", "esmMyCall": "F5", "esmQsoB4": "DISABLED"}
CW_FORMATTING_DEFAULTS = {"cwSpeedStep": 1, "cwRSTFormat": "5NN", "cwSerialPaddingCharacter": "T",
                          "cwSerialPaddingLength": 3, "cwSerialOne": "1", "cwSerialNine": "9",
                          "cwSerialZero": "0"}
N1MM_DESTINATIONS = {
    "Radio": ("n1mmRadioDestinations", "n1mmRadioPort", 12060),
    "Contact": ("n1mmContactDestinations", "n1mmContactPort", 12061),
    "Lookup": ("n1mmLookupDestinations", "n1mmLookupPort", 12062),
    "Score": ("n1mmScoreDestinations", "n1mmScorePort", 12060),
}


def esm_preferences(preferences):
    result = {key: preferences.get(key, default) for key, default in LEGACY_ESM.items()}
    for key in ("useESM", "sendCorrectedCall"):
        require(type(result[key]) is bool, f"{key} must be boolean")
    for key in ESM_ROLES.values():
        require(isinstance(result[key], str) and result[key] in {"DISABLED", *(f"F{i}" for i in range(1, 13))},
                f"{key} must be F1-F12 or DISABLED")
    return result


def cw_formatting_preferences(preferences):
    """Return the finite original Not1MM CW presentation preferences."""
    result = {key: preferences.get(key, default) for key, default in CW_FORMATTING_DEFAULTS.items()}
    require(type(result["cwSpeedStep"]) is int and 1 <= result["cwSpeedStep"] <= 10,
            "cwSpeedStep must be an integer from 1 to 10")
    require(result["cwRSTFormat"] in {"5NN", "599", "ENN"}, "Invalid CW RST format")
    require(result["cwSerialPaddingCharacter"] in {"0", "O", "T"}, "Invalid CW serial padding character")
    require(type(result["cwSerialPaddingLength"]) is int and 1 <= result["cwSerialPaddingLength"] <= 10,
            "cwSerialPaddingLength must be an integer from 1 to 10")
    require(result["cwSerialOne"] in {"1", "A"}, "Invalid CW serial 1 substitution")
    require(result["cwSerialNine"] in {"9", "N"}, "Invalid CW serial 9 substitution")
    require(result["cwSerialZero"] in {"0", "O", "T"}, "Invalid CW serial 0 substitution")
    return result


def n1mm_preferences(network):
    """Validate the finite N1MM settings while retaining the original flat-key migration path."""
    require(isinstance(network, dict), "Network setup must be an object")
    for key in ("n1mmEnabled", "n1mmRadio", "n1mmContact", "n1mmLookup", "n1mmScore"):
        if key in network:
            require(type(network[key]) is bool, f"{key} must be boolean")
    for key in ("n1mmStationName", "n1mmOperatorName"):
        if key in network:
            text(network[key], 128)
    host = str(network.get("n1mmHost", "127.0.0.1"))
    result = {
        "enabled": network.get("n1mmEnabled", False),
        "stationName": str(network.get("n1mmStationName", network.get("stationName", ""))),
        "operatorName": str(network.get("n1mmOperatorName", "")),
    }
    for kind, (destination_key, port_key, default_port) in N1MM_DESTINATIONS.items():
        enabled = network.get(f"n1mm{kind}", False)
        destinations = str(network.get(destination_key, f"{host}:{network.get(port_key, default_port)}")).strip()
        if destinations:
            for connection in destinations.split():
                require(connection.count(":") == 1, f"Invalid N1MM {kind.lower()} destination")
                address, raw_port = connection.split(":")
                try:
                    port = int(raw_port)
                except ValueError as error:
                    raise HostError("invalid_request", f"Invalid N1MM {kind.lower()} destination") from error
                try:
                    ipaddress.IPv4Address(address)
                except ValueError:
                    labels = address.split(".")
                    require(len(address) <= 253 and all(
                        re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                        for label in labels), f"Invalid N1MM {kind.lower()} destination")
                require(str(port) == raw_port and 1 <= port <= 65535,
                        f"Invalid N1MM {kind.lower()} destination")
        require(not (result["enabled"] and enabled) or bool(destinations),
                f"N1MM {kind.lower()} destination is required")
        result[kind.lower()] = enabled
        result[f"{kind.lower()}Destinations"] = destinations
    return result


class HostError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, message, code="invalid_request"):
    if not condition:
        raise HostError(code, message)


def replica_wire_equal(left, right):
    """Exact JSON values across Swift's integral-number encoding and SQLite.

    14025.0 and 14025 carry the same numeric value; booleans, strings, missing
    keys and changed numeric values must still fail the before-image fence.
    Keep payload receipts/digests unchanged: this applies only to replica images.
    """
    if type(left) is bool or type(right) is bool:
        return type(left) is type(right) and left == right
    if type(left) in {int, float} and type(right) in {int, float}:
        return (type(left) is not float or math.isfinite(left)) and (type(right) is not float or math.isfinite(right)) and left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(replica_wire_equal(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(replica_wire_equal(a, b) for a, b in zip(left, right))
    return type(left) is type(right) and left == right


CQ_WW_STATION_ZONE_PLUGINS = {"cq_ww_cw", "cq_ww_ssb"}
CQ_WW_SSB_LOG_COLUMNS = (
    "YYYY-MM-DD HH:MM:SS", "Call", "Freq", "Snt", "Rcv",
    "M1", "ZN", "M2", "PFX", "PTS",
)


def cq_ww_duplicate_projection(plugin_id):
    if plugin_id not in CQ_WW_STATION_ZONE_PLUGINS:
        return ""
    return (
        ",CASE WHEN trim(d.Call)<>'' AND EXISTS(SELECT 1 FROM DXLOG AS prior "
        "WHERE prior.ContestNR=d.ContestNR AND upper(trim(prior.Call))=upper(trim(d.Call)) "
        "AND prior.Band=d.Band AND (prior.TS<d.TS OR (prior.TS=d.TS AND prior.rowid<d.rowid))) "
        "THEN 1 ELSE 0 END AS is_dupe "
    )


def apply_canonical_cq_ww_station_zone(plugin_id, station, settings):
    """CQ WW CW/SSB always send the station identity's canonical CQ zone."""
    if plugin_id not in CQ_WW_STATION_ZONE_PLUGINS:
        return
    zone = str(station.get("CQZone", "")).strip()
    require(zone.isdigit() and 1 <= int(zone) <= 40,
            "Station CQ zone must be 1 to 40")
    station["CQZone"] = zone
    settings["SentExchange"] = zone


def validate_rtc_xml(payload):
    require(isinstance(payload, str) and 1 <= len(payload.encode("utf-8")) <= 65_536,
            "RTC score XML is invalid", "rtc_payload_invalid")
    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError as error:
        raise HostError("rtc_payload_invalid", "RTC score XML is not well formed") from error
    require(root.tag == "dynamicresults", "RTC score XML has an invalid root", "rtc_payload_invalid")
    for field in ("contest", "call", "score", "timestamp"):
        value = root.findtext(field)
        require(isinstance(value, str) and bool(value.strip()),
                f"RTC score XML is missing {field}", "rtc_payload_invalid")
    require(root.find("breakdown") is not None,
            "RTC score XML is missing breakdown", "rtc_payload_invalid")
    return payload


def rtc_safe_values(values):
    """Escape operator-controlled strings before the pinned XML formatter sees them."""
    return {key: xml_escape(value, quote=True) if isinstance(value, str) else value
            for key, value in values.items()}


def validate_central_europe_sent_exchange(plugin_id, station_prefix, exchange):
    exchange = str(exchange)
    if plugin_id == "ari_dx":
        valid = (re.fullmatch(r"[A-Za-z]{2}", exchange) is not None
                 if station_prefix in {"I", "IS"} else exchange == "#")
        require(valid, "ARI DX sent exchange must be an Italian province or #")
    elif plugin_id in {"darc_xmas", "wag"}:
        valid = (re.fullmatch(r"[A-Za-z0-9]{1,6}", exchange) is not None and exchange != "#"
                 if station_prefix == "DL" else exchange == "#")
        require(valid, "DARC sent exchange must be a DOK/NM for DL or # outside DL")
    elif plugin_id == "eudx":
        require((re.fullmatch(r"[A-Za-z]{2}[0-9]{2}", exchange) is not None)
                or (exchange.isdigit() and 1 <= int(exchange) <= 90),
                "EUDX sent exchange must be an EU Union region or ITU zone 1 to 90")
    elif plugin_id == "lz-dx":
        valid = (re.fullmatch(r"[A-Za-z]{2}", exchange) is not None if station_prefix == "LZ"
                 else exchange.isdigit() and 1 <= int(exchange) <= 90)
        require(valid, "LZ DX sent exchange must be a district in LZ or ITU zone 1 to 90")


def validate_central_europe_historical_sent_exchange(plugin_id, exchange):
    """Validate the union of exchanges a past station setup could have sent."""
    exchange = str(exchange)
    positive_serial = exchange.isdigit() and 0 < int(exchange) <= 9223372036854775807
    if plugin_id == "ari_dx":
        valid = positive_serial or re.fullmatch(r"[A-Za-z]{2}", exchange) is not None
    elif plugin_id in {"darc_xmas", "wag"}:
        valid = re.fullmatch(r"[A-Za-z0-9]{1,6}", exchange) is not None
    elif plugin_id == "eudx":
        valid = (re.fullmatch(r"[A-Za-z]{2}[0-9]{2}", exchange) is not None
                 or exchange.isdigit() and 1 <= int(exchange) <= 90)
    else:
        valid = (re.fullmatch(r"[A-Za-z]{2}", exchange) is not None
                 or exchange.isdigit() and 1 <= int(exchange) <= 90)
    require(valid, "Historical sent exchange is invalid for this contest")


def identifier(value):
    require(isinstance(value, str), "UUID required")
    try:
        require(str(uuid.UUID(value)) == value.lower(), "Canonical UUID required")
    except ValueError as error:
        raise HostError("invalid_request", "UUID required") from error
    return value.lower()


def text(value, maximum=256):
    require(isinstance(value, str) and len(value.encode("utf-8")) <= maximum, "Text exceeds field bound")
    require(not any(ord(c) < 32 for c in value), "Control characters are not accepted")
    return value


def validate_jidx_number(value, prefix, call, scoring_revision, direction):
    number = str(value)
    require(re.fullmatch(r"[0-9]+", number) is not None
            and 0 < int(number) <= 9223372036854775807,
            "JIDX sent and received prefecture/CQ zones must be positive SQLite integers")
    if scoring_revision == "26.10.26":
        maximum = jidx_exchange_limit(prefix, call)
        kind = "prefecture" if maximum == 50 else "CQ zone"
        require(int(number) <= maximum, f"JIDX {direction} {kind} must be 1 to {maximum}")


def digital_text(value, maximum=256):
    """Bound fldigi output while admitting only its documented newline control."""
    require(isinstance(value, str) and len(value.encode("utf-8")) <= maximum, "Text exceeds field bound")
    require(not any(ord(character) < 32 and character != "\n" for character in value),
            "Digital output contains an unsupported control character")
    return value


def requires_serial(state):
    plugin_id = state["pluginID"]
    return (plugin_id in SERIAL_PLUGINS
            or plugin_id in CONDITIONAL_SERIAL_PLUGINS
            and "#" in str(state["settings"].get("SentExchange", ""))
            or plugin_id == "rda_contest" and not rda_station_is_russian(state))


def rda_station_is_russian(state):
    station = state.get("station", {}).get("Call", "")
    entity = state.get("reference", {}).get("countries", {}).get(station, {}).get("entity", "")
    return entity in {"European Russia", "Asiatic Russia", "Kaliningrad"}


def reserved_sent_exchange(state, serial):
    value = str(serial).zfill(3)
    if state["pluginID"] in {"canada_day", "rsgb_iota", "ukeidx"}:
        return str(state["settings"].get("SentExchange", "#")).replace("#", value)
    if state["pluginID"] == "es_field_day":
        return f'{value} {str(state["station"].get("State", "")).upper()}'
    if state["pluginID"] == "es_manual_key":
        return f'{str(state["station"].get("LicenseClass", "")).upper()}{value}'
    return value


def serial_scope(state, frequency):
    scope = "contest"
    if ((state["pluginID"] == "trans_tasman"
         and state["settings"].get("OperatorCategory", "") != "SINGLE-OP")
            or (state["pluginID"] == "john_moyle_field_day"
                and state["settings"].get("OperatorCategory", "") in {"MULTI-OP", "MULTI-TWO"})):
        scope = f"band:{Desk.band(frequency)}"
    return scope


def validate_ca_exchange(contest, exchange, setup=False):
    """Accept upstream CQP tokens and its documented county-line syntax."""
    value = str(exchange).upper().strip()
    if setup:
        value = value.lstrip("# ")
    parts = value.split("/")
    valid = (1 <= len(parts) <= 8 and all(part in contest.CA_COUNTIES for part in parts))
    if len(parts) == 1:
        valid = valid or value in contest.CA_MULTS or value == "DX"
    require(valid, "CQP exchange must be a valid state, province, DX, or slash-separated CA counties")


def valid_raem_coordinates(value):
    match = re.fullmatch(r"([0-9]{1,2})([NS])([0-9]{1,3})([WO])", str(value).upper())
    return bool(match and int(match[1]) <= 90 and int(match[3]) <= 180)


def valid_grid4(value):
    return re.fullmatch(r"[A-Ra-r]{2}[0-9]{2}", str(value)) is not None


def normalize_cq_vhf_grid(value):
    source = str(value).upper().strip()
    candidate = source.split()[0] if source else ""
    candidate = candidate[:4] if len(candidate) >= 4 else candidate
    return candidate if len(candidate) == 4 and candidate[:2].isalpha() and candidate[2:].isdigit() else ""


def valid_grid6(value):
    return re.fullmatch(r"[A-Ra-r]{2}[0-9]{2}[A-Xa-x]{2}", str(value)) is not None


def validate_final_vhf_setup(plugin_id, state, exchange):
    if plugin_id == "cq_ww_vhf":
        require(bool(normalize_cq_vhf_grid(exchange)), "Sent exchange must contain a 4-character grid square")
    elif plugin_id in GRID4_EXCHANGE_PLUGINS:
        require(valid_grid4(exchange), "Sent exchange must be a 4-character grid square")
    if plugin_id in SERIAL_GRID6_PLUGINS:
        require(valid_grid6(state["station"].get("GridSquare", "")),
                "Station grid must be a 6-character Maidenhead locator")


def validate_batch2_setup(plugin_id, state, exchange):
    value = str(exchange).upper().strip()
    if plugin_id == "agcw_qrp":
        require(re.fullmatch(r"(?:#|[0-9]+) (?:VLP|QRP|MP|QRO) (?:NM|[0-9]+)", value) is not None,
                "AGCW QRP sent exchange must be # or SERIAL, then POWER and MEMBER (or NM)")
    elif plugin_id == "raem":
        require(valid_raem_coordinates(value), "RAEM sent exchange must be latitude/longitude such as 33N117W")
    elif plugin_id == "rda_contest":
        require((rda_station_is_russian(state) and re.fullmatch(r"[A-Z]{2}-?[0-9]{2}", value) is not None)
                or (not rda_station_is_russian(state) and value == "#"),
                "RDA sent exchange must be an RDA code for Russian stations or # elsewhere")
    elif plugin_id == "rdxc":
        require(value == "#", "RDXC sent exchange must be #")
    elif plugin_id == "rsgb_iota":
        require(re.fullmatch(r"(?:#|0*[1-9][0-9]*)(?: [A-Z]{2}-?[0-9]{3})?", value) is not None,
                "RSGB IOTA sent exchange must be # with an optional IOTA reference")
    elif plugin_id == "stew_perry_topband":
        station_grid = str(state["station"].get("GridSquare", "")).upper()
        require(re.fullmatch(r"[A-R]{2}[0-9]{2}(?:[A-X]{2})?", station_grid) is not None
                and value == station_grid[:4],
                "Stew Perry sent exchange must match the 4-character prefix of the station grid")
    elif plugin_id == "ukeidx":
        require(re.fullmatch(r"(?:#|0*[1-9][0-9]*)(?: [A-Z0-9]{1,4})?", value) is not None,
                "UKEI DX sent exchange must be # with an optional district")
    elif plugin_id == "wia_remembrance":
        require(value == "#" or value.isdigit() and int(value) > 0,
                "WIA Remembrance sent exchange must be # or positive licensed years")


def validate_cwo_names(station, sent_exchange):
    """Match cwo.py's ASCII name parser and station-name export token."""
    require(isinstance(sent_exchange, str)
            and re.fullmatch(r"[A-Za-z]{1,32}", sent_exchange) is not None,
            "CW Open sent exchange must be one ASCII-letter name")
    station_name = station.get("Name", "")
    require(isinstance(station_name, str), "CW Open station name must be text")
    export_name = station_name.partition(" ")[0]
    require(re.fullmatch(r"[A-Za-z]{1,32}", export_name) is not None,
            "CW Open Station Name must begin with an ASCII-letter name")
    require(export_name.casefold() == sent_exchange.casefold(),
            "CW Open Station Name must begin with the Sent Exchange name")


def validate_name_sent_exchange(sent_exchange):
    require(isinstance(sent_exchange, str)
            and sent_exchange == sent_exchange.strip()
            and 0 < len(sent_exchange) <= 64,
            "Sent exchange must be non-empty text without surrounding whitespace")


def validate_ten_ten_sent_exchange(sent_exchange):
    """Bound setup to the same three-token shape as the original plugin exchange."""
    parts = sent_exchange.upper().split() if isinstance(sent_exchange, str) else []
    require(len(parts) == 3 and parts[0].isalpha() and parts[1].isdigit() and parts[2].isalpha(),
            "10-10 sent exchange must be NAME 10-10# SPC")


def validate_cq_ww_rtty_sent_exchange(sent_exchange):
    parts = str(sent_exchange).split()
    require(1 <= len(parts) <= 2 and parts[0].isdigit() and 1 <= int(parts[0]) <= 40
            and (len(parts) == 1 or re.fullmatch(r"[A-Za-z]{1,4}", parts[1]) is not None),
            "CQ WW RTTY sent exchange must be CQ zone plus optional state/VE area")


def validate_estonian_setup(plugin_id, station, settings):
    start = settings.get("StartDate")
    try:
        require(datetime.strptime(start, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == start,
                "Estonian contest start must be UTC YYYY-MM-DD HH:MM:SS")
    except (TypeError, ValueError) as error:
        raise HostError("invalid_request", "Estonian contest start must be UTC YYYY-MM-DD HH:MM:SS") from error
    if plugin_id == "es_field_day":
        require(str(station.get("State", "")).upper() in ESTONIAN_REGIONS,
                "ES Field Day station State must be an Estonian region")
    if plugin_id == "es_manual_key":
        require(re.fullmatch(r"[0-9]{2}", str(station.get("LicenseClass", ""))) is not None,
                "ES Manual Key License Class must be two seniority digits")


def validate_edi_start(settings):
    """Require the exact UTC timestamp shape consumed by the original EDI writers."""
    start = settings.get("StartDate")
    try:
        require(datetime.strptime(start, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == start,
                "EDI contest start must be UTC YYYY-MM-DD HH:MM:SS")
    except (TypeError, ValueError) as error:
        raise HostError("invalid_request", "EDI contest start must be UTC YYYY-MM-DD HH:MM:SS") from error


def validate_european_hf_setup(plugin_id, station_prefix, sent_exchange):
    """Bound setup values required by the five original European HF plugins."""
    exchange = str(sent_exchange).upper()
    if plugin_id == "ari_40_80":
        require(re.fullmatch(r"[A-Z0-9]{1,6}", exchange) is not None,
                "ARI 40/80 sent automobile code must be 1 to 6 letters or digits")
    elif plugin_id == "ea_rtty":
        valid = (re.fullmatch(r"[A-Z]{1,2}", exchange) is not None
                 if station_prefix.startswith("EA") else exchange == "#")
        require(valid, "EA RTTY sent exchange must be an EA province or # outside EA")
    elif plugin_id == "ok1wc":
        require(exchange == "#", "OK1WC requires # as the serial exchange")
    else:
        require(re.fullmatch(r"[A-R]{2}[0-9]{2}[A-X]{2}", exchange) is not None,
                "SSA MT sent exchange must be a 6-character locator")


def now():
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def operating_mode(state):
    """Return the live QSO mode without conflating it with Cabrillo category."""
    return state.get("operatingMode", state["settings"]["ModeCategory"])


def default_report(mode):
    return "59" if mode in {"SSB", "AM", "FM"} else "599"


def workspace_generation(state):
    """Return the persisted window identity, or a stable identity for pre-contract sessions."""
    value = state.get("workspaceGeneration")
    if value is not None:
        return identifier(value)
    return str(uuid.uuid5(uuid.UUID(state["sessionID"]), "xlog-not1mm-workspace"))


def coordination_identity(state):
    """Immutable-enough contest identity shared by one authoritative log and its replicas."""
    value = state.get("coordinationBasis") or {
        "pluginID": state["pluginID"], "sourceRevision": SOURCE_REVISION,
        "referenceID": state["reference"]["id"], "station": state["station"],
        "settings": state["settings"],
    }
    if state.get("scoringRevision"):
        value = {**value, "scoringRevision": state["scoringRevision"]}
    return {"pluginID": value["pluginID"], "sourceRevision": value["sourceRevision"],
            "referenceID": value["referenceID"],
            "coordinationDigest": hashlib.sha256(canonical(value).encode()).hexdigest()}


def authority_identity(state):
    return {"sessionID": state["sessionID"],
            "workspaceGeneration": workspace_generation(state),
            **coordination_identity(state)}


def allocated_serial_field(state):
    if not requires_serial(state) or state["pluginID"] in SSA_MT_PLUGINS:
        return None
    return "sent" if state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else "other_1"


class Field:
    """Only the audited plugin field API; Python rejects unknown attributes."""
    __slots__ = ("name", "value", "maximum", "visible", "accessible_name", "read_only", "enabled", "focused", "tooltip", "style_sheet")

    def __init__(self, name, value="", maximum=512):
        self.name, self.value, self.maximum, self.visible = name, "", maximum, True
        self.accessible_name, self.read_only, self.enabled, self.focused, self.tooltip, self.style_sheet = "", False, True, False, "", ""
        self.setText(value)

    def text(self):
        return self.value

    def setText(self, value):
        self.value = text(str(value), self.maximum)

    def show(self):
        self.visible = True

    def hide(self):
        self.visible = False

    def setAccessibleName(self, value):
        self.accessible_name = text(value)

    def setReadOnly(self, value):
        require(type(value) is bool, "Read-only flag must be boolean")
        self.read_only = value

    def setEnabled(self, value):
        require(type(value) is bool, "Enabled flag must be boolean")
        self.enabled = value

    def setFocus(self):
        self.focused = True

    def toolTip(self):
        return self.tooltip

    def setStyleSheet(self, value):
        self.style_sheet = text(value, 1024)


class DigitalOutputSink:
    """Finite compatibility target for original digital ESM without hardware output."""

    def __init__(self, desk):
        self.desk = desk

    def send_string(self, value, nlbefore=True, rxafter=True):
        self.desk.record_fldigi_output(value, nlbefore=nlbefore, rxafter=rxafter)


class Desk:
    def __init__(self, store, state, commit):
        self.database, self.state, self._commit = store, state, commit
        self.database.plugin_id = state["pluginID"]
        self.database.score_band = (SINGLE_BAND_SCORE_VALUES.get(
            str(state["settings"].get("BandCategory", "ALL")).upper())
            if state["pluginID"] == "cq_ww_ssb" else None)
        self.contest = load_plugin(state["pluginID"])
        self.cw_macros = load_cw_macros(state["pluginID"])
        self.macro_origins = {identity: "pinned_not1mm" for identity in self.cw_macros}
        for macro in state.get("setup", {}).get("macros", []):
            identity = (macro["mode"], macro["key"])
            self.cw_macros[identity] = {
                "label": macro["label"],
                "template": adapt_cw_template(state["pluginID"], macro["template"]),
            }
            self.macro_origins[identity] = "session_setup"
        self.station, self.contest_settings = state["station"], state["settings"]
        esm = esm_preferences(state.get("setup", {}).get("preferences", {}))
        self.use_esm = esm["useESM"]
        if state.get("setup", {}).get("preferences", {}).get("enterPolicy") == "esm":
            self.use_esm = True
        self.pref = {"contest": 1, "run_state": state["run"], "use_esm": self.use_esm,
                     "esm_send_corrected_call": esm["sendCorrectedCall"]}
        self.actions, self.messages, self.highlights = [], [], set()
        self.prev_call = ""
        self.RoverLocation = str(state.get("roverLocation", "")).upper()
        # Original plugins may notify Not1MM's optional log window after a
        # multiplier rebuild. xLog projects the rebuilt database directly.
        self.log_window = None
        for name in FIELDS:
            # Upstream assembles up to four separately bounded CALLHISTORY
            # values into this read-only presentation line. Keep operator
            # inputs at their exact 512-byte protocol bound while allowing
            # that combined output to remain lossless.
            maximum = 4_096 if name == "history_info" else 512
            setattr(self, name, Field(name, state["draft"]["fields"].get(name, ""), maximum))
        # fieldN are visual containers, not a second set of input values.
        self.field0, self.field1, self.field2, self.field3, self.field4 = [Field(f"field{i}") for i in range(5)]
        self.inputs_dict = {getattr(self, name): name for name in INPUTS}
        for i in range(1, 13):
            button = Field(f"F{i}")
            button.tooltip = self.cw_macros[("R" if state["run"] else "S", f"F{i}")]["template"]
            setattr(self, f"F{i}", button)
        self.esm_dict = {role: None if esm[key] == "DISABLED" else getattr(self, esm[key])
                         for role, key in ESM_ROLES.items()}
        self.current_widget = state["focus"]
        self.esm_call_sent = state.get("esmCallSent", "")
        self.current_sn, self.contact_is_dupe = state["draft"].get("serial", 0), 0
        self.radio_state = {"vfoa": state["draft"]["frequencyHz"], "mode": operating_mode(state)}
        self.contact = self.database.get_empty().copy()
        if state["pluginID"] in RTTY_PLUGINS:
            self.fldigi_util = DigitalOutputSink(self)
        self.contest.init_contest(self)
        # DX-Pedition initializes this transient GUI attribute itself. Restore
        # the bounded draft value only after that callback for request continuity.
        self.prev_call = text(state["draft"].get("prevCall", ""), 32)
        if requires_serial(state) and state["pluginID"] not in SSA_MT_PLUGINS:
            # Older hosts allowed this visible field to drift from the durable
            # reservation. Reconcile it on every load before any projection,
            # mutation, direct commit, or reopen can consume the stale value.
            expected = reserved_sent_exchange(state, state["draft"]["serial"])
            serial_field = self.sent if state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else self.other_1
            serial_field.setText(expected)
            state["draft"]["fields"][serial_field.name] = expected
            serial_field.setReadOnly(True)

    def set_running(self, value):
        require(type(value) is bool, "Running flag must be boolean")
        self.state["run"] = value
        self.pref["run_state"] = value

    def cty_lookup(self, call):
        result = self.state["reference"]["countries"].get(call.upper())
        return {result["primary_pfx"]: deepcopy(result)} if result else None

    def show_message_box(self, message):
        self.messages.append(str(message))

    def restore_button_color(self, button):
        if button:
            self.highlights.discard(button.name)

    def make_button_green(self, button):
        if button:
            self.highlights.add(button.name)

    def process_function_key(self, button):
        require(button.name in {f"F{i}" for i in range(1, 13)}, "Unknown function key")
        macro_mode = "R" if self.state["run"] else "S"
        identity = (macro_mode, button.name)
        macro = self.cw_macros[identity]
        if not macro["template"].strip():
            return
        text_template, macro_actions = split_macro_template(macro["template"])
        mode = operating_mode(self.state)
        if re.search(r"\[f(?:10|[1-9])\]", text_template, re.IGNORECASE):
            require(mode == "SSB",
                    "Not1MM VOICEn compatibility uses xLog managed WAV slots only in SSB voice output")
        context = {"sessionID": self.state["sessionID"], "workspaceGeneration": workspace_generation(self.state),
                   "sourceRevision": SOURCE_REVISION, "draftID": self.state["draft"]["id"],
                   "fields": self.values(), "stationCall": self.station["Call"],
                   "sentExchange": str(self.contest_settings["SentExchange"]),
                   "sentSerial": (str(self.current_sn) if self.state["pluginID"] in SSA_MT_PLUGINS | SENT_FIELD_SERIAL_PLUGINS
                                  else self.other_1.text() if self.state["pluginID"] in SENTNR_FIELD_PLUGINS else "")}
        rendered = self.process_macro(text_template)
        self.execute_macro_actions(macro_actions)
        if not text_template.strip():
            return
        if mode == "SSB":
            if self.state["pluginID"] not in VOICE_INTENT_PLUGINS:
                return
            payload = text(rendered, VOICE_PAYLOAD_MAXIMUM)
            source_macro = {"origin": self.macro_origins[identity],
                            "path": ("not1mm/data/cwmacros.txt"
                                     if self.macro_origins[identity] == "pinned_not1mm" else None),
                            "revision": SOURCE_REVISION, "mode": macro_mode, "key": button.name,
                            "label": macro["label"], "template": macro["template"]}
            payload_bytes = payload.encode("utf-8")
            self.actions.append({"kind": "voice_keyer", "signal": "phone", "mode": "SSB",
                                 "key": button.name, "label": macro["label"], "payload": payload,
                                 "payloadUTF8Bytes": len(payload_bytes),
                                 "payloadSHA256": hashlib.sha256(payload_bytes).hexdigest(),
                                 "sourceMacro": source_macro,
                                 "sourceMacroSHA256": hashlib.sha256(
                                     canonical(source_macro).encode("utf-8")).hexdigest(),
                                 **context})
            return
        if mode in DIGITAL_OUTPUT_MODES:
            self.record_fldigi_output(rendered)
            if self.state.get("laneState"):
                self.actions[-1].update(context)
            return
        if mode != "CW":
            return
        self.actions.append({"kind": "function_key", "key": button.name,
                             "label": macro["label"], "template": text_template,
                             **context})

    def record_fldigi_output(self, value, nlbefore=True, rxafter=True):
        require(self.state["pluginID"] in RTTY_PLUGINS, "This contest has no original fldigi transmit path")
        require(type(nlbefore) is bool and type(rxafter) is bool, "Invalid fldigi transmit options")
        payload = digital_text(value, VOICE_PAYLOAD_MAXIMUM)
        payload_bytes = payload.encode("utf-8")
        self.actions.append({"kind": "fldigi", "signal": "digital", "mode": operating_mode(self.state),
                             "payload": payload, "payloadUTF8Bytes": len(payload_bytes),
                             "payloadSHA256": hashlib.sha256(payload_bytes).hexdigest(),
                             "nlBefore": nlbefore, "rxAfter": rxafter,
                             "sessionID": self.state["sessionID"],
                             "workspaceGeneration": workspace_generation(self.state),
                             "sourceRevision": SOURCE_REVISION, "draftID": self.state["draft"]["id"]})

    def process_macro(self, template):
        values = {
            "MYCALL": self.station["Call"],
            "CALL": self.callsign.text(),
            "HISCALL": self.callsign.text(),
            "RST": self.sent.text(),
            "SNT": self.sent.text(),
            "EXCHANGE": str(self.contest_settings["SentExchange"]),
            "EXCH": str(self.contest_settings["SentExchange"]),
            "SENTNR": (str(self.current_sn) if self.state["pluginID"] in SSA_MT_PLUGINS else
                       str(self.contest_settings["SentExchange"])
                       if self.state["pluginID"] in CONFIGURED_SENTNR_PLUGINS
                       else self.other_1.text()),
            "OTHER1": self.other_1.text(),
            "OTHER2": self.other_2.text(),
        }
        if "{PREVNR}" in template:
            previous = self.database.exec_sql(
                "SELECT SentNr FROM DXLOG WHERE ContestNR=? ORDER BY TS DESC,rowid DESC LIMIT 1",
                (self.database.current_contest,),
            )
            values["PREVNR"] = str(previous.get("SentNr") or "") if previous else ""

        serial = None
        def reserved_serial():
            nonlocal serial
            require(type(self.current_sn) is int and self.current_sn > 0,
                    "Not1MM # macro requires an already-reserved current serial")
            serial = serial or str(self.current_sn)
            return serial

        def expand(match):
            syntax = match.group(0)
            if syntax == "#":
                return reserved_serial()
            if syntax == "^M":
                require(self.state["pluginID"] in RTTY_PLUGINS,
                        "Not1MM ^M newline requires the original RTTY/fldigi output owner")
                return "\n"
            token = syntax[1:-1]
            value = values[token]
            # Original Not1MM expands EXCH before # so a configured serial
            # placeholder remains meaningful. Other substituted values are
            # opaque and must never be reinterpreted as template syntax.
            return value.replace("#", reserved_serial()) if token == "EXCHANGE" and "#" in value else value

        syntax = r"\{(?:" + "|".join(map(re.escape, values)) + r")\}|#|\^M"
        return re.sub(syntax, expand, template)

    def execute_macro_actions(self, actions):
        """Route validated macro actions through the existing contest owner methods."""
        for action in actions:
            if action == "LOGIT":
                self.save_contact()
            elif action == "RUN":
                self.set_running(True)
            elif action == "SANDP":
                self.set_running(False)
            elif action == "WIPE":
                self.clear_inputs()
            else:  # split_macro_template only returns the finite tuple above.
                raise HostError("invalid_request", "Unsupported contest macro action")

    def clear_inputs(self):
        """Apply Not1MM WIPE without changing reserved/read-only exchange fields."""
        containers = (self.field0, self.field1, self.field2, self.field3, self.field4)
        for name, container in zip(INPUTS, containers):
            field = getattr(self, name)
            if field.read_only or not container.visible:
                continue
            field.setText(default_report(operating_mode(self.state)) if name in {"sent", "receive"} else "")
        self.current_widget = "callsign"

    def save_contact(self):
        self._commit(self)

    def values(self):
        return {name: getattr(self, name).text() for name in INPUTS}

    def persist(self):
        self.state["draft"]["fields"] = self.values()
        self.state["focus"] = self.current_widget
        self.state["esmCallSent"] = self.esm_call_sent
        self.state["draft"]["prevCall"] = text(self.prev_call, 32)

    def contact_for(self, fields, qso_id, timestamp, frequency, base=None, operator=None):
        for name in INPUTS:
            getattr(self, name).setText(fields[name])
        call = self.parsed_call()
        country = self.cty_lookup(call)
        info = next(iter(country.values())) if country else {}
        band = self.band(frequency)
        self.contact = deepcopy(base) if base is not None else self.database.get_empty().copy()
        from not1mm.lib.ham_utility import calculate_wpx_prefix
        rover_location = (base.get("RoverLocation", "") if base is not None else
                          self.state.get("roverLocation") or self.state["station"].get("RoverQTH", ""))
        self.RoverLocation = str(rover_location).upper()
        self.contact.update({"ID": qso_id, "Call": call, "TS": timestamp, "Freq": frequency / 1000,
            "Band": band, "Operator": operator or self.state["operator"],
            "RoverLocation": str(rover_location).upper(),
            "CountryPrefix": info.get("primary_pfx", ""), "Continent": info.get("continent", ""),
            "ZN": info.get("cq", 0), "WPXPrefix": calculate_wpx_prefix(call)})
        if base is None:
            # Original phone Cabrillo converts USB/LSB to PH.
            mode = operating_mode(self.state)
            radio_mode = ("LSB" if frequency < 10000000 else "USB") if mode == "SSB" else mode
            self.contact.update({"QSXFreq": frequency / 1000, "Mode": radio_mode, "ContestNR": 1,
                "ContestName": self.contest.cabrillo_name, "StationPrefix": self.station["Call"],
                "IsRunQSO": int(self.pref["run_state"]), "Run1Run2": 1})
            if self.state["pluginID"] in {"ca_qso_party", "winter_field_day", "raem"}:
                self.contact["MiscText"] = str(self.state["settings"].get("SentExchange", "")).upper()
            if self.state["pluginID"] == "stew_perry_topband":
                sent_grid = str(self.state["settings"].get("SentExchange", "")).upper()
                station_grid = str(self.state["station"].get("GridSquare", "")).upper()
                self.contact["MiscText"] = f"{sent_grid}|{station_grid}"
                # Stew Perry's QSO points include the entrant power category.
                # Keep the category with the row so setup edits cannot rewrite
                # the historical power multiplier during a score rebuild.
                self.contact["Power"] = str(self.state["settings"].get("PowerCategory", "")).upper()
            if self.state["pluginID"] in SERIAL_GRID6_PLUGINS:
                # Distance scoring belongs to the station locator in force when
                # the QSO was logged, not a later setup edit.
                self.contact["MiscText"] = str(self.state["station"].get("GridSquare", "")).upper()
        self.contact_is_dupe = int(self.is_dupe(call, band, timestamp, self.contact["Mode"]))
        self.contest.set_contact_vars(self)
        if self.state["pluginID"] in ARRL_DX_PLUGINS:
            # The original plugin owns multiplier assignment in prefill().
            # Invoke it after the contact's band, entity and exchange exist.
            self.contest.prefill(self)
        self.contact["Points"] = self.contest.points(self)
        return deepcopy(self.contact)

    def parsed_call(self):
        # Sweepstakes' original parser may supply a corrected call inside the
        # packed exchange. Use that result consistently for identity and dupe.
        if self.state["pluginID"] in {"arrl_ss_cw", "arrl_ss_phone"}:
            return self.contest.parse_exchange(self)[4]
        return self.callsign.text().upper()

    def is_dupe(self, call, band, timestamp=None, mode="CW"):
        if self.contest.dupe_type == 4:
            return False
        if self.contest.dupe_type == 5:
            previous = self.contact
            previous_mode = self.radio_state["mode"]
            self.contact = {"Band": band}
            self.radio_state["mode"] = mode
            self.dupe_timestamp = timestamp or now()
            try:
                return bool(self.contest.specific_contest_check_dupe(self, call).get("isdupe"))
            finally:
                self.contact = previous
                self.radio_state["mode"] = previous_mode
        if self.contest.dupe_type == 1:
            return bool(self.database.check_dupe(call).get("isdupe"))
        if self.contest.dupe_type == 3:
            return bool(self.database.check_dupe_on_band_mode(call, band, mode).get("isdupe"))
        return bool(self.database.check_dupe_on_band(call, band).get("isdupe"))

    def contest_band(self, frequency):
        band = self.band(frequency)
        require(self.state["pluginID"] != "trans_tasman" or band in {1.8, 3.5, 7.0},
                "Trans Tasman supports only 160, 80 and 40 metres", "invalid_frequency")
        require(self.state["pluginID"] != "phone_weekly_test" or band != 28.0,
                "Phone Weekly Test supports 160 through 15 metres", "invalid_frequency")
        require(self.state["pluginID"] not in {"cq_wpx_rtty", "weekly_rtty"} or band != 1.8,
                "Selected RTTY contest supports 80 through 10 metres", "invalid_frequency")
        require(self.state["pluginID"] not in CQ_160_PLUGINS or band == 1.8,
                "CQ 160 supports only 160 metres", "invalid_frequency")
        require(self.state["pluginID"] != "arrl_160m" or band == 1.8,
                "ARRL 160 supports only 160 metres", "invalid_frequency")
        require(self.state["pluginID"] != "arrl_10m" or band == 28.0,
                "ARRL 10M supports only 10 metres", "invalid_frequency")
        require(self.state["pluginID"] != "rsgb_80m_cc" or band == 3.5,
                "RSGB 80M CC supports only 80 metres", "invalid_frequency")
        require(self.state["pluginID"] != "rsgb_commonwealth_beru" or band != 1.8,
                "RSGB Commonwealth BERU supports only 80 through 10 metres", "invalid_frequency")
        require(BAND_LABELS[band] in PLUGIN_REGISTRY[self.state["pluginID"]].bands,
                f'{PLUGIN_REGISTRY[self.state["pluginID"]].name} does not support {BAND_LABELS[band]}',
                "invalid_frequency")
        return band

    @staticmethod
    def band(frequency):
        for definition in BAND_DEFINITIONS:
            if definition["lowHz"] <= frequency < definition["highHz"]:
                return definition["value"]
        raise HostError("invalid_frequency", "Frequency is outside supported contest bands")

    def exchange_warnings(self):
        if self.state["pluginID"] != "cq_ww_ssb":
            return []
        call = self.parsed_call()
        country = self.state["reference"]["countries"].get(call, {})
        prior = self.database.exec_sql_mult(
            "SELECT DISTINCT ZN FROM DXLOG WHERE ContestNR=? AND Call=?", (self.database.current_contest, call)) if call else []
        return Host.exchange_warnings(self.other_2.text(), country, [row["ZN"] for row in prior])

    def entry_multiplier_status(self, call, band, country, duplicate):
        """Read CQ WW credit from the same eligible log rows as the score."""
        if self.state["pluginID"] not in CQ_WW_STATION_ZONE_PLUGINS or not call or duplicate:
            return None
        prefix = str(country.get("primary_pfx", "")).strip().upper()
        zone = self.other_2.text().strip()
        if (not prefix or not re.fullmatch(r"[0-9]+", zone) or not 1 <= int(zone) <= 40
                or not band or self.database.score_band not in (None, band)):
            return None
        counts = self.database.exec_sql(
            "SELECT count(CASE WHEN q.CountryPrefix=? THEN 1 END) AS countries, "
            "count(CASE WHEN q.ZN=? THEN 1 END) AS zones FROM DXLOG AS q "
            "WHERE q.ContestNR=? AND q.Band=? AND " + self.database.cq_ww_multiplier_filter(),
            (prefix, int(zone), self.database.current_contest, band),
        )
        new_country, new_zone = counts["countries"] == 0, counts["zones"] == 0
        return ("new-zone-and-country" if new_country and new_zone else "new-country" if new_country
                else "new-zone" if new_zone else "no-new-multiplier")

    def projection(self):
        if (self.state.get("setup", {}).get("preferences", {}).get("callHistory", True) is not False
                and hasattr(self.contest, "populate_history_info_line")):
            self.contest.populate_history_info_line(self)
        else:
            self.history_info.setText("")
        # Rebuild Not1MM's non-transmitting ESM presentation on every read so
        # highlights survive reopen/refresh without emitting an output intent.
        if self.use_esm and hasattr(self.contest, "process_esm"):
            self.contest.process_esm(self, getattr(self, self.current_widget), False)
        call = self.parsed_call()
        fields = []
        containers = [self.field0, self.field1, self.field2, self.field3, self.field4]
        labels = ["Call", self.snt_label.text() or "SNT", self.rcv_label.text() or "RCV", self.other_label.text(), self.exch_label.text()]
        for name, container, label in zip(INPUTS, containers, labels):
            field = getattr(self, name)
            fields.append({"id": name, "value": field.text(), "visible": container.visible,
                           "label": label, "accessibleName": container.accessible_name or label,
                           "readOnly": field.read_only, "enabled": field.enabled})
        band = self.band(self.state["draft"]["frequencyHz"])
        country = self.state["reference"]["countries"].get(call, {})
        duplicate = bool(call and self.is_dupe(
            call, band, mode=("LSB" if self.state["draft"]["frequencyHz"] < 10000000 else "USB")
            if operating_mode(self.state) == "SSB" else operating_mode(self.state),
        ))
        multiplier_status = self.entry_multiplier_status(call, band, country, duplicate)
        speed = self.state.get("setup", {}).get("preferences", {}).get("cwSpeed")
        if type(speed) not in {int, float} or not 1 <= speed <= 100:
            speed = None
        plugin = PLUGIN_REGISTRY[self.state["pluginID"]]
        serial_field = allocated_serial_field(self.state)
        bound_replica = self.database.replica()
        staged_replica = self.database.replica_stage()
        replica = staged_replica or bound_replica
        staged_reservation = (json.loads(staged_replica["reservation_json"])
                              if staged_replica and staged_replica["reservation_json"] else None)
        result = {"sessionID": self.state["sessionID"], "engine": "not1mm-python",
                "practice": deepcopy(self.state.get("practice")),
                "pluginID": self.state["pluginID"], "pluginName": PLUGINS[self.state["pluginID"]],
                "reservedSerial": self.current_sn if requires_serial(self.state) else None,
                "allocatedSerialFieldID": serial_field,
                "coordinationIdentity": coordination_identity(self.state),
                "replicaCursor": ({"revision": replica["revision"], "sequence": replica["sequence"]}
                                  if replica else None),
                "replicaAuthority": ({"sessionID": replica["master_session_id"],
                                      "workspaceGeneration": replica["master_workspace_generation"]}
                                     if replica else None),
                "authoritySerialRequestID": ((staged_reservation or {}).get("requestID") or
                                             self.state.get("replicaReservation", {}).get("requestID")),
                "sourceRevision": SOURCE_REVISION,
                "ruleIdentity": {"id": self.state["pluginID"].replace("_", "-"),
                                 "version": self.state.get("definitionVersion") or self.state.get("scoringRevision") or "26.10.11",
                                 "edition": WAE_RULE_EDITION if self.state["pluginID"] in WAE_PLUGINS else "not1mm-python", "sourceRevision": SOURCE_REVISION},
                "supportedBands": list(plugin.bands), "supportedModes": list(plugin.modes),
                "allowDuplicateCommit": plugin.allow_duplicate_commit,
                "digitalLoggingSupported": callable(getattr(self.contest, "ft8_handler", None)),
                "fldigiReceiveSupported": callable(getattr(self.contest, "ft8_handler", None)),
                "fldigiTransmitSupported": self.state["pluginID"] in RTTY_PLUGINS,
                "fldigiTransmitAvailable": (not self.state.get("practice") and self.state["pluginID"] in RTTY_PLUGINS
                                             and operating_mode(self.state) in DIGITAL_OUTPUT_MODES),
                "matrixTrackers": list(plugin.matrix_trackers),
                "multiplierViewStatus": multiplier_view_status(self.state),
                "entryPolicy": self.entry_policy(),
                "filterSpotRanges": self.state.get("setup", {}).get("preferences", {}).get("spotRangePolicy", "plugin") == "configured"
                    or self.state.get("setup", {}).get("preferences", {}).get("spotRangePolicy", "plugin") == "plugin" and plugin.filter_spot_ranges,
                "spotModeCategory": self.state["settings"]["ModeCategory"],
                "duplicateChecking": self.contest.dupe_type != 4,
                "exportFormats": list(plugin.export_formats),
                "workspaceGeneration": workspace_generation(self.state),
                "referenceID": self.state["reference"]["id"], "revision": self.state["revision"],
                "draftID": self.state["draft"]["id"], "fields": fields,
                "frequencyHz": self.state["draft"]["frequencyHz"], "mode": operating_mode(self.state), "band": band,
                "operator": self.state["operator"], "cwSpeedWpm": speed,
                "roverLocation": self.state.get("roverLocation", ""),
                "callContext": {"callsign": call, "entity": country.get("entity"), "country": country.get("entity"),
                    "continent": country.get("continent"), "cqZone": country.get("cq"), "ituZone": country.get("itu"),
                    "primaryPrefix": country.get("primary_pfx"), "headingDegrees": None,
                    "longPathHeadingDegrees": None, "distanceKm": None},
                "focus": self.current_widget, "nextField": self.next_field.name,
                "spaceNext": {"callsign": self.next_field.name} if any(
                    field["id"] == self.next_field.name and field["visible"] and field["enabled"]
                    and not field["readOnly"] for field in fields) else {},
                "tabNext": {a.name: b.name for a, b in self.tab_next.items()},
                "tabPrevious": {a.name: b.name for a, b in self.tab_prev.items()},
                "advanceOnSpace": [name for name, enabled in zip(
                    INPUTS, getattr(self.contest, "advance_on_space", [True, False, False, False, False])
                ) if enabled],
                "run": self.pref["run_state"], "functionKeys": [{"id": f"F{i}", "highlighted": f"F{i}" in self.highlights,
                    **self.cw_macros[("R" if self.pref["run_state"] else "S", f"F{i}")]} for i in range(1, 13)],
                "dupe": duplicate,
                **({"entryMultiplierStatus": multiplier_status} if multiplier_status is not None else {}),
                "dupeExplanation": (PLUGIN_REGISTRY[self.state["pluginID"]].duplicate_description or
                                    ("Worked under this contest's specific duplicate rule."
                                    if self.contest.dupe_type == 5 else
                                    "Worked in this contest." if self.contest.dupe_type == 1 else
                                    "Worked on this band and mode." if self.contest.dupe_type == 3 else
                                    "Duplicate checking disabled." if self.contest.dupe_type == 4 else
                                    "Worked on this band.")),
                "countryResolved": bool(self.cty_lookup(call)), "history": self.history_info.text(),
                "exchangeWarnings": self.exchange_warnings(),
                "columns": (list(CQ_WW_SSB_LOG_COLUMNS) if self.state["pluginID"] == "cq_ww_ssb"
                             else self.contest.columns), "score": self.score()}
        from .lanes import metadata, select as select_lane
        result.update(metadata(self.state, result))
        for lane in result.get("operatingLanes", {}).get("lanes", []):
            lane["draftRevision"] = self.state["revision"]
            if lane["laneID"] == result["selectedLaneID"]:
                view = result
            else:
                other = deepcopy(self.state)
                select_lane(other, {"laneID": lane["laneID"], "workspaceGeneration": workspace_generation(other)}, require)
                other.pop("laneState", None)  # One ordinary plugin Desk, not a second log/score owner.
                view = Desk(self.database, other, self._commit).projection()
            lane.update({key: deepcopy(view[key]) for key in ("fields", "mode", "frequencyHz", "run", "focus", "reservedSerial",
                                                              "dupe", "dupeExplanation", "exchangeWarnings", "functionKeys", "band")})
        return result

    def entry_policy(self):
        """Keep the proven phone defaults; operator overrides are explicit."""
        plugin = PLUGIN_REGISTRY[self.state["pluginID"]]
        preferences = self.state.get("setup", {}).get("preferences", {})
        enter = preferences.get("enterPolicy", "plugin")
        clear = preferences.get("vfoClearPolicy", "plugin")
        require(enter in {"plugin", "manual", "esm"}, "Invalid Enter policy")
        require(clear in {"plugin", "on", "off"}, "Invalid VFO clear policy")
        require(preferences.get("spotRangePolicy", "plugin") in {"plugin", "configured", "off"}, "Invalid spot range policy")
        return {"enter": ("manual" if plugin.manual_enter else "esm" if self.use_esm else "manual")
                if enter == "plugin" else enter,
                "clearOnVFOChange": (plugin.clear_on_vfo_change or preferences.get("clearOnVFOChange") is True)
                if clear == "plugin" else clear == "on",
                "leaveRunOnRetune": plugin.clear_on_vfo_change and clear != "off"}

    def score(self):
        if self.state["pluginID"].startswith("wae_"):
            from .wae import score
            return score(self)
        if self.state["pluginID"] == "nac_vhf":
            points = self.database.fetch_points().get("Points") or 0
            squares = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": points,
                    "countries": 0, "zones": 0, "gridSquares": squares,
                    "multipliers": squares, "total": self.contest.calc_score(self) or 0}
        if self.state["pluginID"] in NO_MULTIPLIER_PLUGINS:
            points = self.database.fetch_points().get("Points") or 0
            return {"qsos": self.contest.show_qso(self), "points": points,
                    "countries": 0, "zones": 0, "multipliers": 0,
                    "total": self.contest.calc_score(self) or 0}
        if self.state["pluginID"] == "cq_ww_rtty":
            combined, zone = self.contest.show_mults(self, rtc=True)
            states = self.database.fetch_state_band_count()
            country = combined - states
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": country, "zones": zone, "states": states,
                    "multipliers": combined + zone, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in TEN_TEN_PLUGINS:
            points = self.database.fetch_points().get("Points") or 0
            return {"qsos": self.contest.show_qso(self), "points": points,
                    "countries": 0, "zones": 0, "multipliers": 0,
                    "total": self.contest.calc_score(self)}
        if self.state["pluginID"] == "trans_tasman":
            prefixes = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "prefixes": prefixes,
                    "multipliers": prefixes, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in {"icwc_mst", "cwt", "cwo", "weekly_rtty"}:
            calls = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "uniqueCalls": calls,
                    "multipliers": calls, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in {"arrl_ss_cw", "arrl_ss_phone", "k1usn_sst"}:
            sections = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "sections": sections,
                    "multipliers": sections, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in NAME_SPC_PLUGINS:
            sections = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "sections": sections,
                    "multipliers": sections, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in ARRL_DX_PLUGINS:
            countries, states = self.contest.show_mults(self, rtc=True)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": countries, "zones": 0, "states": states,
                    "multipliers": countries + states, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in {"cq_wpx_cw", "cq_wpx_ssb", "cq_wpx_rtty",
                                      "oceania_dx_cw", "oceania_dx_ssb"}:
            prefixes = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "prefixes": prefixes,
                    "multipliers": prefixes, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] == "cqws":
            countries, brazilian_units = self.contest.show_mults(self, rtc=True)
            score = {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": countries, "zones": 0, "exchangeBandMultipliers": brazilian_units,
                    "multipliers": countries + brazilian_units, "total": self.contest.calc_score(self)}
            if self.state.get("scoringRevision") == "26.10.26":
                unresolved = cqws_multiplier_counts(self)[2]
                score.update(scoringComplete=not unresolved,
                             scoringLimitations=[CQWS_UF_LIMITATION] if unresolved else [])
            return score
        if self.state["pluginID"] in {"rda_contest", "rdxc"}:
            countries, subdivisions = self.contest.show_mults(self, rtc=True)
            subdivision_name = "rdaDistricts" if self.state["pluginID"] == "rda_contest" else "oblasts"
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": countries, "zones": 0, subdivision_name: subdivisions,
                    "multipliers": countries + subdivisions, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in JIDX_PLUGINS and self.state.get("scoringRevision") == "26.10.26":
            counts = self.contest.get_mults(self)
            labels = ([f"{counts['prefecture']} prefecture/band multipliers"] if "prefecture" in counts else
                      [f"{counts['country']} country/band multipliers", f"{counts['zone']} CQ zone/band multipliers"])
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": counts.get("country", 0), "zones": counts.get("zone", 0),
                    "prefectures": counts.get("prefecture", 0), "multipliers": sum(counts.values()),
                    "multiplierSummaryLabels": labels, "total": self.contest.calc_score(self)}
        if self.state["pluginID"] in SIMPLE_MULTIPLIER_PLUGINS:
            multipliers = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "multipliers": multipliers,
                    "total": self.contest.calc_score(self)}
        if self.state["pluginID"] == "iaru_hf":
            headquarters, zones = self.contest.show_mults(self, rtc=True)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": zones, "headquarters": headquarters,
                    "multipliers": headquarters + zones, "total": self.contest.calc_score(self)}
        country, zone = self.contest.show_mults(self, rtc=True)
        return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                "countries": country, "zones": zone, "multipliers": country + zone, "total": self.contest.calc_score(self)}


class Host:
    MUTATIONS = {"session_create", "legacy_import", "draft_apply", "focus", "run_state", "esm", "function_key", "qso_commit", "digital_ingest", "qso_correct", "qso_delete", "setup_save", "rover_location", "recalculate", "country_reconcile", "multi_contact_apply", "multi_replica_apply", "note_save", "strategy_apply", "message_bank_save", "message_bank_activate", "operating_plan_save"}
    MUTATIONS |= {"lanes_configure", "lane_context", "lane_select"}
    MUTATIONS |= {"digital_select"}
    REPLICA_BLOCKED = {"legacy_import", "esm", "function_key", "qso_commit", "digital_ingest", "lanes_configure", "lane_context", "lane_select",
                       "qso_correct", "qso_delete", "recalculate", "country_reconcile", "setup_save", "rover_location",
                       "multi_contact_apply"}

    def __init__(self, data_root):
        supplied = Path(data_root).absolute()
        require(not any(part.is_symlink() for part in [supplied, *supplied.parents]), "Data root must not traverse symlinks")
        supplied.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = supplied.resolve()
        self.stores = {}
        self.exports = {}
        self.analytics = AnalyticsCopies()
        self._operation = None
        self._n1mm_events = None
        self._note_binding_allowed = False
        self._n1mm_delivery_store = None
        self.n1mm_loopback_only = os.environ.get("XLOG_CONTEST_N1MM_LOOPBACK_ONLY") == "1"
        self.n1mm = N1MMOutput(on_delivery=self.record_n1mm_delivery,loopback_only=self.n1mm_loopback_only)
        # The trusted native launcher grants this only in the production profile.
        self.n1mm_udp_allowed = os.environ.get("XLOG_CONTEST_N1MM_UDP_ALLOWED") == "1"

    def close(self):
        for store in self.stores.values():
            store.close()
        self.stores.clear()

    @staticmethod
    def n1mm_contact(state, row):
        network = n1mm_preferences(state.get("setup", {}).get("network", {}))
        operator = str(row.get("Operator") or "")
        frequency = str(round(float(row.get("Freq", 0)) * 100))
        lane = row.get("_n1mm_lane") or {}
        receive = lane.get("receiveFrequencyHz")
        receive_frequency = str(receive // 10) if receive is not None else "" if lane else frequency
        radio = (lane.get("binding") or {}).get("radioID")
        return {
            "contestname": str(row.get("ContestName", "")).replace("-", ""),
            "contestnr": row.get("ContestNR", 1), "timestamp": row.get("TS", ""),
            "mycall": row.get("StationPrefix") or state["station"].get("Call", ""), "operator": operator, "band": row.get("Band", ""),
            "rxfreq": receive_frequency, "txfreq": frequency, "mode": row.get("Mode", ""),
            "call": row.get("Call", ""), "oldcall": row.get("_n1mm_oldcall", row.get("Call", "")),
            "oldtimestamp": row.get("_n1mm_oldtimestamp", row.get("TS", "")),
            "SentExchange": state["settings"].get("SentExchange", ""),
            "countryprefix": row.get("CountryPrefix", ""), "wpxprefix": row.get("WPXPrefix", ""),
            "stationprefix": row.get("StationPrefix", state["station"].get("Call", "")),
            "continent": row.get("Continent", ""), "snt": row.get("SNT", ""),
            "sntnr": row.get("SentNr", ""), "rcv": row.get("RCV", ""), "rcvnr": row.get("NR", ""),
            "gridsquare": row.get("GridSquare", ""), "exchange1": row.get("Exchange1", ""),
            "section": row.get("Sect", ""), "comment": row.get("Comment", ""), "qth": row.get("QTH", ""),
            "name": row.get("Name", ""), "power": row.get("Power", ""), "misctext": row.get("MiscText", ""),
            "zone": row.get("ZN", ""), "prec": row.get("Prec", ""), "ck": row.get("CK", ""),
            "ismultiplier1": row.get("IsMultiplier1", 0), "ismultiplier2": row.get("IsMultiplier2", 0),
            "ismultiplier3": row.get("IsMultiplier3", 0), "points": row.get("Points", 0),
            "radionr": radio[-1] if radio in {"radio1", "radio2"} else row.get("RadioNR", "") or "", "RoverLocation": row.get("RoverLocation", ""),
            "RadioInterfaced": row.get("RadioInterfaced", 0), "NetworkedCompNr": row.get("NetworkedCompNr", 0),
            "IsOriginal": row.get("IsOriginal", 1), "NetBiosName": socket.gethostname(),
            "IsRunQSO": row.get("IsRunQSO", 0), "Run1Run2": row.get("Run1Run2", ""),
            "ContactType": row.get("ContactType", ""), "StationName": network["stationName"],
            "ID": row.get("ID", ""), "IsClaimedQso": row.get("CLAIMEDQSO", 1),
        }

    def record_n1mm_delivery(self, destination, kind, values, packet, outcome, error):
        store = self._n1mm_delivery_store
        if store is None:
            return
        operation = self._operation
        qso_id = str(values.get("ID", ""))
        identity = hashlib.sha256(canonical([operation, destination, kind, qso_id]).encode()).hexdigest()
        # This optional post-commit journal cannot roll back the contact. Failed
        # intent persistence stops that packet; it never fabricates remote storage.
        with store.conn:
            store.conn.execute("""INSERT INTO xlog_n1mm_delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome,error=excluded.error,
                attempts=xlog_n1mm_delivery.attempts+?,updated_utc=excluded.updated_utc""",
                (identity, operation, self._n1mm_delivery_revision, destination, kind, qso_id,
                 packet, hashlib.sha256(packet).hexdigest(), outcome, error,
                 int(outcome == "attempting"), now(), int(outcome == "attempting")))

    def publish_n1mm(self, state, method, params, desk, previous_network):
        if not self.n1mm_udp_allowed or state.get("practice"):
            return
        try:
            self._n1mm_delivery_store = desk.database
            self._n1mm_delivery_revision = state["revision"]
            config = n1mm_preferences(state.get("setup", {}).get("network", {}))
            if not config["enabled"]:
                return
            previous = n1mm_preferences(previous_network)
            radio_changed = (method == "run_state"
                             or method == "draft_apply" and bool({"frequencyHz", "mode"} & set(params))
                             or method == "setup_save" and not (previous["enabled"] and previous["radio"]))
            if config["radio"] and radio_changed:
                frequency = str((state["draft"].get("receiveFrequencyHz") or state["draft"]["frequencyHz"]) // 10)
                transmit = str(state["draft"]["frequencyHz"] // 10)
                from .lanes import attribution
                lane = attribution(state) or {}
                radio = (lane.get("binding") or {}).get("radioID")
                self.n1mm.radio(config["radioDestinations"], {
                    "StationName": config["stationName"], "Freq": frequency, "TXFreq": transmit,
                    "IsSplit": str(frequency != transmit),
                    **({"RadioNr": radio[-1]} if radio in {"radio1", "radio2"} else {}),
                    "Mode": operating_mode(state), "OpCall": config["operatorName"] or state["operator"],
                    "IsRunning": str(state["run"]),
                })
            lookup_changed = method == "draft_apply" and "callsign" in params.get("fields", {})
            if config["lookup"] and lookup_changed:
                call = desk.parsed_call()
                if call:
                    self.n1mm.lookup(config["lookupDestinations"], {
                        "call": call, "operator": config["operatorName"] or state["operator"],
                        "mycall": config["operatorName"] or state["operator"],
                        "stationprefix": state["station"].get("Call", ""),
                        "StationName": config["stationName"],
                    })
            for event, row in self._n1mm_events or []:
                if not config["contact"]:
                    break
                if event == "delete":
                    self.n1mm.delete(config["contactDestinations"], {
                        "timestamp": row.get("TS", ""), "call": row.get("Call", ""),
                        "contestnr": row.get("ContestNR", 1), "StationName": config["stationName"],
                        "ID": row.get("ID", ""),
                    })
                else:
                    known = desk.database.exec_sql("SELECT attribution FROM xlog_qso_lane WHERE qso_id=?", (row["ID"],))
                    if known:
                        row = {**row, "_n1mm_lane": json.loads(known["attribution"])}
                    self.n1mm.contact(config["contactDestinations"], self.n1mm_contact(state, row),
                                      replace=event == "replace")
            if config["score"] and (self._n1mm_events or method in {"recalculate", "setup_save"}):
                score = desk.score()
                if score.get("scoringComplete") is False:
                    return  # Never publish a partial known subtotal as a complete score.
                settings = state["settings"]
                self.n1mm.score(config["scoreDestinations"], {
                    "contest": desk.contest.cabrillo_name, "call": state["station"].get("Call", ""),
                    "score": score["total"],
                    "timestamp": now(), "class": {
                        "ops": settings.get("OperatorCategory", ""), "mode": settings.get("ModeCategory", ""),
                        "power": settings.get("PowerCategory", ""), "bands": settings.get("BandCategory", ""),
                        "transmitter": settings.get("TransmitterCategory", ""),
                    },
                })
        except Exception:
            # A best-effort UDP publication cannot make a committed mutation uncertain.
            logging.exception("N1MM UDP publication failed")
        finally:
            self._n1mm_delivery_store = None

    @property
    def active_session_path(self):
        return self.root / "active-session.json"

    def active_session(self):
        """Return the last admitted session without trusting an unsafe marker."""
        path = self.active_session_path
        try:
            stat = path.lstat()
            if path.is_symlink() or not path.is_file() or stat.st_nlink != 1 or stat.st_size > 1024:
                return None
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or set(payload) != {"sessionID"}:
                return None
            return identifier(payload["sessionID"])
        except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError, HostError):
            return None

    def remember_active_session(self, session_id):
        """Atomically retain the last real session selection across WebView storage resets."""
        session_id = identifier(session_id)
        path = self.active_session_path
        temporary = self.root / f".active-session-{uuid.uuid4()}.tmp"
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(canonical({"sessionID": session_id}))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            return True
        except OSError:
            return False
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def database(self, session_id, create=False):
        if session_id not in self.stores:
            directory = self.root / session_id
            path = directory / "contest.sqlite"
            require(not directory.is_symlink() and not path.is_symlink(), "Unsafe session path")
            require(create or path.is_file(), "Session does not exist", "not_found")
            if path.exists():
                # Refuse a hard-linked station database before upstream's schema
                # initializer can issue any write against an existing file.
                require(path.is_file() and path.stat().st_nlink == 1, "Unsafe linked database", "unsafe_database")
                probe = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
                try:
                    tables = {row[0] for row in probe.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    require({"xlog_session", "xlog_operation", "xlog_qso_identity", "xlog_qso_audit", "DXLOG"} <= tables,
                            "Existing file is not a Python contest store", "unsafe_database")
                finally:
                    probe.close()
            directory.mkdir(mode=0o700, exist_ok=True)
            self.stores[session_id] = Store(path)
        return self.stores[session_id]

    def dispatch(self, request):
        require(isinstance(request, dict) and set(request) == {"id", "method", "params"}, "Expected id, method and params")
        text(request["id"], 128)
        method, params = request["method"], request["params"]
        require(isinstance(method, str) and isinstance(params, dict), "Invalid method/params")
        if method.startswith("contest_"):
            method = method[8:]
        aliases = {"create": "session_create", "open": "session_open", "operation_receipt": "receipt", "draft_get": "projection", "log_page": "log"}
        method = aliases.get(method, method)
        if method == "catalog":
            verify_source()
            return {"plugins": [{"id": key, "name": plugin.name, "engine": "not1mm-python",
                                  "sourceRevision": SOURCE_REVISION, "modes": list(plugin.modes),
                                   "supportedBands": list(plugin.bands),
                                  "sentExchangeHint": plugin.sent_exchange_hint,
                                  "overlayChoices": list(plugin.overlay_choices),
                                  "digitalLoggingSupported": callable(getattr(load_plugin(key), "ft8_handler", None))}
                                  | {"exportFormats": list(plugin.export_formats)}
                                 for key, plugin in PLUGIN_REGISTRY.items()],
                    "bandDefinitions": list(BAND_DEFINITIONS), "protocolVersion": 1}
        if method == "sessions":
            sessions = []
            for directory in sorted(self.root.iterdir()):
                if not directory.is_dir() or directory.is_symlink():
                    continue
                try:
                    session_id = identifier(directory.name)
                    path = directory / "contest.sqlite"
                    require(not path.is_symlink() and path.is_file() and path.stat().st_nlink == 1,
                            "Unsafe or missing session database", "unsafe_database")
                    # Listing must never initialize or repair a candidate via Store.
                    probe = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
                    try:
                        tables = {row[0] for row in probe.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                        require({"xlog_session", "xlog_operation", "xlog_qso_identity", "xlog_qso_audit", "DXLOG"} <= tables,
                                "Existing file is not a Python contest store", "unsafe_database")
                        row = probe.execute("SELECT state FROM xlog_session WHERE id=?", (session_id,)).fetchone()
                    finally:
                        probe.close()
                    if row is None:
                        continue  # A rejected create can leave an initialized, empty store.
                    state = json.loads(row[0])
                    self.verify_engine(state)
                    summary = {"sessionID": session_id, "name": state.get("name", "CQ WW CW"),
                               **({"practice": True} if state.get("practice") else {}),
                               "workspaceGeneration": workspace_generation(state),
                               "pluginID": state["pluginID"], "sourceRevision": state["sourceRevision"],
                               "revision": state["revision"]}
                except (HostError, sqlite3.Error, OSError, json.JSONDecodeError):
                    # Discovery must not let one stale/incomplete store hide other sessions.
                    # Explicit opens still report the candidate's original error.
                    continue
                sessions.append(summary)
            active = self.active_session()
            return {"sessions": sessions,
                    "activeSessionID": active if active in {item["sessionID"] for item in sessions} else None}
        if method == "legacy_preview":
            require(set(params) in ({"sourcePath"}, {"sourcePath", "sourceContestNR"}),
                    "Unexpected legacy preview fields")
            contest_nr = params.get("sourceContestNR")
            require(contest_nr is None or type(contest_nr) is int and contest_nr > 0,
                    "Legacy contest number must be a positive integer")
            try:
                preview = inspect_source(text(params.get("sourcePath"), 4096), contest_nr)
            except LegacyImportError as error:
                raise HostError(error.code, str(error)) from error
            for contest in preview["contests"]:
                names = {contest["contestName"]}
                contest["pluginCandidates"] = [plugin_id for plugin_id in PLUGIN_REGISTRY
                                                if names & {load_plugin(plugin_id).name,
                                                            load_plugin(plugin_id).cabrillo_name}]
            return preview
        session_id = identifier(params.get("sessionID"))
        store = self.database(session_id, method in {"session_create", "legacy_import"})
        if method in self.MUTATIONS:
            return self.mutate(store, session_id, method, params)
        state = store.state(session_id)
        require(state is not None, "Session does not exist", "not_found")
        self.verify_engine(state)
        from .lanes import select as select_lane
        if "laneID" in params or method in {"session_open", "projection", "cw_context"}:
            select_lane(state, params, require, mandatory=method == "cw_context")
        if method in {"strategy", "message_import", "message_preview", "message_banks", "operating_info"}:
            require(params.get("workspaceGeneration") == workspace_generation(state), "Strategy workspace changed", "stale_context")
            require(type(params.get("expectedRevision")) is int and params["expectedRevision"] == state["revision"],
                    "Contest snapshot changed; refresh before review", "stale_revision")
            if method == "strategy":
                if params.get("section") == "adif_preview":
                    from .adif_import import review
                    return review(self,store,state,params,require)[0]
                if params.get("section") == "archive_inspect":
                    from .submission_archive import inspect
                    return inspect(text(params.get("sourcePath"),4096),require)
                if params.get("section") == "developer":
                    from .developer import TEMPLATES, describe, inspect_udc
                    raw=params.get("udcText")
                    require(raw is None or isinstance(raw,str) and len(raw.encode())<=65536, "UDC inspection exceeds the bounded text limit")
                    require(raw is not None or params.get("templateID", "cq_wpx_cw") in TEMPLATES, "No reviewed developer template mapping is supplied for this definition")
                    return inspect_udc(raw.encode()) if raw is not None else describe(params.get("templateID", "cq_wpx_cw"))
                if params.get("section") == "vhf":
                    from .vhf import projection
                    return projection(Desk(store, state, self.commit), params)
                if params.get("section") == "qtc":
                    from .wae import projection
                    state = deepcopy(state)
                    if "countries" in params:
                        require(params.get("referenceID") == state["reference"]["id"], "QTC country reference changed", "reference_mismatch")
                        additions = self.countries(deepcopy(params["countries"]))
                        state["reference"]["countries"].update({call: info for call, info in additions.items() if call not in state["reference"]["countries"]})
                    return projection(Desk(store, state, self.commit), params)
                from .strategy import projection, reconcile_worked
                reviewed = deepcopy(state)
                try:
                    projection(reviewed, now_utc=params.get("nowUTC"))
                    reconcile_worked(reviewed, store.exec_sql_mult("SELECT ID,Call,Band,Mode FROM DXLOG WHERE ContestNR=?", (store.current_contest,)), BAND_LABELS)
                    return projection(reviewed, now_utc=params.get("nowUTC"))
                except ValueError as error:
                    raise HostError("invalid_request", str(error)) from error
            if method == "operating_info":
                from .operating_rules import calculate
                try:
                    return calculate(Desk(store, state, self.commit), {"now": datetime.now(UTC).isoformat(), **params})
                except ValueError as error:
                    raise HostError("invalid_request", str(error)) from error
            from .messages import import_message_bank, preview_message, message_projection
            try:
                if method == "message_import":
                    return import_message_bank(params)
                if method == "message_preview":
                    return preview_message(state, params, Desk(store, state, self.commit).projection())
                return message_projection(state)
            except ValueError as error:
                raise HostError("invalid_request", str(error)) from error
        if method == "recorder_changes":
            from .recorder import changes
            return changes(store, state, params, require)
        if method in {"n1mm_delivery", "n1mm_retry"}:
            require(params.get("workspaceGeneration") == workspace_generation(state), "Delivery workspace changed", "stale_context")
            if method == "n1mm_retry":
                require(type(params.get("expectedAttempts")) is int and params["expectedAttempts"] >= 0,
                        "Review the exact delivery attempt count")
                require(self.n1mm_udp_allowed and not state.get("practice"), "Optional output is unavailable", "output_disabled")
                require(params.get("confirmUncertain") is True, "Review the consumer before retrying an uncertain datagram")
                row = store.exec_sql("SELECT * FROM xlog_n1mm_delivery WHERE id=?", (params.get("deliveryID"),))
                require(row is not None and row["sha256"] == params.get("sha256"), "Reviewed delivery changed", "stale_delivery")
                config = n1mm_preferences(state.get("setup", {}).get("network", {}))
                category = {"RadioInfo": "radio", "contactinfo": "contact", "contactreplace": "contact",
                            "contactdelete": "contact", "lookupinfo": "lookup", "scoreinfo": "score"}[row["kind"]]
                require(config["enabled"] and config[category] and row["destination"] in config[category + "Destinations"].split(),
                        "The original optional-output destination is no longer enabled", "stale_delivery")
                newest = store.latest_qso_revision(row["qso_id"]) if row["qso_id"] else state["revision"]
                require(newest <= row["revision"], "A newer contact or session snapshot supersedes this packet", "stale_delivery")
                require(isinstance(self.n1mm, N1MMOutput), "The native delivery transport is unavailable")
                try:
                    self.n1mm.validate_packet(row["packet"])
                    require(not self.n1mm_loopback_only or row["destination"].split(":")[0]=="127.0.0.1", "Disposable retry requires loopback", "output_disabled")
                except ValueError as error:
                    raise HostError("invalid_delivery", str(error)) from error
                with store.conn:
                    changed = store.conn.execute("UPDATE xlog_n1mm_delivery SET outcome='attempting',error='',attempts=attempts+1,updated_utc=? WHERE id=? AND attempts=?",
                                                 (now(), row["id"], params.get("expectedAttempts"))).rowcount
                    require(changed == 1, "Another attempt already advanced this delivery; review it again", "stale_delivery")
                outcome, failure = "sent_unverified", ""
                try:
                    address, port = row["destination"].split(":")
                    with self.n1mm.socket_factory(family=socket.AF_INET, type=socket.SOCK_DGRAM) as udp:
                        udp.sendto(row["packet"], (address, int(port)))
                except (OSError, ValueError, TypeError) as error:
                    outcome, failure = "failed", str(error)[:512]
                with store.conn:
                    store.conn.execute("UPDATE xlog_n1mm_delivery SET outcome=?,error=?,updated_utc=? WHERE id=?",
                                       (outcome, failure, now(), row["id"]))
            rows = store.exec_sql_mult("SELECT id,operation_id,revision,destination,kind,qso_id,sha256,outcome,error,attempts,updated_utc FROM xlog_n1mm_delivery ORDER BY updated_utc DESC,rowid DESC LIMIT 100")
            return {"sessionID": session_id, "rows": rows, "remotePersistenceVerified": False,
                    "scorePublicationComplete": Desk(store, state, self.commit).score().get("scoringComplete") is not False,
                    "retryPolicy": "No automatic replay. A sent or interrupted UDP attempt may already have arrived; review the consumer before retrying."}
        if method == "analytics":
            require(params.get("workspaceGeneration") == workspace_generation(state),
                    "Analytics workspace changed", "stale_context")
            return self.analytics.read(store, state, params, lambda current: Desk(store, current, self.commit),
                                       BAND_LABELS, require)
        if method.startswith("history_"):
            return self.callhistory(store, state, method, params)
        if method in {"assistance_reverse", "assistance_dupesheet"}:
            from .assistance import read_assistance
            return read_assistance(store, state, method, params, lambda current: Desk(store, current, self.commit), require)
        if method in {"multi_serial_reserve", "multi_dupe_inquiry", "multi_changes", "multi_coordination"}:
            return self.coordinate(store, state, method, params)
        if method == "rates":
            # Capture the revision, log and clock in one SQLite read snapshot.
            store.conn.execute("BEGIN")
            try:
                state = store.state(session_id)
                self.verify_engine(state)
                rows = store.exec_sql_mult("SELECT ID,TS,IsRunQSO FROM DXLOG")
                return {"sessionID": session_id, "revision": state["revision"],
                        **calculate_rates(rows, datetime.now(UTC))}
            finally:
                store.conn.rollback()
        if method == "setup_get":
            setup = deepcopy(state.get("setup", self.default_setup(state)))
            setup["preferences"] = {**setup["preferences"], **esm_preferences(setup["preferences"])}
            return {"sessionID": session_id, "revision": state["revision"],
                    "setup": setup,
                    "effectiveMacros": self.effective_macros(state)}
        if method == "network_pending":
            require(set(params) == {"sessionID", "workspaceGeneration", "limit"},
                    "Unexpected network pending fields")
            require(params["workspaceGeneration"] == workspace_generation(state),
                    "Contest network context is stale", "stale_generation")
            limit = params["limit"]
            require(type(limit) is int and 1 <= limit <= 100,
                    "Invalid network pending limit")
            rows = store.exec_sql_mult(
                "SELECT * FROM DXLOG WHERE ContestNR=? AND Dirty=1 ORDER BY TS ASC,rowid ASC LIMIT ?",
                (store.current_contest, limit),
            )
            return {"sessionID": session_id, "workspaceGeneration": workspace_generation(state),
                    "revision": state["revision"], "contacts": rows}
        if method == "network_confirm":
            require(set(params) == {"sessionID", "workspaceGeneration", "qsoID"},
                    "Unexpected network confirmation fields")
            require(params["workspaceGeneration"] == workspace_generation(state),
                    "Contest network context is stale", "stale_generation")
            qso_id = identifier(params["qsoID"])
            row = store.exec_sql(
                "SELECT ID FROM DXLOG WHERE ID=? AND ContestNR=?",
                (qso_id, store.current_contest),
            )
            require(bool(row), "Network contact does not belong to this contest", "not_found")
            return {"sessionID": session_id, "workspaceGeneration": workspace_generation(state),
                    "qsoID": qso_id, "transportAcknowledged": True,
                    "persistenceVerified": False, "confirmed": False}
        if method == "check_partial":
            query = text(params.get("query", ""), 32).upper()
            require(re.fullmatch(r"[A-Z0-9/]{3,32}", query) is not None, "Partial callsign requires at least three letters, digits or slash")
            limit = params.get("limit", 100)
            require(type(limit) is int and 1 <= limit <= 500, "Invalid partial result limit")
            # Mirror pinned DataBase.fetch_like_calls: substring, contest scope,
            # oldest first. Bound the reply without bounding the search domain.
            store.conn.execute("BEGIN")
            try:
                state = store.state(session_id)
                self.verify_engine(state)
                expected = params.get("expectedRevision")
                require(expected is None or type(expected) is int and expected == state["revision"],
                        "Contest changed before partial log lookup", "stale_revision")
                duplicate_projection = cq_ww_duplicate_projection(state["pluginID"])
                patterns = [f"%{query}%", *(f"{query[:index]}_{query[index + 1:]}%" for index in range(len(query)))]
                predicate = "(" + " OR ".join("d.Call LIKE ?" for _ in patterns) + ")"
                match = (*patterns, store.current_contest)
                total = store.exec_sql(
                    f"SELECT count(*) AS n FROM DXLOG AS d WHERE {predicate} AND d.ContestNR=?", match
                )["n"]
                rows = store.exec_sql_mult(
                    "SELECT d.*,i.raw_fields,i.country AS country_identity,coalesce((SELECT max(a.revision) "
                    "FROM xlog_qso_audit AS a WHERE a.qso_id=d.ID),0) AS change_revision" + duplicate_projection + " " +
                    "FROM DXLOG AS d "
                    "LEFT JOIN xlog_qso_identity AS i ON i.id=d.ID "
                    f"WHERE {predicate} AND d.ContestNR=? "
                    "ORDER BY d.TS ASC,d.rowid ASC LIMIT ?",
                    (*match, limit),
                )
                for row in rows:
                    row["raw_fields"] = json.loads(row["raw_fields"]) if row["raw_fields"] else {}
                    row["country_identity"] = json.loads(row["country_identity"]) if row["country_identity"] else None
                    self.add_legacy_provenance(store, row)
                self.add_exchange_warnings(store, state, rows)
                return {"sessionID": session_id, "revision": state["revision"], "query": query,
                        "limit": limit, "total": total, "rows": rows}
            finally:
                store.conn.rollback()
        if method in {"spot_points_preview", "opportunities"}:
            base_fields = {"sessionID", "workspaceGeneration", "expectedRevision", "spots"}
            require(set(params) in (base_fields, base_fields | {"countries", "referenceID"}),
                    "Unexpected spot points preview fields")
            require(params["workspaceGeneration"] == workspace_generation(state),
                    "Spot points workspace changed", "stale_context")
            expected = params["expectedRevision"]
            require(type(expected) is int and expected == state["revision"],
                    "Contest changed before spot points preview", "stale_revision")
            candidates = params["spots"]
            require(isinstance(candidates, list) and len(candidates) <= 256,
                    "Spot points preview must contain at most 256 spots")
            additions = {}
            if "countries" in params:
                require(params["referenceID"] == state["reference"]["id"],
                        "The contest CTY reference differs from this session", "reference_mismatch")
                additions = self.countries(deepcopy(params["countries"]))
                additions = {call: country for call, country in additions.items()
                             if call not in state["reference"]["countries"]}
            store.conn.execute("BEGIN")
            try:
                current = store.state(session_id)
                self.verify_engine(current)
                require(current["revision"] == expected, "Contest changed before spot points preview", "stale_revision")
                results = []
                # Candidate desks only read CTY entries through cty_lookup(),
                # which returns a defensive copy. Share this request-local map
                # instead of deep-copying every known country for every spot.
                preview_countries = {**current["reference"]["countries"], **additions}
                for candidate in candidates:
                    require(isinstance(candidate, dict)
                            and set(candidate) == {"spotID", "callsign", "frequencyHz", "mode"},
                            "Invalid spot points preview item")
                    spot_id = text(candidate["spotID"], 128)
                    callsign = text(candidate["callsign"], 32).strip().upper()
                    frequency = candidate["frequencyHz"]
                    mode = text(candidate["mode"], 16).strip().upper()
                    require(bool(spot_id) and re.fullmatch(r"[A-Z0-9/]{3,32}", callsign) is not None
                            and type(frequency) is int and 100_000 <= frequency <= 100_000_000_000
                            and mode in PLUGIN_REGISTRY[current["pluginID"]].modes,
                            "Invalid spot points preview item")
                    preview = deepcopy(current, {id(current["reference"]["countries"]): preview_countries})
                    preview["operatingMode"] = mode
                    preview["draft"]["frequencyHz"] = frequency
                    desk = Desk(store, preview, self.commit)
                    try:
                        desk.contest_band(frequency)
                    except HostError:
                        results.append({"spotID": spot_id, "points": None, "dupe": None,
                                        "multiplierCount": None, "countryMultiplier": None,
                                        "zoneMultiplier": None, "reason": "unsupported_band"})
                        continue
                    if method == "opportunities" and str(current["settings"].get("BandCategory", "ALL")).upper() not in {"ALL", str(BAND_LABELS.get(desk.band(frequency))).upper()}:
                        results.append({"spotID": spot_id, "points": None, "dupe": None,
                                        "multiplierCount": None, "countryMultiplier": None,
                                        "zoneMultiplier": None, "reason": "ineligible_category"})
                        continue
                    category = current["settings"]["ModeCategory"]
                    if (category in {"CW", "SSB", "AM", "FM"} and mode != category
                            or category in {"DIGITAL", *RTTY_MODES} and mode in {"CW", "SSB", "AM", "FM"}):
                        results.append({"spotID": spot_id, "points": None, "dupe": None,
                                        "multiplierCount": None, "countryMultiplier": None,
                                        "zoneMultiplier": None, "reason": "unsupported_mode"})
                        continue
                    desk.clear_inputs()
                    desk.callsign.setText(callsign)
                    # Duplicate scope does not require a received serial/name/grid.
                    # Do this before validation and retain it if scoring is unknown.
                    radio_mode = ("LSB" if frequency < 10000000 else "USB") if mode == "SSB" else mode
                    dupe = None if desk.contest.dupe_type == 4 else bool(desk.is_dupe(callsign, desk.band(frequency), mode=radio_mode))
                    if desk.cty_lookup(callsign) is None:
                        results.append({"spotID": spot_id, "points": None, "dupe": dupe,
                                        "multiplierCount": None, "countryMultiplier": None,
                                        "zoneMultiplier": None, "reason": "unresolved_callsign"})
                        continue
                    try:
                        self.prefill(desk)
                        fields = desk.values()
                        require(all(fields[name].strip() for name in PLUGIN_REGISTRY[current["pluginID"]].preview_required_fields),
                                "Received exchange required")
                        self.validate_exchange(desk, fields)
                    except (HostError, ValueError, TypeError, AttributeError):
                        results.append({"spotID": spot_id, "points": None, "dupe": dupe,
                                        "multiplierCount": None, "countryMultiplier": None,
                                        "zoneMultiplier": None, "reason": "exchange_required"})
                        continue
                    try:
                        contact = desk.contact_for(fields, str(uuid.uuid4()), now(), frequency)
                        points = contact.get("Points")
                        require(type(points) in {int, float} and math.isfinite(points) and points >= 0,
                                "Plugin returned invalid spot points")
                        before_score = desk.score()
                        opportunity = {}
                        desk.database.conn.execute("SAVEPOINT spot_preview")
                        try:
                            contact["ContestNR"] = store.current_contest
                            desk.database.exec_sql_insert("DXLOG", contact, commit=False)
                            after_score = desk.score()
                            multiplier_count = max(0, after_score["multipliers"] - before_score["multipliers"])
                            if method == "opportunities":
                                from .opportunities import details
                                opportunity = details(store, preview, contact, before_score, after_score, BAND_LABELS)
                        finally:
                            desk.database.conn.execute("ROLLBACK TO spot_preview")
                            desk.database.conn.execute("RELEASE spot_preview")
                        cq_ww = current["pluginID"] in CQ_WW_STATION_ZONE_PLUGINS
                        results.append({"spotID": spot_id, "points": points, "dupe": dupe,
                                        "multiplierCount": multiplier_count,
                                        "countryMultiplier": after_score["countries"] > before_score["countries"] if cq_ww else None,
                                        "zoneMultiplier": after_score["zones"] > before_score["zones"] if cq_ww else None,
                                        "reason": None, **opportunity,
                                        **({"inferredExchange": {key: value for key, value in fields.items()
                                                                 if key != "callsign" and value.strip()}}
                                           if method == "opportunities" else {})})
                    except (HostError, ValueError, TypeError, AttributeError, ArithmeticError):
                        results.append({"spotID": spot_id, "points": None, "dupe": dupe,
                                        "multiplierCount": None, "countryMultiplier": None,
                                        "zoneMultiplier": None, "reason": "scoring_unavailable"})
                if method == "opportunities":
                    from .opportunities import explain
                    results = explain(results)
                return {"sessionID": session_id, "workspaceGeneration": workspace_generation(current),
                        "revision": current["revision"], "spots": results}
            finally:
                store.conn.rollback()
        if method == "score":
            # Score, matrices and statistics must describe one revision and one
            # complete current-contest DXLOG snapshot.
            store.conn.execute("BEGIN")
            try:
                state = store.state(session_id)
                self.verify_engine(state)
                expected = params.get("expectedRevision")
                require(expected is None or type(expected) is int and expected == state["revision"],
                        "Contest changed before score read", "stale_revision")
                desk = Desk(store, state, self.commit)
                score_band = desk.database.score_band
                rows = store.exec_sql_mult(
                    "SELECT rowid AS source_order,* FROM DXLOG WHERE ContestNR=? ORDER BY TS,rowid",
                    (store.current_contest,),
                )
                rows = [{**row, "is_dupe": flag} for row, flag in zip(rows, duplicate_flags(desk, rows))
                        if score_band is None or row["Band"] == score_band]
                score = desk.score()
                dimension_rows = store.exec_sql_mult("SELECT rowid AS source_order,* FROM DXLOG WHERE ContestNR=? ORDER BY TS,rowid", (store.current_contest,)) if multiplier_definitions(state) else []
                views, _, _ = multiplier_dimensions(dimension_rows, state, score, BAND_LABELS)
                return {"sessionID": session_id, "revision": state["revision"],
                        "score": score, "matrices": self.matrices(store),
                        "multiplierViews": views,
                        "statistics": calculate_statistics(rows, *("IsMultiplier2", "IsMultiplier1")
                                                           if state["pluginID"] == "cq_ww_ssb" else
                                                           ("IsMultiplier1", "IsMultiplier2") if state["pluginID"] == "cq_ww_cw" else ())}
            finally:
                store.conn.rollback()
        if method == "rtc_payload":
            require(not state.get("practice"), "Practice sessions cannot publish scores", "practice_output_disabled")
            require(set(params) == {"sessionID", "workspaceGeneration"},
                    "Unexpected RTC payload fields")
            require(params["workspaceGeneration"] == workspace_generation(state),
                    "RTC reporting context is stale", "stale_generation")
            desk = Desk(store, state, self.commit)
            generator = getattr(desk.contest, "online_score_xml", None)
            require(desk.score().get("scoringComplete") is not False,
                    "This score is partial; complete scoring data is required for online reporting", "scoring_incomplete")
            require(callable(generator), "This contest does not provide RTC score XML", "rtc_unsupported")
            desk.station = rtc_safe_values(desk.station)
            desk.contest_settings = rtc_safe_values(desk.contest_settings)
            payload = validate_rtc_xml(generator(desk))
            return {"sessionID": session_id, "workspaceGeneration": workspace_generation(state),
                    "revision": state["revision"], "xml": payload}
        desk = Desk(store, state, self.commit)
        if method in {"session_open", "projection"}:
            if method == "session_open":
                self.remember_active_session(session_id)
            return {"projection": desk.projection()}
        if method == "cw_context":
            require(not state.get("practice"), "Practice sessions have native output disabled", "practice_output_disabled")
            require(operating_mode(state) == "CW", "This contest does not support CW output", "unsupported_mode")
            from .lanes import attribution
            return {"sessionID": session_id, "revision": state["revision"],
                    **({"laneContext": attribution(state)} if state.get("laneState") else {}),
                    "draftID": state["draft"]["id"], "stationCall": state["station"]["Call"],
                    "fields": desk.values(), "frequencyHz": state["draft"]["frequencyHz"],
                    "cwFormatting": cw_formatting_preferences(state.get("setup", {}).get("preferences", {})),
                    "sentExchange": str(state["settings"]["SentExchange"]),
                    "sentSerial": (str(desk.current_sn) if state["pluginID"] in SSA_MT_PLUGINS | SENT_FIELD_SERIAL_PLUGINS
                                   else desk.other_1.text()
                                   if state["pluginID"] in SENTNR_FIELD_PLUGINS else "")}
        if method == "receipt":
            row = store.exec_sql("SELECT payload,result FROM xlog_operation WHERE operation_id=?", (identifier(params.get("operationID")),))
            return {"found": bool(row), "result": self.replay_result(json.loads(row["result"]), store) if row else None}
        if method == "output_claim":
            require(not state.get("practice"), "Practice sessions have native output disabled", "practice_output_disabled")
            operation = identifier(params.get("operationID"))
            store.begin()
            try:
                current = store.state(session_id)
                row = store.exec_sql("SELECT result FROM xlog_operation WHERE operation_id=?", (operation,))
                require(bool(row), "Output operation does not exist", "not_found")
                result = json.loads(row["result"])
                require(current["revision"] == result["revision"] == params.get("revision"),
                        "Contest changed before output admission", "stale_revision")
                require(bool(result["actions"]), "Operation has no output actions")
                require(not store.exec_sql("SELECT operation_id FROM xlog_output_claim WHERE operation_id=?", (operation,)),
                        "Output was already consumed; do not replay", "output_consumed")
                store.conn.execute("INSERT INTO xlog_output_claim VALUES(?)", (operation,))
                store.finish(True)
                return {"claimed": True, "operationID": operation, "actions": result["actions"]}
            except BaseException:
                store.finish(False)
                raise
        if method == "log":
            from .productivity import log_query
            store.conn.execute("BEGIN")
            try:
                current = store.state(session_id)
                page = log_query(store, current, params, require, cq_ww_duplicate_projection(current["pluginID"]))
                for row in page["rows"]:
                    self.add_legacy_provenance(store, row)
                    lane = store.exec_sql("SELECT attribution FROM xlog_qso_lane WHERE qso_id=?", (row["ID"],))
                    if current.get("laneState") or lane:
                        row["laneAttribution"] = json.loads(lane["attribution"]) if lane else None
                self.add_exchange_warnings(store, current, page["rows"])
                return page
            finally:
                store.conn.rollback()
        if method == "notes":
            from .productivity import read_notes
            require(params.get("workspaceGeneration") == workspace_generation(state), "Notes workspace changed", "stale_context")
            require(params.get("expectedRevision") == state["revision"], "Notes snapshot changed", "stale_revision")
            if params.get("laneID") is not None:
                limit, offset = params.get("limit", 50), params.get("offset", 0)
                require(type(limit) is int and 1 <= limit <= 100 and type(offset) is int and offset >= 0, "Invalid notes page")
                predicate = "coalesce(dl.lane_id,json_extract(ql.attribution,'$.laneID'))=?"
                joins = " FROM xlog_note n LEFT JOIN xlog_draft_lane dl ON dl.draft_id=n.draft_id LEFT JOIN xlog_qso_lane ql ON ql.qso_id=n.qso_id "
                return {"sessionID": session_id, "workspaceGeneration": workspace_generation(state), "revision": state["revision"],
                        "total": store.exec_sql("SELECT count(*) AS n" + joins + "WHERE " + predicate, (params["laneID"],))["n"],
                        "rows": store.exec_sql_mult("SELECT n.*,d.Call AS callsign,d.TS AS workedAt" + joins + "LEFT JOIN DXLOG d ON d.ID=n.qso_id WHERE " + predicate + " ORDER BY n.revision DESC,n.id ASC LIMIT ? OFFSET ?", (params["laneID"], limit, offset))}
            return read_notes(store, state, params, require)
        if method == "export":
            return self.export(desk)
        if method == "submission_preflight":
            from .submission import submission_preflight
            require(params.get("workspaceGeneration") == workspace_generation(state), "Submission workspace changed", "stale_context")
            require(type(params.get("expectedRevision")) is int and params["expectedRevision"] == state["revision"],
                    "Contest changed before submission review", "stale_revision")
            export_format = params.get("format", "cabrillo")
            require(export_format in PLUGIN_REGISTRY[state["pluginID"]].export_formats, "Unsupported submission format")
            if params.get("archive") is True:
                require(len(self.exports)<8,"Release another prepared export first","export_busy")
                from .submission_archive import build
                store.conn.execute('BEGIN')
                try:
                    current=store.state(session_id)
                    require(current["revision"]==state["revision"],"Contest changed before archive snapshot","stale_revision")
                    archive_desk=Desk(store,current,self.commit)
                    selected=None
                    if export_format=="edi":
                        from .vhf import edi_scope
                        archive_desk=edi_scope(archive_desk,params.get("siteID"),require)
                        selected=archive_desk.database.fetch_all_contacts_asc()
                    filename,payload=self.export_artifact(archive_desk,32*1024*1024,export_format)
                    review=submission_preflight(archive_desk,export_format,filename,payload,selected)
                    if params.get("siteID") is not None:review["manifest"]["siteID"]=params["siteID"]
                    frozen,archive_manifest=build(Desk(store,current,self.commit),review,payload,params.get("recordingIndex"),require)
                finally:
                    store.conn.rollback()
                artifact_id=str(uuid.uuid4());digest=hashlib.sha256(frozen).hexdigest()
                prepared={"artifactID":artifact_id,"sessionID":session_id,"workspaceGeneration":workspace_generation(state),"revision":state["revision"],
                          "byteLength":len(frozen),"sha256":digest,"format":"archive","filename":f'{state["pluginID"]}-r{state["revision"]}-{digest[:12]}.zip'}
                self.exports[artifact_id]={"prepared":prepared,"bytes":frozen}
                return {**review,"archiveManifest":archive_manifest,"prepared":prepared}
            filename, payload = self.export_artifact(desk, 32 * 1024 * 1024, export_format, params.get("siteID"))
            if export_format == "edi":
                from .vhf import edi_scope
                scoped = edi_scope(desk, params.get("siteID"), require)
                reviewed = submission_preflight(scoped, export_format, filename, payload, scoped.database.fetch_all_contacts_asc())
            else:
                reviewed = submission_preflight(desk, export_format, filename, payload)
            if params.get("siteID") is not None:
                reviewed["manifest"]["siteID"] = params["siteID"]
                reviewed["checks"].append({"id":"site", "status":"review", "message":"Site-specific EDI subset; other sites remain in the authoritative log."})
            return reviewed
        if method == "export_prepare":
            require({"sessionID"} <= set(params) <= {"sessionID", "format", "expectedRevision", "siteID"},
                    "Unexpected contest export fields")
            require("expectedRevision" not in params or type(params["expectedRevision"]) is int
                    and params["expectedRevision"] == state["revision"], "Contest changed after submission review", "stale_revision")
            require(len(self.exports) < 8, "Release another prepared export first", "export_busy")
            export_format = params.get("format", "cabrillo")
            require(export_format in {"cabrillo", "adif", "edi"}, "Unsupported contest export format")
            filename, payload = self.export_artifact(desk, 32 * 1024 * 1024, export_format, params.get("siteID"))
            require(bool(payload), "Plugin export was empty", "export_failed")
            artifact_id = str(uuid.uuid4())
            prepared = {"artifactID": artifact_id, "sessionID": session_id,
                        "workspaceGeneration": workspace_generation(state), "revision": state["revision"],
                        "byteLength": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
                        "format": export_format, "filename": filename}
            self.exports[artifact_id] = {"prepared": prepared, "bytes": payload}
            return prepared
        if method == "export_read":
            artifact_id = identifier(params.get("exportID"))
            artifact = self.exports.get(artifact_id)
            require(artifact is not None, "Prepared export is unavailable", "not_found")
            prepared, payload = artifact["prepared"], artifact["bytes"]
            require(params.get("workspaceGeneration") == workspace_generation(state)
                    and session_id == prepared["sessionID"],
                    "Prepared export scope changed", "export_scope_changed")
            offset, length = params.get("offset"), params.get("length")
            require(type(offset) is int and type(length) is int and offset >= 0 and 0 < length <= 65536
                    and offset + length <= len(payload), "Invalid export chunk")
            return {**{key: prepared[key] for key in ("artifactID", "sessionID", "workspaceGeneration",
                                                      "revision", "byteLength", "sha256")},
                    "offset": offset, "dataBase64": base64.b64encode(payload[offset:offset + length]).decode("ascii"),
                    "eof": offset + length == len(payload)}
        if method == "export_release":
            artifact_id = identifier(params.get("exportID"))
            artifact = self.exports.get(artifact_id)
            require(artifact is not None, "Prepared export is unavailable", "not_found")
            require(params.get("workspaceGeneration") == workspace_generation(state)
                    and session_id == artifact["prepared"]["sessionID"],
                    "Prepared export scope changed", "export_scope_changed")
            del self.exports[artifact_id]
            return {"released": True, "artifactID": artifact_id, "sessionID": session_id}
        raise HostError("unknown_method", "Unsupported contest host method")

    @staticmethod
    def callhistory(store, state, method, params):
        generation = params.get("generation")
        digest = params.get("digest")
        expected_scope = {"sessionID", "workspaceGeneration"}
        require(params.get("workspaceGeneration") == workspace_generation(state),
                "Call-history workspace changed", "stale_context")
        if method == "history_status":
            require(set(params) == expected_scope, "Unexpected call-history status fields")
            return {"sessionID": state["sessionID"], "workspaceGeneration": workspace_generation(state),
                    "activation": store.callhistory_status()}
        identifier(generation)
        require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
                "Invalid call-history digest")
        common = expected_scope | {"generation", "digest"}
        row_count = params.get("rowCount")
        if method in {"history_stage_begin", "history_stage_commit"}:
            require(set(params) == common | {"rowCount"}, "Unexpected call-history stage fields")
            require(type(row_count) is int and 0 <= row_count <= 100_000, "Invalid call-history row count")
        elif method == "history_stage_chunk":
            require(set(params) == common | {"offset", "rows"}, "Unexpected call-history chunk fields")
            offset, rows = params.get("offset"), params.get("rows")
            require(type(offset) is int and 0 <= offset <= 100_000, "Invalid call-history chunk offset")
            require(isinstance(rows, list) and 0 < len(rows) <= 256, "Invalid call-history chunk")
            for row in rows:
                require(isinstance(row, dict) and set(row) == set(CALLHISTORY_COLUMNS),
                        "Invalid call-history row")
                for value in row.values():
                    text(value, 512)
        elif method == "history_stage_cancel":
            require(set(params) == common, "Unexpected call-history cancellation fields")
        else:
            raise HostError("unknown_method", "Unsupported call-history host method")
        store.begin()
        try:
            if method == "history_stage_begin":
                store.begin_callhistory_stage(generation, digest, row_count)
            elif method == "history_stage_chunk":
                store.append_callhistory_stage(generation, digest, offset, rows)
            elif method == "history_stage_commit":
                store.activate_callhistory_stage(generation, digest, row_count)
            else:
                store.cancel_callhistory_stage(generation, digest)
            store.finish(True)
        except (ValueError, sqlite3.Error) as error:
            store.finish(False)
            raise HostError("history_activation_failed", str(error)) from error
        return {"sessionID": state["sessionID"], "workspaceGeneration": workspace_generation(state),
                "generation": generation, "digest": digest,
                "activation": store.callhistory_status()}

    def coordinate(self, store, state, method, params):
        request_id = identifier(params.get("requestID"))
        payload = canonical({"method": method, "params": params})
        store.begin()
        try:
            require(not store.replica(), "A contest replica cannot serve as group authority", "replica_read_only")
            previous = store.exec_sql(
                "SELECT payload,result FROM xlog_operation WHERE operation_id=?", (request_id,)
            )
            if previous:
                require(previous["payload"] == payload,
                        "Request ID was already used with another payload", "payload_conflict")
                result = json.loads(previous["result"])
                result["replayed"] = True
                store.finish(True)
                return result
            current = store.state(state["sessionID"])
            self.verify_engine(current)
            if "coordinationBasis" not in current:
                current["coordinationBasis"] = {
                    "pluginID": current["pluginID"], "sourceRevision": SOURCE_REVISION,
                    "referenceID": current["reference"]["id"],
                    "station": deepcopy(current["station"]), "settings": deepcopy(current["settings"]),
                }
                store.save_state(current)
            require(params.get("workspaceGeneration") == workspace_generation(current),
                    "Multi-operator workspace changed", "stale_context")
            common = {"sessionID", "workspaceGeneration", "requestID"}
            if method == "multi_coordination":
                from .coordination import coordinate
                result = coordinate(store, current, params, require, authority_identity(current))
                if params.get("action") == "read":
                    store.finish(True)
                    return result
            elif method == "multi_serial_reserve":
                require(set(params) == common | {"frequencyHz"}, "Unexpected shared serial fields")
                require(requires_serial(current), "This contest does not use serial numbers", "serial_unsupported")
                frequency = params.get("frequencyHz")
                require(type(frequency) is int, "Shared serial frequency must be integer Hz")
                Desk(store, current, self.commit).contest_band(frequency)
                scope = serial_scope(current, frequency)
                reservation = store.reserve_shared_serial(request_id, scope)
                result = {"sessionID": current["sessionID"],
                          "workspaceGeneration": workspace_generation(current),
                          "requestID": request_id, "revision": current["revision"],
                          "scope": scope, "serial": reservation["serial"],
                          "sentExchange": reserved_sent_exchange(current, reservation["serial"]),
                           "allocatedFieldID": allocated_serial_field(current),
                           "authority": authority_identity(current),
                          "replayed": False}
            elif method == "multi_dupe_inquiry":
                require(set(params) == common | {"call", "frequencyHz", "mode", "timestamp"},
                        "Unexpected dupe inquiry fields")
                call = text(params.get("call"), 32).strip().upper()
                require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Complete callsign required")
                frequency = params.get("frequencyHz")
                require(type(frequency) is int, "Dupe inquiry frequency must be integer Hz")
                mode = text(params.get("mode"), 16).strip().upper()
                require(mode in PLUGIN_REGISTRY[current["pluginID"]].modes,
                        "Dupe inquiry mode is not supported by this contest")
                timestamp = text(params.get("timestamp"), 19)
                try:
                    require(datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == timestamp,
                            "Timestamp must be UTC YYYY-MM-DD HH:MM:SS")
                except ValueError as error:
                    raise HostError("invalid_request", "Invalid UTC timestamp") from error
                desk = Desk(store, current, self.commit)
                band = desk.contest_band(frequency)
                result = {"sessionID": current["sessionID"],
                          "workspaceGeneration": workspace_generation(current),
                          "requestID": request_id, "revision": current["revision"],
                          "call": call, "band": BAND_LABELS[band], "mode": mode,
                          "timestamp": timestamp,
                          "isDupe": bool(desk.is_dupe(call, band, timestamp, mode)),
                           "authority": authority_identity(current),
                          "replayed": False}
            else:
                require(frozenset(params) in {frozenset(common | {"afterRevision", "limit"}),
                                              frozenset(common | {"afterRevision", "afterSequence", "limit"})},
                        "Unexpected contact change fields")
                after, after_sequence, limit = (params.get("afterRevision"),
                                                params.get("afterSequence", 2**63 - 1), params.get("limit"))
                require(type(after) is int and 0 <= after <= current["revision"],
                        "Invalid contact change revision", "stale_cursor")
                require(type(after_sequence) is int and after_sequence >= 0,
                        "Invalid contact change sequence", "stale_cursor")
                require(type(limit) is int and 1 <= limit <= 100, "Invalid contact change page limit")
                rows = store.contact_changes(after, after_sequence, limit + 1)
                has_more = len(rows) > limit
                rows = rows[:limit]
                if "afterSequence" in params:
                    expected_sequence = after_sequence + 1
                    for row in rows:
                        require(row["sequence"] == expected_sequence,
                                "Contact audit stream has a legacy gap and cannot be replicated safely",
                                "replica_change_unsupported")
                        expected_sequence += 1
                changes = []
                for row in rows:
                    try:
                        require(row["before_json"] is not None and row["after_json"] is not None,
                                "Legacy contact audit image is unavailable", "replica_change_unsupported")
                        before, after_image = json.loads(row["before_json"]), json.loads(row["after_json"])
                        before_identity = (json.loads(row["before_identity_json"])
                                           if row["before_identity_json"] else None)
                        after_identity = (json.loads(row["after_identity_json"])
                                          if row["after_identity_json"] else None)
                    except (TypeError, ValueError, json.JSONDecodeError) as error:
                        raise HostError("replica_change_unsupported",
                                        "Legacy contact audit image is invalid") from error
                    changes.append({"sequence": row["sequence"], "revision": row["revision"],
                                    "requestID": row["operation_id"], "qsoID": row["qso_id"],
                                    "kind": row["kind"], "before": before, "after": after_image,
                                    "reason": row["reason"], "beforeIdentity": before_identity,
                                    "afterIdentity": after_identity})
                if "afterSequence" in params:
                    # A tuple cursor describes the contact-audit stream, not the
                    # host state revision. Empty pages therefore cannot move it.
                    next_revision = rows[-1]["revision"] if rows else after
                    next_sequence = rows[-1]["sequence"] if rows else after_sequence
                else:
                    # Preserve the revision-only contract for older callers.
                    next_revision = rows[-1]["revision"] if has_more else current["revision"]
                    next_sequence = (rows[-1]["sequence"]
                                     if rows and rows[-1]["revision"] == next_revision else 0)
                result = {"sessionID": current["sessionID"],
                          "workspaceGeneration": workspace_generation(current),
                           "requestID": request_id, "afterRevision": after,
                           "afterSequence": after_sequence,
                          "currentRevision": current["revision"], "nextRevision": next_revision,
                           "nextSequence": next_sequence, "hasMore": has_more,
                           "authority": authority_identity(current),
                           "changes": changes, "replayed": False}
            store.conn.execute("INSERT INTO xlog_operation VALUES(?,?,?)",
                               (request_id, payload, canonical(result)))
            store.finish(True)
            return result
        except BaseException:
            store.finish(False)
            raise

    @staticmethod
    def replica_cursor(value, name):
        require(isinstance(value, dict) and set(value) == {"revision", "sequence"},
                f"Invalid {name} replica cursor", "stale_cursor")
        revision, sequence = value["revision"], value["sequence"]
        require(type(revision) is int and revision >= 0 and type(sequence) is int and sequence >= 0,
                f"Invalid {name} replica cursor", "stale_cursor")
        return revision, sequence

    @staticmethod
    def replica_identity(store, qso_id):
        row = store.exec_sql("SELECT raw_fields,country,deleted FROM xlog_qso_identity WHERE id=?", (qso_id,))
        if not row:
            return None
        return {"rawFields": json.loads(row["raw_fields"]),
                "country": json.loads(row["country"]) if row["country"] else None,
                "deleted": bool(row["deleted"])}

    @staticmethod
    def replica_reservation_valid(desk):
        state, store = desk.state, desk.database
        reservation = state.get("replicaReservation")
        keys = {"requestID", "scope", "serial", "sentExchange", "allocatedFieldID"}
        if not isinstance(reservation, dict) or set(reservation) != keys:
            return False
        try:
            request_id = identifier(reservation["requestID"])
            serial = reservation["serial"]
            scope = serial_scope(state, state["draft"]["frequencyHz"])
            if (type(serial) is not int or serial <= 0 or reservation["scope"] != scope or
                    reservation["sentExchange"] != reserved_sent_exchange(state, serial) or
                    reservation["allocatedFieldID"] != allocated_serial_field(state) or
                    state["draft"].get("serial") != serial):
                return False
        except (HostError, KeyError, TypeError, ValueError):
            return False
        row = store.exec_sql(
            "SELECT serial,operation_id,qso_id FROM xlog_serial WHERE draft_id=? AND scope=?",
            (state["draft"]["id"], scope),
        )
        return bool(row and row["serial"] == serial and row["operation_id"] == request_id
                    and row["qso_id"] is None)

    def apply_replica(self, desk, params):
        store, state = desk.database, desk.state
        required = {"sessionID", "workspaceGeneration", "operationID", "expectedRevision",
                    "authority", "fromCursor", "toCursor", "changes"}
        allowed = required | {"draftID", "authoredQSOID", "nextReservation", "historyComplete"}
        require(required <= set(params) <= allowed, "Replica apply fields are invalid")
        authority = params["authority"]
        authority_keys = {"sessionID", "workspaceGeneration", "pluginID", "sourceRevision",
                          "referenceID", "coordinationDigest"}
        require(isinstance(authority, dict) and set(authority) == authority_keys,
                "Replica authority identity is invalid", "authority_mismatch")
        identifier(authority["sessionID"]); identifier(authority["workspaceGeneration"])
        local_identity = coordination_identity(state)
        require({key: authority[key] for key in local_identity} == local_identity,
                "Replica contest configuration differs from the authority", "authority_mismatch")
        start = self.replica_cursor(params["fromCursor"], "source")
        end = self.replica_cursor(params["toCursor"], "destination")
        require(end >= start, "Replica cursor moved backwards", "stale_cursor")
        bound = store.replica()
        stage = store.replica_stage()
        authority_key = (authority["sessionID"], authority["workspaceGeneration"],
                         authority["coordinationDigest"])
        if stage and (stage["master_session_id"], stage["master_workspace_generation"],
                      stage["coordination_digest"]) != authority_key:
            require(start == (0, 0), "Replica staging authority changed", "authority_mismatch")
            # A superseded stage has never changed the local log. Discard it
            # atomically only when the authenticated replacement starts at the
            # beginning of its own history.
            store.conn.execute("DELETE FROM xlog_replica_stage_audit")
            store.conn.execute("DELETE FROM xlog_replica_stage_qso")
            store.conn.execute("DELETE FROM xlog_replica_stage")
            stage = None
        reconciling_history = bool(stage)
        staging_history = bool(stage)
        if stage:
            require(start == (stage["revision"], stage["sequence"]),
                    "Replica staging cursor is stale", "stale_cursor")
        elif bound and (bound["master_session_id"], bound["master_workspace_generation"],
                        bound["coordination_digest"]) == authority_key:
            require(start == (bound["revision"], bound["sequence"]),
                    "Replica cursor is stale", "stale_cursor")
        else:
            count = store.exec_sql("SELECT count(*) AS count FROM DXLOG WHERE ContestNR=?",
                                   (store.current_contest,))["count"]
            identity_count = store.exec_sql(
                "SELECT count(*) AS count FROM xlog_qso_identity")["count"]
            reconciling_history = bool(bound) or count > 0 or identity_count > 0
            require(start == (0, 0),
                    "A replica can bind only from the beginning of authority history", "replica_not_empty")
            if reconciling_history:
                require(type(params.get("historyComplete")) is bool,
                        "Replica history paging state is missing", "replica_history_incomplete")
                store.conn.execute("DELETE FROM xlog_replica_stage_audit")
                store.conn.execute("DELETE FROM xlog_replica_stage_qso")
                store.conn.execute("DELETE FROM xlog_replica_stage")
                store.conn.execute("INSERT INTO xlog_replica_stage VALUES(1,?,?,?,?,?,NULL)",
                                   (*authority_key, 0, 0))
                stage = store.replica_stage()
                staging_history = True
            else:
                store.conn.execute("DELETE FROM xlog_serial WHERE qso_id IS NULL")
                store.conn.execute("INSERT INTO xlog_replica VALUES(1,?,?,?,?,?)",
                                   (*authority_key, 0, 0))
        changes = params["changes"]
        require(isinstance(changes, list) and len(changes) <= 100, "Replica change page is invalid")
        previous = start
        previous_sequence = start[1]
        authored = params.get("authoredQSOID")
        if authored is not None:
            authored = identifier(authored)
            require(params.get("draftID") == state["draft"]["id"], "Draft changed", "stale_draft")
        authored_seen = False
        touched = {}
        staged_rows = (store.exec_sql_mult(
            "SELECT qso_id,row_json,identity_json FROM xlog_replica_stage_qso")
                       if staging_history else [])
        reconciled_rows = {row["qso_id"]: json.loads(row["row_json"])
                           for row in staged_rows}
        reconciled_identities = {row["qso_id"]: json.loads(row["identity_json"])
                                 for row in staged_rows}
        change_keys = {"sequence", "revision", "requestID", "qsoID", "kind", "before", "after",
                       "reason", "beforeIdentity", "afterIdentity"}
        for change in changes:
            require(isinstance(change, dict) and set(change) == change_keys,
                    "Replica change is malformed")
            cursor = self.replica_cursor({"revision": change["revision"],
                                          "sequence": change["sequence"]}, "change")
            require(previous < cursor <= end, "Replica changes are unordered or outside the page", "stale_cursor")
            require(change["sequence"] == previous_sequence + 1,
                    "Replica change page omitted or reordered a contact", "replica_conflict")
            previous = cursor
            previous_sequence = change["sequence"]
            request_id, qso_id = identifier(change["requestID"]), identifier(change["qsoID"])
            kind = change["kind"]
            require(kind in {"commit", "correct", "delete"}, "Replica change kind is invalid")
            require(isinstance(change["reason"], str) and len(change["reason"].encode()) <= 512,
                    "Replica change reason is invalid")
            before, after = change["before"], change["after"]
            require(before is None or isinstance(before, dict) and before.get("ID") == qso_id,
                    "Replica before-image identity is invalid")
            require(after is None or isinstance(after, dict) and after.get("ID") == qso_id,
                    "Replica after-image identity is invalid")
            # ContestNR is a store-local upstream row namespace. The master
            # value is not portable across databases and must never take part
            # in replica fencing or writes.
            before = ({**before, "ContestNR": store.current_contest} if before is not None else None)
            after = ({**after, "ContestNR": store.current_contest} if after is not None else None)
            before_identity, after_identity = change["beforeIdentity"], change["afterIdentity"]
            require(after_identity is not None and isinstance(after_identity, dict),
                    "Replica change lacks durable identity data", "replica_change_unsupported")
            current = (reconciled_rows.get(qso_id) if reconciling_history else
                       store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,)) or None)
            current_identity = (reconciled_identities.get(qso_id) if reconciling_history else
                                self.replica_identity(store, qso_id))
            require(replica_wire_equal(current, before) and replica_wire_equal(current_identity, before_identity),
                    "Replica contact differs from the authoritative before-image", "replica_conflict")
            require((kind == "commit" and before is None and after is not None) or
                    (kind == "correct" and before is not None and after is not None) or
                    (kind == "delete" and before is not None and after is None),
                    "Replica change images do not match its kind")
            require(set(after_identity) == {"rawFields", "country", "deleted"} and
                    isinstance(after_identity["rawFields"], dict) and
                    type(after_identity["deleted"]) is bool and
                    after_identity["deleted"] == (kind == "delete"),
                    "Replica identity image is invalid")
            if reconciling_history:
                reconciled_rows[qso_id] = after
                reconciled_identities[qso_id] = after_identity
                store.conn.execute(
                    "INSERT INTO xlog_replica_stage_qso VALUES(?,?,?) "
                    "ON CONFLICT(qso_id) DO UPDATE SET row_json=excluded.row_json,identity_json=excluded.identity_json",
                    (qso_id, canonical(after), canonical(after_identity)),
                )
            elif kind == "commit":
                store.log_contact(deepcopy(after))
                store.conn.execute("INSERT INTO xlog_qso_identity VALUES(?,?,?,?)",
                                   (qso_id, canonical(after_identity["rawFields"]),
                                    canonical(after_identity["country"]), int(after_identity["deleted"])))
            elif kind == "correct":
                store.change_contact(deepcopy(after))
                store.conn.execute("UPDATE xlog_qso_identity SET raw_fields=?,country=?,deleted=? WHERE id=?",
                                   (canonical(after_identity["rawFields"]), canonical(after_identity["country"]),
                                    int(after_identity["deleted"]), qso_id))
            else:
                store.delete_contact(qso_id)
                store.conn.execute("UPDATE xlog_qso_identity SET raw_fields=?,country=?,deleted=1 WHERE id=?",
                                   (canonical(after_identity["rawFields"]), canonical(after_identity["country"]), qso_id))
            audit_table = "xlog_replica_stage_audit" if staging_history else "xlog_qso_audit"
            store.conn.execute(
                f"INSERT INTO {audit_table}(sequence,revision,operation_id,qso_id,kind,before_json,after_json,reason,"
                "before_identity_json,after_identity_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (change["sequence"], change["revision"], request_id, qso_id, kind,
                 canonical(before), canonical(after), change["reason"],
                 canonical(before_identity) if before_identity is not None else None,
                 canonical(after_identity)),
            )
            touched[qso_id] = after
            authored_seen = authored_seen or (qso_id == authored and kind == "commit")
        require((not changes and end == start) or (changes and previous == end),
                "Replica page cursor does not exactly cover its changes", "replica_conflict")
        require(authored is None or authored_seen, "Authored contact is absent from this replica page",
                "replica_conflict")
        reservation = params.get("nextReservation")
        if staging_history:
            staged_reservation = (json.loads(stage["reservation_json"])
                                  if stage and stage["reservation_json"] else None)
            if reservation is not None:
                self.validate_replica_reservation(desk, reservation, authority)
                require(staged_reservation is None or canonical(staged_reservation) == canonical(reservation),
                        "Replica staging serial reservation changed", "serial_conflict")
                staged_reservation = reservation
            if requires_serial(state):
                require(staged_reservation is not None,
                        "Replica staging requires the next master reservation", "serial_not_found")
            else:
                require(staged_reservation is None,
                        "This replica contest does not use serials", "serial_unsupported")
            store.conn.execute(
                "UPDATE xlog_replica_stage SET revision=?,sequence=?,reservation_json=? WHERE singleton=1",
                (end[0], end[1], canonical(staged_reservation) if staged_reservation is not None else None),
            )
            if params.get("historyComplete") is not True:
                return {"revision": end[0], "sequence": end[1]}
        if reconciling_history:
            expected_rows = {qso_id: row for qso_id, row in reconciled_rows.items() if row is not None}
            actual_rows = {row["ID"]: row for row in store.exec_sql_mult(
                "SELECT * FROM DXLOG WHERE ContestNR=?", (store.current_contest,))}
            normalized_expected_rows = {}
            if set(actual_rows) == set(expected_rows):
                # The pinned Not1MM schema normalizes a few wire values through
                # SQLite affinity (for example "002" -> 2) and omits transient
                # Dirty. Normalize with the same store boundary, then restore
                # the untouched local row before deciding whether it matches.
                for qso_id, expected in expected_rows.items():
                    store.change_contact(deepcopy(expected))
                    normalized_expected_rows[qso_id] = store.exec_sql(
                        "SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
                    store.change_contact(deepcopy(actual_rows[qso_id]))
            identity_rows = store.exec_sql_mult(
                "SELECT id,raw_fields,country,deleted FROM xlog_qso_identity")
            actual_identities = {
                row["id"]: {"rawFields": json.loads(row["raw_fields"]),
                            "country": json.loads(row["country"]) if row["country"] else None,
                            "deleted": bool(row["deleted"])}
                for row in identity_rows
            }
            require(canonical(actual_rows) == canonical(normalized_expected_rows) and
                    canonical(actual_identities) == canonical(reconciled_identities),
                    "The local log is not an exact copy of the complete authority history",
                    "replica_history_conflict")
            store.conn.execute("DELETE FROM xlog_qso_audit")
            store.conn.execute(
                "INSERT INTO xlog_qso_audit(sequence,revision,operation_id,qso_id,kind,before_json,after_json,reason,"
                "before_identity_json,after_identity_json) "
                "SELECT sequence,revision,operation_id,qso_id,kind,before_json,after_json,reason,"
                "before_identity_json,after_identity_json FROM xlog_replica_stage_audit ORDER BY sequence"
            )
            store.conn.execute("DELETE FROM xlog_replica")
            store.conn.execute("INSERT INTO xlog_replica VALUES(1,?,?,?,?,?)",
                               (*authority_key, end[0], end[1]))
            reservation = staged_reservation
        needs_reservation = (requires_serial(state) and
                             (not bound or staging_history or authored is not None or
                              not self.replica_reservation_valid(desk)))
        if requires_serial(state):
            if needs_reservation:
                require(reservation is not None,
                        "Replica draft requires the next master reservation", "serial_not_found")
            else:
                require(reservation is None,
                        "Replica draft already has a valid authority reservation", "serial_conflict")
        else:
            require(reservation is None, "This replica contest does not use serials", "serial_unsupported")
        if bound and not changes and authored is None and not needs_reservation:
            return {"revision": end[0], "sequence": end[1], "noOp": True}
        self.rebuild(desk)
        for qso_id, expected in touched.items():
            actual = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,)) or None
            if expected is not None and not replica_wire_equal(actual, expected):
                # The master audit image is authoritative. Rebuild first so
                # correction side-effects reach other rows, then restore the
                # exact changed row for future before-image fencing.
                store.change_contact(deepcopy(expected))
        if authored is not None:
            if requires_serial(state):
                store.conn.execute("UPDATE xlog_serial SET qso_id=? WHERE draft_id=? AND qso_id IS NULL",
                                   (authored, state["draft"]["id"]))
            self.advance_draft(desk)
        if needs_reservation:
            self.install_replica_reservation(desk, reservation, authority)
        elif not requires_serial(state):
            state.pop("replicaReservation", None)
        store.conn.execute("UPDATE xlog_replica SET revision=?,sequence=? WHERE singleton=1", end)
        if staging_history:
            store.conn.execute("DELETE FROM xlog_replica_stage_audit")
            store.conn.execute("DELETE FROM xlog_replica_stage_qso")
            store.conn.execute("DELETE FROM xlog_replica_stage")
        return {"revision": end[0], "sequence": end[1]}

    def mutate(self, store, session_id, method, params):
        operation = identifier(params.get("requestID") if method == "multi_contact_apply"
                               else params.get("operationID"))
        payload = canonical({"method": method, "params": params})
        # Strategy shares the transaction owner but only these actions change
        # contact/accounting/station authority. Local plans remain writable.
        action = params.get("action")
        replica_blocked = method in self.REPLICA_BLOCKED or (method == "strategy_apply" and
            isinstance(action, str) and (action in {"adif_import", "site_activate", "transverter_save"}
                                         or action.startswith("qtc_")))
        store.begin()
        try:
            if replica_blocked and store.replica():
                raise HostError("replica_read_only",
                                "This contest is bound to a master; contacts and contest semantics are read-only")
            previous = store.exec_sql("SELECT payload,result FROM xlog_operation WHERE operation_id=?", (operation,))
            if previous:
                require(previous["payload"] == payload, "Operation ID was already used with another payload", "payload_conflict")
                result = self.replay_result(json.loads(previous["result"]), store)
                store.finish(True)
                self.remember_active_session(session_id)
                return result
            state = store.state(session_id)
            previous_n1mm_network = deepcopy(state.get("setup", {}).get("network", {})) if state else {}
            if state is not None and store.replica() and replica_blocked:
                raise HostError("replica_read_only",
                                "This contest is bound to a master; contacts and contest semantics are read-only")
            expected = params.get("expectedRevision", 0)
            require(type(expected) is int and expected >= 0, "Revision must be a nonnegative integer")
            new_session = False
            if method == "session_create":
                require(state is None, "Session already exists", "session_exists")
                require(expected == 0, "Creation revision must be zero")
                if "practiceSourceSessionID" in params:
                    from .practice import practice_creation
                    source_id = identifier(params["practiceSourceSessionID"])
                    require(source_id != session_id, "Practice requires a new session identity")
                    source = self.database(source_id).state(source_id)
                    require(source is not None and source["revision"] == params.get("sourceRevision")
                            and workspace_generation(source) == params.get("workspaceGeneration"),
                            "Practice source changed; reopen it before copying", "stale_context")
                    self.verify_engine(source)
                    copied, safe_setup, metadata, scoring = practice_creation(source, {**params, "sessionID": session_id})
                    state = self.new_state(session_id, copied, scoring_revision=scoring)
                    state["practice"], state["setup"] = metadata, safe_setup
                else:
                    state = self.new_state(session_id, params)
                state["coordinationBasis"] = {
                    "pluginID": state["pluginID"], "sourceRevision": SOURCE_REVISION,
                    "referenceID": state["reference"]["id"],
                    "station": deepcopy(state["station"]), "settings": deepcopy(state["settings"]),
                }
                new_session = True
            elif method == "legacy_import":
                if state is None:
                    require(expected == 0, "Creation revision must be zero")
                    state = self.new_state(session_id, params, scoring_revision=None)
                    new_session = True
                else:
                    self.verify_engine(state)
                    require(state.get("legacyImport") is not None,
                            "Session already exists and is not this legacy import", "session_exists")
                    require(params.get("workspaceGeneration") == workspace_generation(state),
                            "Legacy import workspace changed", "stale_context")
                    require(expected in {0, state["revision"]},
                            "Session changed; refresh before reconciling import", "stale_revision")
            else:
                require(state is not None, "Session does not exist", "not_found")
                self.verify_engine(state)
                if method in {"digital_ingest", "digital_select", "country_reconcile", "multi_contact_apply", "multi_replica_apply"}:
                    require(params.get("workspaceGeneration") == workspace_generation(state),
                            "Contact destination belongs to another workspace", "stale_context")
                if method == "digital_ingest":
                    semantic = params.get("semanticIdentity")
                    require(isinstance(semantic, str) and re.fullmatch(r"[0-9a-f]{64}", semantic) is not None,
                            "Invalid digital contact identity")
                    receipt = store.exec_sql(
                        "SELECT qso_id FROM xlog_digital_receipt WHERE semantic_identity=?", (semantic,))
                    if receipt:
                        desk = Desk(store, state, self.commit)
                        result = {"operationID": operation, "sessionID": session_id,
                                  "revision": state["revision"], "projection": desk.projection(),
                                  "actions": [], "messages": [], "replayed": True,
                                  "digitalDuplicate": True, "qsoID": receipt["qso_id"]}
                        store.finish(True)
                        self.remember_active_session(session_id)
                        return result
                if method != "multi_contact_apply":
                    require(expected == state["revision"], "Session changed; refresh before editing", "stale_revision")
            self._operation = operation
            self._n1mm_events = []
            self._note_binding_allowed = method in {"qso_commit", "esm", "function_key"}
            if new_session:
                self.reserve_serial(store, state)
            legacy_summary = None
            if method == "legacy_import":
                legacy_summary = self.import_legacy(store, state, params)
            from .lanes import select as select_lane, ENTRY_METHODS
            action_lane = select_lane(state, params, require, mandatory=method in ENTRY_METHODS or method == "note_save"
                                      or method == "strategy_apply" and params.get("action") == "sked_load")
            from .lanes import attribution as lane_attribution
            origin_context = lane_attribution(state)
            if state.get("laneState", {}).get("mode", "SO1V") != "SO1V" and method in ENTRY_METHODS - {"lane_select", "digital_ingest"}:
                require(params.get("draftID") == state["draft"]["id"], "Lane draft changed", "stale_draft")
                if method in {"esm", "function_key"}:
                    require(state["laneState"]["lanes"][action_lane]["binding"] is not None,
                            "Bind the lane to an explicit radio/receiver before output", "lane_unbound")
            desk = Desk(store, state, self.commit)
            if method == "lanes_configure":
                from .lanes import configure, snapshot
                require(params.get("workspaceGeneration") == workspace_generation(state), "Lane workspace changed", "stale_context")
                def make_second_lane():
                    second = deepcopy(state)
                    second.pop("laneState", None)
                    second["draft"]["id"] = str(uuid.uuid4())
                    second["draft"].pop("receiveFrequencyHz", None)
                    second["draft"]["prevCall"] = ""
                    second["esmCallSent"], second["focus"], second["run"] = "", "callsign", False
                    clean = Desk(store, second, self.commit)
                    clean.clear_inputs()
                    clean.persist()
                    self.reserve_serial(store, second)
                    return snapshot(second)
                configure(state, params, require, make_second_lane)
                desk = Desk(store, state, self.commit)
            elif method == "lane_select":
                require(state.get("laneState") is not None, "Configure operating lanes first")
                state["laneState"]["keyboardLaneID"] = action_lane
            elif method == "lane_context":
                from .lanes import context
                context(state, params, require)
            elif method in {"strategy_apply", "message_bank_save", "message_bank_activate", "operating_plan_save"}:
                require(params.get("workspaceGeneration") == workspace_generation(state), "Strategy workspace changed", "stale_context")
                try:
                    if method == "strategy_apply":
                        from .strategy import mutate as strategy_mutate, projection as strategy_projection
                        if params.get("action") == "adif_import":
                            from .adif_import import apply
                            wave_result = apply(self,store,state,params,require)
                        elif params.get("action") in {"site_activate", "beacon_add", "transverter_save"}:
                            from .vhf import mutate as vhf_mutate
                            def occupied_sites():
                                from .lanes import select
                                for lane_id in state.get("laneState", {}).get("lanes", {"laneA": {}}):
                                    candidate = deepcopy(state)
                                    if candidate.get("laneState"):
                                        select(candidate, {"laneID":lane_id,"workspaceGeneration":workspace_generation(candidate)}, require)
                                    current = Desk(store,candidate,self.commit)
                                    empty = Desk(store,deepcopy(candidate),self.commit);empty.clear_inputs()
                                    self.prefill(empty)
                                    if any(getattr(current,name).text().strip() != getattr(empty,name).text().strip() for name in INPUTS if not getattr(current,name).read_only):
                                        return True
                                return False
                            wave_result = vhf_mutate(desk, params, require, occupied_sites)
                        elif str(params.get("action", "")).startswith("qtc_"):
                            from .wae import mutate as qtc_mutate
                            if "countries" in params:
                                require(params.get("referenceID") == state["reference"]["id"], "QTC country reference changed", "reference_mismatch")
                                additions = self.countries(deepcopy(params["countries"]))
                                state["reference"]["countries"].update({call: info for call, info in additions.items() if call not in state["reference"]["countries"]})
                            wave_result = qtc_mutate(desk, params, require)
                        elif params.get("action") == "sked_load":
                            require(params.get("draftID") == state["draft"]["id"], "Draft changed", "stale_draft")
                            item = next((row for row in state.get("strategy", {}).get("skeds", []) if row["id"] == params.get("itemID")), None)
                            require(item is not None and item["status"] in {"active", "dismissed"}, "This reminder is no longer loadable")
                            empty = Desk(store, deepcopy(state), self.commit)
                            empty.clear_inputs()
                            require(not desk.callsign.text().strip() and all(
                                getattr(desk, name).text().strip() == getattr(empty, name).text().strip()
                                for name in INPUTS if name not in {"sent", "callsign"} and not getattr(desk, name).read_only),
                                "Entry is occupied. Park or finish it before loading a reminder", "occupied_draft")
                            self.apply_fields(desk, {"draftID": state["draft"]["id"], "fields": {**empty.values(), "callsign": item["callsign"]},
                                                    **({"frequencyHz": item["frequencyHz"]} if item["frequencyHz"] else {}),
                                                    **({"mode": "SSB" if item["mode"] in {"USB", "LSB"} else item["mode"]} if item["mode"] else {})})
                            wave_result = strategy_projection(state)
                        else:
                            wave_result = strategy_mutate(state, params, require, now_utc=params.get("nowUTC") or datetime.now(UTC).isoformat())
                    elif method == "operating_plan_save":
                        plan = params.get("plan")
                        require(isinstance(plan, dict) and set(plan) == {"ruleProfileID", "note"}, "Invalid operating plan")
                        require(plan["ruleProfileID"] in {"", "wpx-2026-single-op", "wpx-2026-multi-one"}, "Unsupported operating rule profile")
                        text(plan["note"], 4096)
                        state["operatingPlan"] = deepcopy(plan)
                        wave_result = deepcopy(plan)
                    else:
                        from .messages import apply_message_mutation
                        message_setup = self.default_setup(state)
                        message_setup["preferences"] = esm_preferences(message_setup["preferences"])
                        wave_result = apply_message_mutation(state, method, params, setup_document=message_setup)
                        if method == "message_bank_activate":
                            desk = Desk(store, state, self.commit)
                except ValueError as error:
                    raise HostError("invalid_request", str(error)) from error
            elif method == "note_save":
                from .productivity import save_note
                require(params.get("workspaceGeneration") == workspace_generation(state), "Note workspace changed", "stale_context")
                save_note(store, state, params, require)
            elif method == "digital_select":
                require(params.get("draftID") == state["draft"]["id"], "Digital selection draft changed", "stale_draft")
                field=params.get("fieldID")
                descriptors={item["id"]:item for item in desk.projection()["fields"]}
                require(field in descriptors and not descriptors[field].get("readOnly"), "Choose a writable plugin field")
                value=text(params.get("value"),128).strip()
                require(value and not any(ord(c)<32 for c in value), "Choose a bounded received token")
                baseline=Desk(store,deepcopy(state),self.commit);baseline.clear_inputs()
                require(getattr(desk,field).text().strip() in {"",getattr(baseline,field).text().strip()},
                        "That draft field is occupied. Preserve it before selecting received text", "occupied_draft")
                self.apply_fields(desk,{"draftID":state["draft"]["id"],"fields":{**desk.values(),field:value}})
                state.setdefault("digitalSelections",[]).append({"fieldID":field,"value":value,"source":text(params.get("source"),512),"draftID":state["draft"]["id"],"laneID":action_lane})
                state["digitalSelections"]=state["digitalSelections"][-100:]
            elif method == "draft_apply":
                previous_call = desk.callsign.text().strip().upper()
                self.apply_fields(desk, params)
                self.clear_received_fields_after_vfo_change(desk, params)
                if params.get("manualStackLoad") is not True:
                    self.prefill(desk, reset_cq_ww_zone=(desk.callsign.text().strip().upper() != previous_call))
            elif method == "focus":
                require(params.get("field") in INPUTS, "Unknown field")
                desk.current_widget = params["field"]
                if desk.use_esm:
                    desk.contest.process_esm(desk, getattr(desk, params["field"]), False)
            elif method == "run_state":
                require(type(params.get("run")) is bool, "Run state must be boolean")
                desk.pref["run_state"] = state["run"] = params["run"]
            elif method == "setup_save":
                setup = self.validate_setup(params.get("setup"))
                from .practice import enforce_practice_setup
                setup = enforce_practice_setup(state, setup)
                require(setup["pluginID"] == state["pluginID"], "A session's plugin cannot be changed")
                call = text(setup["station"].get("Call", ""), 32).upper()
                require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Invalid station call")
                require(call in state["reference"]["countries"], "Resolve the station country before changing setup", "station_country_unresolved")
                require(bool(setup["name"].strip()), "Contest name is required")
                operator = text(setup["operator"], 32)
                require(bool(operator.strip()), "Operator is required")
                apply_canonical_cq_ww_station_zone(
                    state["pluginID"], setup["station"], setup["settings"])
                zone = str(setup["settings"].get("SentExchange", ""))
                if state["pluginID"] == "cq_ww_vhf":
                    zone = normalize_cq_vhf_grid(zone)
                    setup["settings"]["SentExchange"] = zone
                if state["pluginID"] == "wia_remembrance":
                    setup["settings"].setdefault(
                        "ContestUTCOffsetMinutes", state["settings"].get("ContestUTCOffsetMinutes", 0))
                    offset = setup["settings"]["ContestUTCOffsetMinutes"]
                    require(type(offset) is int and -720 <= offset <= 840,
                            "WIA contest local UTC offset must be whole minutes from -720 to 840")
                if state["pluginID"] == "cq_ww_rtty":
                    validate_cq_ww_rtty_sent_exchange(setup["settings"].get("SentExchange", ""))
                elif state["pluginID"] in CQ_WW_PLUGINS:
                    require(zone.isdigit() and 1 <= int(zone) <= 40, "Sent CQ zone must be 1 to 40")
                if state["pluginID"] == "icwc_mst":
                    require(re.fullmatch(r"[A-Za-z][A-Za-z'-]{0,31}", zone) is not None, "ICWC sent exchange must be one name")
                if state["pluginID"] == "cwo":
                    validate_cwo_names(setup["station"], setup["settings"].get("SentExchange"))
                if state["pluginID"] in {"cwt", "k1usn_sst"}:
                    validate_name_sent_exchange(setup["settings"].get("SentExchange"))
                if state["pluginID"] in TEN_TEN_PLUGINS:
                    validate_ten_ten_sent_exchange(setup["settings"].get("SentExchange"))
                if state["pluginID"] in AADX_PLUGINS:
                    require(re.fullmatch(r"[0-9]+", zone) is not None
                            and 0 < int(zone) <= 9223372036854775807,
                            "AADX sent age must be a positive SQLite integer")
                if state["pluginID"] in CQ_160_PLUGINS:
                    require(re.fullmatch(r"[A-Za-z0-9]{1,6}", zone) is not None,
                            "CQ 160 sent exchange must be a state, province or CQ zone")
                if state["pluginID"] == "euhfc":
                    require(re.fullmatch(r"[0-9]{2}", zone) is not None,
                            "EUHFC sent license year must be two digits")
                if state["pluginID"] == "iaru_hf":
                    require(zone.isdigit() and 1 <= int(zone) <= 90,
                            "IARU HF sent ITU zone must be 1 to 90")
                    iaru_zone = setup["station"].get("IARUZone")
                    require(str(iaru_zone).isdigit() and 1 <= int(iaru_zone) <= 90,
                            "IARU HF station IARU zone must be 1 to 90")
                if state["pluginID"] == "arrl_10m":
                    require(re.fullmatch(r"#|[A-Za-z0-9]{1,6}", zone) is not None,
                            "ARRL 10M sent exchange must be #, state, province or ITU region")
                if state["pluginID"] == "arrl_160m":
                    require(re.fullmatch(r"[A-Za-z0-9]{1,6}", zone) is not None,
                            "ARRL 160 sent exchange must be an ARRL/RAC section or CQ zone")
                if state["pluginID"] in EA_MAJESTAD_PLUGINS:
                    require(re.fullmatch(r"#|[A-Za-z]{1,4}", zone) is not None,
                            "King of Spain sent exchange must be # or a province")
                if state["pluginID"] in REF_PLUGINS:
                    require(re.fullmatch(r"#|[A-Za-z0-9]{1,6}", zone) is not None,
                            "REF sent exchange must be #, a department or a prefix")
                if state["pluginID"] in EUROPEAN_DX_PLUGINS:
                    require(re.fullmatch(r"#|[A-Za-z]{1,4}", zone) is not None,
                            "National DX sent exchange must be # or a location code")
                if state["pluginID"] in CENTRAL_EUROPEAN_PLUGINS:
                    validate_central_europe_sent_exchange(
                        state["pluginID"], state["reference"]["countries"][call].get("primary_pfx", ""), zone)
                if state["pluginID"] in ESTONIAN_PLUGINS:
                    require(setup["settings"].get("SentExchange") == "#",
                            "Estonian contests require # as the serial exchange")
                    validate_estonian_setup(state["pluginID"], setup["station"], setup["settings"])
                if state["pluginID"] in EUROPEAN_HF_PLUGINS:
                    validate_european_hf_setup(
                        state["pluginID"], state["reference"]["countries"][call].get("primary_pfx", ""), zone)
                if state["pluginID"] in JIDX_PLUGINS:
                    validate_jidx_number(zone, state["reference"]["countries"][call].get("primary_pfx", ""),
                                         call, state.get("scoringRevision"), "sent")
                if state["pluginID"] == "ca_qso_party":
                    validate_ca_exchange(load_plugin(state["pluginID"]), zone, setup=True)
                if state["pluginID"] == "canada_day":
                    require(bool(zone.strip()) and zone.count("#") <= 1
                            and re.fullmatch(r"[A-Za-z0-9 #]{1,32}", zone) is not None,
                            "Canada Day sent exchange must be text with at most one # serial placeholder")
                if state["pluginID"] == "cqws":
                    require(re.fullmatch(r"[A-Za-z0-9]{1,8}", zone) is not None,
                            "CQWS sent station type must be 1 to 8 letters or digits")
                if state["pluginID"] == "darc_schwaben":
                    require(re.fullmatch(r"#|[A-Za-z0-9]{1,6}", zone) is not None,
                            "DARC Schwaben sent exchange must be # or a DOK/NM")
                if state["pluginID"] == "winter_field_day":
                    require(re.fullmatch(r"[0-9]{1,2}[A-Za-z] [A-Za-z0-9]{2,4}", zone) is not None,
                            "Winter Field Day sent exchange must be CLASS SECTION")
                validation_state = {"pluginID": state["pluginID"], "station": setup["station"],
                                    "reference": state["reference"]}
                validate_batch2_setup(state["pluginID"], validation_state, zone)
                validate_final_vhf_setup(state["pluginID"], validation_state, zone)
                modes = PLUGIN_REGISTRY[state["pluginID"]].modes
                mode = modes[0]
                if state["pluginID"] == "cq_ww_vhf":
                    allowed_categories = {*modes, "MIXED", "DIGITAL", "SSB+CW", "SSB+CW+DIGITAL"}
                else:
                    allowed_categories = {*modes, "MIXED"} if state["pluginID"] in MIXED_MODE_PLUGINS else set(modes)
                require(setup["settings"].get("ModeCategory", mode) in allowed_categories,
                        f"Selected plugin requires {mode} mode" if len(modes) == 1 else
                        f"Selected plugin requires a supported {mode} submode")
                setup["station"]["Call"] = call
                setup["settings"].setdefault("SentExchange", "")
                setup["settings"].setdefault("ModeCategory", mode)
                setup["settings"].setdefault("OverlayCategory", "N/A")
                category = setup["settings"]["ModeCategory"]
                current_mode = operating_mode(state)
                if category == "DIGITAL":
                    state["operatingMode"] = current_mode if current_mode not in {"CW", "SSB", "FM"} else "RTTY"
                elif category in modes:
                    state["operatingMode"] = category
                else:
                    state["operatingMode"] = current_mode if current_mode in modes else mode
                state.update({"setup": setup, "name": setup["name"], "operator": operator,
                              "station": deepcopy(setup["station"]), "settings": deepcopy(setup["settings"])})
                state["coordinationBasis"] = {
                    "pluginID": state["pluginID"], "sourceRevision": SOURCE_REVISION,
                    "referenceID": state["reference"]["id"],
                    "station": deepcopy(state["station"]), "settings": deepcopy(state["settings"]),
                }
                if state["pluginID"] == "ea_rtty" and zone != "#":
                    state["draft"]["fields"]["other_1"] = zone.upper()
                if state["pluginID"] == "darc_schwaben" and zone != "#":
                    state["draft"]["fields"]["other_1"] = zone.upper()
                if state["pluginID"] == "canada_day" and "#" not in zone:
                    state["draft"]["fields"]["other_1"] = zone.upper()
                if state["pluginID"] == "agcw_qrp" and not requires_serial(state):
                    state["draft"]["fields"]["other_1"] = zone.upper()
                if state["pluginID"] in {"rda_contest", "wia_remembrance"} and not requires_serial(state):
                    state["draft"]["fields"]["other_1"] = zone.upper()
                if state["pluginID"] in {"rsgb_iota", "ukeidx"} and not requires_serial(state):
                    state["draft"]["fields"]["other_1"] = zone.upper()
                if state["pluginID"] in GRID4_EXCHANGE_PLUGINS:
                    state["draft"]["fields"]["other_1"] = zone.upper()
                self.reserve_serial(store, state)
                # Recreate the adapter with effective settings/macros before returning
                # the projection, and rescore if the station country changed.
                previous_station = desk.station
                desk = Desk(store, state, self.commit)
                if (state["pluginID"] in CQ_WW_PLUGINS and state["pluginID"] != "cq_ww_rtty"
                        or state["pluginID"] in AADX_PLUGINS
                        or state["pluginID"] in DISPLAY_SENTNR_PLUGINS
                        or state["pluginID"] == "arrl_10m"
                        or state["pluginID"] in EA_MAJESTAD_PLUGINS
                        or state["pluginID"] in REF_PLUGINS
                        or state["pluginID"] in EUROPEAN_DX_PLUGINS
                        or state["pluginID"] in GRID4_EXCHANGE_PLUGINS):
                    desk.other_1.setText(zone)
                if state["pluginID"] in TEN_TEN_PLUGINS:
                    self.prefill(desk)
                if previous_station["Call"] != call:
                    self.rebuild(desk)
            elif method == "rover_location":
                location = text(params.get("location", ""), 10).strip().upper()
                require(bool(location), "Enter the current rover location")
                if state["pluginID"] == "cq_ww_vhf":
                    location = normalize_cq_vhf_grid(location)
                    require(bool(location), "CQ WW VHF rover location must contain a 4-character grid square")
                state["roverLocation"] = location
                desk.RoverLocation = location
                if state["pluginID"] == "cq_ww_vhf":
                    desk.other_1.setText(location)
            elif method == "recalculate":
                # Manual recalculation is a durable, replay-safe operation over
                # the complete Python-owned log. Keep the operator's in-progress
                # draft unchanged while the original plugin rebuilds points and
                # multiplier fields in timestamp order.
                fields = desk.values()
                self.rebuild(desk)
                for name, value in fields.items():
                    getattr(desk, name).setText(value)
            elif method == "country_reconcile":
                require(state["pluginID"] == "cq_ww_ssb",
                        "Country reconciliation is available only for CQ WW SSB", "unsupported")
                require(params.get("referenceID") == state["reference"]["id"],
                        "The contest CTY reference differs from this session", "reference_mismatch")
                repairs = params.get("repairs")
                require(isinstance(repairs, list) and 1 <= len(repairs) <= 100,
                        "A bounded country repair list is required")
                seen, changed = set(), False
                for repair in repairs:
                    require(isinstance(repair, dict) and set(repair) == {"qsoID", "callsign", "country"},
                            "Country repair fields are invalid")
                    qso_id = identifier(repair["qsoID"])
                    require(qso_id not in seen, "Country repair identities must be unique")
                    seen.add(qso_id)
                    call = text(repair["callsign"], 32).strip().upper()
                    require(bool(call), "Country repair callsign is required")
                    country = self.countries({call: deepcopy(repair["country"])})[call]
                    row = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
                    identity = store.exec_sql(
                        "SELECT raw_fields,country,deleted FROM xlog_qso_identity WHERE id=?", (qso_id,))
                    require(bool(row) and str(row["Call"]).strip().upper() == call,
                            "Country repair contact does not match", "contact_conflict")
                    require(bool(identity) and not identity["deleted"] and identity["country"],
                            "Country repair identity is unavailable", "contact_conflict")
                    before_identity = json.loads(identity["country"])
                    same_endpoint = (
                        str(before_identity.get("entity", "")).upper() == str(country["entity"]).upper()
                        and all(before_identity.get(key) == country[key] for key in ("continent", "cq", "itu"))
                    )
                    # A session may legitimately retain an older CTY endpoint.
                    # Never let that disagreement block opening the contest and
                    # never rewrite it: only primary-prefix-only matches proceed.
                    if not same_endpoint:
                        continue
                    if str(before_identity.get("primary_pfx", "")).upper() == str(country["primary_pfx"]).upper():
                        continue
                    before = dict(row)
                    after_identity = deepcopy(country)
                    state["reference"]["countries"][call] = after_identity
                    store.conn.execute("UPDATE DXLOG SET CountryPrefix=? WHERE ID=?",
                                       (after_identity["primary_pfx"], qso_id))
                    store.conn.execute("UPDATE xlog_qso_identity SET country=? WHERE id=?",
                                       (canonical(after_identity), qso_id))
                    after = dict(before)
                    after["CountryPrefix"] = after_identity["primary_pfx"]
                    self.audit(store, qso_id, "reference_reconcile", before, after,
                               reason="Bundled CTY primary-prefix correction",
                               revision=state["revision"] + 1,
                               before_identity=before_identity, after_identity=after_identity)
                    changed = True
                if changed:
                    fields = desk.values()
                    self.rebuild(desk)
                    for name, value in fields.items():
                        getattr(desk, name).setText(value)
            elif method == "esm":
                if "fields" in params or "mode" in params:
                    self.apply_fields(desk, params)
                    self.prefill(desk)
                field = params.get("field", state["focus"])
                require(field in INPUTS, "Unknown focused field")
                desk.current_widget = field
                if desk.use_esm:
                    desk.contest.process_esm(desk, getattr(desk, field), True)
                else:
                    desk.save_contact()
            elif method == "function_key":
                if "fields" in params or "mode" in params:
                    self.apply_fields(desk, params)
                    self.prefill(desk)
                key = params.get("key")
                require(key in {f"F{i}" for i in range(1, 13)}, "Unknown function key")
                if key == "F1" and not state["run"]:
                    desk.set_running(True)
                desk.process_function_key(getattr(desk, key))
            elif method == "qso_commit":
                if "fields" in params or "frequencyHz" in params or "countries" in params or "mode" in params:
                    self.apply_fields(desk, params)
                self.commit(desk, params.get("qsoID"), params.get("timestamp"))
            elif method == "digital_ingest":
                packet = self.digital_packet(state, params)
                plugin_handler = getattr(desk.contest, "ft8_handler", None)
                require(callable(plugin_handler), "This contest has no original digital logging handler",
                        "digital_unsupported")
                countries = params.get("countries", {})
                require(isinstance(countries, dict) and len(countries) <= 1,
                        "Invalid digital country reference")
                for call, country in countries.items():
                    require(call == packet["CALL"] and isinstance(country, dict),
                            "Digital country reference does not match the contact")
                    state["reference"]["countries"][call] = country
                committed = []
                from .lanes import snapshot as entry_snapshot
                entry_before=entry_snapshot(state)
                def commit_digital(current):
                    require(not committed, "Original digital handler attempted more than one commit")
                    qso_id = str(uuid.UUID(params["semanticIdentity"][:32]))
                    if requires_serial(state):
                        actual=packet.get("STX","")
                        require(actual.isdigit() and 0<int(actual)<=2**63-1,
                                "The external completion needs its actual sent serial", "external_serial_required")
                        scope=serial_scope(state,self.digital_frequency(packet))
                        held=store.exec_sql("SELECT draft_id FROM xlog_serial WHERE scope=? AND serial=?",(scope,int(actual)))
                        existing=store.exec_sql("SELECT ID FROM DXLOG WHERE ContestNR=? AND CAST(SentNr AS INTEGER)=?"+
                            (" AND Band=?" if scope.startswith("band:") else "")+" LIMIT 1",
                            (store.current_contest,int(actual),Desk.band(self.digital_frequency(packet))) if scope.startswith("band:") else (store.current_contest,int(actual)))
                        require(not held and not existing,"That actual sent serial is already reserved or logged; reconcile the external event before continuing", "external_serial_conflict")
                        store.conn.execute("INSERT INTO xlog_serial(draft_id,serial,operation_id,scope,qso_id) VALUES(?,?,?,?,?)",
                                           ("external:"+qso_id,int(actual),operation,scope,qso_id))
                    # The original digital handlers populate an otherwise empty
                    # contact before saving it. Stamp the same contest ownership
                    # metadata as an operator-entered new contact before passing
                    # those handler-owned fields through as the commit base.
                    current.contact.update({
                        "ContestNR": current.pref["contest"],
                        "ContestName": current.contest.cabrillo_name,
                        "StationPrefix": current.station["Call"],
                        "IsRunQSO": int(current.pref["run_state"]),
                        "Run1Run2": 1,
                    })
                    self.commit(current, qso_id, self.digital_timestamp(packet),
                                base=current.contact, frequency=self.digital_frequency(packet),digital_packet=packet)
                    committed.append(qso_id)
                desk._commit = commit_digital
                set_self = getattr(desk.contest, "set_self", None)
                if callable(set_self):
                    set_self(desk)
                plugin_handler(packet)
                require(len(committed) == 1, "Original digital handler did not commit the contact",
                        "digital_handler_failed")
                store.conn.execute("INSERT INTO xlog_digital_event VALUES(?,?,?)",(committed[0],canonical(packet),canonical(origin_context)))
                if origin_context:
                    attribution=deepcopy(origin_context)
                    attribution.update(transmitFrequencyHz=self.digital_frequency(packet),receiveFrequencyHz=None,split=None,splitEvidence="unknown",frequencyEvidence="external_completed_adif")
                    store.conn.execute("INSERT INTO xlog_qso_lane VALUES(?,?)",(committed[0],canonical(attribution)))
                for key,value in entry_before.items():
                    if value is None:state.pop(key,None)
                    else:state[key]=value
                desk=Desk(store,state,self.commit)
                store.conn.execute("INSERT INTO xlog_digital_receipt VALUES(?,?,?)",
                                   (params["semanticIdentity"], committed[0], operation))
            elif method in {"qso_correct", "qso_delete"}:
                self.change(desk, method, params)
            elif method == "multi_replica_apply":
                replica_cursor = self.apply_replica(desk, params)
                if replica_cursor.pop("noOp", False):
                    result = {"operationID": operation, "sessionID": session_id,
                              "revision": state["revision"], "projection": desk.projection(),
                              "actions": [], "messages": [], "replayed": False,
                              "replicaCursor": replica_cursor}
                    store.finish(True)
                    self.remember_active_session(session_id)
                    return result
            elif method == "multi_contact_apply":
                common = {"sessionID", "workspaceGeneration", "requestID", "action", "qsoID"}
                action = params.get("action")
                require(action in {"commit", "correct", "delete"}, "Unknown remote contact action")
                qso_id = identifier(params.get("qsoID"))
                if action == "commit":
                    required = common | {"timestamp", "frequencyHz", "fields"}
                    allowed = required | {"mode", "operator", "countries", "referenceID", "serialRequestID"}
                    require(required <= set(params) <= allowed, "Remote contact commit fields are invalid")
                    require(not store.exec_sql("SELECT ID FROM DXLOG WHERE ID=?", (qso_id,)),
                            "Remote contact identity already exists", "contact_conflict")
                    local_draft = deepcopy(state["draft"])
                    frequency = params.get("frequencyHz")
                    require(type(frequency) is int, "Frequency must be integer Hz")
                    if requires_serial(state):
                        serial_request = identifier(params.get("serialRequestID"))
                        scope = serial_scope(state, frequency)
                        reservation = store.exec_sql(
                            "SELECT serial,qso_id FROM xlog_serial WHERE draft_id=? AND scope=?",
                            (serial_request, scope),
                        )
                        require(bool(reservation), "Shared serial reservation does not exist", "serial_not_found")
                        require(reservation["qso_id"] in {None, qso_id},
                                "Shared serial reservation was already consumed", "serial_consumed")
                        state["draft"]["id"] = serial_request
                        state["draft"]["serial"] = reservation["serial"]
                        serial_field = "sent" if state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else "other_1"
                        state["draft"]["fields"][serial_field] = reserved_sent_exchange(state, reservation["serial"])
                        desk = Desk(store, state, self.commit)
                        store.conn.execute(
                            "UPDATE xlog_serial SET qso_id=? WHERE draft_id=? AND scope=?",
                            (qso_id, serial_request, scope),
                        )
                    else:
                        require("serialRequestID" not in params,
                                "This contest does not accept shared serial reservations", "serial_unsupported")
                    self.apply_fields(desk, params)
                    self.commit(desk, qso_id, params.get("timestamp"), operator=params.get("operator"))
                    generated_draft = state["draft"]["id"]
                    if generated_draft != local_draft["id"]:
                        store.conn.execute("DELETE FROM xlog_serial WHERE draft_id=? AND qso_id IS NULL",
                                           (generated_draft,))
                    state["draft"] = local_draft
                    desk = Desk(store, state, self.commit)
                else:
                    required = common | {"baseRevision"}
                    allowed = (required | {"fields", "timestamp", "frequencyHz", "receiveFrequencyHz", "power",
                                           "operator", "countries",
                                           "referenceID", "reason"} if action == "correct"
                               else required | {"reason"})
                    require(required <= set(params) <= allowed, "Remote contact change fields are invalid")
                    require("baseRevision" in params and type(params["baseRevision"]) is int,
                            "Remote correction/delete requires a base revision")
                    latest = store.latest_qso_revision(qso_id)
                    require(latest > 0 and params["baseRevision"] == latest,
                            "Contact changed after the remote snapshot", "contact_conflict")
                    identity = store.exec_sql("SELECT deleted FROM xlog_qso_identity WHERE id=?", (qso_id,))
                    require(bool(identity) and not identity["deleted"],
                            "Contact was deleted after the remote snapshot", "contact_conflict")
                    if action == "correct":
                        require("fields" in params, "Remote correction fields are required")
                    self.change(desk, "qso_correct" if action == "correct" else "qso_delete", params)
            if state.get("practice"):
                # Host-owned restriction survives setup changes and receipt replay.
                desk.actions = []
            desk.persist()
            from .lanes import checkpoint, attribution
            checkpoint(state)
            action_context = attribution(state)
            if state.get("strategy", {}).get("moves"):
                from .strategy import reconcile_worked
                reconcile_worked(state, store.exec_sql_mult("SELECT ID,Call,Band,Mode FROM DXLOG WHERE ContestNR=?", (store.current_contest,)), BAND_LABELS)
            state["revision"] += 1
            if state.get("laneState"):
                select_lane(state, {"laneID": state["laneState"]["keyboardLaneID"], "workspaceGeneration": workspace_generation(state)}, require)
            store.save_state(state)
            projection_desk = Desk(store, state, self.commit) if state.get("laneState") else desk
            result = {"operationID": operation, "sessionID": session_id, "revision": state["revision"],
                      "projection": projection_desk.projection(), "actions": desk.actions, "messages": desk.messages, "replayed": False}
            if action_context:
                result.update(laneID=action_context["laneID"], bindingVersion=action_context["bindingVersion"])
            if method == "digital_ingest":
                result.update({"digitalDuplicate": False, "qsoID": committed[0]})
            if method == "setup_save":
                result["setup"] = deepcopy(state["setup"])
                result["effectiveMacros"] = self.effective_macros(state)
            if method in {"strategy_apply", "message_bank_save", "message_bank_activate", "operating_plan_save"}:
                result["waveResult"] = wave_result
                if method == "message_bank_activate":
                    result["setup"] = deepcopy(state["setup"])
                    result["effectiveMacros"] = self.effective_macros(state)
            if method == "multi_contact_apply":
                result.update({"requestID": operation, "qsoID": qso_id, "action": action,
                               "changeRevision": store.latest_qso_revision(qso_id),
                               "authority": authority_identity(state)})
            if method == "multi_replica_apply":
                result["replicaCursor"] = replica_cursor
            if legacy_summary is not None:
                result["legacyImport"] = legacy_summary
            for index, action in enumerate(result["actions"]):
                action["actionID"] = f"{operation}:{index}"
                if origin_context:
                    original_draft = origin_context["draftID"]
                    action.update(laneID=origin_context["laneID"], bindingVersion=origin_context["bindingVersion"], laneBinding=origin_context["binding"],
                                  originDraftID=original_draft, draftID=original_draft, workspaceGeneration=origin_context["workspaceGeneration"])
            store.conn.execute("INSERT INTO xlog_operation VALUES(?,?,?)", (operation, payload, canonical(result)))
            store.finish(True)
            self.remember_active_session(session_id)
            self.publish_n1mm(state, method, params, desk, previous_n1mm_network)
            return result
        except BaseException:
            store.finish(False)
            raise
        finally:
            self._operation = None
            self._n1mm_events = None
            self._note_binding_allowed = False

    @staticmethod
    def exchange_warnings(received, country, prior_zones):
        received = str(received).strip()
        if not received.isdigit() or not 1 <= int(received) <= 40:
            return []
        zone = int(received)
        expected = country.get("cq") if isinstance(country, dict) else None
        warnings = []
        if type(expected) is int and 1 <= expected <= 40 and expected != zone:
            warnings.append({"fieldID": "other_2", "kind": "mismatch",
                             "message": f"Reference suggests CQ zone {expected}; received zone {zone} is retained."})
        previous = sorted({int(str(value).strip()) for value in prior_zones
                           if str(value).strip().isdigit() and 1 <= int(str(value).strip()) <= 40
                           and int(str(value).strip()) != zone})
        if previous:
            values = ", ".join(str(value) for value in previous)
            warnings.append({"fieldID": "other_2", "kind": "conflict",
                             "message": f"Other logged contacts with this call use CQ zone {values}; received zone {zone} is retained."})
        return warnings

    @staticmethod
    def add_exchange_warnings(store, state, rows):
        if state["pluginID"] != "cq_ww_ssb" or not rows:
            return
        calls = sorted({row["Call"] for row in rows})
        placeholders = ",".join("?" for _ in calls)
        prior = {}
        for contact in store.exec_sql_mult(
                f"SELECT DISTINCT Call,ZN FROM DXLOG WHERE ContestNR=? AND Call IN ({placeholders})",
                (store.current_contest, *calls)):
            prior.setdefault(contact["Call"], []).append(contact["ZN"])
        for row in rows:
            country = row.get("country_identity") or state["reference"]["countries"].get(row["Call"], {})
            row["exchangeWarnings"] = Host.exchange_warnings(row.get("ZN", ""), country, prior.get(row["Call"], []))

    @staticmethod
    def add_legacy_provenance(store, row):
        receipt = store.exec_sql(
            "SELECT source_identity,source_digest,source_contest_nr,source_rowid,raw_fields "
            "FROM xlog_legacy_row_receipt WHERE target_qso_id=?", (row["ID"],)
        )
        if receipt:
            row["legacyProvenance"] = {
                "sourceIdentity": receipt["source_identity"],
                "sourceDigest": receipt["source_digest"],
                "sourceContestNR": receipt["source_contest_nr"],
                "sourceRowID": receipt["source_rowid"],
                "rawFields": json.loads(receipt["raw_fields"]),
            }

    @staticmethod
    def import_legacy(store, state, params):
        required = {"sourcePath", "sourceIdentity", "sourceDigest", "sourceContestNR"}
        require(required <= set(params), "Legacy source identity, digest and contest are required")
        source_identity, source_digest = params.get("sourceIdentity"), params.get("sourceDigest")
        contest_nr = params.get("sourceContestNR")
        require(isinstance(source_identity, str) and re.fullmatch(r"[0-9a-f]{64}", source_identity),
                "Invalid legacy source identity")
        require(isinstance(source_digest, str) and re.fullmatch(r"[0-9a-f]{64}", source_digest),
                "Invalid legacy source digest")
        require(type(contest_nr) is int and contest_nr > 0, "Invalid legacy contest number")
        try:
            source = inspect_source(text(params.get("sourcePath"), 4096), contest_nr, include_rows=True)
        except LegacyImportError as error:
            raise HostError(error.code, str(error)) from error
        if source["source"]["identity"] != source_identity:
            raise HostError("source_identity_changed", "Legacy database is not the previewed source")
        if source["source"]["digest"] != source_digest:
            raise HostError("source_changed", "Legacy database changed after preview")
        source_name = source["contest"]["contestName"]
        plugin = load_plugin(state["pluginID"])
        require(source_name in {plugin.name, plugin.cabrillo_name},
                "Selected xLog plugin does not match the legacy contest plugin", "source_plugin_conflict")
        existing = store.exec_sql("SELECT * FROM xlog_legacy_import WHERE source_identity=?", (source_identity,))
        if existing:
            require(existing["source_digest"] == source_digest
                    and existing["source_contest_nr"] == contest_nr
                    and existing["plugin_id"] == state["pluginID"],
                    "Legacy source was already imported with different content or plugin", "source_conflict")
        target_columns = {row["name"] for row in store.exec_sql_mult("PRAGMA table_info(DXLOG)")}
        imported = 0
        for source_row in source["rows"]:
            source_rowid = source_row.pop("__source_rowid__")
            raw = deepcopy(source_row)
            try:
                digest = row_digest(raw)
            except LegacyImportError as error:
                raise HostError(error.code, str(error)) from error
            receipt = store.exec_sql(
                "SELECT source_digest,row_digest,target_qso_id,raw_fields FROM xlog_legacy_row_receipt "
                "WHERE source_identity=? AND source_contest_nr=? AND source_rowid=?",
                (source_identity, contest_nr, source_rowid),
            )
            qso_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                f"xlog:not1mm:{source_identity}:{contest_nr}:{source_rowid}:{digest}"))
            if receipt:
                require(receipt["source_digest"] == source_digest and receipt["row_digest"] == digest
                        and receipt["target_qso_id"] == qso_id and receipt["raw_fields"] == canonical(raw),
                        "Legacy row receipt conflicts with the current source", "source_row_conflict")
                continue
            copied = {key: value for key, value in raw.items() if key in target_columns}
            copied["ID"], copied["ContestNR"] = qso_id, 1
            columns = list(copied)
            placeholders = ",".join("?" for _ in columns)
            try:
                store.conn.execute(f"INSERT INTO DXLOG({','.join(columns)}) VALUES({placeholders})",
                                   tuple(copied[column] for column in columns))
            except sqlite3.IntegrityError as error:
                raise HostError("source_row_conflict", "Legacy row collides with another imported QSO") from error
            editor_fields = Host.legacy_editor_fields(raw)
            store.conn.execute("INSERT INTO xlog_qso_identity VALUES(?,?,?,0)",
                               (qso_id, canonical(editor_fields), "null"))
            store.conn.execute(
                "INSERT INTO xlog_legacy_row_receipt VALUES(?,?,?,?,?,?,?,?)",
                (source_identity, contest_nr, source_rowid, source_digest, digest, qso_id,
                 canonical(raw), canonical(copied)),
            )
            imported += 1
        if existing:
            store.conn.execute("UPDATE xlog_legacy_import SET imported_rows=? WHERE source_identity=?",
                               (len(source["rows"]), source_identity))
        else:
            store.conn.execute("INSERT INTO xlog_legacy_import VALUES(?,?,?,?,?,?,?,?)", (
                source_identity, source_digest, contest_nr, Path(params["sourcePath"]).name,
                len(source["rows"]), canonical(source["contest"]["settings"]),
                canonical(source["station"]) if source["station"] is not None else None,
                state["pluginID"],
            ))
        state["legacyImport"] = {"sourceIdentity": source_identity, "sourceDigest": source_digest,
                                 "sourceContestNR": contest_nr, "sourcePlugin": source_name,
                                 "rowCount": len(source["rows"])}
        return {**state["legacyImport"], "importedRows": imported,
                "reconciledRows": len(source["rows"]) - imported}

    @staticmethod
    def legacy_editor_fields(raw):
        """Project an original plugin row into the finite editor without replacing its raw authority."""
        return {
            "callsign": str(raw.get("Call") or ""),
            "sent": str(raw.get("SNT") or ""),
            "receive": str(raw.get("RCV") or ""),
            "other_1": str(raw.get("SentNr") or ""),
            "other_2": str(raw.get("Exchange1") or raw.get("ZN") or ""),
        }

    @staticmethod
    def default_setup(state):
        return {"name": state.get("name", "CQ WW CW"), "operator": state["operator"],
                "pluginID": state["pluginID"], "station": deepcopy(state["station"]),
                "settings": deepcopy(state["settings"]), "preferences": {}, "network": {}, "macros": []}

    @staticmethod
    def effective_macros(state):
        macros = load_cw_macros(state["pluginID"])
        for macro in state.get("setup", {}).get("macros", []):
            macros[(macro["mode"], macro["key"])] = {
                "label": macro["label"],
                "template": adapt_cw_template(state["pluginID"], macro["template"]),
            }
        return [{"mode": mode, "key": f"F{number}", **deepcopy(macros[(mode, f"F{number}")])}
                for mode in ("R", "S") for number in range(1, 13)]

    @staticmethod
    def validate_setup(value):
        keys = {"name", "operator", "pluginID", "station", "settings", "preferences", "network", "macros"}
        require(isinstance(value, dict) and set(value) == keys, "Complete setup document required")
        for key in ("name", "operator", "pluginID"):
            text(value[key], 128)
        require(value["pluginID"] in PLUGINS, "Unsupported pinned plugin")
        for key in ("station", "settings", "preferences", "network"):
            mapping = value[key]
            require(isinstance(mapping, dict) and len(mapping) <= 128, "Setup map exceeds bound")
            for name, item in mapping.items():
                text(name, 128)
                if key == "preferences" and isinstance(item, list):
                    require(len(item) <= 64, "Preference list exceeds bound")
                    for entry in item:
                        text(entry, 512)
                elif isinstance(item, str):
                    text(item, 512)
                else:
                    require(type(item) in ({int, float, bool} if key in {"preferences", "network"} else {int, float}),
                            "Setup values must be supported scalars")
                    require(type(item) is not float or math.isfinite(item), "Setup numbers must be finite")
        esm_preferences(value["preferences"])
        cw_formatting_preferences(value["preferences"])
        n1mm_preferences(value["network"])
        macros = value["macros"]
        require(isinstance(macros, list) and len(macros) <= 24, "At most 24 macros are supported")
        seen = set()
        for macro in macros:
            require(isinstance(macro, dict) and set(macro) == {"mode", "key", "label", "template"}, "Invalid macro")
            require(isinstance(macro["mode"], str) and isinstance(macro["key"], str)
                    and macro["mode"] in {"R", "S"} and macro["key"] in {f"F{i}" for i in range(1, 13)}, "Invalid macro key/mode")
            identity = (macro["mode"], macro["key"])
            require(identity not in seen, "Duplicate macro key/mode")
            seen.add(identity)
            text(macro["label"], 128)
            text(macro["template"], 1024)
        require(len(canonical(value).encode("utf-8")) <= 16384, "Setup exceeds field bound")
        return deepcopy(value)

    @staticmethod
    def replay_result(result, store=None):
        # Durable database replay never re-emits a physical output intent.
        result = deepcopy(result)
        projection = result.get("projection")
        if (store and isinstance(projection, dict) and projection.get("reservedSerial") is not None
                and projection.get("pluginID") not in SSA_MT_PLUGINS):
            reservation = store.exec_sql("SELECT serial FROM xlog_serial WHERE draft_id=? AND serial=?",
                                         (projection.get("draftID"), projection.get("reservedSerial")))
            if reservation:
                expected = str(reservation["serial"]).zfill(3)
                allocated_field = "sent" if projection.get("pluginID") in SENT_FIELD_SERIAL_PLUGINS else "other_1"
                for field in projection.get("fields", []):
                    if field.get("id") == allocated_field:
                        field["value"], field["readOnly"] = expected, True
        result["actions"] = []
        result["replayed"] = True
        return result

    @staticmethod
    def verify_engine(state):
        require(isinstance(state, dict), "Invalid persisted session state", "invalid_session")
        require(state.get("engine") == "not1mm-python" and isinstance(state.get("pluginID"), str)
                and state["pluginID"] in PLUGINS
                and state.get("sourceRevision") == SOURCE_REVISION,
                "This session belongs to a different contest engine/source", "engine_mismatch")
        require(isinstance(state.get("sessionID"), str)
                and type(state.get("revision")) is int and state["revision"] >= 0
                and all(isinstance(state.get(key), dict) for key in ("station", "settings", "reference", "draft"))
                and isinstance(state.get("operator"), str) and state.get("focus") in FIELDS
                and type(state.get("run")) is bool,
                "Incomplete persisted session state", "invalid_session")
        identifier(state["sessionID"])
        require(state.get("scoringRevision") in {None, "26.10.26"}
                and (state.get("scoringRevision") is None
                     or state["pluginID"] in SCORING_REVISION_PLUGINS),
                "Unsupported persisted scoring revision", "engine_mismatch")
        require(isinstance(state["draft"].get("fields"), dict)
                and isinstance(state["draft"].get("id"), str)
                and type(state["draft"].get("frequencyHz")) is int
                and isinstance(state["reference"].get("countries"), dict)
                and isinstance(state["reference"].get("id"), str)
                and isinstance(state["station"].get("Call"), str)
                and "SentExchange" in state["settings"],
                "Incomplete persisted session state", "invalid_session")
        if state["pluginID"] in WAE_PLUGINS:
            require(state.get("definitionVersion") == WAE_DEFINITION_VERSION,
                    "This WAE definition version requires explicit compatibility review; retained contacts were not rescored", "engine_mismatch")
        # Optional analytical reference coordinates never gate the core log.
        # Creation validates them strictly; an old/incompatible coordinate is
        # retained and makes finite Needed unavailable without a migration.
        require(operating_mode(state) in PLUGIN_REGISTRY[state["pluginID"]].modes,
                "Invalid persisted operating mode", "invalid_session")
        rover_location = state.get("roverLocation", "")
        require(isinstance(rover_location, str) and len(rover_location.encode("utf-8")) <= 10,
                "Invalid persisted rover location", "invalid_session")

    def new_state(self, session_id, params, *, scoring_revision=_NEW_SCORING_REVISION):
        plugin_id = params.get("pluginID", PLUGIN_ID)
        require(plugin_id in PLUGINS, "Unsupported pinned plugin")
        if scoring_revision is _NEW_SCORING_REVISION:
            scoring_revision = "26.10.26" if plugin_id in SCORING_REVISION_PLUGINS else None
        workspace = identifier(params.get("workspaceGeneration"))
        frequency = params.get("frequencyHz")
        require(type(frequency) is int, "A confirmed or manual frequency is required")
        Desk.band(frequency)
        require(plugin_id != "trans_tasman" or Desk.band(frequency) in {1.8, 3.5, 7.0},
                "Trans Tasman supports only 160, 80 and 40 metres", "invalid_frequency")
        require(plugin_id not in {"cq_wpx_rtty", "weekly_rtty"} or Desk.band(frequency) != 1.8,
                "Selected RTTY contest supports 80 through 10 metres", "invalid_frequency")
        require(plugin_id not in CQ_160_PLUGINS or Desk.band(frequency) == 1.8,
                "CQ 160 supports only 160 metres", "invalid_frequency")
        require(plugin_id != "arrl_160m" or Desk.band(frequency) == 1.8,
                "ARRL 160 supports only 160 metres", "invalid_frequency")
        require(plugin_id != "arrl_10m" or Desk.band(frequency) == 28.0,
                "ARRL 10M supports only 10 metres", "invalid_frequency")
        require(BAND_LABELS[Desk.band(frequency)] in PLUGIN_REGISTRY[plugin_id].bands,
                f'{PLUGIN_REGISTRY[plugin_id].name} does not support {BAND_LABELS[Desk.band(frequency)]}',
                "invalid_frequency")
        station, reference = deepcopy(params.get("station")), deepcopy(params.get("reference"))
        require(isinstance(station, dict) and isinstance(reference, dict), "Station and reference are required")
        call = text(station.get("Call", ""), 32).upper()
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Invalid station call")
        station["Call"] = call
        require(isinstance(reference.get("id"), str) and reference["id"], "Reference ID required")
        countries = self.countries(reference.get("countries"))
        multiplier_universe = validate_multiplier_universe(reference.get("multiplierUniverse"), reference["id"], require)
        require(call in countries, "Resolve the station country before creating this contest", "station_country_unresolved")
        settings = deepcopy(params.get("settings", {}))
        require(isinstance(settings, dict), "Settings must be an object")
        apply_canonical_cq_ww_station_zone(plugin_id, station, settings)
        if plugin_id == "wia_remembrance":
            local_offset = datetime.now().astimezone().utcoffset()
            settings.setdefault("ContestUTCOffsetMinutes",
                                int(local_offset.total_seconds() // 60) if local_offset is not None else 0)
        for value in [*station.values(), *settings.values()]:
            require(isinstance(value, (str, int)) and not isinstance(value, bool), "Station/settings values must be text or integer")
            text(str(value), 512)
        settings.setdefault("SentExchange", "")
        if plugin_id == "cq_ww_vhf":
            settings["SentExchange"] = normalize_cq_vhf_grid(settings["SentExchange"])
        if plugin_id == "wia_remembrance":
            offset = settings["ContestUTCOffsetMinutes"]
            require(type(offset) is int and -720 <= offset <= 840,
                    "WIA contest local UTC offset must be whole minutes from -720 to 840")
        if plugin_id == "cq_ww_rtty":
            validate_cq_ww_rtty_sent_exchange(settings["SentExchange"])
        elif plugin_id in CQ_WW_PLUGINS:
            require(str(settings["SentExchange"]).isdigit() and 1 <= int(settings["SentExchange"]) <= 40, "Sent CQ zone must be 1 to 40")
        if plugin_id == "icwc_mst":
            require(isinstance(settings["SentExchange"], str)
                    and re.fullmatch(r"[A-Za-z][A-Za-z'-]{0,31}", settings["SentExchange"]) is not None,
                    "ICWC sent exchange must be one name")
        if plugin_id == "cwo":
            validate_cwo_names(station, settings["SentExchange"])
        if plugin_id in {"cwt", "k1usn_sst"}:
            validate_name_sent_exchange(settings["SentExchange"])
        if plugin_id in TEN_TEN_PLUGINS:
            validate_ten_ten_sent_exchange(settings["SentExchange"])
        if plugin_id in JIDX_PLUGINS:
            validate_jidx_number(settings["SentExchange"], countries[call].get("primary_pfx", ""),
                                 call, scoring_revision, "sent")
        if plugin_id in AADX_PLUGINS:
            require(re.fullmatch(r"[0-9]+", str(settings["SentExchange"])) is not None
                    and 0 < int(settings["SentExchange"]) <= 9223372036854775807,
                    "AADX sent age must be a positive SQLite integer")
        if plugin_id in CQ_160_PLUGINS:
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", str(settings["SentExchange"])) is not None,
                    "CQ 160 sent exchange must be a state, province or CQ zone")
        if plugin_id == "euhfc":
            require(re.fullmatch(r"[0-9]{2}", str(settings["SentExchange"])) is not None,
                    "EUHFC sent license year must be two digits")
        if plugin_id == "iaru_hf":
            require(str(settings["SentExchange"]).isdigit()
                    and 1 <= int(settings["SentExchange"]) <= 90,
                    "IARU HF sent ITU zone must be 1 to 90")
            iaru_zone = station.get("IARUZone")
            require(str(iaru_zone).isdigit() and 1 <= int(iaru_zone) <= 90,
                    "IARU HF station IARU zone must be 1 to 90")
        if plugin_id == "arrl_10m":
            require(re.fullmatch(r"#|[A-Za-z0-9]{1,6}", str(settings["SentExchange"])) is not None,
                    "ARRL 10M sent exchange must be #, state, province or ITU region")
        if plugin_id == "arrl_160m":
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", str(settings["SentExchange"])) is not None,
                    "ARRL 160 sent exchange must be an ARRL/RAC section or CQ zone")
        if plugin_id == "arrl_field_day":
            require(re.fullmatch(r"[0-9]{1,2}[A-Fa-f] [A-Za-z]{2,4}", str(settings["SentExchange"])) is not None,
                    "ARRL Field Day sent exchange must be CLASS SECTION")
        if plugin_id == "arrl_rtty_ru":
            require(re.fullmatch(r"#|[A-Za-z]{1,4}", str(settings["SentExchange"])) is not None,
                    "ARRL RTTY Roundup sent exchange must be #, state or province")
        if plugin_id in ARRL_VHF_PLUGINS:
            require(re.fullmatch(r"[A-Ra-r]{2}[0-9]{2}", str(settings["SentExchange"])) is not None,
                    "ARRL VHF sent exchange must be a 4-character grid square")
        if plugin_id in EA_MAJESTAD_PLUGINS:
            require(re.fullmatch(r"#|[A-Za-z]{1,4}", str(settings["SentExchange"])) is not None,
                    "King of Spain sent exchange must be # or a province")
        if plugin_id in REF_PLUGINS:
            require(re.fullmatch(r"#|[A-Za-z0-9]{1,6}", str(settings["SentExchange"])) is not None,
                    "REF sent exchange must be #, a department or a prefix")
        if plugin_id in EUROPEAN_DX_PLUGINS:
            require(re.fullmatch(r"#|[A-Za-z]{1,4}", str(settings["SentExchange"])) is not None,
                    "National DX sent exchange must be # or a location code")
        if plugin_id in CENTRAL_EUROPEAN_PLUGINS:
            validate_central_europe_sent_exchange(
                plugin_id, countries[call].get("primary_pfx", ""), settings["SentExchange"])
        if plugin_id in ESTONIAN_PLUGINS:
            require(settings["SentExchange"] == "#",
                    "Estonian contests require # as the serial exchange")
            validate_estonian_setup(plugin_id, station, settings)
        if plugin_id in EUROPEAN_HF_PLUGINS:
            validate_european_hf_setup(
                plugin_id, countries[call].get("primary_pfx", ""), settings["SentExchange"])
        if plugin_id == "ca_qso_party":
            validate_ca_exchange(load_plugin(plugin_id), settings["SentExchange"], setup=True)
        if plugin_id == "canada_day":
            canada_exchange = str(settings["SentExchange"])
            require(bool(canada_exchange.strip()) and canada_exchange.count("#") <= 1
                    and re.fullmatch(r"[A-Za-z0-9 #]{1,32}", canada_exchange) is not None,
                    "Canada Day sent exchange must be text with at most one # serial placeholder")
        if plugin_id == "cqws":
            require(re.fullmatch(r"[A-Za-z0-9]{1,8}", str(settings["SentExchange"])) is not None,
                    "CQWS sent station type must be 1 to 8 letters or digits")
        if plugin_id == "darc_schwaben":
            require(re.fullmatch(r"#|[A-Za-z0-9]{1,6}", str(settings["SentExchange"])) is not None,
                    "DARC Schwaben sent exchange must be # or a DOK/NM")
        if plugin_id == "winter_field_day":
            require(re.fullmatch(r"[0-9]{1,2}[A-Za-z] [A-Za-z0-9]{2,4}", str(settings["SentExchange"])) is not None,
                    "Winter Field Day sent exchange must be CLASS SECTION")
        setup_state = {"pluginID": plugin_id, "station": station, "reference": {"countries": countries}}
        validate_batch2_setup(plugin_id, setup_state, settings["SentExchange"])
        validate_final_vhf_setup(plugin_id, setup_state, settings["SentExchange"])
        modes = PLUGIN_REGISTRY[plugin_id].modes
        mode = modes[0]
        settings.setdefault("ModeCategory", mode)
        if plugin_id == "cq_ww_vhf":
            allowed_categories = {*modes, "MIXED", "DIGITAL", "SSB+CW", "SSB+CW+DIGITAL"}
        else:
            allowed_categories = {*modes, "MIXED"} if plugin_id in MIXED_MODE_PLUGINS else set(modes)
        require(settings["ModeCategory"] in allowed_categories,
                f"Selected plugin requires {mode} mode" if len(modes) == 1 else
                f"Selected plugin requires a supported {mode} submode")
        settings.setdefault("OverlayCategory", "N/A")
        mixed_category = settings["ModeCategory"] in {"MIXED", "SSB+CW", "SSB+CW+DIGITAL"}
        if settings["ModeCategory"] == "DIGITAL":
            live_mode = params.get("mode", "RTTY")
        else:
            live_mode = params.get("mode", mode) if mixed_category else settings["ModeCategory"]
        require(live_mode in modes, f"Selected plugin requires a supported {mode} submode")
        report = default_report(live_mode)
        received_report = "" if plugin_id == "ca_qso_party" else report
        return {"sessionID": session_id, "workspaceGeneration": workspace,
                "name": text(params.get("name", PLUGINS[plugin_id]), 128),
                "revision": 0, "engine": "not1mm-python", "pluginID": plugin_id,
                "sourceRevision": SOURCE_REVISION, "schemaVersion": 1, "station": station, "settings": settings,
                # Existing sessions have no marker and retain their pinned score.
                # Setup edits/reopening never opt historical logs into new rules.
                "scoringRevision": scoring_revision,
                **({"definitionVersion":WAE_DEFINITION_VERSION} if plugin_id in WAE_PLUGINS else {}),
                "operatingMode": live_mode,
                "roverLocation": "",
                "operator": text(params.get("operator", call), 32), "reference": {"id": text(reference["id"]), "countries": countries,
                    **({"multiplierUniverse": multiplier_universe} if multiplier_universe is not None else {})},
                "run": False, "focus": "callsign", "draft": {"id": str(uuid.uuid4()), "frequencyHz": frequency,
                "fields": dict(zip(INPUTS, ("", report, received_report,
                    str(settings["SentExchange"]) if (plugin_id in CQ_WW_PLUGINS and plugin_id != "cq_ww_rtty")
                    or plugin_id in JIDX_PLUGINS
                    or plugin_id in AADX_PLUGINS
                     or plugin_id in TEN_TEN_PLUGINS
                     or plugin_id in DISPLAY_SENTNR_PLUGINS
                     or plugin_id == "arrl_10m"
                     or plugin_id in EA_MAJESTAD_PLUGINS
                     or plugin_id == "ea_rtty" and settings["SentExchange"] != "#"
                     or plugin_id in REF_PLUGINS
                       or plugin_id in EUROPEAN_DX_PLUGINS
                       or plugin_id == "canada_day" and "#" not in str(settings["SentExchange"])
                       or plugin_id == "agcw_qrp" and "#" not in str(settings["SentExchange"])
                       or plugin_id in {"rda_contest", "wia_remembrance"}
                       and not (plugin_id == "rda_contest" and not rda_station_is_russian(setup_state))
                       and "#" not in str(settings["SentExchange"])
                       or plugin_id in {"rsgb_iota", "ukeidx"}
                       and "#" not in str(settings["SentExchange"])
                       or plugin_id == "darc_schwaben" and settings["SentExchange"] != "#"
                       or plugin_id in GRID4_EXCHANGE_PLUGINS else "", "")))}}

    def reserve_serial(self, store, state):
        if not requires_serial(state):
            return
        scope = "contest"
        if ((state["pluginID"] == "trans_tasman"
             and state["settings"].get("OperatorCategory", "") != "SINGLE-OP")
                or (state["pluginID"] == "john_moyle_field_day"
                    and state["settings"].get("OperatorCategory", "") in {"MULTI-OP", "MULTI-TWO"})):
            scope = f'band:{Desk.band(state["draft"]["frequencyHz"])}'
        reservation = store.exec_sql("SELECT serial FROM xlog_serial WHERE draft_id=? AND scope=?",
                                     (state["draft"]["id"], scope))
        if reservation:
            serial = reservation["serial"]
        else:
            serial = store.exec_sql("SELECT coalesce(max(serial),0)+1 AS serial FROM xlog_serial WHERE scope=?", (scope,))["serial"]
            serial = max(serial,state.get("historicalSerialFloor",0)+1)
            store.conn.execute("INSERT INTO xlog_serial(draft_id,serial,operation_id,scope) VALUES(?,?,?,?)",
                               (state["draft"]["id"], serial, self._operation, scope))
        state["draft"]["serial"] = serial
        if state["pluginID"] not in SSA_MT_PLUGINS:
            field = "sent" if state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else "other_1"
            state["draft"]["fields"][field] = reserved_sent_exchange(state, serial)

    @staticmethod
    def countries(countries):
        require(isinstance(countries, dict) and len(countries) <= 256, "Bounded country resolution map required")
        for call, item in countries.items():
            text(call, 32)
            require(call == call.upper() and isinstance(item, dict), "Country records must use uppercase call keys")
            require(set(item) >= {"entity", "continent", "cq", "itu", "primary_pfx"}, "Incomplete country record")
            for key in ("entity", "continent", "primary_pfx"):
                text(item[key], 128)
                require(bool(item[key]), "Country text must not be empty")
            require(item["continent"] in {"AF", "AN", "AS", "EU", "NA", "OC", "SA"}, "Unknown continent")
            require(type(item["cq"]) is int and 1 <= item["cq"] <= 40 and type(item["itu"]) is int and 1 <= item["itu"] <= 90, "Invalid country zones")
        return countries

    def apply_fields(self, desk, params, allow_reserved_serial_change=False):
        require(params.get("draftID", desk.state["draft"]["id"]) == desk.state["draft"]["id"], "Draft changed", "stale_draft")
        if "receiveFrequencyHz" in params:
            receive = params["receiveFrequencyHz"]
            require(receive is None or type(receive) is int and 100_000 <= receive <= 100_000_000_000, "Receive frequency must be integer Hz or unknown")
            desk.state["draft"]["receiveFrequencyHz"] = receive
        if "mode" in params:
            mode = params["mode"]
            modes = PLUGIN_REGISTRY[desk.state["pluginID"]].modes
            require(mode in modes, f"Selected plugin requires a supported {modes[0]} submode")
            previous_report = default_report(operating_mode(desk.state))
            next_report = default_report(mode)
            explicit_fields = params.get("fields", {})
            for name in ("sent", "receive"):
                field = getattr(desk, name)
                if name not in explicit_fields and field.text() == previous_report:
                    field.setText(next_report)
            desk.state["operatingMode"] = mode
            desk.radio_state["mode"] = mode
        if "countries" in params:
            require(params.get("referenceID") == desk.state["reference"]["id"],
                    "The contest CTY reference differs from this session; migrate it explicitly before resolving new calls",
                    "reference_mismatch")
            additions = self.countries(deepcopy(params["countries"]))
            current = desk.state["reference"]["countries"]
            for call, country in additions.items():
                # The session reference is immutable once a call is pinned. A
                # newer live resolver may disagree during a long contest, but
                # that must not block draft updates or hide authoritative dupes.
                if call not in current:
                    current[call] = country
                elif (str(current[call].get("entity", "")).upper() == str(country.get("entity", "")).upper()
                      and all(current[call].get(key) == country.get(key)
                              for key in ("continent", "cq", "itu"))):
                    # Repair a primary-prefix-only bridge defect without
                    # accepting a different country endpoint into the pinned
                    # contest reference. This covers named CQ WW authorities
                    # that share an ADIF number with an ordinary entity.
                    current[call] = country
        fields = params.get("fields", {})
        require(isinstance(fields, dict) and set(fields) <= set(INPUTS), "Unknown draft field")
        serial_field = "sent" if desk.state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else "other_1"
        if (not allow_reserved_serial_change and requires_serial(desk.state)
                and desk.state["pluginID"] not in SSA_MT_PLUGINS and serial_field in fields):
            expected = reserved_sent_exchange(desk.state, desk.state["draft"].get("serial", ""))
            require(fields[serial_field] == expected,
                    "The sent serial is reserved by the contest host and cannot be changed", "serial_conflict")
        for name, value in fields.items():
            getattr(desk, name).setText(text(value, 128))
        desk.callsign.setText(desk.callsign.text().upper())
        if desk.state["pluginID"] == "dxpedition" and not desk.callsign.text():
            desk.contest.reset_label(desk)
        if "frequencyHz" in params:
            frequency = params["frequencyHz"]
            require(type(frequency) is int, "Frequency must be integer Hz")
            desk.contest_band(frequency)
            desk.state["draft"]["frequencyHz"] = frequency
            if not allow_reserved_serial_change:
                self.reserve_serial(desk.database, desk.state)
                if requires_serial(desk.state) and desk.state["pluginID"] not in SSA_MT_PLUGINS:
                    desk.current_sn = desk.state["draft"]["serial"]
                    getattr(desk, serial_field).setText(reserved_sent_exchange(desk.state, desk.current_sn))

    @staticmethod
    def prefill(desk, reset_cq_ww_zone=False):
        country = desk.cty_lookup(desk.callsign.text())
        zone_kind = "itu" if desk.state["pluginID"] == "iaru_hf" else "cq"
        desk.contact["ZN"] = next(iter(country.values()))[zone_kind] if country else ""
        if reset_cq_ww_zone and desk.state["pluginID"] == "cq_ww_ssb":
            # A new callsign owns a new received exchange. The pinned plugin only
            # fills an empty field, so explicitly discard the preceding call's
            # zone before its normal prefill/history sequence runs.
            desk.other_2.setText(str(desk.contact["ZN"]))
        if desk.state["pluginID"] == "trans_tasman":
            desk.contact["Band"] = desk.contest_band(desk.state["draft"]["frequencyHz"])
        desk.contest.prefill(desk)
        if (desk.state.get("setup", {}).get("preferences", {}).get("callHistory", True) is not False
                and hasattr(desk.contest, "check_call_history")):
            desk.contest.check_call_history(desk)

    @staticmethod
    def clear_received_fields_after_vfo_change(desk, params):
        if "observedVFOChange" not in params:
            return
        require(type(params["observedVFOChange"]) is bool, "Observed VFO change flag must be boolean")
        clear_enabled = desk.entry_policy()["clearOnVFOChange"]
        if not params["observedVFOChange"] or desk.state["run"] or not clear_enabled:
            return
        # Reports remain at their contest defaults (59/599); only the call and
        # editable plugin exchange inputs belong to the next station worked.
        for field, container in ((desk.callsign, desk.field0),
                                 (desk.other_1, desk.field3), (desk.other_2, desk.field4)):
            if container.visible and field.enabled and not field.read_only:
                field.setText("")
        spotted = params.get("observedSpotCallsign", "")
        require(isinstance(spotted, str) and (not spotted or
                re.fullmatch(r"[A-Z0-9/]{3,32}", spotted) is not None),
                "Observed spot callsign is invalid")
        if spotted:
            desk.callsign.setText(spotted)

    @staticmethod
    def validate_exchange(desk, fields):
        if desk.state["pluginID"].startswith("wae_"):
            require(re.fullmatch(r"[0-9]{1,9}", fields["other_2"]) is not None, "WAE received serial must be numeric; use 000 only when no serial was sent")
        elif desk.state["pluginID"] == "cq_ww_rtty":
            require(fields["other_1"].isdigit() and 1 <= int(fields["other_1"]) <= 40,
                    "CQ zone must be 1 to 40")
            country = desk.cty_lookup(desk.callsign.text())
            continent = next(iter(country.values())).get("continent", "") if country else ""
            require((continent != "NA" and fields["other_2"] == "")
                    or re.fullmatch(r"[A-Za-z]{1,4}", fields["other_2"]) is not None,
                    "CQ WW RTTY state/VE area is required for North America and must contain letters")
        elif desk.state["pluginID"] in CQ_WW_PLUGINS:
            require(fields["other_2"].isdigit() and 1 <= int(fields["other_2"]) <= 40, "CQ zone must be 1 to 40")
            require(fields["other_1"].isdigit() and 1 <= int(fields["other_1"]) <= 40, "Sent CQ zone must be 1 to 40")
        elif desk.state["pluginID"] == "euhfc":
            require(re.fullmatch(r"[0-9]{2}", fields["other_1"]) is not None
                    and re.fullmatch(r"[0-9]{2}", fields["other_2"]) is not None,
                    "EUHFC sent and received license years must be two digits")
        elif desk.state["pluginID"] == "iaru_hf":
            require(fields["other_1"].isdigit() and 1 <= int(fields["other_1"]) <= 90,
                    "IARU HF sent ITU zone must be 1 to 90")
            require((fields["other_2"].isdigit() and 1 <= int(fields["other_2"]) <= 90)
                    or re.fullmatch(r"[A-Z]{2,8}", fields["other_2"]) is not None,
                    "IARU HF received exchange must be ITU zone 1 to 90 or an HQ abbreviation")
        elif desk.state["pluginID"] in {"cq_wpx_cw", "cq_wpx_ssb", "cq_wpx_rtty",
                                         "trans_tasman", "oceania_dx_cw", "oceania_dx_ssb"}:
            for name in ("other_1", "other_2"):
                require(re.fullmatch(r"[0-9]+", fields[name]) is not None and 0 < int(fields[name]) <= 9223372036854775807,
                        "Sent and received serials must be positive SQLite integers")
        elif desk.state["pluginID"] == "cwo":
            require(re.fullmatch(r"[0-9]+", fields["other_1"]) is not None
                    and 0 < int(fields["other_1"]) <= 9223372036854775807,
                    "CW Open sent serial must be a positive SQLite integer")
            first, separator, second = fields["other_2"].partition(" ")
            name = first if re.fullmatch(r"[A-Za-z]{1,32}", first) else second
            serial = second if name == first else first
            require(separator == " " and fields["other_2"].count(" ") == 1
                    and re.fullmatch(r"[A-Za-z]{1,32}", name) is not None
                    and re.fullmatch(r"[0-9]+", serial) is not None
                    and 0 < int(serial) <= 9223372036854775807,
                    "CW Open received exchange must be SERIAL NAME or NAME SERIAL with one space")
        elif desk.state["pluginID"] in {"cwt", "k1usn_sst"}:
            require(all(value and value == value.strip() for value in (fields["other_1"], fields["other_2"])),
                    "Received name and exchange must be non-empty without surrounding whitespace")
        elif desk.state["pluginID"] in NAME_SPC_ENTRY_PLUGINS:
            country = desk.cty_lookup(desk.callsign.text())
            continent = next(iter(country.values())).get("continent", "") if country else ""
            require(fields["other_1"].isalpha(), "Received name must contain letters")
            require(continent != "NA" and fields["other_2"] == "" or fields["other_2"].isalpha(),
                    "Received SPC is required for North America and must contain letters")
        elif desk.state["pluginID"] in ARRL_DX_PLUGINS:
            require(bool(fields["other_2"].strip()), "Received power/state/province is required")
        elif desk.state["pluginID"] in TEN_TEN_PLUGINS:
            require(desk.contest.validate(desk), "Received exchange must be NAME 10-10# SPC")
        elif desk.state["pluginID"] in JIDX_PLUGINS:
            for name, call, direction in (("other_1", desk.station["Call"], "sent"),
                                           ("other_2", desk.parsed_call(), "received")):
                country = desk.cty_lookup(call)
                prefix = next(iter(country.values())).get("primary_pfx", "") if country else ""
                validate_jidx_number(fields[name], prefix, call, desk.state.get("scoringRevision"), direction)
        elif desk.state["pluginID"] in AADX_PLUGINS:
            require(desk.cty_lookup(desk.callsign.text()) is not None,
                    "Resolve the contact country before logging AADX")
            for name in ("other_1", "other_2"):
                require(re.fullmatch(r"[0-9]+", fields[name]) is not None
                        and 0 < int(fields[name]) <= 9223372036854775807,
                        "AADX sent and received ages must be positive SQLite integers")
        elif desk.state["pluginID"] in CQ_160_PLUGINS:
            country = desk.cty_lookup(desk.callsign.text())
            require(country is not None, "Resolve the contact country before logging CQ 160")
            exchange = fields["other_2"]
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", exchange) is not None,
                    "CQ 160 received exchange must be a state, province or CQ zone")
        elif desk.state["pluginID"] == "arrl_10m":
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", fields["other_2"]) is not None,
                    "ARRL 10M received exchange must be a state, province, serial or ITU region")
            if requires_serial(desk.state):
                require(re.fullmatch(r"[0-9]+", fields["other_1"]) is not None
                        and 0 < int(fields["other_1"]) <= 9223372036854775807,
                        "ARRL 10M sent serial must be a positive SQLite integer")
            else:
                require(fields["other_1"] == str(desk.state["settings"]["SentExchange"]),
                        "ARRL 10M sent exchange must match contest setup")
        elif desk.state["pluginID"] == "arrl_160m":
            require(desk.cty_lookup(desk.callsign.text()) is not None,
                    "Resolve the contact country before logging ARRL 160")
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", fields["other_2"]) is not None,
                    "ARRL 160 received exchange must be an ARRL/RAC section or CQ zone")
        elif desk.state["pluginID"] == "arrl_field_day":
            require(re.fullmatch(r"[0-9]{1,2}[A-Fa-f]", fields["other_1"]) is not None
                    and re.fullmatch(r"[A-Za-z]{2,4}", fields["other_2"]) is not None,
                    "ARRL Field Day received exchange must be CLASS and SECTION")
        elif desk.state["pluginID"] == "arrl_rtty_ru":
            require(re.fullmatch(r"[A-Za-z]{1,4}|[0-9]+", fields["other_2"]) is not None,
                    "ARRL RTTY Roundup received exchange must be a state, province or positive serial")
            if fields["other_2"].isdigit():
                require(0 < int(fields["other_2"]) <= 9223372036854775807,
                        "ARRL RTTY Roundup received serial must be a positive SQLite integer")
            if requires_serial(desk.state):
                require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0,
                        "ARRL RTTY Roundup sent serial must be positive")
            else:
                require(fields["other_1"] == str(desk.state["settings"]["SentExchange"]),
                        "ARRL RTTY Roundup sent exchange must match contest setup")
        elif desk.state["pluginID"] in ARRL_VHF_PLUGINS:
            require(re.fullmatch(r"[A-Ra-r]{2}[0-9]{2}", fields["other_2"]) is not None,
                    "ARRL VHF received exchange must be a 4-character grid square")
            require(fields["other_1"].upper() == str(desk.state["settings"]["SentExchange"]).upper(),
                    "ARRL VHF sent grid must match contest setup")
        elif desk.state["pluginID"] in EA_MAJESTAD_PLUGINS:
            require(re.fullmatch(r"[A-Za-z]{1,4}|[0-9]+", fields["other_2"]) is not None,
                    "King of Spain received exchange must be a province or positive serial")
            if fields["other_2"].isdigit():
                require(0 < int(fields["other_2"]) <= 9223372036854775807,
                        "King of Spain received serial must be a positive SQLite integer")
            if requires_serial(desk.state):
                require(fields["other_1"].isdigit()
                        and 0 < int(fields["other_1"]) <= 9223372036854775807,
                        "King of Spain sent serial must be a positive SQLite integer")
            else:
                require(fields["other_1"] == str(desk.state["settings"]["SentExchange"]),
                        "King of Spain sent province must match contest setup")
        elif desk.state["pluginID"] in REF_PLUGINS:
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", fields["other_2"]) is not None,
                    "REF received exchange must be a department, prefix or positive serial")
            if fields["other_2"].isdigit():
                require(0 < int(fields["other_2"]) <= 9223372036854775807,
                        "REF received serial must be a positive SQLite integer")
            if requires_serial(desk.state):
                require(fields["other_1"].isdigit()
                        and 0 < int(fields["other_1"]) <= 9223372036854775807,
                        "REF sent serial must be a positive SQLite integer")
            else:
                require(fields["other_1"] == str(desk.state["settings"]["SentExchange"]),
                        "REF sent department/prefix must match contest setup")
        elif desk.state["pluginID"] in EUROPEAN_DX_PLUGINS:
            received = fields["other_2"]
            require(re.fullmatch(r"[A-Za-z]{1,4}|[0-9]+", received) is not None,
                    "National DX received exchange must be a location code or positive serial")
            if received.isdigit():
                require(0 < int(received) <= 9223372036854775807,
                        "National DX received serial must be a positive SQLite integer")
            if requires_serial(desk.state):
                require(fields["other_1"].isdigit()
                        and 0 < int(fields["other_1"]) <= 9223372036854775807,
                        "National DX sent serial must be a positive SQLite integer")
            else:
                require(fields["other_1"] == str(desk.state["settings"]["SentExchange"]),
                        "National DX sent location must match contest setup")
        elif desk.state["pluginID"] in CENTRAL_EUROPEAN_PLUGINS:
            plugin_id = desk.state["pluginID"]
            country = desk.cty_lookup(desk.callsign.text())
            require(country is not None, "Resolve the contact country before logging this contest")
            contact_prefix = next(iter(country.values())).get("primary_pfx", "")
            station_country = desk.cty_lookup(desk.station.get("Call", ""))
            station_prefix = next(iter(station_country.values())).get("primary_pfx", "") if station_country else ""
            sent = fields["other_1"]
            received = fields["other_2"]
            if requires_serial(desk.state):
                require(sent.isdigit() and 0 < int(sent) <= 9223372036854775807,
                        "Sent serial must be a positive SQLite integer")
            else:
                require(sent.upper() == str(desk.state["settings"]["SentExchange"]).upper(),
                        "Sent exchange must match contest setup")
            if plugin_id == "ari_dx":
                valid = (re.fullmatch(r"[A-Za-z]{2}", received) is not None
                         if contact_prefix in {"I", "IS"} else received.isdigit() and int(received) > 0)
                require(valid, "ARI DX received exchange must be an Italian province or positive serial")
            elif plugin_id in {"darc_xmas", "wag"}:
                valid = (re.fullmatch(r"[A-Za-z0-9]{1,6}", received) is not None
                         if contact_prefix == "DL" else received.isdigit() and int(received) > 0)
                require(valid, "DARC received exchange must be a DOK/NM for DL or positive serial")
                if plugin_id == "wag" and station_prefix != "DL":
                    require(contact_prefix == "DL", "Non-DL WAG stations may work only DL stations")
            elif plugin_id == "eudx":
                require((re.fullmatch(r"[A-Za-z]{2}[0-9]{2}", received) is not None)
                        or (received.isdigit() and 1 <= int(received) <= 90),
                        "EUDX received exchange must be an EU Union region or ITU zone 1 to 90")
            else:
                valid = (re.fullmatch(r"[A-Za-z]{2}", received) is not None if contact_prefix == "LZ"
                         else received.isdigit() and 1 <= int(received) <= 90)
                require(valid, "LZ DX received exchange must be a district in LZ or ITU zone 1 to 90")
        elif desk.state["pluginID"] in EUROPEAN_HF_PLUGINS:
            plugin_id = desk.state["pluginID"]
            sent, received = fields["other_1"], fields["other_2"].upper()
            if plugin_id == "ari_40_80":
                require(re.fullmatch(r"[A-Z0-9]{1,6}", received) is not None,
                        "ARI 40/80 received automobile code must be 1 to 6 letters or digits")
            elif plugin_id == "ea_rtty":
                contact = desk.cty_lookup(desk.callsign.text())
                station = desk.cty_lookup(desk.station.get("Call", ""))
                require(contact is not None and station is not None,
                        "Resolve station and contact countries before logging EA RTTY")
                contact_prefix = next(iter(contact.values())).get("primary_pfx", "")
                station_prefix = next(iter(station.values())).get("primary_pfx", "")
                sent_valid = (re.fullmatch(r"[A-Z]{1,2}", sent.upper()) is not None
                              if station_prefix.startswith("EA") else sent.isdigit() and int(sent) > 0)
                received_valid = (re.fullmatch(r"[A-Z]{1,2}", received) is not None
                                  if contact_prefix.startswith("EA") else received.isdigit() and int(received) > 0)
                require(sent_valid and received_valid,
                        "EA RTTY exchange must be an EA province or a positive serial outside EA")
            elif plugin_id == "ok1wc":
                require(sent.isdigit() and int(sent) > 0 and received.isdigit() and int(received) > 0,
                        "OK1WC sent and received serials must be positive integers")
            else:
                require(sent.isdigit() and 1 <= int(sent) <= 999
                        and 1 <= int(desk.current_sn) <= 999,
                        "SSA MT sent and received serials must be between 1 and 999")
                require(desk.contest._check_locator(received),  # pylint: disable=protected-access
                        "SSA MT received locator must be a valid 6-character Swedish locator")
        elif desk.state["pluginID"] == "ca_qso_party":
            validate_ca_exchange(desk.contest, fields["other_1"])
            require(fields["sent"].isdigit() and int(fields["sent"]) > 0
                    and fields["receive"].isdigit() and int(fields["receive"]) > 0,
                    "CQP sent and received serials must be positive integers")
        elif desk.state["pluginID"] == "canada_day":
            require(bool(fields["other_1"].strip()), "Canada Day sent exchange is required")
            require(re.fullmatch(r"[A-Za-z]{1,8}|[0-9]+", fields["other_2"]) is not None,
                    "Canada Day received exchange must be a province, territory, or positive serial")
            if fields["other_2"].isdigit():
                require(int(fields["other_2"]) > 0, "Canada Day received serial must be positive")
        elif desk.state["pluginID"] == "cqws":
            extra = {"TEEN", "ROOKIE"} if desk.state.get("scoringRevision") == "26.10.26" else set()
            require(fields["other_2"].upper() in CQWS_EXCHANGES | extra,
                    "CQWS received station type is invalid")
        elif desk.state["pluginID"] == "darc_schwaben":
            if requires_serial(desk.state):
                require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0,
                        "DARC Schwaben sent serial must be positive")
            else:
                require(fields["other_1"].upper() == str(desk.state["settings"]["SentExchange"]).upper(),
                        "DARC Schwaben sent DOK/NM must match contest setup")
            received, locator = desk.contest.parse_exchange(fields["other_2"])
            require(re.fullmatch(r"[A-Za-z0-9]{1,6}", received) is not None,
                    "DARC Schwaben received exchange must contain a DOK/NM or serial")
            require(not locator or re.fullmatch(r"[A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?", locator) is not None,
                    "DARC Schwaben locator must be a valid 4- or 6-character grid")
        elif desk.state["pluginID"] == "winter_field_day":
            require(re.fullmatch(r"[0-9]{1,2}[A-Za-z]", fields["other_1"]) is not None
                    and re.fullmatch(r"[A-Za-z0-9]{2,4}", fields["other_2"]) is not None,
                    "Winter Field Day received exchange must be CLASS and SECTION")
        elif desk.state["pluginID"] == "agcw_qrp":
            configured = str(desk.state["settings"]["SentExchange"]).upper()
            require((requires_serial(desk.state)
                     and fields["other_1"].isdigit() and int(fields["other_1"]) > 0)
                    or (not requires_serial(desk.state) and fields["other_1"].upper() == configured),
                    "AGCW QRP sent exchange must match the configured fixed value or a positive serial")
            require(re.fullmatch(r"[0-9]+[ /](?:VLP|QRP|MP|QRO)[ /](?:NM|[0-9]+)",
                                 fields["other_2"].upper()) is not None,
                    "AGCW QRP received exchange must be SERIAL POWER MEMBER (or NM)")
        elif desk.state["pluginID"] == "raem":
            require(fields["sent"].isdigit() and int(fields["sent"]) > 0
                    and fields["other_1"].isdigit() and int(fields["other_1"]) > 0,
                    "RAEM sent and received serials must be positive")
            require(valid_raem_coordinates(fields["other_2"]),
                    "RAEM received coordinates must look like 33N117W")
        elif desk.state["pluginID"] in {"rda_contest", "rdxc"}:
            if desk.state["pluginID"] == "rdxc" or not rda_station_is_russian(desk.state):
                require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0,
                        "Sent serial must be positive")
            else:
                require(fields["other_1"].upper() == str(desk.state["settings"]["SentExchange"]).upper(),
                        "RDA sent district must match contest setup")
            require(re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,15}|[0-9]+", fields["other_2"]) is not None,
                    "Received exchange must be a positive serial or district/oblast code")
            if fields["other_2"].isdigit():
                require(int(fields["other_2"]) > 0, "Received serial must be positive")
        elif desk.state["pluginID"] == "rsgb_iota":
            require(re.fullmatch(r"0*[1-9][0-9]*(?: [A-Za-z]{2}-?[0-9]{3})?", fields["other_1"]) is not None,
                    "RSGB IOTA sent exchange must contain a positive serial and optional IOTA reference")
            require(re.fullmatch(r"0*[1-9][0-9]*(?: [A-Za-z]{2}-?[0-9]{3})?", fields["other_2"]) is not None,
                    "RSGB IOTA received exchange must be SERIAL with an optional IOTA reference")
        elif desk.state["pluginID"] == "stew_perry_topband":
            require(re.fullmatch(r"[A-Ra-r]{2}[0-9]{2}", fields["other_1"]) is not None,
                    "Stew Perry received exchange must be a 4-character grid")
        elif desk.state["pluginID"] == "ukeidx":
            require(re.fullmatch(r"0*[1-9][0-9]*(?: [A-Za-z0-9]{1,4})?", fields["other_1"]) is not None,
                    "UKEI DX sent exchange must contain a positive serial and optional district")
            require(re.fullmatch(r"(?:0*[1-9][0-9]*(?: [A-Za-z0-9]{1,4})?|0*[1-9][0-9]*[A-Za-z]{2})",
                                 fields["other_2"]) is not None,
                    "UKEI DX received exchange must be SERIAL with an optional district")
        elif desk.state["pluginID"] == "wia_remembrance":
            require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0
                    and fields["other_2"].isdigit() and int(fields["other_2"]) > 0,
                    "WIA Remembrance licensed years must be positive integers")
        elif desk.state["pluginID"] == "cq_ww_vhf":
            require(bool(normalize_cq_vhf_grid(fields["other_1"]))
                    and bool(normalize_cq_vhf_grid(fields["other_2"])),
                    "Sent and received exchanges must contain 4-character grid squares")
        elif desk.state["pluginID"] in GRID4_EXCHANGE_PLUGINS:
            require(valid_grid4(fields["other_1"]) and valid_grid4(fields["other_2"]),
                    "Sent and received exchanges must be 4-character grid squares")
        elif desk.state["pluginID"] in SERIAL_GRID6_PLUGINS:
            require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0,
                    "Sent serial must be a positive integer")
            received_serial, received_grid = desk.contest.parse_exchange(desk)
            require(str(received_serial).isdigit() and int(received_serial) > 0 and valid_grid6(received_grid),
                    "Received exchange must contain a positive serial and 6-character grid")
        elif desk.state["pluginID"] == "john_moyle_field_day":
            require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0
                    and fields["other_2"].isdigit() and int(fields["other_2"]) > 0,
                    "John Moyle sent and received serials must be positive integers")
        elif desk.state["pluginID"] in NO_MULTIPLIER_PLUGINS:
            pass
        elif desk.state["pluginID"] in QSO_PARTY_PLUGINS:
            location = fields["other_1"]
            require(len(location) <= 15
                    and re.fullmatch(r"[A-Za-z0-9 .'/\-]+", location) is not None
                    and re.search(r"[A-Za-z0-9]", location) is not None,
                    "QSO Party location must be 1 to 15 letters, digits, spaces, apostrophes, "
                    "periods, hyphens, or slashes")
            if desk.state["pluginID"] == "qso_party_sn":
                require(fields["sent"].isdigit() and int(fields["sent"]) > 0
                        and fields["receive"].isdigit() and int(fields["receive"]) > 0,
                        "QSO Party serials must be positive integers")
        elif desk.state["pluginID"] in RSGB_PLUGINS:
            received = fields["other_2"]
            match = re.fullmatch(r"([0-9]+)(?:\s+[Hh][Qq])?", received)
            require(match is not None and 0 < int(match[1]) <= 9223372036854775807,
                    "RSGB received exchange must be a positive serial, optionally followed by HQ")
            require(fields["other_1"].isdigit()
                    and 0 < int(fields["other_1"]) <= 9223372036854775807,
                    "RSGB sent serial must be a positive SQLite integer")
        elif desk.state["pluginID"] in ESTONIAN_PLUGINS:
            if desk.state["pluginID"] == "es_field_day":
                require(re.fullmatch(r"[0-9]+ [A-Z]{2}", fields["other_1"]) is not None,
                        "ES Field Day sent exchange must contain its serial and region")
            elif desk.state["pluginID"] == "es_manual_key":
                require(re.fullmatch(r"[0-9]{5}", fields["other_1"]) is not None,
                        "ES Manual Key sent exchange must contain seniority and serial")
            else:
                require(fields["other_1"].isdigit() and int(fields["other_1"]) > 0,
                        "Estonian sent serial must be positive")
            received = fields["other_2"]
            if desk.state["pluginID"] == "es_field_day":
                match = re.fullmatch(r"([0-9]+)(?: ([A-Z]{2}))?", received)
                require(match is not None and 0 < int(match[1]) <= 9223372036854775807,
                        "ES Field Day exchange must be a positive serial and optional region")
                country = desk.cty_lookup(desk.callsign.text())
                prefix = next(iter(country.values())).get("primary_pfx", "") if country else ""
                require(prefix != "ES" or match[2] in ESTONIAN_REGIONS,
                        "ES Field Day contacts in Estonia require a valid region")
            elif desk.state["pluginID"] == "es_manual_key":
                require(re.fullmatch(r"[0-9]{5}", received) is not None,
                        "ES Manual Key exchange must be two seniority digits plus a three-digit serial")
            else:
                require(received.isdigit() and 0 < int(received) <= 9223372036854775807,
                        "Estonian received serial must be a positive SQLite integer")
        else:
            require(re.fullmatch(r"[0-9]+", fields["other_1"]) is not None
                    and 0 < int(fields["other_1"]) <= 9223372036854775807,
                    "Sent serial must be a positive SQLite integer")
            if desk.state["pluginID"] in {"sac_cw", "sac_ssb", "iaru_fieldday_r1_cw", "iaru_fieldday_r1_ssb"}:
                require(re.fullmatch(r"[0-9]+", fields["other_2"]) is not None
                        and 0 < int(fields["other_2"]) <= 9223372036854775807,
                        "Received serial must be a positive SQLite integer")
            if desk.state["pluginID"] == "icwc_mst":
                exchange = re.fullmatch(r"[A-Za-z][A-Za-z'-]{0,31} ([0-9]+)", fields["other_2"])
                require(exchange is not None and 0 < int(exchange[1]) <= 9223372036854775807,
                        "ICWC received exchange must be NAME SERIAL with one space and a positive SQLite serial")

    def digital_packet(self, state, params):
        packet = params.get("packet")
        require(isinstance(packet, dict) and 1 <= len(packet) <= 64,
                "Digital contact must contain a bounded ADIF record")
        allowed = {"CALL", "GRIDSQUARE", "MODE", "SUBMODE", "RST_SENT", "RST_RCVD",
                   "QSO_DATE", "TIME_ON", "QSO_DATE_OFF", "TIME_OFF", "BAND", "FREQ",
                   "STATION_CALLSIGN", "MY_GRIDSQUARE", "CONTEST_ID", "SRX", "SRX_STRING",
                   "STX", "STX_STRING", "CLASS", "ARRL_SECT", "STATE", "CQZ", "ITUZ",
                   "NAME", "TX_PWR", "OPERATOR", "MY_CITY", "MY_STATE", "COUNTRY", "APP_XLOG_EXTERNAL_INSTANCE"}
        require(set(packet) <= allowed and all(isinstance(value, str) and len(value.encode("utf-8")) <= 512
                                               for value in packet.values()),
                "Digital contact contains unsupported or oversized fields")
        call = packet.get("CALL", "").strip().upper()
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Complete callsign required")
        packet = {key: value.strip() for key, value in packet.items()}
        packet["CALL"] = call
        self.digital_frequency(packet)
        self.digital_timestamp(packet)
        require(not packet.get("STATION_CALLSIGN") or packet["STATION_CALLSIGN"].upper()==state["station"]["Call"].upper(),
                "The external completed event belongs to another station", "stale_context")
        require(packet.get("MODE") or packet.get("SUBMODE"), "Digital contact mode is required")
        return packet

    @staticmethod
    def digital_frequency(packet):
        try:
            frequency = float(packet.get("FREQ", "")) * 1_000_000
        except (TypeError, ValueError) as error:
            raise HostError("invalid_request", "Digital contact frequency is invalid") from error
        require(math.isfinite(frequency) and 0 < frequency <= 7_500_000_000_000,
                "Digital contact frequency is invalid")
        return round(frequency)

    @staticmethod
    def digital_timestamp(packet):
        date = packet.get("QSO_DATE_OFF") or packet.get("QSO_DATE") or ""
        time_value = packet.get("TIME_OFF") or packet.get("TIME_ON") or ""
        require(re.fullmatch(r"[0-9]{8}", date) is not None and re.fullmatch(r"[0-9]{4}(?:[0-9]{2})?", time_value) is not None,
                "Digital contact timestamp is invalid")
        if len(time_value) == 4:
            time_value += "00"
        try:
            return datetime.strptime(date + time_value, "%Y%m%d%H%M%S").strftime("%Y-%m-%d %H:%M:%S")
        except ValueError as error:
            raise HostError("invalid_request", "Digital contact timestamp is invalid") from error

    def advance_draft(self, desk):
        desk.state["draft"]["id"] = str(uuid.uuid4())
        report = default_report(operating_mode(desk.state))
        desk.callsign.setText("")
        desk.sent.setText(report)
        desk.receive.setText("" if desk.state["pluginID"] == "ca_qso_party" else report)
        desk.other_2.setText("")
        if desk.state["pluginID"] in {
            "cwt", "k1usn_sst", "cq_ww_rtty", "general_logging",
            *NAME_SPC_ENTRY_PLUGINS, *QSO_PARTY_PLUGINS,
            "ca_qso_party", "winter_field_day", "raem", "stew_perry_topband",
        }:
            desk.other_1.setText("")
        if requires_serial(desk.state):
            self.reserve_serial(desk.database, desk.state)
            desk.current_sn = desk.state["draft"]["serial"]
            serial_field = "sent" if desk.state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else "other_1"
            getattr(desk, serial_field).setText("" if desk.state["pluginID"] in SSA_MT_PLUGINS
                                                else desk.state["draft"]["fields"][serial_field])
        desk.prev_call = ""
        desk.current_widget = "callsign"

    def validate_replica_reservation(self, desk, reservation, authority):
        state = desk.state
        keys = {"requestID", "scope", "serial", "sentExchange", "allocatedFieldID", "authority"}
        require(isinstance(reservation, dict) and set(reservation) == keys,
                "Replica serial reservation is invalid")
        request_id = identifier(reservation["requestID"])
        require(reservation["authority"] == authority, "Replica serial authority changed",
                "authority_mismatch")
        serial = reservation["serial"]
        require(type(serial) is int and serial > 0, "Replica serial is invalid")
        scope = serial_scope(state, state["draft"]["frequencyHz"])
        require(reservation["scope"] == scope and
                reservation["sentExchange"] == reserved_sent_exchange(state, serial) and
                reservation["allocatedFieldID"] == allocated_serial_field(state),
                "Replica serial reservation does not match this draft", "serial_conflict")
        return request_id, serial, scope

    def install_replica_reservation(self, desk, reservation, authority):
        state, store = desk.state, desk.database
        keys = {"requestID", "scope", "serial", "sentExchange", "allocatedFieldID", "authority"}
        request_id, serial, scope = self.validate_replica_reservation(desk, reservation, authority)
        store.conn.execute("DELETE FROM xlog_serial WHERE draft_id=? AND qso_id IS NULL",
                           (state["draft"]["id"],))
        store.conn.execute(
            "INSERT INTO xlog_serial(draft_id,serial,operation_id,scope,qso_id) VALUES(?,?,?,?,NULL)",
            (state["draft"]["id"], serial, request_id, scope),
        )
        state["draft"]["serial"] = serial
        serial_field = "sent" if state["pluginID"] in SENT_FIELD_SERIAL_PLUGINS else "other_1"
        state["draft"]["fields"][serial_field] = reservation["sentExchange"]
        getattr(desk, serial_field).setText("" if state["pluginID"] in SSA_MT_PLUGINS
                                            else reservation["sentExchange"])
        desk.current_sn = serial
        state["replicaReservation"] = {key: deepcopy(reservation[key]) for key in keys - {"authority"}}

    def commit(self, desk, qso_id=None, timestamp=None, base=None, frequency=None, operator=None, digital_packet=None):
        fields = desk.values()
        if requires_serial(desk.state) and desk.state.get("historicalSerialFloor") and base is None:
            require(not desk.database.exec_sql("SELECT ID FROM DXLOG WHERE CAST(SentNr AS INTEGER)=?",(desk.state["draft"].get("serial"),)),
                    "The preserved draft serial is already present in an imported historical contact. Preserve any actual sent exchange and deliberately finish/reconcile this draft before using a fresh serial.","historical_serial_conflict")
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", desk.parsed_call()) is not None, "Complete callsign required")
        self.validate_exchange(desk, fields)
        if desk.state["pluginID"] == "darc_schwaben" \
                and BAND_LABELS[desk.band(desk.state["draft"]["frequencyHz"])] in {"2m", "70cm"}:
            require(bool(desk.contest.parse_exchange(fields["other_2"])[1]),
                    "DARC Schwaben VHF exchange requires a locator")
        qso_id = identifier(qso_id) if qso_id else str(uuid.uuid4())
        timestamp = timestamp or now()
        try:
            require(datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == timestamp, "Timestamp must be UTC YYYY-MM-DD HH:MM:SS")
        except (ValueError, TypeError) as error:
            raise HostError("invalid_request", "Invalid UTC timestamp") from error
        previous = desk.database.exec_sql("SELECT TS FROM DXLOG ORDER BY TS DESC LIMIT 1")
        chronological_append = not previous or previous["TS"] < timestamp
        contact = desk.contact_for(fields, qso_id, timestamp,
                                   frequency or desk.state["draft"]["frequencyHz"], base=base, operator=operator)
        if digital_packet is not None:
            for source,target in (("RST_SENT","SNT"),("RST_RCVD","RCV"),("STATION_CALLSIGN","StationPrefix"),("OPERATOR","Operator")):
                if digital_packet.get(source):contact[target]=digital_packet[source]
            if requires_serial(desk.state) and digital_packet.get("STX"):contact["SentNr"]=digital_packet["STX"]
            contact["Mode"]=digital_packet.get("SUBMODE") or digital_packet["MODE"]
        from .lanes import attribution
        lane_context = attribution(desk.state) if self._note_binding_allowed else None
        if lane_context and lane_context["receiveFrequencyHz"] is not None:
            contact["QSXFreq"] = lane_context["receiveFrequencyHz"] / 1000
        if desk.state["pluginID"] == "cq_ww_ssb":
            country = str(contact.get("CountryPrefix", "")).strip().upper()
            zone = str(contact.get("ZN", "")).strip()
            eligible = not desk.contact_is_dupe and bool(country)
            country_count = desk.database.exec_sql(
                "SELECT count(*) AS n FROM DXLOG WHERE ContestNR=? AND Band=? AND CountryPrefix=?",
                (desk.database.current_contest, contact.get("Band"), country),
            )["n"]
            zone_count = desk.database.exec_sql(
                "SELECT count(*) AS n FROM DXLOG WHERE ContestNR=? AND Band=? AND ZN=? AND CountryPrefix<>''",
                (desk.database.current_contest, contact.get("Band"), zone),
            )["n"]
            # Not1MM's CQ WW log contract is M1=zone and M2=country.
            contact["IsMultiplier1"] = int(eligible and bool(zone) and zone_count == 0)
            contact["IsMultiplier2"] = int(eligible and country_count == 0)
        try:
            desk.database.log_contact(contact)
        except sqlite3.IntegrityError as error:
            raise HostError("qso_collision", "QSO identity or timestamp/call already exists") from error
        country = desk.state["reference"]["countries"].get(contact["Call"])
        desk.database.conn.execute("INSERT INTO xlog_qso_identity VALUES(?,?,?,0)", (qso_id, canonical(fields), canonical(country)))
        from .vhf import bind_contact
        bind_contact(desk.database, desk.state, qso_id)
        if lane_context:
            desk.database.conn.execute("INSERT INTO xlog_qso_lane VALUES(?,?)", (qso_id, canonical(lane_context)))
            if requires_serial(desk.state):
                desk.database.conn.execute("UPDATE xlog_serial SET qso_id=? WHERE draft_id=? AND scope=? AND qso_id IS NULL",
                                           (qso_id, desk.state["draft"]["id"], serial_scope(desk.state, desk.state["draft"]["frequencyHz"])))
        if self._note_binding_allowed:
            # External/digital contacts temporarily borrow a Desk but do not
            # consume the operator's Entry; they must never claim its notes.
            draft_id = desk.state["draft"]["id"]
            desk.database.conn.execute("INSERT OR IGNORE INTO xlog_draft_contact VALUES(?,?)", (draft_id, qso_id))
            desk.database.conn.execute("UPDATE xlog_note SET qso_id=? WHERE draft_id=? AND qso_id IS NULL", (qso_id, draft_id))
        if desk.state["pluginID"] in APPEND_RECALCULATION_PLUGINS:
            if chronological_append and desk.state["pluginID"] not in FULL_REBUILD_APPEND_PLUGINS:
                self.recalculate_append(desk, contact)
            else:
                self.rebuild(desk)
            contact = desk.database.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
        identity_after = {"rawFields": fields, "country": country, "deleted": False}
        self.audit(desk.database, qso_id, "commit", None, contact,
                   after_identity=identity_after, revision=desk.state["revision"] + 1)
        if self._n1mm_events is not None:
            self._n1mm_events.append(("contact", deepcopy(contact)))
        if digital_packet is None:
            self.advance_draft(desk)

    @staticmethod
    def recalculate_append(desk, contact):
        """Apply pinned multiplier rules to one new row with full SQL history.

        The two callbacks with local `seen` sets need an explicit prior-row
        query. Distance/bonus-only callbacks need no replay: contact_for already
        scored this contact against the historical grid and existing log.
        """
        store, plugin_id = desk.database, desk.state["pluginID"]
        if plugin_id in {"nac_vhf", "darc_vhf"}:
            return
        if plugin_id in SSA_MT_PLUGINS:
            square = str(contact.get("Exchange1", ""))[:4].upper()
            previous = store.exec_sql(
                "SELECT 1 AS found FROM DXLOG WHERE ContestNR=? AND Band=? "
                "AND upper(substr(Exchange1,1,4))=? AND ID<>? LIMIT 1",
                (store.current_contest, contact["Band"], square, contact["ID"]),
            )
            contact["IsMultiplier1"] = int(len(square) == 4 and not previous)
            store.change_contact(contact)
            return
        if plugin_id == "ca_qso_party":
            exchange = str(contact.get("Exchange1", "")).upper()
            previous = store.exec_sql(
                "SELECT 1 AS found FROM DXLOG WHERE ContestNR=? AND upper(Exchange1)=? AND ID<>? LIMIT 1",
                (store.current_contest, exchange, contact["ID"]),
            )
            contact["IsMultiplier1"] = int(bool(exchange) and exchange != "DX" and not previous)
            store.change_contact(contact)
            return

        class AppendRows:
            # Only the callback's replay enumeration is bounded. Its SQL queries
            # and writes still use the complete store and the same transaction.
            def fetch_all_contacts_asc(self):
                return [contact]

            def __getattr__(self, name):
                return getattr(store, name)

        points, duplicate = contact["Points"], desk.contact_is_dupe
        desk.database = AppendRows()
        try:
            desk.contest.recalculate_mults(desk)
        finally:
            desk.database = store
            desk.contact_is_dupe = duplicate
        # Match rebuild's ordered duplicate/points authority: some original
        # callbacks reset the shared duplicate flag or recalculate points.
        store.conn.execute("UPDATE DXLOG SET Points=? WHERE ID=?", (points, contact["ID"]))

    def change(self, desk, method, params):
        qso_id = identifier(params.get("qsoID"))
        before = desk.database.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
        require(bool(before), "QSO does not exist", "not_found")
        identity_row = desk.database.exec_sql(
            "SELECT raw_fields,country,deleted FROM xlog_qso_identity WHERE id=?", (qso_id,))
        require(bool(identity_row), "QSO identity does not exist", "not_found")
        identity_before = {"rawFields": json.loads(identity_row["raw_fields"]),
                           "country": json.loads(identity_row["country"]) if identity_row["country"] else None,
                           "deleted": bool(identity_row["deleted"])}
        reason = text(params.get("reason", "Operator correction"), 512)
        old_fields = desk.values()
        legacy = None
        if method == "qso_delete":
            desk.database.delete_contact(qso_id)
            desk.database.conn.execute("UPDATE xlog_qso_identity SET deleted=1 WHERE id=?", (qso_id,))
            after = None
        else:
            legacy = desk.database.exec_sql(
                "SELECT current_fields FROM xlog_legacy_row_receipt WHERE target_qso_id=?", (qso_id,)
            )
            if legacy:
                # Imported contacts are edited from the complete plugin row last
                # accepted by xLog. The five-field projection is only an editor
                # view; it must never become the authority for untouched columns.
                before = json.loads(legacy["current_fields"])
                fields = self.legacy_editor_fields(before)
            else:
                identity = desk.database.exec_sql("SELECT raw_fields FROM xlog_qso_identity WHERE id=?", (qso_id,))
                fields = json.loads(identity["raw_fields"])
            for name in INPUTS:
                getattr(desk, name).setText(fields[name])
            correction_fields = params.get("fields", {})
            require(isinstance(correction_fields, dict)
                    and set(correction_fields) <= set(INPUTS) | set(CONTACT_METADATA_FIELDS),
                    "Unknown correction field")
            changes = {"fields": {name: value for name, value in correction_fields.items() if name in INPUTS}}
            if "countries" in params:
                changes.update({"countries": params["countries"], "referenceID": params.get("referenceID")})
            self.apply_fields(desk, changes, allow_reserved_serial_change=True)
            updated = desk.values()
            require(re.fullmatch(r"[A-Z0-9/]{3,32}", desk.parsed_call()) is not None, "Complete callsign required")
            if desk.state["pluginID"] in CENTRAL_EUROPEAN_PLUGINS:
                validate_central_europe_historical_sent_exchange(
                    desk.state["pluginID"], updated["other_1"])
            if (desk.state["pluginID"] == "arrl_10m"
                    or desk.state["pluginID"] in EA_MAJESTAD_PLUGINS
                    or desk.state["pluginID"] in REF_PLUGINS
                    or desk.state["pluginID"] in EUROPEAN_DX_PLUGINS
                    or desk.state["pluginID"] in CENTRAL_EUROPEAN_PLUGINS
                    or desk.state["pluginID"] == "darc_schwaben"
                    or desk.state["pluginID"] == "arrl_rtty_ru"
                    or desk.state["pluginID"] in ARRL_VHF_PLUGINS):
                pattern = (r"[A-Ra-r]{2}[0-9]{2}" if desk.state["pluginID"] in ARRL_VHF_PLUGINS else
                           r"[A-Za-z0-9]{1,6}" if desk.state["pluginID"] == "arrl_10m"
                           or desk.state["pluginID"] in REF_PLUGINS
                           or desk.state["pluginID"] in CENTRAL_EUROPEAN_PLUGINS
                           or desk.state["pluginID"] == "darc_schwaben" else r"[A-Za-z]{1,4}|[0-9]+")
                require(re.fullmatch(pattern, updated["other_1"]) is not None,
                        "Historical sent exchange must be a serial or location code")
                original = desk.state["settings"]["SentExchange"]
                desk.state["settings"]["SentExchange"] = updated["other_1"]
                try:
                    self.validate_exchange(desk, updated)
                finally:
                    desk.state["settings"]["SentExchange"] = original
            elif (desk.state["pluginID"] in {"agcw_qrp", "rda_contest"}
                  and "other_1" not in correction_fields):
                original = desk.state["settings"]["SentExchange"]
                desk.state["settings"]["SentExchange"] = updated["other_1"]
                try:
                    self.validate_exchange(desk, updated)
                finally:
                    desk.state["settings"]["SentExchange"] = original
            else:
                self.validate_exchange(desk, updated)
            timestamp = params.get("timestamp", before["TS"])
            try:
                require(datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == timestamp,
                        "Timestamp must be UTC YYYY-MM-DD HH:MM:SS")
            except (ValueError, TypeError) as error:
                raise HostError("invalid_request", "Invalid UTC timestamp") from error
            frequency = params.get("frequencyHz", round(before["Freq"] * 1000))
            require(type(frequency) is int, "Frequency must be integer Hz")
            desk.contest_band(frequency)
            receive_frequency = params.get("receiveFrequencyHz", round(float(before.get("QSXFreq") or 0) * 1000))
            require(type(receive_frequency) is int and 0 <= receive_frequency <= 100_000_000_000,
                    "RX frequency must be integer Hz")
            power = text(params.get("power", str(before.get("Power", ""))), 8)
            # Validate a newly supplied numeric power without rejecting historical
            # plugin-owned categories (for example Stew Perry's LOW/HIGH/QRP).
            if "power" in params:
                require(not power or power.isdigit(), "Power must contain digits only")
            if desk.state["pluginID"] == "darc_schwaben" and BAND_LABELS[desk.band(frequency)] in {"2m", "70cm"}:
                require(bool(desk.contest.parse_exchange(updated["other_2"])[1]),
                        "DARC Schwaben VHF exchange requires a locator")
            operator = text(params.get("operator", before["Operator"]), 20)
            require(bool(operator.strip()), "Operator is required")
            after = desk.contact_for(updated, qso_id, timestamp, frequency, base=before, operator=operator)
            after["QSXFreq"] = receive_frequency / 1000
            after["Power"] = power
            for name, maximum in CONTACT_METADATA_FIELDS.items():
                if name in correction_fields:
                    after[name] = text(correction_fields[name], maximum)
                # Persist the final plugin-normalized contact value as raw
                # authority. An omitted generic field never overwrites a Name,
                # QTH or Comment legitimately derived from an entry field.
                updated[name] = text(after.get(name, before.get(name, "")), maximum)
            if desk.state["pluginID"] == "darc_schwaben" and not desk.contest.parse_exchange(updated["other_2"])[1]:
                after["Exchange1"] = ""
            preserve_sent = (desk.state["pluginID"] in SSA_MT_PLUGINS
                             or desk.state["pluginID"] == "cq_ww_rtty"
                             or desk.state["pluginID"] == "arrl_field_day"
                             or desk.state["pluginID"] != "arrl_10m" and desk.state["pluginID"] in {
                                 "cwt", "k1usn_sst", *TEN_TEN_PLUGINS, *NAME_SPC_ENTRY_PLUGINS,
                                 *ARRL_DX_PLUGINS, *CQ_160_PLUGINS, *DISPLAY_SENTNR_PLUGINS, "arrl_160m"
                             }
                             or desk.state["pluginID"] in {"arrl_10m", *EA_MAJESTAD_PLUGINS, *REF_PLUGINS,
                                                           *EUROPEAN_DX_PLUGINS, *CENTRAL_EUROPEAN_PLUGINS,
                                                           *EUROPEAN_HF_PLUGINS}
                             and "other_1" not in correction_fields
                             or desk.state["pluginID"] == "cqws"
                             or desk.state["pluginID"] == "ca_qso_party" and "sent" not in correction_fields
                             or desk.state["pluginID"] in {"canada_day", "darc_schwaben"}
                             and "other_1" not in correction_fields
                             or desk.state["pluginID"] in {"agcw_qrp", "rda_contest"}
                             and "other_1" not in correction_fields
                             or desk.state["pluginID"] == "raem" and "sent" not in correction_fields)
            if preserve_sent:
                # Received-name edits must not replace the exchange actually
                # sent with the session's current setup value.
                after["SentNr"] = before["SentNr"]
                if desk.state["pluginID"] in SSA_MT_PLUGINS:
                    after["GridSquare"] = before["GridSquare"]
            elif desk.state["pluginID"] in TYPE4_UTILITY_PLUGINS:
                # These plugins own heterogeneous historical sent fields
                # (RST, serial, RandomGram, or no sent exchange at all).
                pass
            elif desk.state["pluginID"] == "ca_qso_party":
                after["SentNr"] = int(updated["sent"])
            elif desk.state["pluginID"] == "raem":
                after["SentNr"] = int(updated["sent"])
            elif desk.state["pluginID"] in {"canada_day", "darc_schwaben", "winter_field_day"}:
                # Original setters already own their heterogeneous sent fields.
                pass
            elif desk.state["pluginID"] in {"agcw_qrp", "rda_contest", "rdxc", "rsgb_iota",
                                             "stew_perry_topband", "ukeidx", "wia_remembrance"}:
                # Original setters own these plugins' scalar/composite sent fields.
                pass
            elif desk.state["pluginID"] in FINAL_VHF_PLUGINS:
                # These original setters own grid and/or serial fields. The edit
                # path began with this row's raw fields, so unrelated corrections
                # retain the exchange exactly as logged.
                pass
            elif (desk.state["pluginID"] in EA_MAJESTAD_PLUGINS
                  or desk.state["pluginID"] in REF_PLUGINS
                  or desk.state["pluginID"] in ESTONIAN_PLUGINS
                  or desk.state["pluginID"] in EUROPEAN_DX_PLUGINS
                  or desk.state["pluginID"] in CENTRAL_EUROPEAN_PLUGINS
                  or desk.state["pluginID"] in EUROPEAN_HF_PLUGINS):
                after["SentNr"] = (int(updated["other_1"]) if updated["other_1"].isdigit()
                                   else updated["other_1"].upper())
            else:
                # The first four supported plugins expose an operator-correctable
                # numeric sent exchange in other_1; name/SPC plugins do not.
                after["SentNr"] = int(updated["other_1"])
            try:
                desk.database.change_contact(after)
            except sqlite3.IntegrityError as error:
                raise HostError("qso_collision", "Corrected timestamp/call collides with another contact") from error
            country = desk.state["reference"]["countries"].get(after["Call"])
            desk.database.conn.execute("UPDATE xlog_qso_identity SET raw_fields=?,country=? WHERE id=?", (canonical(updated), canonical(country), qso_id))
        self.rebuild(desk)
        after = desk.database.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,)) or None
        if after and ("frequencyHz" in params or "receiveFrequencyHz" in params):
            lane_row = desk.database.exec_sql("SELECT attribution FROM xlog_qso_lane WHERE qso_id=?", (qso_id,))
            if lane_row:
                lane_context = json.loads(lane_row["attribution"])
                lane_context["transmitFrequencyHz"] = round(float(after["Freq"]) * 1000)
                if "receiveFrequencyHz" in params:
                    lane_context["receiveFrequencyHz"] = params["receiveFrequencyHz"]
                    lane_context["splitEvidence"] = "operator_correction"
                receive = lane_context["receiveFrequencyHz"]
                lane_context["split"] = receive != lane_context["transmitFrequencyHz"] if receive is not None else None
                desk.database.conn.execute("UPDATE xlog_qso_lane SET attribution=? WHERE qso_id=?", (canonical(lane_context), qso_id))
        if method != "qso_delete" and legacy:
            desk.database.conn.execute(
                "UPDATE xlog_legacy_row_receipt SET current_fields=? WHERE target_qso_id=?",
                (canonical(after), qso_id),
            )
        identity_row = desk.database.exec_sql(
            "SELECT raw_fields,country,deleted FROM xlog_qso_identity WHERE id=?", (qso_id,))
        identity_after = {"rawFields": json.loads(identity_row["raw_fields"]),
                          "country": json.loads(identity_row["country"]) if identity_row["country"] else None,
                          "deleted": bool(identity_row["deleted"])}
        self.audit(desk.database, qso_id, "delete" if method == "qso_delete" else "correct", before, after, reason,
                   before_identity=identity_before, after_identity=identity_after,
                   revision=desk.state["revision"] + 1)
        if self._n1mm_events is not None:
            emitted = deepcopy(before if method == "qso_delete" else after)
            if method != "qso_delete":
                emitted["_n1mm_oldcall"] = before["Call"]
                emitted["_n1mm_oldtimestamp"] = before["TS"]
            self._n1mm_events.append(("delete" if method == "qso_delete" else "replace",
                                      emitted))
        for name in INPUTS:
            getattr(desk, name).setText(old_fields[name])

    @staticmethod
    def rebuild(desk):
        rows = desk.database.fetch_all_contacts_asc()
        points, duplicate_ids = {}, set()
        configured_sent_exchange = desk.state["settings"].get("SentExchange", "")
        replay_received_exchange = desk.other_2.text()
        replay_other_1 = desk.other_1.text()
        replay_callsign = desk.callsign.text()
        configured_station_grid = desk.station.get("GridSquare", "")
        configured_power_category = desk.state["settings"].get("PowerCategory", "")
        configured_rover_location = desk.RoverLocation
        try:
            desk.database.conn.execute("DELETE FROM DXLOG")
            for row in rows:
                desk.contact = row
                if desk.state["pluginID"] == "cq_ww_vhf":
                    desk.RoverLocation = str(row.get("RoverLocation", ""))
                desk.contact_is_dupe = int(desk.is_dupe(row["Call"], row["Band"], row["TS"], row["Mode"]))
                if desk.contact_is_dupe:
                    duplicate_ids.add(row["ID"])
                if desk.state["pluginID"] in TEN_TEN_PLUGINS or desk.state["pluginID"] == "pacc":
                    # The original points() reads the active exchange widget. During
                    # ordered replay, make that widget represent the row being scored.
                    desk.other_2.setText(row["NR"])
                if desk.state["pluginID"] == "eudx":
                    # Its original points callback reads both exchange widgets and
                    # contest settings; replay each row with its historical values.
                    desk.other_2.setText(str(row["NR"]))
                    desk.state["settings"]["SentExchange"] = str(row["SentNr"])
                    desk.contest_settings["SentExchange"] = str(row["SentNr"])
                if desk.state["pluginID"] == "raem":
                    # Score replay against the coordinates actually sent for
                    # this QSO, not a later setup edit.
                    historical_coordinates = str(row.get("MiscText", configured_sent_exchange))
                    desk.state["settings"]["SentExchange"] = historical_coordinates
                    desk.contest_settings["SentExchange"] = historical_coordinates
                    desk.other_2.setText(str(row.get("Exchange1", "")))
                    desk.callsign.setText(str(row.get("Call", "")))
                if desk.state["pluginID"] == "stew_perry_topband":
                    historical_grid = str(row.get("MiscText", configured_station_grid))
                    desk.station["GridSquare"] = historical_grid.partition("|")[2] or historical_grid
                    historical_power = str(row.get("Power", configured_power_category))
                    desk.state["settings"]["PowerCategory"] = historical_power
                    desk.contest_settings["PowerCategory"] = historical_power
                    desk.other_1.setText(str(row.get("Exchange1", "")))
                if desk.state["pluginID"] == "rsgb_iota":
                    historical_sent = str(row.get("SentNr", configured_sent_exchange))
                    desk.state["settings"]["SentExchange"] = historical_sent
                    desk.contest_settings["SentExchange"] = historical_sent
                    desk.other_2.setText(str(row.get("NR", "")))
                if desk.state["pluginID"] in SERIAL_GRID6_PLUGINS:
                    desk.station["GridSquare"] = str(row.get("MiscText", configured_station_grid))
                row["Points"] = desk.contest.points(desk)
                points[row["ID"]] = row["Points"]
                desk.database.log_contact(row)
        finally:
            desk.state["settings"]["SentExchange"] = configured_sent_exchange
            desk.contest_settings["SentExchange"] = configured_sent_exchange
            desk.station["GridSquare"] = configured_station_grid
            desk.state["settings"]["PowerCategory"] = configured_power_category
            desk.contest_settings["PowerCategory"] = configured_power_category
            desk.RoverLocation = configured_rover_location
            desk.other_2.setText(replay_received_exchange)
            desk.other_1.setText(replay_other_1)
            desk.callsign.setText(replay_callsign)
        desk.contest.recalculate_mults(desk)
        if desk.state["pluginID"] == "cq_ww_ssb":
            countries, zones = set(), set()
            for row in desk.database.fetch_all_contacts_asc():
                band = row.get("Band")
                country = str(row.get("CountryPrefix", "")).strip().upper()
                zone = str(row.get("ZN", "")).strip()
                country_key, zone_key = (band, country), (band, zone)
                duplicate = row["ID"] in duplicate_ids
                row["IsMultiplier1"] = int(not duplicate and bool(country) and bool(zone) and zone_key not in zones)
                row["IsMultiplier2"] = int(not duplicate and bool(country) and country_key not in countries)
                desk.database.change_contact(row)
                if not duplicate and country:
                    countries.add(country_key)
                if not duplicate and country and zone:
                    zones.add(zone_key)
        if desk.state["pluginID"] == "ca_qso_party":
            seen = set()
            for row in desk.database.fetch_all_contacts_asc():
                exchange = str(row.get("Exchange1", "")).upper()
                is_multiplier = int(bool(exchange) and exchange != "DX" and exchange not in seen)
                row["IsMultiplier1"] = is_multiplier
                desk.database.change_contact(row)
                if exchange and exchange != "DX":
                    seen.add(exchange)
        if desk.state["pluginID"] == "rsgb_commonwealth_beru":
            # BERU's original callback deliberately reallocates the first three
            # per-band bonuses. Preserve those recalculated values while retaining
            # the ordered replay's duplicate-zero rule.
            for qso_id in duplicate_ids:
                desk.database.conn.execute("UPDATE DXLOG SET Points=0 WHERE ID=?", (qso_id,))
        else:
            # Most upstream recalculate_mults callbacks call points with one
            # shared dupe flag. Restore each ordered replay score for those plugins.
            for qso_id, value in points.items():
                desk.database.conn.execute("UPDATE DXLOG SET Points=? WHERE ID=?", (value, qso_id))

    def audit(self, store, qso_id, kind, before, after, reason="", revision=None,
              before_identity=None, after_identity=None):
        require(type(revision) is int and revision > 0, "Contact audit revision is required")
        store.conn.execute(
            "INSERT INTO xlog_qso_audit(revision,operation_id,qso_id,kind,before_json,after_json,reason,"
            "before_identity_json,after_identity_json) VALUES(?,?,?,?,?,?,?,?,?)",
            (revision, self._operation, qso_id, kind, canonical(before), canonical(after), reason,
             canonical(before_identity) if before_identity is not None else None,
             canonical(after_identity) if after_identity is not None else None),
        )

    @staticmethod
    def matrices(store):
        band_clause = " AND q.Band=?" if store.score_band is not None else ""
        params = (store.current_contest, *(() if store.score_band is None else (store.score_band,)))
        if store.plugin_id in CQ_WW_PLUGINS:
            eligible = store.cq_ww_multiplier_filter()
            result = {"countries": store.exec_sql_mult(f"SELECT q.CountryPrefix AS value,q.Band AS band,count(*) AS qsos FROM DXLOG AS q WHERE q.ContestNR=? AND {eligible}{band_clause} GROUP BY q.CountryPrefix,q.Band ORDER BY q.CountryPrefix,q.Band", params),
                      "zones": store.exec_sql_mult(f"SELECT q.ZN AS value,q.Band AS band,count(*) AS qsos FROM DXLOG AS q WHERE q.ContestNR=? AND {eligible}{band_clause} GROUP BY q.ZN,q.Band ORDER BY q.ZN,q.Band", params)}
            if store.plugin_id == "cq_ww_rtty":
                result["states"] = store.exec_sql_mult(
                    "SELECT q.Exchange1 AS value,q.Band AS band,count(*) AS qsos FROM DXLOG AS q "
                    f"WHERE q.ContestNR=? AND q.Exchange1 <> 'DX' AND {eligible} "
                    "GROUP BY q.Exchange1,q.Band ORDER BY q.Exchange1,q.Band",
                    params,
                )
            return result
        return {"countries": store.exec_sql_mult("SELECT CountryPrefix AS value,Band AS band,count(*) AS qsos FROM DXLOG WHERE ContestNR=? GROUP BY CountryPrefix,Band ORDER BY CountryPrefix,Band", params),
                "zones": store.exec_sql_mult("SELECT ZN AS value,Band AS band,count(*) AS qsos FROM DXLOG WHERE ContestNR=? GROUP BY ZN,Band ORDER BY ZN,Band", params)}

    @staticmethod
    def export_artifact(desk, maximum, export_format="cabrillo", site_id=None):
        require(export_format in PLUGIN_REGISTRY[desk.state["pluginID"]].export_formats,
                f"{PLUGIN_REGISTRY[desk.state['pluginID']].name} does not provide {export_format.upper()} export",
                "export_unsupported")
        if desk.state["pluginID"].startswith("wae_") and export_format == "cabrillo":
            from .wae import export
            payload = export(desk)
            require(len(payload) <= maximum, "WAE export exceeds the save limit", "export_too_large")
            return f'{desk.station["Call"]}-{desk.contest.cabrillo_name}.log', payload
        if export_format == "edi":
            validate_edi_start(desk.state["settings"])
            from .vhf import edi_scope
            desk = edi_scope(desk, site_id, require)
        else:
            require(site_id is None, "Site subsets are supported only for EDI")
        # The pinned plugin writes only inside this explicit private destination.
        with TemporaryDirectory(prefix="export-", dir=Path(desk.database.database).parent) as directory:
            desk.export_directory = Path(directory)
            if export_format == "cabrillo":
                desk.contest.cabrillo(desk, "utf-8")
                files = list(Path(directory).glob("*.log"))
            else:
                writer = getattr(desk.contest, export_format, None)
                require(callable(writer),
                        f"This original plugin does not provide {export_format.upper()} export",
                        "export_unsupported")
                # Original Not1MM ADIF and EDI writers target Path.home(). The host is a
                # serialized helper process, so redirect HOME only for this one
                # synchronous plugin call and restore it before inspecting output.
                previous_home = os.environ.get("HOME")
                os.environ["HOME"] = directory
                try:
                    writer(desk)
                finally:
                    if previous_home is None:
                        os.environ.pop("HOME", None)
                    else:
                        os.environ["HOME"] = previous_home
                files = list(Path(directory).glob("*.adi" if export_format == "adif" else "*.edi"))
            require(len(files) == 1, "Plugin export failed", "export_failed")
            if (export_format == "cabrillo" and desk.state["pluginID"] == "cqws"
                    and desk.state.get("scoringRevision") == "26.10.26"
                    and not desk.score()["scoringComplete"]):
                payload = files[0].read_bytes()
                note = ("SOAPBOX: Known score (partial): " + CQWS_UF_LIMITATION + "\r\n").encode("utf-8")
                require(payload.count(b"END-OF-LOG:") == 1, "CQWS export terminator is invalid", "export_failed")
                files[0].write_bytes(payload.replace(b"END-OF-LOG:", note + b"END-OF-LOG:"))
            if export_format == "adif":
                from .lanes import augment_adif
                known = {row["qso_id"]: json.loads(row["attribution"]) for row in desk.database.exec_sql_mult("SELECT * FROM xlog_qso_lane")}
                digital={row["qso_id"]:json.loads(row["packet"]) for row in desk.database.exec_sql_mult("SELECT * FROM xlog_digital_event")}
                digital.update({row["qso_id"]:json.loads(row["source"])["raw"] for row in desk.database.exec_sql_mult("SELECT * FROM xlog_adif_import")})
                if known or digital:
                    files[0].write_bytes(augment_adif(files[0].read_bytes(), desk.database.fetch_all_contacts_asc(), known, require,digital))
            require(files[0].stat().st_size <= maximum,
                    "Use a chunked export route for this log" if maximum == 512000 else "Prepared export exceeds the native save limit",
                    "export_too_large")
            return files[0].name, files[0].read_bytes()

    @classmethod
    def export(cls, desk):
        filename, payload = cls.export_artifact(desk, 512000)
        return {"sessionID": desk.state["sessionID"], "revision": desk.state["revision"], "filename": filename,
                "format": "cabrillo", "content": payload.decode("utf-8")}
