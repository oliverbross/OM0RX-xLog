"""Pinned French REF CW/SSB plugins through the Python/SQLite host."""
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
    **deepcopy(fixtures.CTY),
    "F1AAA": {"entity": "France", "continent": "EU", "cq": 14, "itu": 27,
              "primary_pfx": "F"},
    "F2BBB": {"entity": "France", "continent": "EU", "cq": 14, "itu": 27,
              "primary_pfx": "F"},
}
HASHES = {
    "ref_cw": "1b080f1181d2be51171ed9054dd6e218042c17925d394c3a32ccb1e39a306394",
    "ref_ssb": "a3837ad14b6efd487313f82c613b77bf91974fb7a211f72fd4fe1e655a1e764d",
}


class REFHostCase:
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
                "SentExchange": "#",
                "ModeCategory": self.mode,
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "ref-cty-v1", "countries": deepcopy(CTY)},
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

    def log(self, call, exchange, minute, frequency=14025000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-21 15:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def test_source_registry_projection_validation_and_esm(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == self.plugin_id)
        self.assertEqual(
            (item["name"], item["modes"], item["sentExchangeHint"]),
            (self.plugin_name, [self.mode], "Department/prefix or #"),
        )
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["mode"], projection["reservedSerial"],
             projection["supportedBands"]),
            (self.plugin_name, self.mode, 1, ["80m", "40m", "20m", "15m", "10m"]),
        )
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]),
                         (self.report, self.report))
        self.assertEqual(
            (fields["other_1"]["label"], fields["other_1"]["value"],
             fields["other_1"]["readOnly"], fields["other_2"]["label"]),
            ("Sent", "001", True, "Dep/Pfx/SN"),
        )

        with self.assertRaisesRegex(HostError, "department, prefix or positive serial"):
            self.mutate("qso_commit", fields={"callsign": "F1AAA", "other_2": ""})
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "BAD VALUE"
        with self.assertRaisesRegex(HostError, "department or a prefix"):
            self.mutate("setup_save", setup=setup)
        setup["settings"]["SentExchange"] = "OM"
        changed = self.mutate("setup_save", setup=setup)["projection"]
        changed_fields = {field["id"]: field for field in changed["fields"]}
        self.assertIsNone(changed["reservedSerial"])
        self.assertEqual((changed_fields["other_1"]["value"], changed_fields["other_1"]["readOnly"]),
                         ("OM", False))

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "F1AAA"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "M"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        row = self.read("log")["rows"][0]
        self.assertEqual((row["SentNr"], row["NR"], row["Points"]), ("OM", "M", 1))

    def test_scoring_correction_delete_restart_and_export(self):
        first = self.log("F1AAA", "75", 0)
        second = self.log("F2BBB", "33", 1)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 2,
            "points": 2,
            "countries": 0,
            "zones": 0,
            "multipliers": 2,
            "total": 4,
        })

        self.mutate("qso_correct", qsoID=first, fields={"other_2": "33"},
                    reason="Correct received department")
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.mutate("qso_delete", qsoID=first, reason="Remove corrected contact")
        self.assertEqual(self.read("score")["score"]["total"], 1)
        row = self.read("log")["rows"][0]
        self.assertEqual((row["ID"], row["SentNr"], row["NR"]), (second, 2, 33))

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 1)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 1\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 1)
        self.assertIn(" PH " if self.mode == "SSB" else " CW ", qso_lines[0])
        self.assertIn("F2BBB", qso_lines[0])


class REFCWHostTests(REFHostCase, unittest.TestCase):
    plugin_id = "ref_cw"
    plugin_name = "French REF DX contest - CW"
    mode = "CW"
    report = "599"
    cabrillo_name = "REF-CW"


class REFSSBHostTests(REFHostCase, unittest.TestCase):
    plugin_id = "ref_ssb"
    plugin_name = "French REF DX contest - SSB"
    mode = "SSB"
    report = "59"
    cabrillo_name = "REF-SSB"


if __name__ == "__main__":
    unittest.main()
