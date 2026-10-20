"""Pinned Scandinavian Activity Contest CW/SSB plugins through the host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
SAC_COUNTRIES = {
    **deepcopy(fixtures.CTY),
    "SM1ABC": {"entity": "Sweden", "continent": "EU", "cq": 14,
               "itu": 18, "primary_pfx": "SM"},
    "SM2ABC": {"entity": "Sweden", "continent": "EU", "cq": 14,
               "itu": 18, "primary_pfx": "SM"},
}


class SACHostCase:
    plugin_id = ""
    contest_name = ""
    source_hash = ""
    mode = ""
    report = ""
    cabrillo_mode = ""

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
                "SentExchange": "",
                "ModeCategory": self.mode,
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "sac-test-cty-v1", "countries": deepcopy(SAC_COUNTRIES)},
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

    def log(self, call, serial, minute, frequency):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso,
                    timestamp=f"2026-10-20 09:{minute:02}:00", frequencyHz=frequency,
                    fields={"callsign": call, "other_2": serial})
        return qso

    def test_original_source_workflow_scoring_correction_restart_and_export(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual((projection["pluginName"], projection["mode"],
                          projection["supportedModes"], projection["reservedSerial"]),
                         (self.contest_name, self.mode, [self.mode], 1))
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"],
                          fields["other_1"]["label"], fields["other_1"]["value"],
                          fields["other_1"]["readOnly"], fields["other_2"]["label"]),
                         (self.report, self.report, "SentNR", "001", True, "RcvNR"))
        if self.mode == "CW":
            action = self.mutate("function_key", key="F3")["actions"][0]
            self.assertEqual((action["template"], action["sentSerial"]),
                             ("{RST} {SENTNR}", "001"))
        else:
            with self.assertRaisesRegex(HostError, "does not support CW"):
                self.read("cw_context")
            self.assertEqual(self.mutate("function_key", key="F3")["actions"], [])

        first = self.log("SM1ABC", "101", 0, 14025000)
        second = self.log("SM1ABC", "102", 1, 7025000)
        self.log("SM2ABC", "103", 2, 14025000)
        self.log("DL1ABC", "104", 3, 14025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 4, "points": 3, "countries": 0, "zones": 0,
            "multipliers": 3, "total": 9,
        })

        self.mutate("qso_correct", qsoID=first, fields={"other_2": "201"},
                    reason="Correct received serial")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["SentNr"], corrected["NR"], corrected["Points"]),
                         (1, 201, 1))
        self.mutate("qso_delete", qsoID=second, reason="Remove second band")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3, "points": 2, "countries": 0, "zones": 0,
            "multipliers": 2, "total": 4,
        })

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 5)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {load_plugin(self.plugin_id).cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 4\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 3)
        self.assertTrue(any(self.cabrillo_mode in line.split()
                            and all(token in line.split() for token in ("SM1ABC", "201"))
                            for line in qso_lines))

    def test_original_esm_commits_and_advances_serial(self):
        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "SM1ABC"})
        expected = ["F2", "F3"] if self.mode == "CW" else []
        self.assertEqual([action["key"] for action in call["actions"]], expected)
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "101"})
        self.assertEqual([action["key"] for action in exchange["actions"]],
                         ["F4"] if self.mode == "CW" else [])
        self.assertEqual(self.read("log")["total"], 1)
        projection = self.read("projection")["projection"]
        self.assertEqual(projection["reservedSerial"], 2)
        self.assertEqual(next(field["value"] for field in projection["fields"]
                              if field["id"] == "other_1"), "002")


class SACCWHostTests(SACHostCase, unittest.TestCase):
    plugin_id = "sac_cw"
    contest_name = "SAC CW"
    source_hash = "2c2879d79f59df964e821f5c9ee6a5a460dad93e1c0e04a72b4c3a9ff9aa36ce"
    mode = "CW"
    report = "599"
    cabrillo_mode = "CW"


class SACSSBHostTests(SACHostCase, unittest.TestCase):
    plugin_id = "sac_ssb"
    contest_name = "SAC SSB"
    source_hash = "c8a8fe6189e79a6fe001de2f73cccd574acc0d26ea8f2f8691765619f1b06fd9"
    mode = "SSB"
    report = "59"
    cabrillo_mode = "PH"


if __name__ == "__main__":
    unittest.main()
