"""CQ WW application adapter: plugin code owns rules, xLog owns output."""
from copy import deepcopy
from datetime import datetime, UTC
import base64
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from tempfile import TemporaryDirectory
import uuid

from .store import Store, canonical
from .upstream import load_cqww, load_cw_macros

PLUGIN_ID = "cq_ww_cw"
SOURCE_REVISION = "7c8b499225a73f7f8f792246881bd7aefc05452f"
INPUTS = ("callsign", "sent", "receive", "other_1", "other_2")
FIELDS = INPUTS + ("snt_label", "rcv_label", "other_label", "exch_label", "history_info")
BANDS = {1.8, 3.5, 7.0, 14.0, 21.0, 28.0}


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
    __slots__ = ("name", "value", "visible", "accessible_name", "read_only", "enabled", "focused")

    def __init__(self, name, value=""):
        self.name, self.value, self.visible = name, str(value), True
        self.accessible_name, self.read_only, self.enabled, self.focused = "", False, True, False

    def text(self):
        return self.value

    def setText(self, value):
        self.value = text(str(value), 512)

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


class Desk:
    def __init__(self, store, state, commit):
        self.database, self.state, self._commit = store, state, commit
        self.contest = load_cqww()
        self.cw_macros = load_cw_macros()
        self.station, self.contest_settings = state["station"], state["settings"]
        self.pref = {"contest": 1, "run_state": state["run"], "esm_send_corrected_call": True}
        self.actions, self.messages, self.highlights = [], [], set()
        for name in FIELDS:
            setattr(self, name, Field(name, state["draft"]["fields"].get(name, "")))
        # fieldN are visual containers, not a second set of input values.
        self.field0, self.field1, self.field2, self.field3, self.field4 = [Field(f"field{i}") for i in range(5)]
        self.inputs_dict = {getattr(self, name): name for name in INPUTS}
        for i in range(1, 13):
            setattr(self, f"F{i}", Field(f"F{i}"))
        # Not1MM stores ESM roles as preferences; they are not sequential F-keys.
        # These are the upstream defaults for the pinned CQ WW macro file.
        self.esm_dict = {
            "CQ": self.F1, "EXCH": self.F3, "QRZ": self.F4, "AGN": self.F9,
            "HISCALL": self.F2, "MYCALL": self.F5, "QSOB4": None,
        }
        self.current_widget = state["focus"]
        self.esm_call_sent = state.get("esmCallSent", "")
        self.current_sn, self.contact_is_dupe = 0, 0
        self.radio_state = {"vfoa": state["draft"]["frequencyHz"], "mode": "CW"}
        self.contact = self.database.get_empty().copy()
        self.contest.init_contest(self)

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
        macro = self.cw_macros[("R" if self.state["run"] else "S", button.name)]
        if not macro["template"].strip():
            return
        self.actions.append({"kind": "function_key", "key": button.name,
                             "label": macro["label"], "template": macro["template"],
                             "sessionID": self.state["sessionID"], "draftID": self.state["draft"]["id"],
                             "fields": self.values(), "stationCall": self.station["Call"],
                             "sentExchange": self.contest_settings["SentExchange"]})

    def save_contact(self):
        self._commit(self)

    def values(self):
        return {name: getattr(self, name).text() for name in INPUTS}

    def persist(self):
        self.state["draft"]["fields"] = self.values()
        self.state["focus"] = self.current_widget
        self.state["esmCallSent"] = self.esm_call_sent

    def contact_for(self, fields, qso_id, timestamp, frequency):
        call = fields["callsign"].upper()
        country = self.cty_lookup(call)
        info = next(iter(country.values())) if country else {}
        band = self.band(frequency)
        self.contact = self.database.get_empty().copy()
        from not1mm.lib.ham_utility import calculate_wpx_prefix
        self.contact.update({"ID": qso_id, "Call": call, "TS": timestamp,
            "Freq": frequency / 1000, "QSXFreq": frequency / 1000, "Band": band, "Mode": "CW",
            "ContestNR": 1, "ContestName": self.contest.cabrillo_name,
            "StationPrefix": self.station["Call"], "Operator": self.state["operator"],
            "CountryPrefix": info.get("primary_pfx", ""), "Continent": info.get("continent", ""),
            "ZN": info.get("cq", 0), "WPXPrefix": calculate_wpx_prefix(call),
            "IsRunQSO": int(self.pref["run_state"]), "Run1Run2": 1})
        for name in INPUTS:
            getattr(self, name).setText(fields[name])
        self.contact_is_dupe = int(bool(self.database.check_dupe_on_band(call, band).get("isdupe")))
        self.contest.set_contact_vars(self)
        self.contact["Points"] = self.contest.points(self)
        return deepcopy(self.contact)

    @staticmethod
    def band(frequency):
        for low, high, band in ((1800000, 2000000, 1.8), (3500000, 4000000, 3.5),
                                (7000000, 7300000, 7.0), (14000000, 14350000, 14.0),
                                (21000000, 21450000, 21.0), (28000000, 29700000, 28.0)):
            if low <= frequency <= high:
                return band
        raise HostError("invalid_frequency", "Frequency is outside CQ WW bands")

    def projection(self):
        # Rebuild Not1MM's non-transmitting ESM presentation on every read so
        # highlights survive reopen/refresh without emitting an output intent.
        self.contest.process_esm(self, getattr(self, self.current_widget), False)
        fields = []
        containers = [self.field0, self.field1, self.field2, self.field3, self.field4]
        labels = ["Call", self.snt_label.text() or "SNT", self.rcv_label.text() or "RCV", self.other_label.text(), self.exch_label.text()]
        for name, container, label in zip(INPUTS, containers, labels):
            field = getattr(self, name)
            fields.append({"id": name, "value": field.text(), "visible": container.visible,
                           "label": label, "accessibleName": container.accessible_name or label,
                           "readOnly": field.read_only, "enabled": field.enabled})
        call = self.callsign.text().upper()
        band = self.band(self.state["draft"]["frequencyHz"])
        return {"sessionID": self.state["sessionID"], "engine": "not1mm-python",
                "pluginID": PLUGIN_ID, "sourceRevision": SOURCE_REVISION,
                "workspaceGeneration": workspace_generation(self.state),
                "referenceID": self.state["reference"]["id"], "revision": self.state["revision"],
                "draftID": self.state["draft"]["id"], "fields": fields,
                "frequencyHz": self.state["draft"]["frequencyHz"], "mode": "CW", "band": band,
                "focus": self.current_widget, "nextField": self.next_field.name,
                "tabNext": {a.name: b.name for a, b in self.tab_next.items()},
                "tabPrevious": {a.name: b.name for a, b in self.tab_prev.items()},
                "run": self.pref["run_state"], "functionKeys": [{"id": f"F{i}", "highlighted": f"F{i}" in self.highlights} for i in range(1, 13)],
                "dupe": bool(call and self.database.check_dupe_on_band(call, band).get("isdupe")),
                "countryResolved": bool(self.cty_lookup(call)), "history": self.history_info.text(),
                "columns": self.contest.columns, "score": self.score()}

    def score(self):
        country, zone = self.contest.show_mults(self, rtc=True)
        return {"qsos": self.contest.show_qso(self), "points": self.database.fetch_points().get("Points") or 0,
                "countries": country, "zones": zone, "total": self.contest.calc_score(self)}


