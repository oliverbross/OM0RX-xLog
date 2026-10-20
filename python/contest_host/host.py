"""Bounded application adapter: pinned plugins own rules, xLog owns output."""
from copy import deepcopy
from datetime import datetime, UTC
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
from tempfile import TemporaryDirectory
import uuid

from .store import CALLHISTORY_COLUMNS, Store, canonical
from .rates import calculate_rates
from .plugins import (ARRL_DX_PLUGINS, CQ_WW_PLUGINS, NAME_SPC_PLUGINS,
                      PLUGIN_REGISTRY, PLUGINS, SERIAL_PLUGINS, TEN_TEN_PLUGINS)
from .statistics import calculate_statistics
from .upstream import adapt_cw_template, load_plugin, load_cw_macros, verify_source

PLUGIN_ID = "cq_ww_cw"
SOURCE_REVISION = "7c8b499225a73f7f8f792246881bd7aefc05452f"
INPUTS = ("callsign", "sent", "receive", "other_1", "other_2")
FIELDS = INPUTS + ("snt_label", "rcv_label", "other_label", "exch_label", "history_info")
BANDS = {1.8, 3.5, 7.0, 14.0, 21.0, 28.0}
VOICE_INTENT_PLUGINS = {"arrl_ss_phone", "cq_wpx_ssb", "cq_ww_ssb"}
VOICE_PAYLOAD_MAXIMUM = 4_096
ESM_ROLES = {"CQ": "esmCQ", "EXCH": "esmExchange", "QRZ": "esmQRZ", "AGN": "esmAGN",
             "HISCALL": "esmHisCall", "MYCALL": "esmMyCall", "QSOB4": "esmQsoB4"}
# Pre-settings host sessions always used these assignments. Materialize only
# missing values on restore; new setup documents explicitly choose upstream defaults.
LEGACY_ESM = {"useESM": True, "sendCorrectedCall": True, "esmCQ": "F1", "esmExchange": "F3",
              "esmQRZ": "F4", "esmAGN": "F9", "esmHisCall": "F2", "esmMyCall": "F5", "esmQsoB4": "DISABLED"}


def esm_preferences(preferences):
    result = {key: preferences.get(key, default) for key, default in LEGACY_ESM.items()}
    for key in ("useESM", "sendCorrectedCall"):
        require(type(result[key]) is bool, f"{key} must be boolean")
    for key in ESM_ROLES.values():
        require(isinstance(result[key], str) and result[key] in {"DISABLED", *(f"F{i}" for i in range(1, 13))},
                f"{key} must be F1-F12 or DISABLED")
    return result


class HostError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, message, code="invalid_request"):
    if not condition:
        raise HostError(code, message)


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


def now():
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def workspace_generation(state):
    """Return the persisted window identity, or a stable identity for pre-contract sessions."""
    value = state.get("workspaceGeneration")
    if value is not None:
        return identifier(value)
    return str(uuid.uuid5(uuid.UUID(state["sessionID"]), "xlog-not1mm-workspace"))


class Field:
    """Only the audited plugin field API; Python rejects unknown attributes."""
    __slots__ = ("name", "value", "maximum", "visible", "accessible_name", "read_only", "enabled", "focused", "tooltip")

    def __init__(self, name, value="", maximum=512):
        self.name, self.value, self.maximum, self.visible = name, "", maximum, True
        self.accessible_name, self.read_only, self.enabled, self.focused, self.tooltip = "", False, True, False, ""
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


class DigitalOutputSink:
    """Finite compatibility target for original digital ESM without hardware output."""

    def send_string(self, _value):
        return None


