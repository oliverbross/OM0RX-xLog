"""Pinned All Asian DX CW/SSB family through the original Python/SQLite host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
CTY = {
    **fixtures.CTY,
    "JA1ABC": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JA1XYZ": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JA2XYZ": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
}
HASHES = {
    "aadx_cw": "491affb2e8e1a9f64984f30ca95ec8bbf4a4f89788ffdc24f116356dc84df745",
    "aadx_ssb": "5d6d4a6a9dff5f07bb533041ba259bf901ef33a74e31f0a4091a9235333b0bdc",
}


class AADXHostCase:
    plugin_id = ""
    plugin_name = ""
    mode = ""
    report = ""
    cabrillo_name = ""

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
                "SentExchange": "42",
                "ModeCategory": self.mode,
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)},
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

    def log(self, call, received, timestamp, frequency=14025000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=timestamp,
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": received},
        )
        return qso

    def test_original_source_projection_validation_and_esm(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["mode"], projection["supportedModes"]),
            (self.plugin_name, self.mode, [self.mode]),
        )
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), (self.report, self.report))
        self.assertEqual(
            (fields["other_1"]["label"], fields["other_1"]["value"], fields["other_2"]["label"]),
            ("SentNR", "42", "RcvNR"),
        )
        self.assertIsNone(projection["reservedSerial"])

        for fields in (
            {"callsign": "JA1ABC", "other_2": ""},
            {"callsign": "JA1ABC", "other_2": "AGE"},
            {"callsign": "JA1ABC", "other_1": "0", "other_2": "21"},
        ):
            with self.subTest(fields=fields), self.assertRaisesRegex(HostError, "AADX sent and received ages"):
                self.mutate("qso_commit", fields=fields)
        with self.assertRaisesRegex(HostError, "Resolve the contact country"):
            self.mutate("qso_commit", fields={"callsign": "XX1TEST", "other_2": "21"})

        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "0"
        with self.assertRaisesRegex(HostError, "AADX sent age"):
            self.mutate("setup_save", setup=setup)

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "JA1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "21"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"] if self.mode == "CW" else [])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"] if self.mode == "CW" else [])
        self.assertEqual(self.read("log")["total"], 1)

    def test_scoring_same_second_rebuild_correction_restart_and_export(self):
        first = self.log("JA1ABC", "21", "2026-10-21 09:00:00")
        second = self.log("JA1XYZ", "22", "2026-10-21 09:00:00")
        third = self.log("JA2XYZ", "23", "2026-10-21 09:01:00")

        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 3,
            "countries": 0,
            "zones": 0,
            "multipliers": 2,
            "total": 6,
        })
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual(
            [(rows[qso]["SentNr"], rows[qso]["NR"], rows[qso]["Points"], rows[qso]["IsMultiplier1"])
             for qso in (first, second, third)],
            [(42, 21, 1, 1), (42, 22, 1, 0), (42, 23, 1, 1)],
        )

        self.mutate(
            "qso_correct",
            qsoID=third,
            fields={"callsign": "K1ABC", "other_2": "24"},
            reason="Correct call and age",
        )
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.mutate("qso_delete", qsoID=second, reason="Remove duplicate prefix")
        self.assertEqual(self.read("score")["score"]["total"], 1)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 1)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 1\r\n", export)
        qso_lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any(
            self.mode.replace("SSB", "PH") in line and "JA1ABC" in line and "42" in line and "21" in line
            for line in qso_lines
        ))


class AADXCWHostTests(AADXHostCase, unittest.TestCase):
    plugin_id = "aadx_cw"
    plugin_name = "AADX CW"
    mode = "CW"
    report = "599"
    cabrillo_name = "AADX-CW"


class AADXSSBHostTests(AADXHostCase, unittest.TestCase):
    plugin_id = "aadx_ssb"
    plugin_name = "AADX SSB"
    mode = "SSB"
    report = "59"
    cabrillo_name = "AADX-SSB"


if __name__ == "__main__":
    unittest.main()