class Host:
    MUTATIONS = {"session_create", "draft_apply", "focus", "run_state", "esm", "function_key", "qso_commit", "qso_correct", "qso_delete"}

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
            return {"plugins": [{"id": PLUGIN_ID, "name": "CQ WW CW", "engine": "not1mm-python", "sourceRevision": SOURCE_REVISION}], "protocolVersion": 1}
        if method == "sessions":
            sessions = []
            for directory in sorted(self.root.iterdir()):
                if not directory.is_dir() or directory.is_symlink():
                    continue
                try:
                    session_id = identifier(directory.name)
                except HostError:
                    continue
                store = self.database(session_id)
                state = store.state(session_id)
                require(state is not None, "Session does not exist", "not_found")
                self.verify_engine(state)
                sessions.append({"sessionID": session_id, "name": state.get("name", "CQ WW CW"),
                                 "workspaceGeneration": workspace_generation(state),
                                 "pluginID": state["pluginID"], "sourceRevision": state["sourceRevision"],
                                 "revision": state["revision"]})
            return {"sessions": sessions}
        session_id = identifier(params.get("sessionID"))
        store = self.database(session_id, method == "session_create")
        if method in self.MUTATIONS:
            return self.mutate(store, session_id, method, params)
        state = store.state(session_id)
        require(state is not None, "Session does not exist", "not_found")
        self.verify_engine(state)
        desk = Desk(store, state, self.commit)
        if method in {"session_open", "projection"}:
            return {"projection": desk.projection()}
        if method == "cw_context":
            return {"sessionID": session_id, "revision": state["revision"],
                    "draftID": state["draft"]["id"], "stationCall": state["station"]["Call"],
                    "fields": desk.values(), "frequencyHz": state["draft"]["frequencyHz"]}
        if method == "receipt":
            row = store.exec_sql("SELECT payload,result FROM xlog_operation WHERE operation_id=?", (identifier(params.get("operationID")),))
            return {"found": bool(row), "result": self.replay_result(json.loads(row["result"])) if row else None}
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
        if method == "score":
            return {"sessionID": session_id, "revision": state["revision"], "score": desk.score(), "matrices": self.matrices(store)}
        if method == "log":
            offset, limit = params.get("offset", 0), params.get("limit", 50)
            require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100, "Invalid page")
            return {"sessionID": session_id, "revision": state["revision"], "total": desk.score()["qsos"],
                    "rows": store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY TS,ID LIMIT ? OFFSET ?", (limit, offset))}
        if method == "export":
            return self.export(desk)
        if method == "export_prepare":
            exported = self.export(desk)
            payload = exported["content"].encode("utf-8")
            require(bool(payload), "Plugin export was empty", "export_failed")
            require(len(self.exports) < 8, "Release another prepared export first", "export_busy")
            artifact_id = str(uuid.uuid4())
            prepared = {"artifactID": artifact_id, "sessionID": session_id,
                        "workspaceGeneration": workspace_generation(state), "revision": state["revision"],
                        "byteLength": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
                        "format": "cabrillo", "filename": exported["filename"]}
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

    def mutate(self, store, session_id, method, params):
        operation = identifier(params.get("operationID"))
        payload = canonical({"method": method, "params": params})
        store.begin()
        try:
            previous = store.exec_sql("SELECT payload,result FROM xlog_operation WHERE operation_id=?", (operation,))
            if previous:
                require(previous["payload"] == payload, "Operation ID was already used with another payload", "payload_conflict")
                result = self.replay_result(json.loads(previous["result"]))
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
            desk = Desk(store, state, self.commit)
            if method == "draft_apply":
                self.apply_fields(desk, params)
                self.prefill(desk)
            elif method == "focus":
                require(params.get("field") in INPUTS, "Unknown field")
                desk.current_widget = params["field"]
                desk.contest.process_esm(desk, getattr(desk, params["field"]), False)
            elif method == "run_state":
                require(type(params.get("run")) is bool, "Run state must be boolean")
                desk.pref["run_state"] = state["run"] = params["run"]
            elif method == "esm":
                if "fields" in params:
                    self.apply_fields(desk, params)
                    self.prefill(desk)
                field = params.get("field", state["focus"])
                require(field in INPUTS, "Unknown focused field")
                desk.contest.process_esm(desk, getattr(desk, field), True)
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
    def replay_result(result):
        # Durable database replay never re-emits a physical output intent.
        result = deepcopy(result)
        result["actions"] = []
        result["replayed"] = True
        return result

    @staticmethod
    def verify_engine(state):
        require(state.get("engine") == "not1mm-python" and state.get("pluginID") == PLUGIN_ID
                and state.get("sourceRevision") == SOURCE_REVISION,
                "This session belongs to a different contest engine/source", "engine_mismatch")

    def new_state(self, session_id, params):
        require(params.get("pluginID", PLUGIN_ID) == PLUGIN_ID, "Only CQ WW CW is supported")
        workspace = identifier(params.get("workspaceGeneration"))
        frequency = params.get("frequencyHz")
        require(type(frequency) is int, "A confirmed or manual frequency is required")
        Desk.band(frequency)
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
        settings.setdefault("SentExchange", str(countries[call]["cq"]))
        require(str(settings["SentExchange"]).isdigit() and 1 <= int(settings["SentExchange"]) <= 40, "Sent CQ zone must be 1 to 40")
        settings.setdefault("ModeCategory", "CW")
        return {"sessionID": session_id, "workspaceGeneration": workspace,
                "name": text(params.get("name", "CQ WW CW"), 128),
                "revision": 0, "engine": "not1mm-python", "pluginID": PLUGIN_ID,
                "sourceRevision": SOURCE_REVISION, "schemaVersion": 1, "station": station, "settings": settings,
                "operator": text(params.get("operator", call), 32), "reference": {"id": text(reference["id"]), "countries": countries},
                "run": False, "focus": "callsign", "draft": {"id": str(uuid.uuid4()), "frequencyHz": frequency,
                "fields": dict(zip(INPUTS, ("", "599", "599", str(settings["SentExchange"]), "")))}}

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

    def apply_fields(self, desk, params):
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
        for name, value in fields.items():
            getattr(desk, name).setText(text(value, 128))
        desk.callsign.setText(desk.callsign.text().upper())
        if "frequencyHz" in params:
            frequency = params["frequencyHz"]
            require(type(frequency) is int, "Frequency must be integer Hz")
            desk.band(frequency)
            desk.state["draft"]["frequencyHz"] = frequency

    @staticmethod
    def prefill(desk):
        country = desk.cty_lookup(desk.callsign.text())
        desk.contact["ZN"] = next(iter(country.values()))["cq"] if country else ""
        desk.contest.prefill(desk)
        desk.contest.check_call_history(desk)

    def commit(self, desk, qso_id=None, timestamp=None):
        fields = desk.values()
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", fields["callsign"]) is not None, "Complete callsign required")
        require(fields["other_2"].isdigit() and 1 <= int(fields["other_2"]) <= 40, "CQ zone must be 1 to 40")
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
        country = desk.state["reference"]["countries"].get(fields["callsign"])
        desk.database.conn.execute("INSERT INTO xlog_qso_identity VALUES(?,?,?,0)", (qso_id, canonical(fields), canonical(country)))
        self.audit(desk.database, qso_id, "commit", None, contact)
        desk.state["draft"]["id"] = str(uuid.uuid4())
        for name in ("callsign", "other_2"):
            getattr(desk, name).setText("")
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
            self.apply_fields(desk, changes)
            updated = desk.values()
            require(re.fullmatch(r"[A-Z0-9/]{3,32}", updated["callsign"]) is not None, "Complete callsign required")
            require(updated["other_2"].isdigit() and 1 <= int(updated["other_2"]) <= 40, "CQ zone must be 1 to 40")
            # Existing ID/timestamp/frequency remain stable in this bounded editor.
            after = desk.contact_for(updated, qso_id, before["TS"], round(before["Freq"] * 1000))
            try:
                desk.database.change_contact(after)
            except sqlite3.IntegrityError as error:
                raise HostError("qso_collision", "Corrected timestamp/call collides with another contact") from error
            country = desk.state["reference"]["countries"].get(updated["callsign"])
            desk.database.conn.execute("UPDATE xlog_qso_identity SET raw_fields=?,country=? WHERE id=?", (canonical(updated), canonical(country), qso_id))
        self.rebuild(desk)
        after = desk.database.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,)) or None
        self.audit(desk.database, qso_id, "delete" if method == "qso_delete" else "correct", before, after, reason)
        for name in INPUTS:
            getattr(desk, name).setText(old_fields[name])

    @staticmethod
    def rebuild(desk):
        rows = desk.database.fetch_all_contacts_asc()
        desk.database.conn.execute("DELETE FROM DXLOG")
        for row in rows:
            desk.contact = row
            desk.contact_is_dupe = int(bool(desk.database.check_dupe_on_band(row["Call"], row["Band"]).get("isdupe")))
            row["Points"] = desk.contest.points(desk)
            desk.database.log_contact(row)
        desk.contest.recalculate_mults(desk)

    def audit(self, store, qso_id, kind, before, after, reason=""):
        store.conn.execute("INSERT INTO xlog_qso_audit(operation_id,qso_id,kind,before_json,after_json,reason) VALUES(?,?,?,?,?,?)", (self._operation, qso_id, kind, canonical(before), canonical(after), reason))

    @staticmethod
    def matrices(store):
        return {"countries": store.exec_sql_mult("SELECT CountryPrefix AS value,Band AS band,count(*) AS qsos FROM DXLOG GROUP BY CountryPrefix,Band ORDER BY CountryPrefix,Band"),
                "zones": store.exec_sql_mult("SELECT ZN AS value,Band AS band,count(*) AS qsos FROM DXLOG GROUP BY ZN,Band ORDER BY ZN,Band")}

    @staticmethod
    def export(desk):
        # The pinned plugin writes only inside this explicit private destination.
        with TemporaryDirectory(prefix="export-", dir=Path(desk.database.database).parent) as directory:
            desk.export_directory = Path(directory)
            desk.contest.cabrillo(desk, "utf-8")
            files = list(Path(directory).glob("*.log"))
            require(len(files) == 1, "Plugin export failed", "export_failed")
            require(files[0].stat().st_size <= 512000, "Use a chunked export route for this log", "export_too_large")
            return {"sessionID": desk.state["sessionID"], "revision": desk.state["revision"], "filename": files[0].name,
                    "format": "cabrillo", "content": files[0].read_bytes().decode("utf-8")}