class Desk:
    def __init__(self, store, state, commit):
        self.database, self.state, self._commit = store, state, commit
        self.database.plugin_id = state["pluginID"]
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
        self.pref = {"contest": 1, "run_state": state["run"], "use_esm": self.use_esm,
                     "esm_send_corrected_call": esm["sendCorrectedCall"]}
        self.actions, self.messages, self.highlights = [], [], set()
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
        self.radio_state = {"vfoa": state["draft"]["frequencyHz"], "mode": state["settings"]["ModeCategory"]}
        self.contact = self.database.get_empty().copy()
        if state["pluginID"] == "cq_ww_rtty":
            self.fldigi_util = DigitalOutputSink()
        self.contest.init_contest(self)
        if state["pluginID"] in SERIAL_PLUGINS:
            # Older hosts allowed this visible field to drift from the durable
            # reservation. Reconcile it on every load before any projection,
            # mutation, direct commit, or reopen can consume the stale value.
            expected = str(state["draft"]["serial"]).zfill(3)
            self.other_1.setText(expected)
            state["draft"]["fields"]["other_1"] = expected
            self.other_1.setReadOnly(True)

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
        mode = self.state["settings"]["ModeCategory"]
        context = {"sessionID": self.state["sessionID"], "draftID": self.state["draft"]["id"],
                   "fields": self.values(), "stationCall": self.station["Call"],
                   "sentExchange": str(self.contest_settings["SentExchange"]),
                   "sentSerial": self.other_1.text() if self.state["pluginID"] in SERIAL_PLUGINS else ""}
        if mode == "SSB":
            if self.state["pluginID"] not in VOICE_INTENT_PLUGINS:
                return
            payload = text(self.process_macro(macro["template"]), VOICE_PAYLOAD_MAXIMUM)
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
        if mode != "CW":
            return
        self.actions.append({"kind": "function_key", "key": button.name,
                             "label": macro["label"], "template": macro["template"],
                             **context})

    def process_macro(self, template):
        values = {
            "MYCALL": self.station["Call"],
            "CALL": self.callsign.text(),
            "HISCALL": self.callsign.text(),
            "RST": self.sent.text(),
            "SNT": self.sent.text(),
            "EXCHANGE": str(self.contest_settings["SentExchange"]),
            "EXCH": str(self.contest_settings["SentExchange"]),
            "SENTNR": (str(self.contest_settings["SentExchange"])
                       if self.state["pluginID"] == "cq_ww_rtty" else self.other_1.text()),
        }
        for token, value in values.items():
            template = template.replace("{" + token + "}", value)
        return template

    def save_contact(self):
        self._commit(self)

    def values(self):
        return {name: getattr(self, name).text() for name in INPUTS}

    def persist(self):
        self.state["draft"]["fields"] = self.values()
        self.state["focus"] = self.current_widget
        self.state["esmCallSent"] = self.esm_call_sent

    def contact_for(self, fields, qso_id, timestamp, frequency, base=None, operator=None):
        for name in INPUTS:
            getattr(self, name).setText(fields[name])
        call = self.parsed_call()
        country = self.cty_lookup(call)
        info = next(iter(country.values())) if country else {}
        band = self.band(frequency)
        self.contact = deepcopy(base) if base is not None else self.database.get_empty().copy()
        from not1mm.lib.ham_utility import calculate_wpx_prefix
        self.contact.update({"ID": qso_id, "Call": call, "TS": timestamp, "Freq": frequency / 1000,
            "Band": band, "Operator": operator or self.state["operator"],
            "CountryPrefix": info.get("primary_pfx", ""), "Continent": info.get("continent", ""),
            "ZN": info.get("cq", 0), "WPXPrefix": calculate_wpx_prefix(call)})
        if base is None:
            # Original phone Cabrillo converts USB/LSB to PH.
            mode = self.state["settings"]["ModeCategory"]
            radio_mode = ("LSB" if frequency < 10000000 else "USB") if mode == "SSB" else mode
            self.contact.update({"QSXFreq": frequency / 1000, "Mode": radio_mode, "ContestNR": 1,
                "ContestName": self.contest.cabrillo_name, "StationPrefix": self.station["Call"],
                "IsRunQSO": int(self.pref["run_state"]), "Run1Run2": 1})
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
        return bool(self.database.check_dupe_on_band(call, band).get("isdupe"))

    def contest_band(self, frequency):
        band = self.band(frequency)
        require(self.state["pluginID"] != "trans_tasman" or band in {1.8, 3.5, 7.0},
                "Trans Tasman supports only 160, 80 and 40 metres", "invalid_frequency")
        require(self.state["pluginID"] != "phone_weekly_test" or band != 28.0,
                "Phone Weekly Test supports 160 through 15 metres", "invalid_frequency")
        return band

    @staticmethod
    def band(frequency):
        for low, high, band in ((1800000, 2000000, 1.8), (3500000, 4000000, 3.5),
                                (7000000, 7300000, 7.0), (14000000, 14350000, 14.0),
                                (21000000, 21450000, 21.0), (28000000, 29700000, 28.0)):
            if low <= frequency <= high:
                return band
        raise HostError("invalid_frequency", "Frequency is outside CQ WW bands")

    def projection(self):
        if (self.state.get("setup", {}).get("preferences", {}).get("callHistory", True) is not False
                and hasattr(self.contest, "populate_history_info_line")):
            self.contest.populate_history_info_line(self)
        else:
            self.history_info.setText("")
        # Rebuild Not1MM's non-transmitting ESM presentation on every read so
        # highlights survive reopen/refresh without emitting an output intent.
        if self.use_esm:
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
        speed = self.state.get("setup", {}).get("preferences", {}).get("cwSpeed")
        if type(speed) not in {int, float} or not 1 <= speed <= 100:
            speed = None
        plugin = PLUGIN_REGISTRY[self.state["pluginID"]]
        return {"sessionID": self.state["sessionID"], "engine": "not1mm-python",
                "pluginID": self.state["pluginID"], "pluginName": PLUGINS[self.state["pluginID"]],
                "reservedSerial": self.current_sn if self.state["pluginID"] in SERIAL_PLUGINS else None,
                "sourceRevision": SOURCE_REVISION,
                "ruleIdentity": {"id": self.state["pluginID"].replace("_", "-"), "version": "26.10.11",
                                 "edition": "not1mm-python", "sourceRevision": SOURCE_REVISION},
                "supportedBands": list(plugin.bands), "supportedModes": list(plugin.modes),
                "allowDuplicateCommit": plugin.allow_duplicate_commit,
                "matrixTrackers": list(plugin.matrix_trackers),
                "workspaceGeneration": workspace_generation(self.state),
                "referenceID": self.state["reference"]["id"], "revision": self.state["revision"],
                "draftID": self.state["draft"]["id"], "fields": fields,
                "frequencyHz": self.state["draft"]["frequencyHz"], "mode": self.state["settings"]["ModeCategory"], "band": band,
                "operator": self.state["operator"], "cwSpeedWpm": speed,
                "callContext": {"callsign": call, "entity": country.get("entity"), "country": country.get("entity"),
                    "continent": country.get("continent"), "cqZone": country.get("cq"), "ituZone": country.get("itu"),
                    "primaryPrefix": country.get("primary_pfx"), "headingDegrees": None,
                    "longPathHeadingDegrees": None, "distanceKm": None},
                "focus": self.current_widget, "nextField": self.next_field.name,
                "tabNext": {a.name: b.name for a, b in self.tab_next.items()},
                "tabPrevious": {a.name: b.name for a, b in self.tab_prev.items()},
                "advanceOnSpace": [name for name, enabled in zip(
                    INPUTS, getattr(self.contest, "advance_on_space", [True, False, False, False, False])
                ) if enabled],
                "run": self.pref["run_state"], "functionKeys": [{"id": f"F{i}", "highlighted": f"F{i}" in self.highlights,
                    **self.cw_macros[("R" if self.pref["run_state"] else "S", f"F{i}")]} for i in range(1, 13)],
                "dupe": bool(call and self.is_dupe(call, band)),
                "dupeExplanation": ("Worked on this band and mode in this 2-hour UTC block (08–10, 10–12, 12–14)."
                                    if self.contest.dupe_type == 5 else
                                    "Worked in this contest." if self.contest.dupe_type == 1 else "Worked on this band."),
                "countryResolved": bool(self.cty_lookup(call)), "history": self.history_info.text(),
                "columns": self.contest.columns, "score": self.score()}

    def score(self):
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
        if self.state["pluginID"] in {"icwc_mst", "cwt", "cwo"}:
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
        if self.state["pluginID"] in {"cq_wpx_cw", "cq_wpx_ssb", "oceania_dx_cw", "oceania_dx_ssb"}:
            prefixes = self.contest.show_mults(self)
            return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                    "countries": 0, "zones": 0, "prefixes": prefixes,
                    "multipliers": prefixes, "total": self.contest.calc_score(self)}
        country, zone = self.contest.show_mults(self, rtc=True)
        return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                "countries": country, "zones": zone, "multipliers": country + zone, "total": self.contest.calc_score(self)}


