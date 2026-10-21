"""Pinned ARRL Field Day, RTTY Roundup and VHF plugins through the Python host."""
import base64
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Desk, Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "arrl_field_day": "c048a3f302063fb8bd575eac9bf06d637af8f1fab995b843c4228367aaa8efa8",
    "arrl_rtty_ru": "51ec034028d5afa0d2788acb4e718d9699a198b2392dde2dbe78a0abfad31df6",
    "arrl_vhf_jan": "692e8456947e307c15ae04c8ffe56a38f5f9475c22973a30d80b3879aeecb990",
    "arrl_vhf_jun": "dd7d4183aa106125b3223aca6e2479341a8264995ea5b0261357301325573aff",
    "arrl_vhf_sep": "571558e52d5de8fa886f9b4ce7e49a9a86d045b495d732da43ada9c6f36f3656",
}


class ARRLOriginalPluginCase(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session = self.workspace = None
        self.revision = 0

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def create(self, plugin_id, sent_exchange, frequency, mode, category=None):
        self.session, self.workspace = uid(), uid()
        result = self.host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": self.session, "workspaceGeneration": self.workspace,
            "operationID": uid(), "expectedRevision": 0, "pluginID": plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "ARRLSection": "ORG"},
            "frequencyHz": frequency, "mode": mode,
            "settings": {"SentExchange": sent_exchange, "ModeCategory": category or mode,
                         "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL",
                         "PowerCategory": "LOW"},
            "reference": {"id": "arrl-original-cty-v1", "countries": deepcopy(fixtures.CTY)},
        }})
        self.revision = result["revision"]
        return result

    def mutate(self, method, **params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": self.session, "operationID": uid(),
            "expectedRevision": self.revision, **params}})
        self.revision = result["revision"]
        return result

    def read(self, method, **params):
        return self.host.dispatch({"id": uid(), "method": method,
                                   "params": {"sessionID": self.session, **params}})

    def prepared_adif(self):
        prepared = self.read("export_prepare", format="adif")
        chunk = self.read("export_read", exportID=prepared["artifactID"],
                          workspaceGeneration=self.workspace, offset=0,
                          length=prepared["byteLength"])
        return base64.b64decode(chunk["dataBase64"]).decode("utf-8")


class ARRLFamilyAdmissionTests(ARRLOriginalPluginCase):
    def test_exact_sources_catalog_and_setup_band_mode_policy(self):
        catalog = {row["id"]: row for row in
                   self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]}
        for plugin_id, digest in HASHES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                self.assertEqual(catalog[plugin_id]["sourceRevision"],
                                 "7c8b499225a73f7f8f792246881bd7aefc05452f")

        self.create("arrl_field_day", "1D ORG", 14025000, "CW")
        projection = self.read("projection")["projection"]
        self.assertIn("6m", projection["supportedBands"])
        self.assertEqual(projection["supportedModes"], ["CW", "SSB", "RTTY", "AM", "FM"])
        with self.assertRaisesRegex(HostError, "does not support 6m"):
            self.host.new_state(uid(), {"sessionID": uid(), "workspaceGeneration": uid(),
                "pluginID": "cq_ww_cw", "station": {"Call": "OM0RX"}, "frequencyHz": 50125000,
                "settings": {"SentExchange": "15"},
                "reference": {"id": "cty", "countries": deepcopy(fixtures.CTY)}})
        with self.assertRaisesRegex(HostError, "CLASS SECTION"):
            self.host.new_state(uid(), {"sessionID": uid(), "workspaceGeneration": uid(),
                "pluginID": "arrl_field_day", "station": {"Call": "OM0RX"}, "frequencyHz": 14025000,
                "settings": {"SentExchange": "ORG"},
                "reference": {"id": "cty", "countries": deepcopy(fixtures.CTY)}})

    def test_rtty_and_vhf_setup_reject_invalid_exchange_band_and_mode(self):
        base = {"sessionID": uid(), "workspaceGeneration": uid(), "station": {"Call": "OM0RX"},
                "reference": {"id": "cty", "countries": deepcopy(fixtures.CTY)}}
        with self.assertRaisesRegex(HostError, "state or province"):
            self.host.new_state(uid(), {**base, "pluginID": "arrl_rtty_ru", "frequencyHz": 14080000,
                                        "settings": {"SentExchange": "12 BAD", "ModeCategory": "RTTY"}})
        with self.assertRaisesRegex(HostError, "does not support 160m"):
            self.host.new_state(uid(), {**base, "pluginID": "arrl_rtty_ru", "frequencyHz": 1850000,
                                        "settings": {"SentExchange": "#", "ModeCategory": "RTTY"}})
        with self.assertRaisesRegex(HostError, "4-character grid"):
            self.host.new_state(uid(), {**base, "pluginID": "arrl_vhf_jan", "frequencyHz": 50125000,
                                        "settings": {"SentExchange": "JN888", "ModeCategory": "CW"}})
        with self.assertRaisesRegex(HostError, "does not support 20m"):
            self.host.new_state(uid(), {**base, "pluginID": "arrl_vhf_sep", "frequencyHz": 14025000,
                                        "settings": {"SentExchange": "JN88", "ModeCategory": "CW"}})
        with self.assertRaisesRegex(HostError, "supported CW submode"):
            self.host.new_state(uid(), {**base, "pluginID": "arrl_vhf_jun", "frequencyHz": 50125000,
                                        "settings": {"SentExchange": "JN88", "ModeCategory": "USB-D"}})


