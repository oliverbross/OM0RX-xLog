"""Pinned CQ 160 CW/SSB family through the original Python/SQLite host."""
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
    "K1XYZ": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
    "K1NEW": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
    "K1ABC/MM": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
    "VE3ABC": {"entity": "Canada", "continent": "NA", "cq": 4, "itu": 4, "primary_pfx": "VE"},
}
HASHES = {
    "cq_160_cw": "45dce6c2caa3ee05e56137e2fee226dae5e1f2434b327b0d3506ae17b804379c",
    "cq_160_ssb": "db03be688702e523a3d532fabc59e84e689668438e3c3038501a0d82a8b55804",
}


class CQ160HostCase:
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
            "frequencyHz": 1825000,
            "settings": {
                "SentExchange": "15",
                "ModeCategory": self.mode,
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "160M",
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

    def log(self, call, exchange, timestamp):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=timestamp,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def test_original_source_projection_validation_band_and_esm(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["mode"], projection["supportedModes"],
             projection["supportedBands"]),
            (self.plugin_name, self.mode, [self.mode], ["160m"]),
        )
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]),
                         (self.report, self.report))
        self.assertEqual((fields["other_1"]["visible"], fields["other_2"]["label"]),
                         (False, "ST/Prov/CQ Zone"))

        invalid = (
            ({"callsign": "K1ABC", "other_2": ""}, "state, province or CQ zone"),
            ({"callsign": "DL1ABC", "other_2": "14'"}, "state, province or CQ zone"),
            ({"callsign": "XX1TEST", "other_2": "14"}, "Resolve the contact country"),
        )
        for values, message in invalid:
            with self.subTest(values=values), self.assertRaisesRegex(HostError, message):
                self.mutate("qso_commit", fields=values)
        with self.assertRaisesRegex(HostError, "only 160 metres"):
            self.mutate("qso_commit", frequencyHz=3525000,
                        fields={"callsign": "DL1ABC", "other_2": "14"})

        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "bad exchange"
        with self.assertRaisesRegex(HostError, "state, province or CQ zone"):
            self.mutate("setup_save", setup=setup)

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "CT"})
        expected_call_keys = ["F2", "F3"] if self.mode == "CW" else []
        expected_exchange_keys = ["F4"] if self.mode == "CW" else []
        self.assertEqual([action["key"] for action in call["actions"]], expected_call_keys)
        self.assertEqual([action["key"] for action in exchange["actions"]], expected_exchange_keys)
        self.assertEqual(self.read("log")["total"], 1)

    def test_original_scoring_rebuild_restart_and_export(self):
        first = self.log("K1ABC", "CT", "2026-10-21 09:00:00")
        second = self.log("K1XYZ", "CT", "2026-10-21 09:00:00")
        third = self.log("VE3ABC", "ON", "2026-10-21 09:01:00")
        fourth = self.log("DL1ABC", "14", "2026-10-21 09:02:00")
        fifth = self.log("OM1ABC", "15", "2026-10-21 09:03:00")
        maritime = self.log("K1ABC/MM", "CT", "2026-10-21 09:04:00")

        self.assertEqual(self.read("score")["score"], {
            "qsos": 6,
            "points": 42,
            "countries": 0,
            "zones": 0,
            "multipliers": 4,
            "total": 168,
        })
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual(
            [(rows[qso]["Points"], rows[qso]["IsMultiplier1"])
             for qso in (first, second, third, fourth, fifth, maritime)],
            [(10, 1), (10, 0), (10, 1), (5, 1), (2, 1), (5, 0)],
        )

        self.mutate("qso_correct", qsoID=third,
                    fields={"callsign": "K1NEW", "other_2": "CT"},
                    reason="Correct call and exchange")
        self.assertEqual(self.read("score")["score"]["total"], 126)
        self.mutate("qso_delete", qsoID=first, reason="Remove first state contact")
        self.assertEqual(self.read("score")["score"]["total"], 96)
        promoted = {row["ID"]: row for row in self.read("log")["rows"]}[second]
        self.assertEqual(promoted["IsMultiplier1"], 1)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 96)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 96\r\n", export)
        qso_lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 5)
        self.assertTrue(any(self.mode.replace("SSB", "PH") in line and "K1XYZ" in line
                            and "CT" in line for line in qso_lines))


class CQ160CWHostTests(CQ160HostCase, unittest.TestCase):
    plugin_id = "cq_160_cw"
    plugin_name = "CQ 160 CW"
    mode = "CW"
    report = "599"
    cabrillo_name = "CQ-160-CW"


class CQ160SSBHostTests(CQ160HostCase, unittest.TestCase):
    plugin_id = "cq_160_ssb"
    plugin_name = "CQ 160 SSB"
    mode = "SSB"
    report = "59"
    cabrillo_name = "CQ-160-SSB"


if __name__ == "__main__":
    unittest.main()