class Host:
    MUTATIONS = {"session_create", "draft_apply", "focus", "run_state", "esm", "function_key", "qso_commit", "qso_correct", "qso_delete", "setup_save"}

    def __init__(self, data_root):
        supplied = Path(data_root).absolute()
        require(not any(part.is_symlink() for part in [supplied, *supplied.parents]), "Data root must not traverse symlinks")
        supplied.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = supplied.resolve()
        self.stores = {}
        self.exports = {}
        self._operation = None

    def close(self):
        for store in self.stores.values():
            store.close()
        self.stores.clear()

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
                                  "sentExchangeHint": plugin.sent_exchange_hint,
                                  "overlayChoices": list(plugin.overlay_choices)}
                                 for key, plugin in PLUGIN_REGISTRY.items()], "protocolVersion": 1}
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
                               "workspaceGeneration": workspace_generation(state),
                               "pluginID": state["pluginID"], "sourceRevision": state["sourceRevision"],
                               "revision": state["revision"]}
                except (HostError, sqlite3.Error, OSError, json.JSONDecodeError):
                    # Discovery must not let one stale/incomplete store hide other sessions.
                    # Explicit opens still report the candidate's original error.
                    continue
                sessions.append(summary)
            return {"sessions": sessions}
        session_id = identifier(params.get("sessionID"))
        store = self.database(session_id, method == "session_create")
        if method in self.MUTATIONS:
            return self.mutate(store, session_id, method, params)
        state = store.state(session_id)
        require(state is not None, "Session does not exist", "not_found")
        self.verify_engine(state)
        if method.startswith("history_"):
            return self.callhistory(store, state, method, params)
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
        if method == "check_partial":
            query = text(params.get("query", ""), 32).upper()
            require(re.fullmatch(r"[A-Z0-9/]{1,32}", query) is not None, "Partial callsign must contain letters, digits or slash")
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
                match = (f"%{query}%", store.current_contest)
                total = store.exec_sql("SELECT count(*) AS n FROM DXLOG WHERE Call LIKE ? AND ContestNR=?", match)["n"]
                rows = store.exec_sql_mult("SELECT * FROM DXLOG WHERE Call LIKE ? AND ContestNR=? ORDER BY TS ASC,rowid ASC LIMIT ?", (*match, limit))
                return {"sessionID": session_id, "revision": state["revision"], "query": query,
                        "limit": limit, "total": total, "rows": rows}
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
                rows = store.exec_sql_mult(
                    "SELECT Band,Call,Mode,WPXPrefix,Points FROM DXLOG WHERE ContestNR=?",
                    (store.current_contest,),
                )
                return {"sessionID": session_id, "revision": state["revision"],
                        "score": desk.score(), "matrices": self.matrices(store),
                        "statistics": calculate_statistics(rows)}
            finally:
                store.conn.rollback()
        desk = Desk(store, state, self.commit)
        if method in {"session_open", "projection"}:
            return {"projection": desk.projection()}
        if method == "cw_context":
            require(state["settings"]["ModeCategory"] == "CW", "This contest does not support CW output", "unsupported_mode")
            return {"sessionID": session_id, "revision": state["revision"],
                    "draftID": state["draft"]["id"], "stationCall": state["station"]["Call"],
                    "fields": desk.values(), "frequencyHz": state["draft"]["frequencyHz"],
                    "sentExchange": str(state["settings"]["SentExchange"]),
                    "sentSerial": desk.other_1.text() if state["pluginID"] in SERIAL_PLUGINS else ""}
        if method == "receipt":
            row = store.exec_sql("SELECT payload,result FROM xlog_operation WHERE operation_id=?", (identifier(params.get("operationID")),))
            return {"found": bool(row), "result": self.replay_result(json.loads(row["result"]), store) if row else None}
        if method == "output_claim":
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
            offset, limit = params.get("offset", 0), params.get("limit", 50)
            require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100, "Invalid page")
            expected = params.get("expectedRevision")
            require(expected is None or expected == state["revision"], "Contest changed before the next log page", "stale_revision")
            return {"sessionID": session_id, "revision": state["revision"], "offset": offset, "limit": limit,
                    "total": store.exec_sql("SELECT count(*) AS n FROM DXLOG")["n"],
                    "rows": store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY TS DESC,rowid DESC LIMIT ? OFFSET ?", (limit, offset))}
        if method == "export":
            return self.export(desk)
        if method == "export_prepare":
            require(len(self.exports) < 8, "Release another prepared export first", "export_busy")
            filename, payload = self.export_artifact(desk, 32 * 1024 * 1024)
            require(bool(payload), "Plugin export was empty", "export_failed")
            artifact_id = str(uuid.uuid4())
            prepared = {"artifactID": artifact_id, "sessionID": session_id,
                        "workspaceGeneration": workspace_generation(state), "revision": state["revision"],
                        "byteLength": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
                        "format": "cabrillo", "filename": filename}
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

    def mutate(self, store, session_id, method, params):
        operation = identifier(params.get("operationID"))
        payload = canonical({"method": method, "params": params})
        store.begin()
        try:
            previous = store.exec_sql("SELECT payload,result FROM xlog_operation WHERE operation_id=?", (operation,))
            if previous:
                require(previous["payload"] == payload, "Operation ID was already used with another payload", "payload_conflict")
                result = self.replay_result(json.loads(previous["result"]), store)
                store.finish(True)
                return result
            state = store.state(session_id)
            expected = params.get("expectedRevision", 0)
            require(type(expected) is int and expected >= 0, "Revision must be a nonnegative integer")
            if method == "session_create":
                require(state is None, "Session already exists", "session_exists")
                require(expected == 0, "Creation revision must be zero")
                state = self.new_state(session_id, params)
            else:
                require(state is not None, "Session does not exist", "not_found")
                self.verify_engine(state)
                require(expected == state["revision"], "Session changed; refresh before editing", "stale_revision")
            self._operation = operation
            if method == "session_create":
                self.reserve_serial(store, state)
            desk = Desk(store, state, self.commit)
            if method == "draft_apply":
                self.apply_fields(desk, params)
                self.prefill(desk)
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
                require(setup["pluginID"] == state["pluginID"], "A session's plugin cannot be changed")
                call = text(setup["station"].get("Call", ""), 32).upper()
                require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Invalid station call")
                require(call in state["reference"]["countries"], "Resolve the station country before changing setup", "station_country_unresolved")
                require(bool(setup["name"].strip()), "Contest name is required")
                operator = text(setup["operator"], 32)
                require(bool(operator.strip()), "Operator is required")
                zone = str(setup["settings"].get("SentExchange", ""))
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
                modes = PLUGIN_REGISTRY[state["pluginID"]].modes
                mode = modes[0]
                require(setup["settings"].get("ModeCategory", mode) in modes,
                        f"Selected plugin requires {mode} mode" if len(modes) == 1 else
                        f"Selected plugin requires a supported {mode} submode")
                setup["station"]["Call"] = call
                setup["settings"].setdefault("SentExchange", "")
                setup["settings"].setdefault("ModeCategory", mode)
                setup["settings"].setdefault("OverlayCategory", "N/A")
                state.update({"setup": setup, "name": setup["name"], "operator": operator,
                              "station": deepcopy(setup["station"]), "settings": deepcopy(setup["settings"])})
                self.reserve_serial(store, state)
                # Recreate the adapter with effective settings/macros before returning
                # the projection, and rescore if the station country changed.
                previous_station = desk.station
                desk = Desk(store, state, self.commit)
                if state["pluginID"] in CQ_WW_PLUGINS and state["pluginID"] != "cq_ww_rtty":
                    desk.other_1.setText(zone)
                if state["pluginID"] in TEN_TEN_PLUGINS:
                    self.prefill(desk)
                if previous_station["Call"] != call:
                    self.rebuild(desk)
            elif method == "esm":
                if "fields" in params:
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
                if "fields" in params:
                    self.apply_fields(desk, params)
                    self.prefill(desk)
                key = params.get("key")
                require(key in {f"F{i}" for i in range(1, 13)}, "Unknown function key")
                desk.process_function_key(getattr(desk, key))
            elif method == "qso_commit":
                if "fields" in params or "frequencyHz" in params or "countries" in params:
                    self.apply_fields(desk, params)
                self.commit(desk, params.get("qsoID"), params.get("timestamp"))
            elif method in {"qso_correct", "qso_delete"}:
                self.change(desk, method, params)
            desk.persist()
            state["revision"] += 1
            store.save_state(state)
            result = {"operationID": operation, "sessionID": session_id, "revision": state["revision"],
                      "projection": desk.projection(), "actions": desk.actions, "messages": desk.messages, "replayed": False}
            if method == "setup_save":
                result["setup"] = deepcopy(state["setup"])
                result["effectiveMacros"] = self.effective_macros(state)
            for index, action in enumerate(result["actions"]):
                action["actionID"] = f"{operation}:{index}"
            store.conn.execute("INSERT INTO xlog_operation VALUES(?,?,?)", (operation, payload, canonical(result)))
            store.finish(True)
            return result
        except BaseException:
            store.finish(False)
            raise
        finally:
            self._operation = None

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
        if store and isinstance(projection, dict) and projection.get("pluginID") in SERIAL_PLUGINS:
            reservation = store.exec_sql("SELECT serial FROM xlog_serial WHERE draft_id=? AND serial=?",
                                         (projection.get("draftID"), projection.get("reservedSerial")))
            if reservation:
                expected = str(reservation["serial"]).zfill(3)
                for field in projection.get("fields", []):
                    if field.get("id") == "other_1":
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
        require(isinstance(state["draft"].get("fields"), dict)
                and isinstance(state["draft"].get("id"), str)
                and type(state["draft"].get("frequencyHz")) is int
                and isinstance(state["reference"].get("countries"), dict)
                and isinstance(state["reference"].get("id"), str)
                and isinstance(state["station"].get("Call"), str)
                and "SentExchange" in state["settings"],
                "Incomplete persisted session state", "invalid_session")

    def new_state(self, session_id, params):
        plugin_id = params.get("pluginID", PLUGIN_ID)
        require(plugin_id in PLUGINS, "Unsupported pinned plugin")
        workspace = identifier(params.get("workspaceGeneration"))
        frequency = params.get("frequencyHz")
        require(type(frequency) is int, "A confirmed or manual frequency is required")
        Desk.band(frequency)
        require(plugin_id != "trans_tasman" or Desk.band(frequency) in {1.8, 3.5, 7.0},
                "Trans Tasman supports only 160, 80 and 40 metres", "invalid_frequency")
        station, reference = deepcopy(params.get("station")), deepcopy(params.get("reference"))
        require(isinstance(station, dict) and isinstance(reference, dict), "Station and reference are required")
        call = text(station.get("Call", ""), 32).upper()
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Invalid station call")
        station["Call"] = call
        require(isinstance(reference.get("id"), str) and reference["id"], "Reference ID required")
        countries = self.countries(reference.get("countries"))
        require(call in countries, "Resolve the station country before creating this contest", "station_country_unresolved")
        settings = deepcopy(params.get("settings", {}))
        require(isinstance(settings, dict), "Settings must be an object")
        for value in [*station.values(), *settings.values()]:
            require(isinstance(value, (str, int)) and not isinstance(value, bool), "Station/settings values must be text or integer")
            text(str(value), 512)
        settings.setdefault("SentExchange", "")
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
        modes = PLUGIN_REGISTRY[plugin_id].modes
        mode = modes[0]
        settings.setdefault("ModeCategory", mode)
        require(settings["ModeCategory"] in modes,
                f"Selected plugin requires {mode} mode" if len(modes) == 1 else
                f"Selected plugin requires a supported {mode} submode")
        settings.setdefault("OverlayCategory", "N/A")
        report = "59" if settings["ModeCategory"] == "SSB" else "599"
        return {"sessionID": session_id, "workspaceGeneration": workspace,
                "name": text(params.get("name", PLUGINS[plugin_id]), 128),
                "revision": 0, "engine": "not1mm-python", "pluginID": plugin_id,
                "sourceRevision": SOURCE_REVISION, "schemaVersion": 1, "station": station, "settings": settings,
                "operator": text(params.get("operator", call), 32), "reference": {"id": text(reference["id"]), "countries": countries},
                "run": False, "focus": "callsign", "draft": {"id": str(uuid.uuid4()), "frequencyHz": frequency,
                "fields": dict(zip(INPUTS, ("", report, report,
                    str(settings["SentExchange"]) if (plugin_id in CQ_WW_PLUGINS and plugin_id != "cq_ww_rtty")
                    or plugin_id in TEN_TEN_PLUGINS else "", "")))}}

    def reserve_serial(self, store, state):
        if state["pluginID"] not in SERIAL_PLUGINS:
            return
        scope = "contest"
        if state["pluginID"] == "trans_tasman" and state["settings"].get("OperatorCategory", "") != "SINGLE-OP":
            scope = f'band:{Desk.band(state["draft"]["frequencyHz"])}'
        reservation = store.exec_sql("SELECT serial FROM xlog_serial WHERE draft_id=? AND scope=?",
                                     (state["draft"]["id"], scope))
        if reservation:
            serial = reservation["serial"]
        else:
            serial = store.exec_sql("SELECT coalesce(max(serial),0)+1 AS serial FROM xlog_serial WHERE scope=?", (scope,))["serial"]
            store.conn.execute("INSERT INTO xlog_serial(draft_id,serial,operation_id,scope) VALUES(?,?,?,?)",
                               (state["draft"]["id"], serial, self._operation, scope))
        state["draft"]["serial"] = serial
        state["draft"]["fields"]["other_1"] = str(serial).zfill(3)

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
        if "countries" in params:
            require(params.get("referenceID") == desk.state["reference"]["id"],
                    "The contest CTY reference differs from this session; migrate it explicitly before resolving new calls",
                    "reference_mismatch")
            additions = self.countries(deepcopy(params["countries"]))
            current = desk.state["reference"]["countries"]
            for call, country in additions.items():
                require(call not in current or current[call] == country, "Pinned country resolution changed", "reference_conflict")
            current.update(additions)
        fields = params.get("fields", {})
        require(isinstance(fields, dict) and set(fields) <= set(INPUTS), "Unknown draft field")
        if not allow_reserved_serial_change and desk.state["pluginID"] in SERIAL_PLUGINS and "other_1" in fields:
            expected = str(desk.state["draft"].get("serial", "")).zfill(3)
            require(fields["other_1"] == expected,
                    "The sent serial is reserved by the contest host and cannot be changed", "serial_conflict")
        for name, value in fields.items():
            getattr(desk, name).setText(text(value, 128))
        desk.callsign.setText(desk.callsign.text().upper())
        if "frequencyHz" in params:
            frequency = params["frequencyHz"]
            require(type(frequency) is int, "Frequency must be integer Hz")
            desk.contest_band(frequency)
            desk.state["draft"]["frequencyHz"] = frequency
            if not allow_reserved_serial_change:
                self.reserve_serial(desk.database, desk.state)
                if desk.state["pluginID"] in SERIAL_PLUGINS:
                    desk.current_sn = desk.state["draft"]["serial"]
                    desk.other_1.setText(str(desk.current_sn).zfill(3))

    @staticmethod
    def prefill(desk):
        country = desk.cty_lookup(desk.callsign.text())
        desk.contact["ZN"] = next(iter(country.values()))["cq"] if country else ""
        if desk.state["pluginID"] == "trans_tasman":
            desk.contact["Band"] = desk.contest_band(desk.state["draft"]["frequencyHz"])
        desk.contest.prefill(desk)
        if (desk.state.get("setup", {}).get("preferences", {}).get("callHistory", True) is not False
                and hasattr(desk.contest, "check_call_history")):
            desk.contest.check_call_history(desk)

    @staticmethod
    def validate_exchange(desk, fields):
        if desk.state["pluginID"] == "cq_ww_rtty":
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
        elif desk.state["pluginID"] in {"cq_wpx_cw", "cq_wpx_ssb", "trans_tasman", "oceania_dx_cw", "oceania_dx_ssb"}:
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
        elif desk.state["pluginID"] in NAME_SPC_PLUGINS:
            country = desk.cty_lookup(desk.callsign.text())
            continent = next(iter(country.values())).get("continent", "") if country else ""
            require(fields["other_1"].isalpha(), "Received name must contain letters")
            require(continent != "NA" and fields["other_2"] == "" or fields["other_2"].isalpha(),
                    "Received SPC is required for North America and must contain letters")
        elif desk.state["pluginID"] in ARRL_DX_PLUGINS:
            require(bool(fields["other_2"].strip()), "Received power/state/province is required")
        elif desk.state["pluginID"] in TEN_TEN_PLUGINS:
            require(desk.contest.validate(desk), "Received exchange must be NAME 10-10# SPC")
        else:
            require(re.fullmatch(r"[0-9]+", fields["other_1"]) is not None
                    and 0 < int(fields["other_1"]) <= 9223372036854775807,
                    "Sent serial must be a positive SQLite integer")
            if desk.state["pluginID"] == "icwc_mst":
                exchange = re.fullmatch(r"[A-Za-z][A-Za-z'-]{0,31} ([0-9]+)", fields["other_2"])
                require(exchange is not None and 0 < int(exchange[1]) <= 9223372036854775807,
                        "ICWC received exchange must be NAME SERIAL with one space and a positive SQLite serial")

    def commit(self, desk, qso_id=None, timestamp=None):
        fields = desk.values()
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", desk.parsed_call()) is not None, "Complete callsign required")
        self.validate_exchange(desk, fields)
        qso_id = identifier(qso_id) if qso_id else str(uuid.uuid4())
        timestamp = timestamp or now()
        try:
            require(datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S") == timestamp, "Timestamp must be UTC YYYY-MM-DD HH:MM:SS")
        except (ValueError, TypeError) as error:
            raise HostError("invalid_request", "Invalid UTC timestamp") from error
        contact = desk.contact_for(fields, qso_id, timestamp, desk.state["draft"]["frequencyHz"])
        try:
            desk.database.log_contact(contact)
        except sqlite3.IntegrityError as error:
            raise HostError("qso_collision", "QSO identity or timestamp/call already exists") from error
        country = desk.state["reference"]["countries"].get(contact["Call"])
        desk.database.conn.execute("INSERT INTO xlog_qso_identity VALUES(?,?,?,0)", (qso_id, canonical(fields), canonical(country)))
        if desk.state["pluginID"] in {"trans_tasman", "oceania_dx_cw", "oceania_dx_ssb"}:
            self.rebuild(desk)
            contact = desk.database.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
        self.audit(desk.database, qso_id, "commit", None, contact)
        desk.state["draft"]["id"] = str(uuid.uuid4())
        report = "59" if desk.state["settings"].get("ModeCategory") == "SSB" else "599"
        desk.callsign.setText("")
        desk.sent.setText(report)
        desk.receive.setText(report)
        desk.other_2.setText("")
        if desk.state["pluginID"] in {"cwt", "k1usn_sst", "cq_ww_rtty", *NAME_SPC_PLUGINS}:
            desk.other_1.setText("")
        if desk.state["pluginID"] in SERIAL_PLUGINS:
            self.reserve_serial(desk.database, desk.state)
            desk.current_sn = desk.state["draft"]["serial"]
            desk.other_1.setText(desk.state["draft"]["fields"]["other_1"])
        desk.current_widget = "callsign"

    def change(self, desk, method, params):
        qso_id = identifier(params.get("qsoID"))
        before = desk.database.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
        require(bool(before), "QSO does not exist", "not_found")
        reason = text(params.get("reason", "Operator correction"), 512)
        old_fields = desk.values()
        if method == "qso_delete":
            desk.database.delete_contact(qso_id)
            desk.database.conn.execute("UPDATE xlog_qso_identity SET deleted=1 WHERE id=?", (qso_id,))
            after = None
        else:
            identity = desk.database.exec_sql("SELECT raw_fields FROM xlog_qso_identity WHERE id=?", (qso_id,))
            fields = json.loads(identity["raw_fields"])
            for name in INPUTS:
                getattr(desk, name).setText(fields[name])
            changes = {"fields": params.get("fields", {})}
            if "countries" in params:
                changes.update({"countries": params["countries"], "referenceID": params.get("referenceID")})
            self.apply_fields(desk, changes, allow_reserved_serial_change=True)
            updated = desk.values()
            require(re.fullmatch(r"[A-Z0-9/]{3,32}", desk.parsed_call()) is not None, "Complete callsign required")
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
            operator = text(params.get("operator", before["Operator"]), 20)
            require(bool(operator.strip()), "Operator is required")
            after = desk.contact_for(updated, qso_id, timestamp, frequency, base=before, operator=operator)
            if desk.state["pluginID"] in {"cwt", "k1usn_sst", *TEN_TEN_PLUGINS,
                                           *NAME_SPC_PLUGINS, *ARRL_DX_PLUGINS}:
                # Received-name edits must not replace the exchange actually
                # sent with the session's current setup value.
                after["SentNr"] = before["SentNr"]
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
        self.audit(desk.database, qso_id, "delete" if method == "qso_delete" else "correct", before, after, reason)
        for name in INPUTS:
            getattr(desk, name).setText(old_fields[name])

    @staticmethod
    def rebuild(desk):
        rows = desk.database.fetch_all_contacts_asc()
        points = {}
        desk.database.conn.execute("DELETE FROM DXLOG")
        for row in rows:
            desk.contact = row
            desk.contact_is_dupe = int(desk.is_dupe(row["Call"], row["Band"], row["TS"], row["Mode"]))
            if desk.state["pluginID"] in TEN_TEN_PLUGINS:
                # The original points() reads the active exchange widget. During
                # ordered replay, make that widget represent the row being scored.
                desk.other_2.setText(row["NR"])
            row["Points"] = desk.contest.points(desk)
            points[row["ID"]] = row["Points"]
            desk.database.log_contact(row)
        desk.contest.recalculate_mults(desk)
        # Upstream recalculate_mults calls points with one shared dupe flag.
        # Restore each contact's plugin-calculated score from the ordered replay.
        for qso_id, value in points.items():
            desk.database.conn.execute("UPDATE DXLOG SET Points=? WHERE ID=?", (value, qso_id))

    def audit(self, store, qso_id, kind, before, after, reason=""):
        store.conn.execute("INSERT INTO xlog_qso_audit(operation_id,qso_id,kind,before_json,after_json,reason) VALUES(?,?,?,?,?,?)", (self._operation, qso_id, kind, canonical(before), canonical(after), reason))

    @staticmethod
    def matrices(store):
        params = (store.current_contest,)
        if store.plugin_id in CQ_WW_PLUGINS:
            eligible = store.cq_ww_multiplier_filter()
            result = {"countries": store.exec_sql_mult(f"SELECT q.CountryPrefix AS value,q.Band AS band,count(*) AS qsos FROM DXLOG AS q WHERE q.ContestNR=? AND {eligible} GROUP BY q.CountryPrefix,q.Band ORDER BY q.CountryPrefix,q.Band", params),
                      "zones": store.exec_sql_mult(f"SELECT q.ZN AS value,q.Band AS band,count(*) AS qsos FROM DXLOG AS q WHERE q.ContestNR=? AND {eligible} GROUP BY q.ZN,q.Band ORDER BY q.ZN,q.Band", params)}
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
    def export_artifact(desk, maximum):
        # The pinned plugin writes only inside this explicit private destination.
        with TemporaryDirectory(prefix="export-", dir=Path(desk.database.database).parent) as directory:
            desk.export_directory = Path(directory)
            desk.contest.cabrillo(desk, "utf-8")
            files = list(Path(directory).glob("*.log"))
            require(len(files) == 1, "Plugin export failed", "export_failed")
            require(files[0].stat().st_size <= maximum,
                    "Use a chunked export route for this log" if maximum == 512000 else "Prepared export exceeds the native save limit",
                    "export_too_large")
            return files[0].name, files[0].read_bytes()

    @classmethod
    def export(cls, desk):
        filename, payload = cls.export_artifact(desk, 512000)
        return {"sessionID": desk.state["sessionID"], "revision": desk.state["revision"], "filename": filename,
                "format": "cabrillo", "content": payload.decode("utf-8")}
