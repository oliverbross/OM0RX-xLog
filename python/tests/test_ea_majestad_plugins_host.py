"""Pinned King of Spain CW/SSB plugins through the Python/SQLite host."""
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
    "EA1AAA": {"entity": "Spain", "continent": "EU", "cq": 14, "itu": 37,
               "primary_pfx": "EA"},
    "EA2BBB": {"entity": "Spain", "continent": "EU", "cq": 14, "itu": 37,
               "primary_pfx": "EA"},
}
HASHES = {
    "ea_majestad_cw": "6c3e2825fea358615df7f9fb1c4c788acf3d7785ae031dbdaa60fff06d8332ad",
    "ea_majestad_ssb": "168ad966df4cbfaf24044b5b9a3840407b6d01255184442e690f99d7693f9391",
}


class KingOfSpainHostCase:
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
            "reference": {"id": "king-of-spain-cty-v1", "countries": deepcopy(CTY)},
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
            timestamp=f"2026-10-21 14:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def test_source_projection_conditional_serial_validation_and_esm(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["mode"], projection["supportedModes"],
             projection["reservedSerial"]),
            (self.plugin_name, self.mode, [self.mode], 1),
        )
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]),
                         (self.report, self.report))
        self.assertEqual(
            (fields["other_1"]["label"], fields["other_1"]["value"],
             fields["other_1"]["readOnly"], fields["other_2"]["label"]),
            ("SentNR", "001", True, "Prov or SN"),
        )

        with self.assertRaisesRegex(HostError, "province or positive serial"):
            self.mutate("qso_commit", fields={"callsign": "EA1AAA", "other_2": ""})
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "12"
        with self.assertRaisesRegex(HostError, "# or a province"):
            self.mutate("setup_save", setup=setup)
        setup["settings"]["SentExchange"] = "M"
        changed = self.mutate("setup_save", setup=setup)["projection"]
        changed_fields = {field["id"]: field for field in changed["fields"]}
        self.assertIsNone(changed["reservedSerial"])
        self.assertEqual((changed_fields["other_1"]["value"], changed_fields["other_1"]["readOnly"]),
                         ("M", False))

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "EA1AAA"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "B"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        row = self.read("log")["rows"][0]
        self.assertEqual((row["SentNr"], row["NR"], row["Points"]), ("M", "B", 3))

    def test_scoring_correction_delete_restart_and_export(self):
        first = self.log("EA1AAA", "M", 0)
        second = self.log("DL1ABC", "001", 1)
        third = self.log("EA2BBB", "B", 2, 7025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 7,
            "countries": 0,
            "zones": 0,
            "multipliers": 5,
            "total": 35,
        })

        self.mutate("qso_correct", qsoID=third,
                    fields={"callsign": "DL1ABC", "other_2": "002"},
                    reason="Correct call and serial")
        self.assertEqual(self.read("score")["score"]["total"], 20)
        self.mutate("qso_delete", qsoID=second, reason="Remove second contact")
        self.assertEqual(self.read("score")["score"]["total"], 12)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["SentNr"], rows[third]["SentNr"]), (1, 3))

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 12)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 12\r\n", export)
        qso_lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any(self.mode.replace("SSB", "PH") in line for line in qso_lines))


class KingOfSpainCWHostTests(KingOfSpainHostCase, unittest.TestCase):
    plugin_id = "ea_majestad_cw"
    plugin_name = "His Maj. King of Spain Contest, CW"
    mode = "CW"
    report = "599"
    cabrillo_name = "KING-OF-SPAIN-CW"


class KingOfSpainSSBHostTests(KingOfSpainHostCase, unittest.TestCase):
    plugin_id = "ea_majestad_ssb"
    plugin_name = "His Maj. King of Spain Contest, SSB"
    mode = "SSB"
    report = "59"
    cabrillo_name = "KING-OF-SPAIN-SSB"


if __name__ == "__main__":
    unittest.main()
