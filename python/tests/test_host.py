from copy import deepcopy
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
        self.revision = 0
        self.create = {"sessionID": self.session, "operationID": uid(), "expectedRevision": 0,
                       "pluginID": "cq_ww_cw", "station": {"Call": "OM0RX", "GridSquare": "JN88"},
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
        self.assertFalse(fields["other_1"]["visible"])
        self.assertEqual(fields["other_2"]["label"], "CQ Zone")
        self.assertEqual(fields["other_2"]["accessibleName"], "C Q Zone")
        self.mutate("draft_apply", fields={"callsign": "K", "other_2": ""})
        partial = self.read("projection")["projection"]
        self.assertEqual(partial["fields"][0]["value"], "K")
        with self.assertRaises(AttributeError):
            Field("callsign").silentlyIgnoreMissingQtMethod()

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
                                    "pluginID": "cq_ww_cw",
                                    "sourceRevision": "7c8b499225a73f7f8f792246881bd7aefc05452f",
                                    "revision": self.revision}])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.call("contest_sessions", {})["sessions"][0]["sessionID"], self.session)

    def test_actual_score_dupe_and_band_semantics(self):
        self.log()
        self.log("DL1ABC", "14", 1)
        self.assertEqual(self.read("score")["score"], {"qsos": 2, "points": 4, "countries": 2, "zones": 2, "total": 16})
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
        self.assertEqual(result["actions"][0]["template"], "{CALL}")
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
        self.assertEqual([a["key"] for a in result["actions"]], ["F2"])
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
        self.assertEqual(prepared["workspaceGeneration"], self.session)
        chunk = self.read("export_read", exportID=prepared["artifactID"],
                          workspaceGeneration=self.session, offset=0, length=prepared["byteLength"])
        payload = base64.b64decode(chunk["dataBase64"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), prepared["sha256"])
        self.assertTrue(chunk["eof"])
        self.assertTrue(self.read("export_release", exportID=prepared["artifactID"],
                                  workspaceGeneration=self.session)["released"])
        with self.assertRaises(HostError) as error:
            self.read("export_read", exportID=prepared["artifactID"],
                      workspaceGeneration=self.session, offset=0, length=prepared["byteLength"])
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
