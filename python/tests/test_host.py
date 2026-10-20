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

from contest_host.__main__ import MAX_REQUEST, run
from contest_host.host import Host, HostError, Field
from contest_host.rates import calculate_rates, timestamp
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
                       "pluginID": "cq_ww_cw", "station": {"Call": "OM0RX", "GridSquare": "JN88"},
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

    def test_new_session_requires_explicit_sent_exchange(self):
        params = deepcopy(self.create)
        params["sessionID"] = uid()
        params["workspaceGeneration"] = uid()
        params["settings"].pop("SentExchange")
        with self.assertRaisesRegex(HostError, "Sent CQ zone must be 1 to 40"):
            self.host.new_state(params["sessionID"], params)

    def test_commit_restores_default_reports_for_next_draft(self):
        self.mutate("draft_apply", fields={"sent": "579", "receive": "589"})
        self.log()
        fields = {row["id"]: row["value"] for row in self.read("projection")["projection"]["fields"]}
        self.assertEqual((fields["callsign"], fields["sent"], fields["receive"], fields["other_2"]),
                         ("", "599", "599", ""))

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
            "runQso": 2, "searchAndPounceQso": 1, "hourRunQso": 0, "hourSearchAndPounceQso": 1})
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
        setup.update(name="Operator contest", operator="OM0RX/P", station={**setup["station"], "Call": "OM1ABC", "Name": "Contest operator"},
                     settings={**setup["settings"], "SentExchange": "16", "PowerCategory": "HIGH"},
                     macros=[{"mode": "R", "key": "F1", "label": "My CQ", "template": "cq test {MYCALL}"},
                             {"mode": "S", "key": "F1", "label": "My S&P", "template": "de {MYCALL}"}])
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision, "setup": setup}
        saved = self.call("setup_save", params)
        self.assertEqual(saved["projection"]["functionKeys"][0]["label"], "My S&P")
        self.assertEqual(next(field["value"] for field in saved["projection"]["fields"] if field["id"] == "other_1"), "16")
        self.assertEqual(self.call("sessions", {})["sessions"][0]["name"], "Operator contest")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("setup_get")["setup"], setup)
        action = self.mutate("function_key", key="F1")["actions"][0]
        self.assertEqual((action["label"], action["template"], action["stationCall"], action["sentExchange"]),
                         ("My S&P", "de {MYCALL}", "OM1ABC", "16"))
        self.mutate("run_state", run=True)
        action = self.mutate("function_key", key="F1")["actions"][0]
        self.assertEqual((action["label"], action["template"]), ("My CQ", "cq test {MYCALL}"))
        self.assertEqual(self.mutate("function_key", key="F3")["actions"][0]["template"], "{RST} {EXCHANGE}")
        self.assertTrue(self.call("setup_save", params)["replayed"])
        self.assertEqual(self.read("setup_get")["setup"], setup)
        new_qso = self.log("DL1ABC", "14", 1)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual(rows[qso], before)
        self.assertEqual((rows[new_qso]["Operator"], rows[new_qso]["StationPrefix"], rows[new_qso]["SentNr"]),
                         ("OM0RX/P", "OM1ABC", 16))
        self.assertEqual((rows[qso]["IsRunQSO"], rows[qso]["Run1Run2"]), (0, 1))

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

    def test_setup_rejects_invalid_contest_configuration_atomically(self):
        setup = self.read("setup_get")["setup"]
        for update in ({"station": {"Call": "XX1UNKNOWN"}}, {"settings": {"SentExchange": "41"}},
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
        store.conn.commit()
        result = self.read("contest_check_partial", query="abc", limit=120, expectedRevision=self.revision)
        self.assertEqual((result["query"], result["total"], len(result["rows"])), ("ABC", 126, 120))
        self.assertEqual(result["rows"][0]["ID"], qso)
        self.assertEqual(result["rows"][-1]["Call"], "K118ABC")
        self.assertEqual(self.read("check_partial", query="124")["rows"][0]["Call"], "K124ABC")
        self.assertEqual(self.read("check_partial", query="NOTFOUND")["total"], 0)
        row = result["rows"][0]
        self.assertTrue({"TS", "Call", "Freq", "SNT", "RCV", "SentNr", "ZN", "WPXPrefix", "CountryPrefix", "Points"} <= set(row))
        self.assertEqual(self.read("log", limit=1)["rows"][0]["Freq"], 14025)
        self.assertEqual(self.read("check_partial", query="ABC")["revision"], self.revision)
        self.mutate("draft_apply", fields={"callsign": "DL1ABC"})
        with self.assertRaises(HostError) as error:
            self.read("check_partial", query="ABC", expectedRevision=self.revision - 1)
        self.assertEqual(error.exception.code, "stale_revision")
        for params in ({"query": "%"}, {"query": ""}, {"query": "ABC", "limit": 501}, {"query": "ABC", "limit": True}):
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
        sessions = self.call("sessions", {})["sessions"]
        self.assertEqual(sessions, [{"sessionID": self.session, "name": "CQ WW CW",
                                    "workspaceGeneration": self.workspace,
                                    "pluginID": "cq_ww_cw",
                                    "sourceRevision": "7c8b499225a73f7f8f792246881bd7aefc05452f",
                                    "revision": self.revision}])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.call("contest_sessions", {})["sessions"][0]["sessionID"], self.session)

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
                   "isMultiplier3", "Dirty"}
        self.assertLessEqual({key for key in before if before[key] != after[key]}, allowed)
        audit = store.exec_sql(
            "SELECT before_json,after_json FROM xlog_qso_audit WHERE qso_id=? AND kind='correct'", (qso,))
        self.assertEqual(json.loads(audit["before_json"]), before)
        self.assertEqual(json.loads(audit["after_json"]), after)

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
