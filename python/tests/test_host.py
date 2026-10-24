from copy import deepcopy
from datetime import datetime, timedelta
from io import BytesIO
import json
import base64
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
import uuid
from xml.etree import ElementTree

from contest_host.__main__ import MAX_REQUEST, run
from contest_host.host import Host, HostError, Field
from contest_host.rates import calculate_rates, timestamp
from contest_host.upstream import load_plugin
from unittest.mock import patch


def uid():
    return str(uuid.uuid4())


# Test resolutions are input data, never a fallback inside the production host.
CTY = {
    "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
    "K1ABC": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
    "DL1ABC": {"entity": "Germany", "continent": "EU", "cq": 14, "itu": 28, "primary_pfx": "DL"},
    "OM1ABC": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
}


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session = uid()
        self.workspace = uid()
        self.revision = 0
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": uid(), "expectedRevision": 0,
                       "pluginID": "cq_ww_cw", "station": {"Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"},
                       "frequencyHz": 14025000,
                       "settings": {"SentExchange": "15", "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL", "PowerCategory": "LOW"},
                       "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)}}
        self.call("session_create", self.create)

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def mutate(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision, **kwargs})

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def log(self, call="K1ABC", zone="5", minute=0, frequency=14025000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-19 08:{minute:02}:00", frequencyHz=frequency,
                    fields={"callsign": call, "other_2": zone})
        return qso

    def test_actual_plugin_layout_tab_order_and_partial_input(self):
        view = self.read("session_open")["projection"]
        self.assertEqual(view["tabNext"], {"callsign": "sent", "sent": "receive", "receive": "other_2", "other_1": "callsign", "other_2": "callsign"})
        self.assertEqual(view["tabPrevious"]["callsign"], "other_2")
        fields = {row["id"]: row for row in view["fields"]}
        self.assertEqual({key: fields[key]["value"] for key in ("callsign", "sent", "receive", "other_1", "other_2")},
                         {"callsign": "", "sent": "599", "receive": "599", "other_1": "15", "other_2": ""})
        self.assertFalse(fields["other_1"]["visible"])
        self.assertEqual(fields["other_2"]["label"], "CQ Zone")
        self.assertEqual(fields["other_2"]["accessibleName"], "C Q Zone")
        self.mutate("draft_apply", fields={"callsign": "K", "other_2": ""})
        partial = self.read("projection")["projection"]
        self.assertEqual(partial["fields"][0]["value"], "K")
        with self.assertRaises(AttributeError):
            Field("callsign").silentlyIgnoreMissingQtMethod()

    def test_new_session_requires_canonical_station_cq_zone(self):
        params = deepcopy(self.create)
        params["sessionID"] = uid()
        params["workspaceGeneration"] = uid()
        params["station"].pop("CQZone")
        with self.assertRaisesRegex(HostError, "Station CQ zone must be 1 to 40"):
            self.host.new_state(params["sessionID"], params)

    def test_new_session_uses_station_cq_zone_instead_of_duplicate_exchange(self):
        params = deepcopy(self.create)
        params["sessionID"] = uid()
        params["workspaceGeneration"] = uid()
        params["station"]["CQZone"] = "14"
        params["settings"]["SentExchange"] = "5"
        state = self.host.new_state(params["sessionID"], params)
        self.assertEqual(state["station"]["CQZone"], "14")
        self.assertEqual(state["settings"]["SentExchange"], "14")

    def test_catalog_exposes_supported_bands_before_projection(self):
        response = self.call("contest_catalog", {})
        catalog = response["plugins"]
        plugins = {plugin["id"]: plugin for plugin in catalog}
        self.assertFalse(plugins["cq_ww_cw"]["digitalLoggingSupported"])
        self.assertEqual(plugins["trans_tasman"]["supportedBands"], ["160m", "80m", "40m"])
        self.assertEqual(plugins["cq_ww_cw"]["supportedBands"],
                         ["160m", "80m", "40m", "20m", "15m", "10m"])
        bands = {band["id"]: band for band in response["bandDefinitions"]}
        self.assertEqual(bands["1.25m"], {"id": "1.25m", "lowHz": 222_000_000,
                                         "highHz": 225_000_000, "value": 222.0})
        self.assertEqual(bands["13cm"], {"id": "13cm", "lowHz": 2_300_000_000,
                                        "highHz": 2_450_000_000, "value": 2300.0})
        self.assertEqual(set(bands), {band for plugin in plugins.values() for band in plugin["supportedBands"]})

    def test_digital_ingest_rejects_plugin_without_original_handler(self):
        with self.assertRaisesRegex(HostError, "no original digital logging handler") as failure:
            self.mutate("digital_ingest", workspaceGeneration=self.workspace,
                        semanticIdentity="1" * 64,
                        packet={"CALL": "K1ABC", "MODE": "FT8", "FREQ": "14.074000",
                                "QSO_DATE": "20261020", "TIME_ON": "081500"})
        self.assertEqual(failure.exception.code, "digital_unsupported")
        self.assertEqual(self.read("log")["total"], 0)

    def test_commit_restores_default_reports_for_next_draft(self):
        self.mutate("draft_apply", fields={"sent": "579", "receive": "589"})
        self.log()
        fields = {row["id"]: row["value"] for row in self.read("projection")["projection"]["fields"]}
        self.assertEqual((fields["callsign"], fields["sent"], fields["receive"], fields["other_2"]),
                         ("", "599", "599", ""))

    def test_network_publication_ledger_remains_dirty_after_unverified_acknowledgement(self):
        first = self.log(minute=0)
        second = self.log("DL1ABC", "14", minute=1)
        scope = {"workspaceGeneration": self.workspace, "limit": 100}
        pending = self.read("network_pending", **scope)
        self.assertEqual([row["ID"] for row in pending["contacts"]], [first, second])
        self.assertTrue(all(row["Dirty"] == 1 for row in pending["contacts"]))

        # Pinned Renfield also emits this response when a same-second/call
        # INSERT collides. The client must not interpret it as persistence.
        acknowledged = self.read("network_confirm", workspaceGeneration=self.workspace, qsoID=second)
        self.assertEqual(acknowledged["qsoID"], second)
        self.assertTrue(acknowledged["transportAcknowledged"])
        self.assertFalse(acknowledged["persistenceVerified"])
        self.assertFalse(acknowledged["confirmed"])
        self.read("network_confirm", workspaceGeneration=self.workspace, qsoID=second)
        replay = self.read("network_pending", **scope)
        self.assertEqual([row["ID"] for row in replay["contacts"]], [first, second])

        self.host.close()
        self.host = Host(self.root)
        restarted = self.read("network_pending", **scope)
        self.assertEqual([row["ID"] for row in restarted["contacts"]], [first, second])

    def test_network_publication_rejects_stale_foreign_and_unknown_receipts(self):
        qso = self.log()
        with self.assertRaises(HostError) as stale:
            self.read("network_pending", workspaceGeneration=uid(), limit=100)
        self.assertEqual(stale.exception.code, "stale_generation")
        with self.assertRaises(HostError) as unknown:
            self.read("network_confirm", workspaceGeneration=self.workspace, qsoID=uid())
        self.assertEqual(unknown.exception.code, "not_found")
        self.assertEqual([row["ID"] for row in self.read(
            "network_pending", workspaceGeneration=self.workspace, limit=100)["contacts"]], [qso])

    def test_rover_location_is_persisted_for_future_contacts_only(self):
        first = self.log(minute=0)
        changed = self.mutate("rover_location", location="fn20")
        self.assertEqual(changed["projection"]["roverLocation"], "FN20")
        second = self.log(minute=1)
        rows = {row["ID"]: row for row in self.read("log", offset=0, limit=10)["rows"]}
        self.assertEqual(rows[first]["RoverLocation"], "")
        self.assertEqual(rows[second]["RoverLocation"], "FN20")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("session_open")["projection"]["roverLocation"], "FN20")

    def test_rover_location_rejects_blank_and_overlong_values_without_revision_change(self):
        before = self.revision
        for value in ("", " ", "ABCDEFGHIJK"):
            with self.subTest(value=value), self.assertRaises(HostError):
                self.mutate("rover_location", location=value)
            self.assertEqual(self.read("projection")["projection"]["revision"], before)

    def save_esm(self, **preferences):
        setup = self.read("setup_get")["setup"]
        setup["preferences"].update(preferences)
        return self.mutate("setup_save", setup=setup)

    def test_esm_disabled_enter_commits_without_output_and_manual_keys_still_work(self):
        self.save_esm(useESM=False, sendCorrectedCall=False)
        self.mutate("run_state", run=True)
        view = self.mutate("focus", field="other_2")["projection"]
        self.assertFalse(any(key["highlighted"] for key in view["functionKeys"]))
        result = self.mutate("esm", field="other_2", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual(result["actions"], [])
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual([action["key"] for action in self.mutate("function_key", key="F1")["actions"]], ["F1"])
        self.host.close()
        self.host = Host(self.root)
        self.assertFalse(self.read("setup_get")["setup"]["preferences"]["useESM"])

    def test_esm_uses_saved_roles_and_disabled_roles_without_changing_manual_keys(self):
        self.save_esm(useESM=True, esmCQ="F7", esmHisCall="F6", esmExchange="F8", esmQRZ="F10",
                      esmAGN="DISABLED", esmMyCall="F11", esmQsoB4="F12", sendCorrectedCall=False)
        self.mutate("run_state", run=True)
        view = self.read("projection")["projection"]
        self.assertEqual([key["id"] for key in view["functionKeys"] if key["highlighted"]], ["F7"])
        self.assertEqual([action["key"] for action in self.mutate("esm", field="callsign")["actions"]], ["F7"])
        exchange = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC", "other_2": ""})
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F6", "F8"])
        # The configured resend flag suppresses the corrected-call role.
        result = self.mutate("esm", field="other_2", fields={"callsign": "DL1ABC", "other_2": "14"})
        self.assertEqual([action["key"] for action in result["actions"]], ["F10"])
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(self.mutate("esm", field="other_2", fields={"callsign": "K9XYZ", "other_2": ""})["actions"], [])

    def test_esm_rejects_invalid_settings_atomically(self):
        for key, value in [("useESM", "false"), ("useESM", 1), ("sendCorrectedCall", 0),
                           ("esmCQ", "F13"), ("esmExchange", "f3"), ("esmAGN", True)]:
            with self.subTest(key=key, value=value):
                revision = self.revision
                with self.assertRaises(HostError):
                    self.save_esm(**{key: value})
                self.assertEqual(self.read("projection")["projection"]["revision"], revision)

    def test_legacy_esm_defaults_are_explicit_on_restore_and_preserve_existing_behavior(self):
        setup = self.read("setup_get")["setup"]
        self.assertEqual({key: setup["preferences"][key] for key in ("useESM", "sendCorrectedCall", "esmCQ", "esmExchange")},
                         {"useESM": True, "sendCorrectedCall": True, "esmCQ": "F1", "esmExchange": "F3"})
        self.mutate("setup_save", setup=setup)
        self.host.close()
        self.host = Host(self.root)
        self.mutate("run_state", run=True)
        self.assertEqual([action["key"] for action in self.mutate("esm", field="callsign")["actions"]], ["F1"])

    def test_function_key_projection_uses_actual_active_macros(self):
        sandp = {row["id"]: row for row in self.read("projection")["projection"]["functionKeys"]}
        self.assertEqual((sandp["F3"]["label"], sandp["F3"]["template"]), ("Exch", "{RST} {EXCHANGE}"))
        run = self.mutate("run_state", run=True)["projection"]["functionKeys"]
        self.assertEqual((run[3]["label"], run[3]["template"]), ("Run TU", "tu {MYCALL} qrz"))
        self.assertEqual({row["id"]: row for row in run}["F6"]["template"], "{EXCHANGE}")

    def test_rates_read_full_log_with_historical_styles_and_no_mutation(self):
        qso = self.log()
        store = self.host.database(self.session)
        base = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
        store.conn.execute("DELETE FROM DXLOG")
        start = datetime(2026, 10, 19, 8, 0)
        for index in range(150):
            row = {**base, "ID": uid(), "TS": (start + timedelta(seconds=index * 10)).isoformat(" "),
                   "IsRunQSO": index % 2, "Run1Run2": 2}
            store.log_contact(row)
        store.conn.commit()
        revision = self.revision
        with patch("contest_host.host.datetime") as clock:
            clock.now.return_value = timestamp("2026-10-19T08:30:00Z")
            rates = self.read("contest_rates")
        self.assertAlmostEqual(rates["lastHourQsoPerHour"], 150 * 3600 / 1490)
        self.assertAlmostEqual(rates["last10QsoPerHour"], 400)
        self.assertAlmostEqual(rates["last100QsoPerHour"], 100 * 3600 / 990)
        self.assertEqual((rates["sinceHourUTC"], rates["sinceHourQso"]), (8, 149))
        self.assertEqual((rates["runQso"], rates["searchAndPounceQso"]), (75, 75))
        self.assertEqual((rates["hourRunQso"], rates["hourSearchAndPounceQso"]), (75, 74))
        self.assertEqual(rates["revision"], revision)
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"], revision)

    def test_rates_boundaries_iso_timestamps_future_and_malformed_rows(self):
        at = timestamp("2026-10-19T09:30:00Z")
        rows = [{"ID": str(i), "TS": stamp, "IsRunQSO": run} for i, (stamp, run) in enumerate([
            ("2026-10-19 08:30:00", 1), ("2026-10-19T09:00:00Z", 1),
            ("2026-10-19T11:30:00.000+02:00", 0), ("2026-10-19 09:30:01", 1)])]
        rates = calculate_rates(rows, at)
        self.assertEqual(rates, {"lastHourQsoPerHour": 4, "last10QsoPerHour": None,
            "last100QsoPerHour": None, "sinceHourUTC": 9, "sinceHourQso": 1,
            "runQso": 2, "searchAndPounceQso": 1, "hourRunQso": 0, "hourSearchAndPounceQso": 1,
            "hourly": [{"hourUTC": "2026-10-19T08:00:00Z", "qsos": 1},
                       {"hourUTC": "2026-10-19T09:00:00Z", "qsos": 2}],
            "lastQsoAt": "2026-10-19T09:30:00Z"})
        self.assertEqual(calculate_rates(rows, at.replace(minute=0))["sinceHourQso"], 0)
        boundary = [{"ID": "after", "TS": "2026-10-19T09:00:00.001Z", "IsRunQSO": 1}]
        self.assertEqual(calculate_rates(boundary, at)["sinceHourQso"], 1)
        late = [{"ID": "late", "TS": "2026-10-19T23:59:59.999Z", "IsRunQSO": 0}]
        self.assertEqual(calculate_rates(late, timestamp("2026-10-19T23:59:59.999Z"))["sinceHourUTC"], 23)
        midnight = calculate_rates(late, timestamp("2026-10-20T00:00:00Z"))
        self.assertEqual((midnight["sinceHourUTC"], midnight["sinceHourQso"]), (0, 0))
        same = [{"ID": str(i), "TS": "2026-10-19 09:15:00", "IsRunQSO": 0} for i in range(100)]
        self.assertIsNone(calculate_rates(same, at)["last100QsoPerHour"])
        self.assertIsNone(calculate_rates(same, at)["last10QsoPerHour"])
        rows.append({"ID": "bad", "TS": "invalid", "IsRunQSO": 0})
        malformed = calculate_rates(rows, at)
        self.assertIsNone(malformed["lastHourQsoPerHour"])
        self.assertEqual(malformed["sinceHourQso"], 1)
        self.assertIsNone(timestamp(None))

    def test_setup_save_is_durable_revision_fenced_and_idempotent(self):
        setup = self.read("contest_setup_get")["setup"]
        setup.update({"name": "Saved contest", "preferences": {**setup["preferences"], "useESM": True, "bands": ["20m"], "speed": 25},
                      "network": {"enabled": False, "port": 12060},
                      "macros": [{"mode": "R", "key": "F1", "label": "CQ", "template": "cq {MYCALL}"}]})
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision, "setup": setup}
        saved = self.call("contest_setup_save", params)
        self.assertEqual(saved["setup"], setup)
        self.host.close()
        self.host = Host(self.root)
        reopened = self.read("contest_setup_get")
        self.assertEqual({key: reopened[key] for key in ("sessionID", "revision", "setup")},
                         {"sessionID": self.session, "revision": saved["revision"], "setup": setup})
        self.assertEqual(len(reopened["effectiveMacros"]), 24)
        self.assertEqual(next(item for item in reopened["effectiveMacros"]
                              if item["mode"] == "R" and item["key"] == "F1"), setup["macros"][0])
        self.assertTrue(self.call("contest_setup_save", params)["replayed"])
        with self.assertRaises(HostError) as error:
            self.call("contest_setup_save", {**params, "operationID": uid()})
        self.assertEqual(error.exception.code, "stale_revision")
        with self.assertRaises(HostError) as error:
            self.call("contest_setup_save", {**params, "setup": {**setup, "name": "Conflict"}})
        self.assertEqual(error.exception.code, "payload_conflict")

    def test_invalid_setup_rolls_back_and_is_scoped_to_session(self):
        setup = self.read("setup_get")["setup"]
        for update in ({"station": {"Call": True}}, {"preferences": {"nested": {}}},
                       {"network": {"port": float("inf")}}, {"pluginID": "other"},
                       {"macros": [{"mode": [], "key": "F1", "label": "", "template": ""}]},
                       {"name": "x" * 129}):
            with self.subTest(update=update), self.assertRaises((HostError, ValueError)):
                self.mutate("setup_save", setup={**setup, **update})
        self.assertEqual(self.read("setup_get")["revision"], self.revision)
        self.assertEqual(self.read("setup_get")["setup"], setup)
        other = deepcopy(self.create)
        other.update(sessionID=uid(), operationID=uid(), workspaceGeneration=uid())
        self.call("session_create", other)
        self.mutate("setup_save", setup={**setup, "name": "Unique setup"})
        self.assertEqual(self.call("setup_get", {"sessionID": other["sessionID"]})["setup"]["name"], "CQ WW CW")

    def test_setup_applies_contest_configuration_and_effective_macros_after_reopen(self):
        qso = self.log()
        before = self.host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
        setup = self.read("setup_get")["setup"]
        setup.update(name="Operator contest", operator="OM0RX/P", station={**setup["station"], "Call": "OM1ABC", "Name": "Contest operator", "CQZone": "16"},
                     settings={**setup["settings"], "SentExchange": "5", "PowerCategory": "HIGH"},
                     macros=[{"mode": "R", "key": "F1", "label": "My CQ", "template": "cq test {MYCALL}"},
                             {"mode": "S", "key": "F1", "label": "My S&P", "template": "de {MYCALL}"}])
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision, "setup": setup}
        saved = self.call("setup_save", params)
        expected_setup = deepcopy(setup)
        expected_setup["settings"]["SentExchange"] = "16"
        self.assertEqual(saved["projection"]["functionKeys"][0]["label"], "My S&P")
        self.assertEqual(next(field["value"] for field in saved["projection"]["fields"] if field["id"] == "other_1"), "16")
        self.assertEqual(self.call("sessions", {})["sessions"][0]["name"], "Operator contest")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("setup_get")["setup"], expected_setup)
        action = self.mutate("function_key", key="F1")["actions"][0]
        self.assertEqual((action["label"], action["template"], action["stationCall"], action["sentExchange"]),
                         ("My CQ", "cq test {MYCALL}", "OM1ABC", "16"))
        self.assertTrue(self.read("projection")["projection"]["run"])
        action = self.mutate("function_key", key="F1")["actions"][0]
        self.assertEqual((action["label"], action["template"]), ("My CQ", "cq test {MYCALL}"))
        self.assertEqual(self.mutate("function_key", key="F3")["actions"][0]["template"], "{RST} {EXCHANGE}")
        self.assertTrue(self.call("setup_save", params)["replayed"])
        self.assertEqual(self.read("setup_get")["setup"], expected_setup)
        new_qso = self.log("DL1ABC", "14", 1)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual(
            {key: value for key, value in rows[qso].items()
             if key not in {"raw_fields", "change_revision", "is_dupe"}},
            before,
        )
        self.assertEqual(rows[qso]["raw_fields"]["other_2"], "5")
        self.assertEqual((rows[new_qso]["Operator"], rows[new_qso]["StationPrefix"], rows[new_qso]["SentNr"]),
                         ("OM0RX/P", "OM1ABC", 16))
        self.assertEqual((rows[qso]["IsRunQSO"], rows[qso]["Run1Run2"]), (0, 1))

    def test_operator_switch_preserves_setup_and_historical_qso_attribution(self):
        old_qso = self.log()
        before = self.read("setup_get")["setup"]
        switched = {**before, "operator": "OM1ABC/P"}
        saved = self.mutate("setup_save", setup=switched)
        self.assertEqual(saved["setup"], switched)
        self.assertEqual({key: saved["setup"][key] for key in before if key != "operator"},
                         {key: before[key] for key in before if key != "operator"})
        new_qso = self.log("DL1ABC", "14", 1)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual(rows[old_qso]["Operator"], "OM0RX")
        self.assertEqual(rows[new_qso]["Operator"], "OM1ABC/P")

    def test_saved_cqww_mynr_macro_migrates_to_configured_exchange(self):
        setup = self.read("setup_get")["setup"]
        setup["macros"] = [{"mode": "R", "key": "F6", "label": "MyNR", "template": "{SENTNR}"}]
        saved = self.mutate("setup_save", setup=setup)
        effective = next(item for item in saved["effectiveMacros"]
                         if item["mode"] == "R" and item["key"] == "F6")
        self.assertEqual(effective["template"], "{EXCHANGE}")
        self.host.close()
        self.host = Host(self.root)
        self.mutate("run_state", run=True)
        action = self.mutate("function_key", key="F6")["actions"][0]
        self.assertEqual((action["template"], action["sentExchange"], action["sentSerial"]),
                         ("{EXCHANGE}", "15", ""))

    def test_macro_contest_actions_are_separated_from_output_and_owned(self):
        setup = self.read("setup_get")["setup"]
        setup["macros"] = [
            {"mode": "S", "key": "F6", "label": "Reversed", "template": "{SANDP}{RUN}"},
            {"mode": "S", "key": "F7", "label": "Repeated", "template": "{RUN}{SANDP}{RUN} cq {MYCALL}"},
            {"mode": "R", "key": "F8", "label": "Log", "template": "{LOGIT}{WIPE}"},
            {"mode": "R", "key": "F9", "label": "S&P", "template": "{RUN}{SANDP}"},
        ]
        self.mutate("setup_save", setup=setup)
        reversed_actions = self.mutate("function_key", key="F6")
        self.assertTrue(reversed_actions["projection"]["run"])
        self.assertEqual(reversed_actions["actions"], [])
        self.mutate("run_state", run=False)
        repeated = self.mutate("function_key", key="F7")
        self.assertTrue(repeated["projection"]["run"])
        self.assertEqual(repeated["actions"][0]["template"], " cq {MYCALL}")
        logged = self.mutate("function_key", key="F8", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual(logged["actions"], [])
        self.assertEqual(self.read("log")["total"], 1)
        values = {field["id"]: field["value"] for field in logged["projection"]["fields"]}
        self.assertEqual((values["callsign"], values["sent"], values["receive"], values["other_2"]),
                         ("", "599", "599", ""))
        self.assertEqual(values["other_1"], "15")
        sandp = self.mutate("function_key", key="F9")
        self.assertFalse(sandp["projection"]["run"])
        self.assertEqual(sandp["actions"], [])

    def test_macro_setup_explicitly_rejects_external_output_owners(self):
        original = self.read("setup_get")["setup"]
        for token, message in (("{TX}", "radio PTT"), ("{RX}", "radio PTT"),
                               ("{TX/RX}", "radio PTT"), ("{MARK}", "band-map marking"),
                               ("{SPOT}", "cluster spotting"), ("RI:FA;", "xLog owns radio control")):
            setup = deepcopy(original)
            setup["macros"] = [{"mode": "S", "key": "F6", "label": "Unsafe", "template": token}]
            with self.subTest(token=token), self.assertRaisesRegex(RuntimeError, message):
                self.mutate("setup_save", setup=setup)
            self.assertEqual(self.read("setup_get")["setup"], original)

    def test_setup_rejects_invalid_contest_configuration_atomically(self):
        setup = self.read("setup_get")["setup"]
        for update in ({"station": {"Call": "XX1UNKNOWN"}}, {"station": {**setup["station"], "CQZone": "41"}},
                       {"settings": {"SentExchange": "15", "ModeCategory": "SSB"}},
                       {"operator": ""}, {"name": ""}):
            with self.subTest(update=update), self.assertRaises(HostError):
                self.mutate("setup_save", setup={**setup, **update})
            self.assertEqual(self.read("setup_get")["setup"], setup)

    def test_setup_station_change_rescores_without_rewriting_historical_metadata(self):
        qso = self.log()
        setup = self.read("setup_get")["setup"]
        before = self.host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
        self.mutate("setup_save", setup={**setup, "station": {**setup["station"], "Call": "K1ABC"}})
        after = self.host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
        self.assertEqual(after["Points"], 0)
        for key in ("Operator", "StationPrefix", "SentNr", "IsRunQSO", "Run1Run2"):
            self.assertEqual(after[key], before[key])

    def test_main_context_exposes_operator_saved_speed_cty_and_authoritative_score(self):
        setup = self.read("setup_get")["setup"]
        self.mutate("setup_save", setup={**setup, "operator": "OM0RX/P", "preferences": {"cwSpeed": 27}})
        self.log()
        view = self.mutate("draft_apply", fields={"callsign": "DL1ABC"})["projection"]
        self.assertEqual((view["operator"], view["cwSpeedWpm"]), ("OM0RX/P", 27))
        self.assertEqual(view["matrixTrackers"], ["countries", "zones"])
        self.assertEqual(view["score"]["multipliers"], view["score"]["countries"] + view["score"]["zones"])
        self.assertEqual(view["callContext"], {"callsign": "DL1ABC", "entity": "Germany", "country": "Germany",
            "continent": "EU", "cqZone": 14, "ituZone": 28, "primaryPrefix": "DL", "headingDegrees": None,
            "longPathHeadingDegrees": None, "distanceKm": None})
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("projection")["projection"]["callContext"], view["callContext"])
        unknown = self.mutate("draft_apply", fields={"callsign": "XX1UNKNOWN"})["projection"]["callContext"]
        self.assertEqual(unknown["callsign"], "XX1UNKNOWN")
        self.assertTrue(all(value is None for key, value in unknown.items() if key != "callsign"))

    def test_main_context_absent_or_invalid_saved_speed_stays_unknown(self):
        self.assertIsNone(self.read("projection")["projection"]["cwSpeedWpm"])
        setup = self.read("setup_get")["setup"]
        for speed in (True, "25", 0, -1, 101):
            self.assertIsNone(self.mutate("setup_save", setup={**setup, "preferences": {"cwSpeed": speed}})["projection"]["cwSpeedWpm"])

    def test_partial_log_searches_all_rows_with_total_and_not1mm_order(self):
        qso = self.log()
        store = self.host.database(self.session)
        base = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
        start = datetime(2026, 10, 19, 9, 0)
        for index in range(125):
            store.log_contact({**base, "ID": uid(), "TS": (start + timedelta(seconds=index)).isoformat(" "),
                               "Call": f"K{index}ABC"})
        store.log_contact({**base, "ID": uid(), "TS": (start + timedelta(minutes=3)).isoformat(" "), "Call": "YT1A"})
        store.log_contact({**base, "ID": uid(), "TS": (start + timedelta(minutes=4)).isoformat(" "), "Call": "YT1ET"})
        store.conn.commit()
        result = self.read("contest_check_partial", query="abc", limit=120, expectedRevision=self.revision)
        self.assertEqual((result["query"], result["total"], len(result["rows"])), ("ABC", 126, 120))
        self.assertEqual(result["rows"][0]["ID"], qso)
        self.assertEqual(result["rows"][-1]["Call"], "K118ABC")
        self.assertIn("K124ABC", [row["Call"] for row in self.read("check_partial", query="124")["rows"]])
        self.assertEqual([row["Call"] for row in self.read("check_partial", query="YT1E")["rows"]], ["YT1A", "YT1ET"])
        self.assertEqual(self.read("check_partial", query="NOTFOUND")["total"], 0)
        row = result["rows"][0]
        self.assertTrue({"TS", "Call", "Freq", "SNT", "RCV", "SentNr", "ZN", "WPXPrefix", "CountryPrefix", "Points"} <= set(row))
        self.assertGreater(row["change_revision"], 0)
        self.assertEqual(result["rows"][-1]["change_revision"], 0)
        newest = self.read("log", limit=1)["rows"][0]
        self.assertEqual((newest["Freq"], newest["change_revision"]), (14025, 0))
        self.assertEqual(self.read("check_partial", query="ABC")["revision"], self.revision)
        self.mutate("draft_apply", fields={"callsign": "DL1ABC"})
        with self.assertRaises(HostError) as error:
            self.read("check_partial", query="ABC", expectedRevision=self.revision - 1)
        self.assertEqual(error.exception.code, "stale_revision")
        for params in ({"query": "%"}, {"query": ""}, {"query": "AB"}, {"query": "ABC", "limit": 501}, {"query": "ABC", "limit": True}):
            with self.subTest(params=params), self.assertRaises(HostError):
                self.read("check_partial", **params)

    def test_country_additions_require_the_session_reference_identity(self):
        country = {"VK1ABC": {"entity": "Australia", "continent": "OC", "cq": 30,
                              "itu": 59, "primary_pfx": "VK"}}
        before = self.revision
        with self.assertRaises(HostError) as error:
            self.mutate("draft_apply", fields={"callsign": "VK1ABC"}, countries=country,
                        referenceID="test-cty-v2")
        self.assertEqual(error.exception.code, "reference_mismatch")
        self.assertEqual(self.read("projection")["projection"]["revision"], before)
        accepted = self.mutate("draft_apply", fields={"callsign": "VK1ABC"}, countries=country,
                               referenceID="test-cty-v1")
        self.assertTrue(accepted["projection"]["countryResolved"])

    def test_session_catalog_reopens_owned_python_sessions(self):
        catalog = self.call("sessions", {})
        self.assertEqual(catalog["sessions"], [{"sessionID": self.session, "name": "CQ WW CW",
                                               "workspaceGeneration": self.workspace,
                                               "pluginID": "cq_ww_cw",
                                               "sourceRevision": "7c8b499225a73f7f8f792246881bd7aefc05452f",
                                               "revision": self.revision}])
        self.assertEqual(catalog["activeSessionID"], self.session)
        self.host.close()
        self.host = Host(self.root)
        reopened = self.call("contest_sessions", {})
        self.assertEqual(reopened["sessions"][0]["sessionID"], self.session)
        self.assertEqual(reopened["activeSessionID"], self.session)

    def test_session_catalog_retains_the_last_opened_session_across_restart(self):
        other = uid()
        create = {**self.create, "sessionID": other, "workspaceGeneration": uid(),
                  "operationID": uid(), "expectedRevision": 0}
        self.call("session_create", create)
        self.assertEqual(self.call("sessions", {})["activeSessionID"], other)
        self.call("session_open", {"sessionID": self.session})
        self.assertEqual(self.call("sessions", {})["activeSessionID"], self.session)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.call("sessions", {})["activeSessionID"], self.session)

    def test_session_catalog_ignores_a_malformed_active_marker(self):
        marker = self.root / "active-session.json"
        marker.write_text('["not", "a", "session"]', encoding="utf-8")
        catalog = self.call("sessions", {})
        self.assertEqual([item["sessionID"] for item in catalog["sessions"]], [self.session])
        self.assertIsNone(catalog["activeSessionID"])

    def test_actual_score_dupe_and_band_semantics(self):
        self.log()
        self.log("DL1ABC", "14", 1)
        self.assertEqual(self.read("score")["score"], {"qsos": 2, "points": 4, "countries": 2, "zones": 2, "multipliers": 4, "total": 16})
        self.log(minute=2)
        self.assertEqual(self.read("score")["score"]["points"], 4)
        self.log(minute=3, frequency=7025000)
        self.assertEqual(self.read("score")["score"]["points"], 7)
        self.assertEqual(self.read("score")["score"]["total"], 42)
        self.assertEqual(len(self.read("score")["matrices"]["zones"]), 3)

    def test_rtc_payload_is_original_plugin_xml_and_generation_bound(self):
        self.log()
        result = self.read("rtc_payload", workspaceGeneration=self.workspace)
        self.assertEqual(result["sessionID"], self.session)
        self.assertEqual(result["workspaceGeneration"], self.workspace)
        self.assertIn("<dynamicresults>", result["xml"])
        self.assertIn("<contest>CQ-WW-CW</contest>", result["xml"])
        self.assertIn("<call>OM0RX</call>", result["xml"])
        self.assertIn("<score>6</score>", result["xml"])
        with self.assertRaises(HostError) as stale:
            self.read("rtc_payload", workspaceGeneration=uid())
        self.assertEqual(stale.exception.code, "stale_generation")

    def test_rtc_payload_escapes_dynamic_text_and_remains_well_formed(self):
        setup = self.read("setup_get")["setup"]
        setup["station"] = {**setup["station"], "Club": "A&B <Contesters>"}
        self.mutate("setup_save", setup=setup)
        payload = self.read("rtc_payload", workspaceGeneration=self.workspace)["xml"]
        root = ElementTree.fromstring(payload)
        self.assertEqual(root.tag, "dynamicresults")
        self.assertEqual(root.findtext("club"), "A&B <Contesters>")
        self.assertIn("A&amp;B &lt;Contesters&gt;", payload)

    def test_rtc_payload_rejects_malformed_or_incomplete_plugin_xml(self):
        plugin = load_plugin("cq_ww_cw")
        for payload in ("<dynamicresults><call>OM0RX</dynamicresults>",
                        "<dynamicresults><contest>CQ-WW-CW</contest></dynamicresults>"):
            with self.subTest(payload=payload), patch.object(plugin, "online_score_xml", return_value=payload):
                with self.assertRaises(HostError) as error:
                    self.read("rtc_payload", workspaceGeneration=self.workspace)
                self.assertEqual(error.exception.code, "rtc_payload_invalid")

    def test_manual_recalculation_repairs_derived_points_without_changing_draft(self):
        qso = self.log()
        self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_2": "14"})
        before = self.read("projection")["projection"]
        store = self.host.database(self.session)
        store.conn.execute("UPDATE DXLOG SET Points=99, IsMultiplier1=0, IsMultiplier2=0 WHERE ID=?", (qso,))
        store.conn.commit()
        repaired = self.mutate("recalculate")
        row = self.read("log")["rows"][0]
        self.assertEqual(row["Points"], 3)
        self.assertEqual(repaired["projection"]["fields"], before["fields"])
        self.assertEqual(repaired["projection"]["draftID"], before["draftID"])
        self.assertEqual(repaired["revision"], before["revision"] + 1)

    def test_native_esm_batch_preserves_frozen_call_after_log_and_consumes_output_once(self):
        result = self.mutate("esm", field="other_2", fields={"callsign":"K1ABC", "sent":"579", "other_2":"5"}, frequencyHz=14025000)
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(result["projection"]["fields"][0]["value"], "")
        self.assertEqual(result["actions"][0]["fields"]["callsign"], "K1ABC")
        self.assertEqual(result["actions"][0]["fields"]["sent"], "579")
        self.assertEqual(result["actions"][0]["key"], "F3")
        self.assertEqual(result["actions"][0]["template"], "{RST} {EXCHANGE}")
        claimed = self.read("output_claim", operationID=result["operationID"], revision=result["revision"])
        self.assertEqual(claimed["actions"], result["actions"])
        self.host.close(); self.host = Host(self.root)
        with self.assertRaises(HostError) as error:
            self.read("output_claim", operationID=result["operationID"], revision=result["revision"])
        self.assertEqual(error.exception.code, "output_consumed")
        self.assertEqual(self.read("receipt", operationID=result["operationID"])["result"]["actions"], [])

    def test_native_output_claim_rejects_a_newer_session_revision(self):
        result = self.mutate("function_key", key="F1", fields={"callsign":"K1ABC"}, frequencyHz=14025000)
        self.mutate("draft_apply", fields={"callsign":"DL1ABC"})
        with self.assertRaises(HostError) as error:
            self.read("output_claim", operationID=result["operationID"], revision=result["revision"])
        self.assertEqual(error.exception.code, "stale_revision")

    def test_pinned_not1mm_macros_follow_run_and_search_and_pounce(self):
        sandp = self.mutate("function_key", key="F3")
        self.assertEqual(sandp["actions"][0]["template"], "{RST} {EXCHANGE}")
        self.mutate("run_state", run=True)
        run = self.mutate("function_key", key="F4")
        self.assertEqual(run["actions"][0]["label"], "Run TU")
        self.assertEqual(run["actions"][0]["template"], "tu {MYCALL} qrz")

    def test_esm_roles_follow_not1mm_preferences_in_run_and_search_and_pounce(self):
        sandp_call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        self.assertEqual([(item["key"], item["template"]) for item in sandp_call["actions"]],
                         [("F5", "{MYCALL}")])
        sandp_exchange = self.mutate("esm", field="other_2", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual([(item["key"], item["template"]) for item in sandp_exchange["actions"]],
                         [("F3", "{RST} {EXCHANGE}")])
        self.assertEqual(self.read("log")["total"], 1)

        self.mutate("run_state", run=True)
        run_call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC", "other_2": ""})
        self.assertEqual([(item["key"], item["template"]) for item in run_call["actions"]],
                         [("F2", "{CALL}"), ("F3", "{RST} {EXCHANGE}")])
        run_exchange = self.mutate("esm", field="other_2", fields={"callsign": "DL1ABC", "other_2": "14"})
        self.assertEqual([(item["key"], item["template"]) for item in run_exchange["actions"]],
                         [("F4", "tu {MYCALL} qrz")])
        self.assertEqual(self.read("log")["total"], 2)

    def test_correction_and_delete_promote_duplicate(self):
        first = self.log()
        second = self.log(minute=1)
        self.mutate("qso_correct", qsoID=first, fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Correct copied call")
        self.assertEqual(self.read("score")["score"]["total"], 16)
        self.mutate("qso_correct", qsoID=first, fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual(self.read("score")["score"]["points"], 3)
        self.mutate("qso_delete", qsoID=first, reason="Remove test QSO")
        rows = self.read("log")["rows"]
        self.assertEqual([(r["ID"], r["Points"]) for r in rows], [(second, 3)])
        store = self.host.database(self.session)
        self.assertEqual(store.exec_sql("SELECT deleted FROM xlog_qso_identity WHERE id=?", (first,))["deleted"], 1)
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_qso_audit")["n"], 5)

    def test_replay_conflict_reopen_and_receipt(self):
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "qsoID": uid(), "timestamp": "2026-10-19 08:00:00", "fields": {"callsign": "K1ABC", "other_2": "5"}}
        original = self.call("qso_commit", params)
        replay = self.call("qso_commit", params)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["revision"], original["revision"])
        self.host.close()
        self.host = Host(self.root)
        self.assertTrue(self.call("qso_commit", params)["replayed"])
        self.assertEqual(self.read("log")["total"], 1)
        self.assertTrue(self.read("receipt", operationID=params["operationID"])["found"])
        conflict = deepcopy(params)
        conflict["fields"]["other_2"] = "6"
        with self.assertRaises(HostError) as error:
            self.call("qso_commit", conflict)
        self.assertEqual(error.exception.code, "payload_conflict")
        self.assertTrue(self.call("session_create", self.create)["replayed"])

    def test_process_death_before_and_after_commit_keeps_exact_retry_safe(self):
        for stage, minute in (("before", 10), ("after", 11)):
            params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                      "qsoID": uid(), "timestamp": f"2026-10-19 08:{minute:02}:00",
                      "fields": {"callsign": "K1ABC", "other_2": "5"}}
            program = "\n".join([
                "import json, os, sys",
                "from contest_host.host import Host",
                "from contest_host.store import Store",
                "original = Store.finish",
                "def interrupted(self, success):",
                f"    if success and {stage!r} == 'before': os._exit(71)",
                "    original(self, success)",
                "    if success: os._exit(72)",
                "Store.finish = interrupted",
                "Host(sys.argv[1]).dispatch(json.loads(sys.stdin.read()))",
            ])
            request = {"id": uid(), "method": "qso_commit", "params": params}
            child = subprocess.run([sys.executable, "-c", program, str(self.root)],
                                   input=json.dumps(request).encode(), capture_output=True)
            self.assertEqual(child.returncode, 71 if stage == "before" else 72, child.stderr)
            receipt = self.read("receipt", operationID=params["operationID"])
            self.assertEqual(receipt["found"], stage == "after")
            result = self.call("qso_commit", params)
            self.assertEqual(result["replayed"], stage == "after")
        self.assertEqual(self.read("log")["total"], 2)

    def test_identity_collision_and_cross_engine_rejection(self):
        qso_id = self.log()
        with self.assertRaises(HostError) as error:
            self.mutate("qso_commit", qsoID=qso_id, timestamp="2026-10-19 09:00:00",
                        fields={"callsign": "DL1ABC", "other_2": "14"})
        self.assertEqual(error.exception.code, "qso_collision")
        store = self.host.database(self.session)
        state = store.state(self.session)
        state["engine"] = "legacy-swift"
        store.save_state(state)
        store.conn.commit()
        with self.assertRaises(HostError) as error:
            self.read("session_open")
        self.assertEqual(error.exception.code, "engine_mismatch")

    def test_existing_foreign_or_hardlinked_database_is_never_initialized(self):
        foreign_id = uid()
        directory = self.root / foreign_id
        directory.mkdir()
        foreign = directory / "contest.sqlite"
        connection = sqlite3.connect(foreign)
        connection.execute("CREATE TABLE normal_logbook(id TEXT)")
        connection.commit()
        connection.close()
        with self.assertRaises(HostError) as error:
            self.call("session_open", {"sessionID": foreign_id})
        self.assertEqual(error.exception.code, "unsafe_database")
        connection = sqlite3.connect(foreign)
        self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("normal_logbook",)])
        connection.close()
        linked_id = uid()
        linked_dir = self.root / linked_id
        linked_dir.mkdir()
        os.link(self.root / self.session / "contest.sqlite", linked_dir / "contest.sqlite")
        with self.assertRaises(HostError) as error:
            self.call("session_open", {"sessionID": linked_id})
        self.assertEqual(error.exception.code, "unsafe_database")

    def test_session_discovery_survives_rejected_create_and_incomplete_stores(self):
        rejected = uid()
        with self.assertRaises(HostError):
            self.call("session_create", {**self.create, "sessionID": rejected,
                                        "operationID": uid(), "pluginID": "unsupported"})
        self.assertIsNone(self.host.database(rejected).state(rejected))
        missing = self.root / uid()
        missing.mkdir()
        foreign = self.root / uid()
        foreign.mkdir()
        foreign_path = foreign / "contest.sqlite"
        with sqlite3.connect(foreign_path) as connection:
            connection.execute("CREATE TABLE normal_logbook(id TEXT)")
        corrupt = self.root / uid()
        corrupt.mkdir()
        (corrupt / "contest.sqlite").write_bytes(b"not a sqlite database")
        foreign_before = foreign_path.read_bytes()
        # Restart to exercise discovery through disk, rather than cached stores.
        self.host.close()
        self.host = Host(self.root)
        sessions = self.call("sessions", {})["sessions"]
        self.assertEqual([session["sessionID"] for session in sessions], [self.session])
        self.assertEqual(self.read("session_open")["projection"]["sessionID"], self.session)
        self.assertEqual(foreign_path.read_bytes(), foreign_before)
        self.assertFalse((missing / "contest.sqlite").exists())
        self.assertEqual((corrupt / "contest.sqlite").read_bytes(), b"not a sqlite database")
        with self.assertRaises(HostError) as error:
            self.call("session_open", {"sessionID": rejected})
        self.assertEqual(error.exception.code, "not_found")

    def test_session_discovery_isolates_malformed_json_state_and_explicit_open_rejects_it(self):
        valid = self.host.database(self.session).state(self.session)
        malformed = [[], {}, {**valid, "pluginID": []}]
        for key in ("revision", "sessionID", "draft", "station", "settings", "reference", "operator", "focus", "run"):
            state = deepcopy(valid)
            del state[key]
            malformed.append(state)
        malformed.append({**valid, "draft": {}})
        for state in malformed:
            with self.subTest(state=state):
                session = uid()
                store = self.host.database(session, create=True)
                store.conn.execute("INSERT INTO xlog_session VALUES(?,?)", (session, json.dumps(state)))
                store.conn.commit()
                self.assertEqual([item["sessionID"] for item in self.call("sessions", {})["sessions"]], [self.session])
                with self.assertRaises(HostError):
                    self.call("session_open", {"sessionID": session})
                self.assertEqual(store.exec_sql("SELECT state FROM xlog_session WHERE id=?", (session,))["state"], json.dumps(state))

    def test_session_discovery_never_repairs_malformed_store_after_restart(self):
        malformed = uid()
        store = self.host.database(malformed, create=True)
        store.conn.execute("INSERT INTO xlog_session VALUES(?,?)", (malformed, "[]"))
        store.conn.execute("DROP TABLE xlog_serial")
        store.conn.commit()
        self.host.close()
        path = self.root / malformed / "contest.sqlite"
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as connection:
            schema_before = connection.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").fetchall()
        self.host = Host(self.root)
        self.assertEqual([item["sessionID"] for item in self.call("sessions", {})["sessions"]], [self.session])
        self.assertFalse(self.host.stores)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as connection:
            self.assertEqual(connection.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").fetchall(), schema_before)
            self.assertIsNone(connection.execute("SELECT name FROM sqlite_master WHERE name='xlog_serial'").fetchone())
            self.assertEqual(connection.execute("SELECT state FROM xlog_session").fetchone(), ("[]",))

    def test_atomic_rollback_on_sql_error_and_timestamp_collision(self):
        self.log()
        before = self.read("projection")["projection"]["revision"]
        with self.assertRaises(HostError) as error:
            self.log()
        self.assertEqual(error.exception.code, "qso_collision")
        self.assertEqual(self.read("projection")["projection"]["revision"], before)
        store = self.host.database(self.session)
        store.conn.execute("CREATE TRIGGER fail_receipt BEFORE INSERT ON xlog_operation BEGIN SELECT RAISE(ABORT,'injected'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.log("DL1ABC", "14", 1)
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_qso_audit")["n"], 1)

    def test_log_pages_are_recent_first_and_qso_101_can_be_corrected(self):
        base = datetime(2026, 10, 19, 8, 0, 0)
        contacts = []
        for index in range(201):
            qso = uid()
            timestamp = (base + timedelta(seconds=index)).strftime("%Y-%m-%d %H:%M:%S")
            self.mutate("qso_commit", qsoID=qso, timestamp=timestamp, frequencyHz=14025000,
                        fields={"callsign": "K1ABC", "other_2": "5"})
            contacts.append(qso)
        recent = self.read("log", offset=0, limit=100)
        self.assertEqual((recent["offset"], recent["limit"], recent["total"]), (0, 100, 201))
        self.assertEqual(recent["rows"][0]["ID"], contacts[-1])
        self.assertEqual(recent["rows"][-1]["ID"], contacts[101])
        middle = self.read("log", offset=100, limit=100)
        self.assertEqual(middle["rows"][0]["ID"], contacts[100])
        qso_101 = middle["rows"][0]["ID"]
        self.mutate("qso_correct", qsoID=qso_101, fields={"other_2": "6"}, reason="QSO 101 correction")
        corrected = self.read("log", offset=100, limit=100)
        self.assertEqual((corrected["rows"][0]["ID"], corrected["rows"][0]["ZN"]), (qso_101, 6))

    def test_log_page_ties_follow_commit_order_and_revision_fence(self):
        first = "ffffffff-ffff-4fff-8fff-ffffffffffff"
        second = "00000000-0000-4000-8000-000000000000"
        timestamp = "2026-10-19 08:00:00"
        self.mutate("qso_commit", qsoID=first, timestamp=timestamp, frequencyHz=14025000,
                    fields={"callsign": "K1ABC", "other_2": "5"})
        self.mutate("qso_commit", qsoID=second, timestamp=timestamp, frequencyHz=14025000,
                    fields={"callsign": "DL1ABC", "other_2": "14"})
        revision = self.revision
        self.assertEqual([row["ID"] for row in self.read("log", expectedRevision=revision)["rows"]], [second, first])
        self.mutate("draft_apply", fields={"callsign": "OM1ABC"})
        with self.assertRaises(HostError) as error:
            self.read("log", expectedRevision=revision)
        self.assertEqual(error.exception.code, "stale_revision")

    def test_correction_updates_operator_fields_without_changing_historical_run_metadata(self):
        qso = self.log()
        store = self.host.database(self.session)
        sentinels = {"QSXFreq": 14123, "Mode": "SSB", "ContestName": "HIST",
                     "StationPrefix": "HIST", "RadioNR": 2, "ContactType": "X",
                     "NetworkedCompNr": 7, "NetBiosName": "OLD-NODE", "IsOriginal": 0}
        store.conn.execute("UPDATE DXLOG SET " + ",".join(f"{key}=?" for key in sentinels) + " WHERE ID=?",
                           (*sentinels.values(), qso))
        store.conn.commit()
        before = self.read("log", limit=1)["rows"][0]
        self.assertEqual(before["IsRunQSO"], 0)
        self.mutate("run_state", run=True)
        self.mutate("qso_correct", qsoID=qso, timestamp="2026-10-19 09:15:30", frequencyHz=7025000,
                    operator="OM0RX/P", fields={"callsign": "DL1ABC", "sent": "579", "receive": "589",
                    "other_1": "16", "other_2": "14"}, reason="Correct paper log")
        after = self.read("log", limit=1)["rows"][0]
        self.assertEqual(after["TS"], "2026-10-19 09:15:30")
        self.assertEqual(after["Freq"], 7025)
        self.assertEqual(after["Band"], 7)
        self.assertEqual(after["Operator"], "OM0RX/P")
        self.assertEqual((after["Call"], after["SNT"], after["RCV"], after["SentNr"], after["ZN"]),
                         ("DL1ABC", "579", "589", 16, 14))
        self.assertEqual(after["IsRunQSO"], 0)
        self.assertEqual(after["Run1Run2"], before["Run1Run2"])
        for key, value in sentinels.items():
            self.assertEqual(after[key], value, key)
        allowed = {"TS", "Call", "Freq", "Band", "Operator", "SNT", "RCV", "SentNr", "ZN", "NR",
                   "CountryPrefix", "Continent", "WPXPrefix", "Points", "IsMultiplier1", "IsMultiplier2",
                   "isMultiplier3", "Dirty", "raw_fields", "change_revision"}
        self.assertLessEqual({key for key in before if before[key] != after[key]}, allowed)
        audit = store.exec_sql(
            "SELECT before_json,after_json FROM xlog_qso_audit WHERE qso_id=? AND kind='correct'", (qso,))
        self.assertEqual(json.loads(audit["before_json"]),
                         {key: value for key, value in before.items()
                          if key not in {"raw_fields", "change_revision", "is_dupe"}})
        self.assertEqual(json.loads(audit["after_json"]),
                         {key: value for key, value in after.items()
                          if key not in {"raw_fields", "change_revision", "is_dupe"}})

    def test_correction_updates_contact_metadata_and_preserves_it_on_unchanged_save(self):
        qso = self.log()
        self.mutate("qso_correct", qsoID=qso, fields={"Name": "Alice", "QTH": "Darwin", "Comment": "Paper log"})
        edited = self.read("log", limit=1)["rows"][0]
        self.assertEqual((edited["Name"], edited["QTH"], edited["Comment"]),
                         ("Alice", "Darwin", "Paper log"))
        self.assertEqual({key: edited["raw_fields"][key] for key in ("Name", "QTH", "Comment")},
                         {"Name": "Alice", "QTH": "Darwin", "Comment": "Paper log"})

        self.mutate("qso_correct", qsoID=qso, fields={})
        unchanged = self.read("log", limit=1)["rows"][0]
        self.assertEqual((unchanged["Name"], unchanged["QTH"], unchanged["Comment"]),
                         ("Alice", "Darwin", "Paper log"))
        self.assertEqual({key: unchanged["raw_fields"][key] for key in ("Name", "QTH", "Comment")},
                         {"Name": "Alice", "QTH": "Darwin", "Comment": "Paper log"})

    def test_unknown_country_retained_and_station_country_required(self):
        self.log("XX1TEST", "10")
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(self.read("score")["score"]["points"], 0)
        bad = deepcopy(self.create)
        bad.update(sessionID=uid(), operationID=uid())
        bad["reference"]["countries"].pop("OM0RX")
        with self.assertRaises(HostError) as error:
            self.call("session_create", bad)
        self.assertEqual(error.exception.code, "station_country_unresolved")

    def test_actual_esm_actions_are_intents_and_never_replayed(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "5"})
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision, "field": "other_2"}
        result = self.call("esm", params)
        self.assertEqual([a["key"] for a in result["actions"]], ["F3"])
        self.assertEqual(result["actions"][0]["template"], "{RST} {EXCHANGE}")
        self.assertEqual(result["actions"][0]["fields"]["callsign"], "K1ABC")
        self.assertEqual(result["projection"]["score"]["qsos"], 1)
        self.assertEqual(self.call("esm", params)["actions"], [])
        self.assertEqual(self.read("session_open")["projection"]["fields"][0]["value"], "")

    def test_cw_context_is_host_owned_and_tracks_the_active_draft(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "5"})
        context = self.read("cw_context")
        self.assertEqual(context["stationCall"], "OM0RX")
        self.assertEqual(context["fields"]["callsign"], "K1ABC")
        self.assertEqual(context["fields"]["other_1"], "15")
        self.assertEqual(context["fields"]["other_2"], "5")
        self.assertEqual(context["cwFormatting"], {"cwSpeedStep": 1, "cwRSTFormat": "5NN",
            "cwSerialPaddingCharacter": "T", "cwSerialPaddingLength": 3,
            "cwSerialOne": "1", "cwSerialNine": "9", "cwSerialZero": "0"})
        setup = self.read("setup_get")["setup"]
        preferences = {**setup["preferences"], "cwSpeedStep": 5, "cwRSTFormat": "ENN",
                       "cwSerialPaddingCharacter": "O", "cwSerialPaddingLength": 4,
                       "cwSerialOne": "A", "cwSerialNine": "N", "cwSerialZero": "T"}
        self.mutate("setup_save", setup={**setup, "preferences": preferences})
        configured = self.read("cw_context")
        self.assertEqual(configured["cwFormatting"], {key: preferences[key] for key in (
            "cwSpeedStep", "cwRSTFormat", "cwSerialPaddingCharacter", "cwSerialPaddingLength",
            "cwSerialOne", "cwSerialNine", "cwSerialZero")})
        self.assertEqual(configured["fields"]["other_1"], "15")

    def test_setup_rejects_out_of_range_cw_formatting_preferences(self):
        setup = self.read("setup_get")["setup"]
        invalid = ({"cwSpeedStep": 0}, {"cwSpeedStep": True}, {"cwRSTFormat": "NNN"},
                   {"cwSerialPaddingCharacter": "A"}, {"cwSerialPaddingLength": 11},
                   {"cwSerialOne": "T"}, {"cwSerialNine": "A"}, {"cwSerialZero": "N"})
        for update in invalid:
            with self.subTest(update=update), self.assertRaises(HostError):
                self.mutate("setup_save", setup={**setup, "preferences": {**setup["preferences"], **update}})

    def test_export_actual_plugin_and_no_home_write(self):
        self.log()
        self.log("DL1ABC", "14", 1)
        export = self.read("export")
        self.assertIn("CONTEST: CQ-WW-CW\r\n", export["content"])
        self.assertIn("CLAIMED-SCORE: 16\r\n", export["content"])
        lines = [line for line in export["content"].splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0].split()[1], "14025")
        self.assertTrue(export["content"].endswith("END-OF-LOG:\r\n"))
        self.assertEqual(list((self.root / self.session).glob("export-*")), [])

    def test_prepared_export_is_chunked_verified_and_explicitly_released(self):
        self.log()
        prepared = self.read("export_prepare")
        self.assertEqual(prepared["workspaceGeneration"], self.workspace)
        chunk = self.read("export_read", exportID=prepared["artifactID"],
                          workspaceGeneration=self.workspace, offset=0, length=prepared["byteLength"])
        payload = base64.b64decode(chunk["dataBase64"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), prepared["sha256"])
        self.assertTrue(chunk["eof"])
        self.assertTrue(self.read("export_release", exportID=prepared["artifactID"],
                                  workspaceGeneration=self.workspace)["released"])
        with self.assertRaises(HostError) as error:
            self.read("export_read", exportID=prepared["artifactID"],
                      workspaceGeneration=self.workspace, offset=0, length=prepared["byteLength"])
        self.assertEqual(error.exception.code, "not_found")

    def test_prepared_adif_uses_original_plugin_inside_private_destination(self):
        self.log()
        prepared = self.read("export_prepare", format="adif")
        self.assertEqual(prepared["format"], "adif")
        self.assertTrue(prepared["filename"].endswith(".adi"))
        chunk = self.read("export_read", exportID=prepared["artifactID"],
                          workspaceGeneration=self.workspace, offset=0, length=prepared["byteLength"])
        payload = base64.b64decode(chunk["dataBase64"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), prepared["sha256"])
        content = payload.decode("utf-8")
        self.assertIn("Not1MM ADIF export\r\n", content)
        self.assertIn("<CALL:5>K1ABC", content)
        self.assertIn("<CONTEST_ID:8>CQ-WW-CW", content)
        self.assertIn("<EOR>", content)
        self.assertEqual(list((self.root / self.session).glob("export-*")), [])
        self.assertTrue(self.read("export_release", exportID=prepared["artifactID"],
                                  workspaceGeneration=self.workspace)["released"])

    def test_prepared_export_rejects_unknown_format(self):
        with self.assertRaises(HostError) as error:
            self.read("export_prepare", format="json")
        self.assertEqual(error.exception.code, "invalid_request")

    def test_prepared_export_above_inline_limit_contains_every_qso_and_end_marker(self):
        self.log()
        store = self.host.database(self.session)
        seed = store.exec_sql("SELECT * FROM DXLOG LIMIT 1")
        columns = list(seed)
        statement = f"INSERT INTO DXLOG ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})"
        base = datetime(2026, 10, 20, 0, 0, 0)
        expected_calls = [seed["Call"]]
        for index in range(7001):
            row = deepcopy(seed)
            row["ID"] = uid()
            row["TS"] = (base + timedelta(seconds=index)).strftime("%Y-%m-%d %H:%M:%S")
            row["Call"] = f"K{index:05d}"
            expected_calls.append(row["Call"])
            store.conn.execute(statement, tuple(row[column] for column in columns))
        store.conn.commit()
        with self.assertRaises(HostError) as error:
            self.read("export")
        self.assertEqual(error.exception.code, "export_too_large")
        prepared = self.read("export_prepare")
        self.assertGreater(prepared["byteLength"], 512000)
        payload = bytearray()
        while len(payload) < prepared["byteLength"]:
            length = min(65536, prepared["byteLength"] - len(payload))
            offset = len(payload)
            chunk = self.read("export_read", exportID=prepared["artifactID"],
                              workspaceGeneration=self.workspace, offset=offset, length=length)
            self.assertEqual(chunk["offset"], offset)
            self.assertEqual(chunk["eof"], offset + length == prepared["byteLength"])
            payload.extend(base64.b64decode(chunk["dataBase64"]))
        self.assertEqual(hashlib.sha256(payload).hexdigest(), prepared["sha256"])
        content = payload.decode("utf-8")
        qso_lines = [line for line in content.splitlines() if line.startswith("QSO:")]
        self.assertEqual([line.split()[8] for line in qso_lines], expected_calls)
        self.assertTrue(content.endswith("END-OF-LOG:\r\n"))
        self.assertTrue(self.read("export_release", exportID=prepared["artifactID"],
                                  workspaceGeneration=self.workspace)["released"])
        with self.assertRaises(HostError) as error:
            self.read("export_read", exportID=prepared["artifactID"],
                      workspaceGeneration=self.workspace, offset=0, length=1)
        self.assertEqual(error.exception.code, "not_found")

    def test_bounded_serial_jsonl_and_real_process(self):
        requests = b'{bad json}\n' + json.dumps({"id": "r1", "method": "contest_catalog", "params": {}}).encode() + b"\n"
        output = BytesIO()
        self.assertEqual(run(BytesIO(requests), output, self.host), 0)
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertFalse(replies[0]["ok"])
        self.assertEqual(replies[1]["id"], "r1")
        self.assertEqual(run(BytesIO(b"x" * (MAX_REQUEST + 1)), BytesIO(), self.host), 2)
        child = subprocess.run([sys.executable, "-m", "contest_host", "--data-root", str(self.root)],
                               input=requests, capture_output=True, check=True)
        self.assertEqual(len(child.stdout.splitlines()), 2)
        self.assertTrue(json.loads(child.stdout.splitlines()[1])["ok"])
        launcher = Path(__file__).resolve().parents[1] / "contest_host/launcher.py"
        isolated = subprocess.run([sys.executable, "-I", "-B", str(launcher), "--data-root", str(self.root)],
                                  input=requests, capture_output=True, check=True)
        self.assertTrue(json.loads(isolated.stdout.splitlines()[1])["ok"])


if __name__ == "__main__":
    unittest.main()
