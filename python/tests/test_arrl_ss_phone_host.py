"""Original source-pinned ARRL Sweepstakes Phone plugin through the production host."""
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


class ARRLSweepstakesPhoneHostTests(unittest.TestCase):
    source_hash = "24b9c96dc716769f4c30016b4979d38c33e609ae6ae6af104d10dd66e807a41a"

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
            "pluginID": "arrl_ss_phone",
            "station": {"Call": "OM0RX", "GridSquare": "JN88"},
            "frequencyHz": 14250000,
            "settings": {
                "SentExchange": "A OM0RX 67 CT",
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

    def log(self, call="K1ABC", exchange="123 A K1ABC 67 CT", minute=0, frequency=14250000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 09:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def fields(self):
        return {
            field["id"]: field
            for field in self.read("projection")["projection"]["fields"]
        }

    def test_original_bytes_catalog_fields_parser_and_setup_validation(self):
        source = VENDOR / "not1mm/plugins/arrl_ss_phone.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin("arrl_ss_phone").__file__, str(source))
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == "arrl_ss_phone")
        self.assertEqual(item, {
            "id": "arrl_ss_phone",
            "name": "ARRL Sweepstakes Phone",
            "engine": "not1mm-python",
            "sourceRevision": "7c8b499225a73f7f8f792246881bd7aefc05452f",
            "modes": ["SSB"],
            "sentExchangeHint": "Prec Call Check Section",
            "overlayChoices": ["N/A"],
        })
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["pluginName"], view["mode"], view["supportedModes"]),
                         ("ARRL Sweepstakes Phone", "SSB", ["SSB"]))
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), ("59", "59"))
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]),
                         ("SentNR", "sn: p: cl: ck: sec:"))
        self.assertEqual((fields["other_1"]["value"], fields["other_1"]["readOnly"]),
                         ("001", True))
        self.assertEqual(view["nextField"], "other_2")

        qso = self.log("DL1ABC", "123A K1ABC 67CT")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == qso)
        self.assertEqual((row["NR"], row["Prec"], row["CK"], row["Sect"], row["Call"]),
                         (123, "A", 67, "CT", "K1ABC"))

        setup = self.read("setup_get")["setup"]
        setup["settings"]["ModeCategory"] = "CW"
        with self.assertRaisesRegex(HostError, "requires SSB"):
            self.mutate("setup_save", setup=setup)

    def test_phone_f3_and_original_esm_emit_voice_intents_and_commit(self):
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")
        direct = self.mutate("function_key", key="F3", fields={"callsign": "K1ABC"})
        self.assert_voice(direct["actions"][0], "F3", "K1ABC 001 A OM0RX 67 CT", "S")
        self.assertEqual(direct["actions"][0]["sourceMacro"]["template"],
                         "{CALL} {SENTNR} {EXCHANGE}")
        self.assertEqual(
            self.read("output_claim", operationID=direct["operationID"], revision=direct["revision"])["actions"],
            direct["actions"],
        )
        self.assertEqual(self.read("receipt", operationID=direct["operationID"])["result"]["actions"], [])
        self.assertEqual(
            [action["key"] for action in self.mutate(
                "esm", field="callsign", fields={"callsign": "K1ABC"})["actions"]],
            ["F5"],
        )
        sandp_exchange = self.mutate(
            "esm", field="other_2", fields={"other_2": "123 A K1ABC 67 CT"},
        )
        self.assert_voice(sandp_exchange["actions"][0], "F3", "K1ABC 001 A OM0RX 67 CT", "S")
        self.mutate("run_state", run=True)
        run_call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        self.assertEqual([action["key"] for action in run_call["actions"]], ["F2", "F3"])
        self.assert_voice(run_call["actions"][0], "F2", "DL1ABC", "R")
        self.assert_voice(run_call["actions"][1], "F3", "DL1ABC 002 A OM0RX 67 CT", "R")
        run_exchange = self.mutate(
            "esm", field="other_2", fields={"other_2": "456 B DL1ABC 72 EMA"},
        )
        self.assert_voice(run_exchange["actions"][0], "F4", "tu OM0RX qrz", "R")
        rows = self.read("log")["rows"]
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["Mode"] for row in rows], ["USB", "USB"])
        self.assertEqual(self.fields()["other_1"]["value"], "003")

    def test_sections_contest_wide_dupes_corrections_delete_restart_and_ph_export(self):
        first = self.log()
        duplicate = self.log("OM1ABC", "789 Q K1ABC 80 CT", 1, 7125000)
        third = self.log("DL1ABC", "456 B DL1ABC 72 EMA", 2)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["Points"], rows[duplicate]["Points"], rows[third]["Points"]),
                         (2, 0, 2))
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 4,
            "countries": 0,
            "zones": 0,
            "sections": 2,
            "multipliers": 2,
            "total": 8,
        })

        self.mutate(
            "qso_correct",
            qsoID=first,
            fields={"other_1": "50", "other_2": "101 Q OM1ABC 80 WMA"},
            reason="Correct exchange",
        )
        self.assertEqual(self.read("score")["score"]["total"], 18)
        self.mutate(
            "qso_correct",
            qsoID=first,
            fields={"other_2": "123 A K1ABC 67 CT"},
            reason="Restore exchange",
        )
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.mutate("qso_delete", qsoID=first, reason="Delete original")
        promoted = next(row for row in self.read("log")["rows"] if row["ID"] == duplicate)
        self.assertEqual((promoted["Points"], promoted["IsMultiplier1"]), (2, 1))
        self.mutate("qso_delete", qsoID=third, reason="Leave one PH QSO")
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.assertEqual(self.fields()["other_1"]["value"], "004")

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 2)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-SS-SSB\r\n", export)
        self.assertIn("CATEGORY-MODE: SSB\r\n", export)
        self.assertIn("CLAIMED-SCORE: 2\r\n", export)
        lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1:3], ["7125", "PH"])
        self.assertEqual(lines[0][5:], [
            "OM0RX", "0002", "A", "67", "CT", "K1ABC", "0789", "Q", "80", "CT",
        ])
        self.assertNotIn("CW", lines[0])


if __name__ == "__main__":
    unittest.main()
