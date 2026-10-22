"""Pinned ARRL 10M and 160M plugins through the Python/SQLite host."""
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
    "K1XYZ": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8,
              "primary_pfx": "K"},
    "OM1ABC": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28,
               "primary_pfx": "OM"},
}
HASHES = {
    "arrl_10m": "a2f81691437e8333046b8dae46dc0229638d034d1da30e780320becc55c595c6",
    "arrl_160m": "6df35f43815c8426a406ccc93c80ebc77b42c9fd9f59a263975968b3313ccc45",
}


class ARRLHostCase(unittest.TestCase):
    plugin_id = ""
    frequency = 0
    sent_exchange = ""

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
            "frequencyHz": self.frequency,
            "settings": {
                "SentExchange": self.sent_exchange,
                "ModeCategory": "MIXED" if self.plugin_id == "arrl_10m" else "CW",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "arrl-single-band-cty-v1", "countries": deepcopy(CTY)},
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

    def log(self, call, exchange, minute):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso,
                    timestamp=f"2026-10-21 13:{minute:02}:00",
                    fields={"callsign": call, "other_2": exchange})
        return qso

    def assert_source(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))


class ARRL10MHostTests(ARRLHostCase):
    plugin_id = "arrl_10m"
    frequency = 28025000
    sent_exchange = "#"

    def test_voice_alias_is_fenced_from_mixed_contest_cw_output(self):
        setup = self.read("setup_get")["setup"]
        setup["macros"] = [{"mode": "S", "key": "F6", "label": "Managed voice",
                            "template": "{VOICE1}{RUN}"}]
        saved = self.mutate("setup_save", setup=setup)
        effective = next(item for item in saved["effectiveMacros"]
                         if item["mode"] == "S" and item["key"] == "F6")
        self.assertEqual(effective["template"], "[f1]{RUN}")
        with self.assertRaisesRegex(HostError, "managed WAV slots only in SSB voice output"):
            self.mutate("function_key", key="F6")
        self.assertFalse(self.read("projection")["projection"]["run"])

    def test_catalog_projection_conditional_serial_validation_and_esm(self):
        self.assert_source()
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(value for value in catalog if value["id"] == self.plugin_id)
        self.assertEqual((item["name"], item["modes"]), ("ARRL 10M", ["CW", "SSB"]))
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual((projection["supportedBands"], projection["reservedSerial"]), (["10m"], 1))
        self.assertEqual((fields["other_1"]["value"], fields["other_1"]["readOnly"],
                          fields["other_2"]["label"]), ("001", True, "State|Prov|SN|ITU"))

        with self.assertRaisesRegex(HostError, "only 10 metres"):
            self.mutate("qso_commit", frequencyHz=14025000,
                        fields={"callsign": "DL1ABC", "other_2": "001"})
        with self.assertRaisesRegex(HostError, "received exchange"):
            self.mutate("qso_commit", fields={"callsign": "DL1ABC", "other_2": ""})

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "001"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        row = self.read("log")["rows"][0]
        self.assertEqual((row["SentNr"], row["NR"], row["Points"]), (1, 1, 4))

        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "CT"
        fixed = self.mutate("setup_save", setup=setup)["projection"]
        fixed_fields = {field["id"]: field for field in fixed["fields"]}
        self.assertIsNone(fixed["reservedSerial"])
        self.assertEqual((fixed_fields["other_1"]["value"], fixed_fields["other_1"]["readOnly"]),
                         ("CT", False))

    def test_mixed_mode_scoring_correction_delete_restart_and_cabrillo(self):
        first = self.log("DL1ABC", "001", 0)
        second = self.log("K1ABC", "CT", 1)
        switched = self.mutate("draft_apply", mode="SSB")["projection"]
        switched_fields = {field["id"]: field["value"] for field in switched["fields"]}
        self.assertEqual((switched["mode"], switched_fields["sent"], switched_fields["receive"]),
                         ("SSB", "59", "59"))
        third = self.log("DL1ABC", "002", 2)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3, "points": 10, "countries": 0, "zones": 0,
            "multipliers": 3, "total": 30,
        })

        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "CT"
        self.mutate("setup_save", setup=setup)
        self.mutate("qso_correct", qsoID=second, fields={"other_2": "002"},
                    reason="Correct received serial")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == second)
        self.assertEqual((corrected["SentNr"], corrected["NR"]), (2, 2))
        self.mutate("qso_correct", qsoID=first, fields={"other_1": "007"},
                    reason="Correct historical sent serial")
        corrected_sent = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual(corrected_sent["SentNr"], 7)
        self.mutate("qso_delete", qsoID=first, reason="Remove first CW contact")
        self.assertEqual(self.read("score")["score"]["total"], 12)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("projection")["projection"]["mode"], "SSB")
        self.assertEqual(self.read("score")["score"]["total"], 12)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-10\r\n", export)
        self.assertIn("CATEGORY-MODE: MIXED\r\n", export)
        self.assertIn("CLAIMED-SCORE: 12\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any(" PH " in line for line in qso_lines))
        self.assertTrue(any(" CW " in line for line in qso_lines))


class ARRL160MHostTests(ARRLHostCase):
    plugin_id = "arrl_160m"
    frequency = 1825000
    sent_exchange = "15"

    def test_source_projection_validation_esm_and_scoring_round_trip(self):
        self.assert_source()
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual((projection["pluginName"], projection["supportedBands"], projection["reservedSerial"]),
                         ("ARRL 160-Meter", ["160m"], None))
        self.assertEqual((fields["other_1"]["visible"], fields["other_2"]["label"]),
                         (False, "ARRL/RAC Section"))

        with self.assertRaisesRegex(HostError, "only 160 metres"):
            self.mutate("qso_commit", frequencyHz=3525000,
                        fields={"callsign": "DL1ABC", "other_2": "14"})
        with self.assertRaisesRegex(HostError, "Resolve the contact country"):
            self.mutate("qso_commit", fields={"callsign": "XX1TEST", "other_2": "14"})

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "14"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])

    def test_original_scoring_correction_delete_restart_and_cabrillo(self):
        first = self.log("DL1ABC", "14", 0)
        second = self.log("K1ABC", "CT", 1)
        self.log("OM1ABC", "15", 2)
        fourth = self.log("K1ABC", "ON", 3)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 4, "points": 10, "countries": 0, "zones": 0,
            "multipliers": 4, "total": 40,
        })
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["Points"], rows[second]["Points"], rows[fourth]["Points"]),
                         (5, 5, 0))

        self.mutate("qso_correct", qsoID=second, fields={"other_2": "14"},
                    reason="Correct section")
        self.assertEqual(self.read("score")["score"]["total"], 30)
        self.mutate("qso_delete", qsoID=first, reason="Remove first zone")
        self.assertEqual(self.read("score")["score"]["total"], 15)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 15)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-160\r\n", export)
        self.assertIn("CLAIMED-SCORE: 15\r\n", export)
        self.assertEqual(len([line for line in export.splitlines() if line.startswith("QSO:")]), 3)


if __name__ == "__main__":
    unittest.main()
