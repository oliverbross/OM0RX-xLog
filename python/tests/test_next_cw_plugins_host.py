"""Pinned ARRL DX CW and NAQP CW plugins through the Python host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid


class CWPluginHostCase(unittest.TestCase):
    plugin_id = ""
    sent_exchange = ""
    contest_name = ""
    source_hash = ""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.call("session_create", {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": self.plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88"},
            "frequencyHz": 14025000,
            "settings": {
                "SentExchange": self.sent_exchange,
                "ModeCategory": "CW",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
        })

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

    def assert_source_and_cw_surface(self, labels):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual((projection["pluginName"], projection["mode"], projection["supportedModes"]),
                         (self.contest_name, "CW", ["CW"]))
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), labels)
        context = self.read("cw_context")
        self.assertEqual((context["sentExchange"], context["fields"]["sent"]),
                         (self.sent_exchange, "599"))
        action = self.mutate("function_key", key="F3")["actions"][0]
        self.assertEqual((action["template"], action["sentExchange"]),
                         ("{RST} {EXCHANGE}", self.sent_exchange))


class ARRLDXCWHostTests(CWPluginHostCase):
    plugin_id = "arrl_dx_cw"
    sent_exchange = "100"
    contest_name = "ARRL DX CW"
    source_hash = "50dad8d13b4e782f6a846660f96a96357ae96866dac4ae5787f97818ed00e2d2"

    def log(self, call, exchange, minute, frequency):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso,
                    timestamp=f"2026-10-20 09:{minute:02}:00", frequencyHz=frequency,
                    fields={"callsign": call, "other_2": exchange})
        return qso

    def test_original_source_scoring_corrections_restart_and_export(self):
        self.assert_source_and_cw_surface(("", "Power/State/Province"))
        first = self.log("K1ABC", "CT", 0, 14025000)
        second = self.log("K1ABC", "CT", 1, 7025000)
        self.log("DL1ABC", "500", 2, 14025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3, "points": 6, "countries": 0, "zones": 0,
            "states": 2, "multipliers": 2, "total": 12,
        })
        self.mutate("qso_correct", qsoID=first, fields={"other_2": "MA"},
                    reason="Correct state")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["NR"], corrected["SentNr"], corrected["Points"]),
                         ("MA", 100, 3))
        self.mutate("qso_delete", qsoID=second, reason="Remove second band")
        self.assertEqual(self.read("score")["score"]["total"], 3)

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-DX-CW\r\n", export)
        self.assertIn("CLAIMED-SCORE: 3\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any(all(token in line.split() for token in ("CW", "K1ABC", "MA"))
                            for line in qso_lines))

    def test_original_run_esm_emits_exchange_and_commits(self):
        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "CT"})
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        self.assertEqual(self.read("log")["total"], 1)


class NAQPCWHostTests(CWPluginHostCase):
    plugin_id = "naqp_cw"
    sent_exchange = "OLIVER DX"
    contest_name = "NAQP CW"
    source_hash = "84da97206ac651638498812dc7867432c883e88650a86571161ca5e3a72b222b"

    def log(self, call, name, section, minute, frequency):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso,
                    timestamp=f"2026-10-20 09:{minute:02}:00", frequencyHz=frequency,
                    fields={"callsign": call, "other_1": name, "other_2": section})
        return qso

    def test_original_source_scoring_corrections_restart_and_export(self):
        self.assert_source_and_cw_surface(("Name", "State"))
        first = self.log("K1ABC", "JOHN", "CT", 0, 14025000)
        second = self.log("K1ABC", "JOHN", "CT", 1, 7025000)
        self.log("DL1ABC", "HANS", "", 2, 14025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3, "points": 2, "countries": 0, "zones": 0,
            "sections": 3, "multipliers": 3, "total": 6,
        })
        self.mutate("qso_correct", qsoID=first,
                    fields={"other_1": "JACK", "other_2": "MA"},
                    reason="Correct exchange")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["Name"], corrected["Sect"], corrected["SentNr"]),
                         ("JACK", "MA", self.sent_exchange))
        self.mutate("qso_delete", qsoID=second, reason="Remove second band")
        self.assertEqual(self.read("score")["score"]["total"], 2)

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: NAQP-CW\r\n", export)
        self.assertIn("CLAIMED-SCORE: 2\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any("CW" in line.split() and self.sent_exchange in line
                            and all(token in line.split() for token in ("JACK", "MA"))
                            for line in qso_lines))

    def test_original_run_esm_emits_exchange_and_commits(self):
        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        exchange = self.mutate("esm", field="other_2",
                               fields={"other_1": "JOHN", "other_2": "CT"})
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        self.assertEqual(self.read("log")["total"], 1)


if __name__ == "__main__":
    unittest.main()