class ARRLFieldDayHostTests(ARRLOriginalPluginCase):
    def test_exchange_scoring_correction_restart_and_exports(self):
        self.create("arrl_field_day", "1D ORG", 14025000, "CW")
        first = uid()
        self.mutate("qso_commit", qsoID=first, timestamp="2026-06-27 18:00:00",
                    fields={"callsign": "K1ABC", "other_1": "2A", "other_2": "CT"})
        self.mutate("qso_commit", qsoID=uid(), timestamp="2026-06-27 18:01:00", mode="SSB",
                    fields={"callsign": "DL1ABC", "other_1": "1D", "other_2": "DX"})
        self.assertEqual(self.read("score")["score"]["total"], 6)
        self.mutate("qso_correct", qsoID=first,
                    fields={"other_1": "3A", "other_2": "EMA"}, reason="Correct exchange")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((row["Exchange1"], row["Sect"], row["Points"]), ("3A", "EMA", 2))
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        cabrillo = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-FIELD-DAY\r\n", cabrillo)
        self.assertIn(" 3A ", cabrillo)
        adif = self.prepared_adif()
        self.assertIn("<STX_STRING:6>1D ORG", adif)
        self.assertIn("<SRX_STRING:6>3A EMA", adif)

    def test_am_fm_reports_scoring_and_exports_are_phone_compatible(self):
        result = self.create("arrl_field_day", "1D ORG", 14025000, "AM", "MIXED")
        fields = {row["id"]: row["value"] for row in result["projection"]["fields"]}
        self.assertEqual((fields["sent"], fields["receive"]), ("59", "59"))
        self.mutate("qso_commit", qsoID=uid(), timestamp="2026-06-27 18:00:00",
                    fields={"callsign": "K1ABC", "other_1": "2A", "other_2": "CT"})
        self.mutate("qso_commit", qsoID=uid(), timestamp="2026-06-27 18:01:00",
                    frequencyHz=50125000, mode="FM",
                    fields={"callsign": "DL1ABC", "other_1": "1D", "other_2": "DX"})
        rows = self.read("log")["rows"]
        self.assertEqual([(row["Mode"], row["SNT"], row["RCV"], row["Points"]) for row in rows],
                         [("FM", "59", "59", 1), ("AM", "59", "59", 1)])
        self.assertEqual(self.read("score")["score"]["total"], 4)
        qso_lines = [line for line in self.read("export")["content"].splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(all(" PH " in line for line in qso_lines))
        adif = self.prepared_adif()
        self.assertIn("<MODE:2>AM", adif)
        self.assertIn("<MODE:2>FM", adif)


class ARRLRTTYRoundupHostTests(ARRLOriginalPluginCase):
    def test_serial_multiplier_correction_restart_and_exports(self):
        self.create("arrl_rtty_ru", "#", 14080000, "RTTY")
        projection = self.read("projection")["projection"]
        fields = {row["id"]: row for row in projection["fields"]}
        self.assertEqual((projection["reservedSerial"], fields["other_1"]["value"],
                          fields["other_1"]["readOnly"]), (1, "001", True))
        first = uid()
        self.mutate("qso_commit", qsoID=first, timestamp="2026-01-03 18:00:00",
                    fields={"callsign": "K1ABC", "other_2": "CT"})
        self.mutate("qso_commit", qsoID=uid(), timestamp="2026-01-03 18:01:00",
                    fields={"callsign": "DL1ABC", "other_2": "101"})
        self.assertEqual(self.read("score")["score"]["total"], 4)
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "DX"
        self.mutate("setup_save", setup=setup)
        self.mutate("qso_correct", qsoID=first, fields={"other_2": "MA"}, reason="Correct state")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((row["NR"], row["SentNr"]), ("MA", 1))
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 4)
        cabrillo = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-RTTY\r\n", cabrillo)
        adif = self.prepared_adif()
        self.assertIn("<STX_STRING:1>1", adif)
        self.assertIn("<SRX_STRING:2>MA", adif)


