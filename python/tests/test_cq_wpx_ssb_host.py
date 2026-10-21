"""Original source-pinned CQ WPX SSB plugin through the production host."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class CQWPXSSBHostTests(unittest.TestCase):
    source_hash = "7d76fc6506c9fa4599db7ba1ea1e609a42994c79fc77096fbb522a7cb129f10d"

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": "cq_wpx_ssb",
            "station": {"Call": "OM0RX", "GridSquare": "JN88"},
            "frequencyHz": 14250000,
            "settings": {
                "SentExchange": "",
                "ModeCategory": "SSB",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
        }
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
        return self.call(method, {
            "sessionID": self.session,
            "operationID": uid(),
            "expectedRevision": self.revision,
            **kwargs,
        })

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def assert_voice(self, action, key, payload, macro_mode):
        self.assertEqual((action["kind"], action["signal"], action["mode"]),
                         ("voice_keyer", "phone", "SSB"))
        self.assertEqual((action["key"], action["payload"]), (key, payload))
        self.assertEqual(action["payloadUTF8Bytes"], len(payload.encode("utf-8")))
        self.assertEqual(action["payloadSHA256"], sha256(payload.encode("utf-8")).hexdigest())
        source = action["sourceMacro"]
        self.assertEqual((source["origin"], source["path"], source["revision"],
                          source["mode"], source["key"]),
                         ("pinned_not1mm", "not1mm/data/cwmacros.txt",
                          "7c8b499225a73f7f8f792246881bd7aefc05452f", macro_mode, key))
        encoded = json.dumps(source, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        self.assertEqual(action["sourceMacroSHA256"], sha256(encoded).hexdigest())
        self.assertNotIn("audio", action)
        self.assertNotIn("ptt", action)

    def log(self, call="K1ABC", serial="100", minute=0, frequency=14250000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 09:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": serial},
        )
        return qso

    def fields(self):
        return {field["id"]: field for field in self.read("projection")["projection"]["fields"]}

    def test_original_bytes_setup_validation_and_ui_descriptor(self):
        source = VENDOR / "not1mm/plugins/cq_wpx_ssb.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin("cq_wpx_ssb").__file__, str(source))
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == "cq_wpx_ssb")
        self.assertEqual(item, {
            "id": "cq_wpx_ssb", "name": "CQ WPX SSB", "engine": "not1mm-python",
            "sourceRevision": "7c8b499225a73f7f8f792246881bd7aefc05452f", "modes": ["SSB"],
            "supportedBands": ["160m", "80m", "40m", "20m", "15m", "10m"],
            "sentExchangeHint": "Sent Exchange",
            "overlayChoices": ["N/A", "CLASSIC", "ROOKIE", "TB-WIRES", "YOUTH"],
            "exportFormats": ["cabrillo", "adif"],
        })
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["pluginName"], view["mode"], view["supportedModes"]),
                         ("CQ WPX SSB", "SSB", ["SSB"]))
        self.assertEqual((view["supportedBands"], view["allowDuplicateCommit"], view["matrixTrackers"]),
                         (["160m", "80m", "40m", "20m", "15m", "10m"], False, []))
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), ("59", "59"))
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("SentNR", "RcvNR"))
        self.assertEqual((fields["other_1"]["value"], fields["other_1"]["readOnly"]), ("001", True))
        self.assertEqual(view["nextField"], "other_2")
        for received in ("", "ABC", "0", "-1", "9223372036854775808"):
            with self.subTest(received=received), self.assertRaisesRegex(HostError, "positive SQLite integers"):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": received})
        setup = self.read("setup_get")["setup"]
        setup["settings"]["ModeCategory"] = "CW"
        with self.assertRaisesRegex(HostError, "requires SSB"):
            self.mutate("setup_save", setup=setup)

    def test_phone_f3_and_original_esm_emit_voice_intents_and_commit(self):
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")
        direct = self.mutate("function_key", key="F3")
        self.assert_voice(direct["actions"][0], "F3", "59 001", "S")
        self.assertEqual(direct["actions"][0]["sourceMacro"]["template"], "{RST} {SENTNR}")
        self.assertEqual(
            self.read("output_claim", operationID=direct["operationID"], revision=direct["revision"])["actions"],
            direct["actions"],
        )
        self.assertEqual(self.read("receipt", operationID=direct["operationID"])["result"]["actions"], [])
        sandp_call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        self.assert_voice(sandp_call["actions"][0], "F5", "OM0RX", "S")
        sandp_exchange = self.mutate("esm", field="other_2", fields={"other_2": "100"})
        self.assert_voice(sandp_exchange["actions"][0], "F3", "59 001", "S")
        self.assertEqual(self.read("log")["total"], 1)
        self.mutate("run_state", run=True)
        run_call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        self.assertEqual([action["key"] for action in run_call["actions"]], ["F2", "F3"])
        self.assert_voice(run_call["actions"][0], "F2", "DL1ABC", "R")
        self.assert_voice(run_call["actions"][1], "F3", "59 002", "R")
        run_exchange = self.mutate("esm", field="other_2", fields={"other_2": "101"})
        self.assert_voice(run_exchange["actions"][0], "F4", "tu OM0RX qrz", "R")
        self.assertEqual(self.read("log")["total"], 2)
        self.assertEqual([row["Mode"] for row in self.read("log")["rows"]], ["USB", "USB"])

    def test_serial_reservation_is_read_only_replay_safe_and_durable(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "100"})
        with self.assertRaisesRegex(HostError, "reserved by the contest host") as changed:
            self.mutate("draft_apply", fields={"other_1": "002"})
        self.assertEqual(changed.exception.code, "serial_conflict")
        params = {
            "sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
            "qsoID": uid(), "timestamp": "2026-10-20 09:00:00",
        }
        saved = self.call("qso_commit", params)
        self.assertEqual(saved["projection"]["reservedSerial"], 2)
        self.assertEqual(self.fields()["other_1"]["value"], "002")
        self.host.close()
        self.host = Host(self.root)
        self.assertTrue(self.call("qso_commit", params)["replayed"])
        self.assertEqual(self.fields()["other_1"]["value"], "002")
        self.log(minute=1)
        ledger = self.host.database(self.session).exec_sql_mult("SELECT serial FROM xlog_serial ORDER BY serial")
        self.assertEqual([row["serial"] for row in ledger], [1, 2, 3])

    def test_points_prefix_multiplier_per_band_and_dupes(self):
        self.log()
        self.log(minute=1)
        self.log(minute=2, frequency=7125000)
        self.log("DL1ABC", "200", minute=3)
        score = self.read("score")["score"]
        self.assertEqual(score, {
            "qsos": 4, "points": 10, "countries": 0, "zones": 0,
            "prefixes": 2, "multipliers": 2, "total": 20,
        })
        rows = list(reversed(self.read("log")["rows"]))
        self.assertEqual([row["Points"] for row in rows], [3, 0, 6, 1])
        self.assertEqual([row["IsMultiplier1"] for row in rows], [1, 0, 0, 1])

    def test_correction_delete_restart_and_ph_export(self):
        self.mutate("draft_apply", fields={"sent": "57", "receive": "58"})
        first = self.log()
        second = self.log(minute=1)
        self.mutate("qso_correct", qsoID=second,
                    fields={"callsign": "DL1ABC", "other_2": "200"}, reason="Correct duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.mutate("qso_delete", qsoID=first, reason="Delete original")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 1, "points": 1, "countries": 0, "zones": 0,
            "prefixes": 1, "multipliers": 1, "total": 1,
        })
        self.assertEqual(self.fields()["other_1"]["value"], "003")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 1)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: CQ-WPX-SSB\r\n", export)
        self.assertIn("CATEGORY-MODE: SSB\r\n", export)
        self.assertIn("CLAIMED-SCORE: 1\r\n", export)
        lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1:3], ["14250", "PH"])
        self.assertEqual(lines[0][5:], ["OM0RX", "59", "2", "DL1ABC", "59", "200"])
        self.assertNotIn("CW", lines[0])


if __name__ == "__main__":
    unittest.main()