class ARRLVHFHostTests(ARRLOriginalPluginCase):
    def test_vhf_catalog_and_host_cover_every_pinned_microwave_band(self):
        expected = {
            2320000000: (2300.0, "13cm"), 3400000000: (3300.0, "9cm"),
            5670000000: (5650.0, "6cm"), 10360000000: (10000.0, "3cm"),
            24048000000: (24000.0, "1.25cm"), 47088000000: (47000.0, "6mm"),
            76000000000: (75500.0, "4mm"), 120000000000: (119980.0, "2.5mm"),
            142000000000: (134000.0, "2mm"), 242000000000: (241000.0, "1mm"),
            300000000000: (300000.0, "submm"),
        }
        result = self.create("arrl_vhf_jan", "JN88", 300000000000, "CW")
        self.assertEqual(result["projection"]["supportedBands"][-11:],
                         [label for _, label in expected.values()])
        for frequency, (band, _) in expected.items():
            with self.subTest(frequency=frequency):
                self.assertEqual(Desk.band(frequency), band)
        self.assertEqual(self.read("projection")["projection"]["band"], 300000.0)

    def test_vhf_season_scoring_and_exact_plugin_differences(self):
        expected = {"arrl_vhf_jan": 39, "arrl_vhf_jun": 24, "arrl_vhf_sep": 24}
        for plugin_id, total in expected.items():
            with self.subTest(plugin=plugin_id):
                self.host.close()
                self.root = Path(self.temporary.name).resolve() / plugin_id
                self.host = Host(self.root)
                self.revision = 0
                self.create(plugin_id, "JN88", 50125000, "CW")
                self.mutate("qso_commit", qsoID=uid(), timestamp="2026-09-12 18:00:00",
                            fields={"callsign": "K1ABC", "other_2": "FN31"})
                self.mutate("qso_commit", qsoID=uid(), timestamp="2026-09-12 18:01:00",
                            frequencyHz=902100000, fields={"callsign": "DL1ABC", "other_2": "JO60"})
                self.mutate("qso_commit", qsoID=uid(), timestamp="2026-09-12 18:02:00",
                            frequencyHz=3400000000, fields={"callsign": "VK4ABC", "other_2": "QG62"})
                self.assertEqual(self.read("score")["score"]["total"], total)

    def test_vhf_am_fm_reports_scoring_and_cabrillo_are_phone_compatible(self):
        result = self.create("arrl_vhf_jun", "JN88", 144100000, "AM", "MIXED")
        fields = {row["id"]: row["value"] for row in result["projection"]["fields"]}
        self.assertEqual((fields["sent"], fields["receive"]), ("59", "59"))
        self.mutate("qso_commit", qsoID=uid(), timestamp="2026-06-13 18:00:00",
                    fields={"callsign": "K1ABC", "other_2": "FN31"})
        self.mutate("qso_commit", qsoID=uid(), timestamp="2026-06-13 18:01:00",
                    frequencyHz=2320000000, mode="FM",
                    fields={"callsign": "DL1ABC", "other_2": "JO60"})
        rows = self.read("log")["rows"]
        self.assertEqual([(row["Mode"], row["SNT"], row["RCV"], row["Points"]) for row in rows],
                         [("FM", "59", "59", 4), ("AM", "59", "59", 1)])
        self.assertEqual(self.read("score")["score"]["total"], 10)
        qso_lines = [line for line in self.read("export")["content"].splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(all(" PH " in line for line in qso_lines))
        adif = self.prepared_adif()
        self.assertIn("<MODE:2>AM", adif)
        self.assertIn("<MODE:2>FM", adif)

    def test_vhf_historical_grid_restart_cabrillo_and_adif(self):
        self.create("arrl_vhf_jun", "JN88", 144100000, "CW")
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp="2026-06-13 18:00:00",
                    fields={"callsign": "K1ABC", "other_2": "FN31"})
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "JN89"
        self.mutate("setup_save", setup=setup)
        self.mutate("qso_correct", qsoID=qso, fields={"other_2": "FN32"}, reason="Correct grid")
        row = self.read("log")["rows"][0]
        self.assertEqual((row["SentNr"], row["NR"], row["Points"]), ("JN88", "FN32", 1))
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 1)
        cabrillo = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-VHF\r\n", cabrillo)
        self.assertIn("JN88", cabrillo)
        adif = self.prepared_adif()
        self.assertIn("<STX_STRING:4>JN88", adif)
        self.assertIn("<SRX_STRING:4>FN32", adif)


if __name__ == "__main__":
    unittest.main()
