"""Focused host regressions for the final seven pinned Not1MM plugins."""
import base64
from copy import deepcopy
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.plugins import PLUGIN_REGISTRY
import test_host as fixtures


uid = fixtures.uid
PLUGINS = (
    "cq_ww_vhf",
    "darc_vhf",
    "john_moyle_field_day",
    "labre_rs_digi",
    "nac_vhf",
    "ta_vhf_uhf_contest",
    "vhf_sprint",
)


class FinalRemainingPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, plugin_id, *, frequency=50125000, mode="CW", sent_exchange=None,
               station=None, operator_category="SINGLE-OP", band_category="ALL",
               countries=None, start_date="2026-10-21 00:00:00"):
        root = Path(self.temporary.name).resolve() / f"{plugin_id}-{uid()}"
        host, session = Host(root), uid()
        defaults = {
            "cq_ww_vhf": "JN88",
            "darc_vhf": "#",
            "john_moyle_field_day": "#",
            "labre_rs_digi": "JN88",
            "nac_vhf": "#",
            "ta_vhf_uhf_contest": "#",
            "vhf_sprint": "JN88",
        }
        settings = {
            "SentExchange": defaults[plugin_id] if sent_exchange is None else sent_exchange,
            "StartDate": start_date,
            "ModeCategory": mode,
            "OperatorCategory": operator_category,
            "BandCategory": band_category,
            "PowerCategory": "LOW",
        }
        try:
            result = host.dispatch({"id": uid(), "method": "session_create", "params": {
                "sessionID": session, "workspaceGeneration": uid(), "operationID": uid(),
                "expectedRevision": 0, "pluginID": plugin_id,
                "station": station or {"Call": "OM0RX", "GridSquare": "JN88XX"},
                "frequencyHz": frequency, "mode": mode, "settings": settings,
                "reference": {"id": "final-seven-cty-v1",
                              "countries": deepcopy(countries or fixtures.CTY)},
            }})
        except BaseException:
            host.close()
            raise
        return host, root, session, result["revision"]

    @staticmethod
    def mutate(host, session, revision, method, **params):
        result = host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": session, "operationID": uid(),
            "expectedRevision": revision, **params}})
        return result, result["revision"]

    @staticmethod
    def read(host, session, method, **params):
        return host.dispatch({"id": uid(), "method": method,
                              "params": {"sessionID": session, **params}})

    def test_vhf_admission_and_ta_advertises_no_cabrillo(self):
        for plugin_id in PLUGINS:
            self.assertIn(plugin_id, PLUGIN_REGISTRY)

        for plugin_id, frequency, mode in (
                ("cq_ww_vhf", 50125000, "CW"),
                ("cq_ww_vhf", 144100000, "SSB"),
                ("darc_vhf", 144300000, "FM"),
                ("john_moyle_field_day", 50125000, "CW"),
                ("nac_vhf", 144300000, "SSB"),
                ("ta_vhf_uhf_contest", 432200000, "CW"),
                ("vhf_sprint", 50125000, "SSB")):
            with self.subTest(plugin=plugin_id, frequency=frequency):
                host, _, session, _ = self.create(plugin_id, frequency=frequency, mode=mode)
                try:
                    projection = self.read(host, session, "projection")["projection"]
                    self.assertIn(projection["band"], (50.0, 144.0, 432.0))
                finally:
                    host.close()

        for plugin_id in ("cq_ww_vhf", "darc_vhf", "nac_vhf",
                          "ta_vhf_uhf_contest", "vhf_sprint"):
            with self.subTest(plugin=plugin_id, invalid_band="20m"), self.assertRaises(HostError):
                self.create(plugin_id, frequency=14025000)

        host, _, session, _ = self.create("ta_vhf_uhf_contest", frequency=144300000)
        try:
            projection = self.read(host, session, "projection")["projection"]
            self.assertEqual(projection["exportFormats"], ["adif", "edi"])
            with self.assertRaises(HostError) as error:
                self.read(host, session, "export_prepare", format="cabrillo")
            self.assertEqual(error.exception.code, "export_unsupported")
        finally:
            host.close()

        self.assertEqual(PLUGIN_REGISTRY["darc_vhf"].export_formats,
                         ("cabrillo", "adif", "edi"))
        self.assertEqual(PLUGIN_REGISTRY["nac_vhf"].export_formats,
                         ("cabrillo", "adif", "edi"))
        self.assertEqual(
            {plugin_id for plugin_id, plugin in PLUGIN_REGISTRY.items()
             if "edi" in plugin.export_formats},
            {"darc_vhf", "nac_vhf", "ta_vhf_uhf_contest"},
        )

    def test_edi_export_requires_canonical_start_date_without_blocking_other_workflows(self):
        for plugin_id in ("darc_vhf", "nac_vhf", "ta_vhf_uhf_contest"):
            for invalid in ("", "2026-10-21", "2026-10-21T00:00:00", "2026-02-30 00:00:00"):
                with self.subTest(plugin=plugin_id, start=invalid):
                    host, _, session, revision = self.create(
                        plugin_id, frequency=144300000, start_date=invalid)
                    try:
                        setup = self.read(host, session, "setup_get")["setup"]
                        setup["station"]["Club"] = "OM DX Club"
                        saved, revision = self.mutate(
                            host, session, revision, "setup_save", setup=setup)
                        self.assertEqual(saved["projection"]["revision"], revision)
                        with self.assertRaisesRegex(HostError, "EDI contest start must be UTC"):
                            self.read(host, session, "export_prepare", format="edi")
                    finally:
                        host.close()

    def test_original_edi_writers_use_prepared_private_chunked_export(self):
        expected_names = {
            "darc_vhf": "DARC VHF Contest",
            "nac_vhf": "NAC",
            "ta_vhf_uhf_contest": "TA 50_144_430 Contest",
        }
        private_home = Path(self.temporary.name) / "operator-home"
        private_home.mkdir()
        previous_home = os.environ.get("HOME")
        os.environ["HOME"] = str(private_home)
        try:
            for plugin_id, contest_name in expected_names.items():
                with self.subTest(plugin=plugin_id):
                    host, _, session, revision = self.create(plugin_id, frequency=144300000)
                    try:
                        _, revision = self.mutate(
                            host, session, revision, "qso_commit", qsoID=uid(),
                            timestamp="2026-10-21 01:30:00",
                            fields={"callsign": "K1ABC", "other_2": "101 JO60AA"})
                        points = self.read(host, session, "score")["score"]["points"]
                        prepared = self.read(host, session, "export_prepare", format="edi")
                        self.assertEqual(prepared["format"], "edi")
                        self.assertTrue(prepared["filename"].endswith(".edi"))
                        chunks = []
                        offset = 0
                        while offset < prepared["byteLength"]:
                            length = min(37, prepared["byteLength"] - offset)
                            chunk = self.read(
                                host, session, "export_read", exportID=prepared["artifactID"],
                                workspaceGeneration=prepared["workspaceGeneration"],
                                offset=offset, length=length)
                            chunks.append(base64.b64decode(chunk["dataBase64"]))
                            offset += length
                            self.assertEqual(chunk["eof"], offset == prepared["byteLength"])
                        payload = b"".join(chunks)
                        self.assertEqual(len(payload), prepared["byteLength"])
                        self.assertNotIn(b"\n", payload.replace(b"\r\n", b""))
                        content = payload.decode("ascii")
                        self.assertTrue(content.startswith("[REG1TEST;1]\r\n"))
                        self.assertIn(f"TName={contest_name}\r\n", content)
                        self.assertIn("TDate=20261021;20261021\r\n", content)
                        self.assertIn("PCall=OM0RX\r\n", content)
                        self.assertIn("PWWLo=JN88XX\r\n", content)
                        self.assertIn("CQSOs=1;1\r\n", content)
                        self.assertIn(f"CQSOP={points}\r\n", content)
                        self.assertIn(f"CToSc={points}\r\n", content)
                        self.assertIn("[QSORecords;1]\r\n", content)
                        self.assertIn("K1ABC", content)
                        self.assertIn("JO60AA", content)
                        self.assertEqual(list(private_home.glob("*.edi")), [])

                        released = self.read(
                            host, session, "export_release", exportID=prepared["artifactID"],
                            workspaceGeneration=prepared["workspaceGeneration"])
                        self.assertTrue(released["released"])
                        with self.assertRaisesRegex(HostError, "unavailable"):
                            self.read(host, session, "export_read", exportID=prepared["artifactID"],
                                      workspaceGeneration=prepared["workspaceGeneration"],
                                      offset=0, length=1)
                    finally:
                        host.close()
                    self.assertEqual(os.environ.get("HOME"), str(private_home))
        finally:
            if previous_home is None:
                os.environ.pop("HOME", None)
            else:
                os.environ["HOME"] = previous_home

    def test_edi_is_rejected_outside_the_three_original_plugins(self):
        host, _, session, _ = self.create("cq_ww_vhf", frequency=50125000)
        try:
            with self.assertRaises(HostError) as caught:
                self.read(host, session, "export_prepare", format="edi")
            self.assertEqual(caught.exception.code, "export_unsupported")
            with self.assertRaisesRegex(HostError, "Unsupported contest export format"):
                self.read(host, session, "export_prepare", format="reg1test")
        finally:
            host.close()

    def test_grid_exchanges_are_strict_and_normalized(self):
        cases = (
            ("cq_ww_vhf", 50125000, "fn31", "FN31", "NR"),
            ("labre_rs_digi", 14080000, "gg40", "GG40", "NR"),
            ("vhf_sprint", 144300000, "jo60", "JO60", "NR"),
            ("darc_vhf", 144300000, "101 JO60AA", "JO60AA", "Exchange1"),
            ("nac_vhf", 144300000, "101 JO60AA", "JO60AA", "Exchange1"),
            ("ta_vhf_uhf_contest", 144300000, "101 JO60AA", "JO60AA", "Exchange1"),
        )
        for plugin_id, frequency, exchange, expected, column in cases:
            with self.subTest(plugin=plugin_id):
                mode = "RTTY" if plugin_id == "labre_rs_digi" else "CW"
                host, _, session, revision = self.create(plugin_id, frequency=frequency, mode=mode)
                try:
                    invalid = "101 BAD" if " " in exchange else "BAD"
                    with self.assertRaises(HostError):
                        self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                    fields={"callsign": "K1ABC", "other_2": invalid})
                    fields = {"callsign": "K1ABC", "other_2": exchange}
                    if plugin_id in {"cq_ww_vhf", "labre_rs_digi", "vhf_sprint"}:
                        fields["other_1"] = "jn88"
                    _, revision = self.mutate(
                        host, session, revision, "qso_commit", qsoID=uid(),
                        timestamp="2026-10-21 01:30:00",
                        fields=fields)
                    row = self.read(host, session, "log")["rows"][0]
                    self.assertEqual(row[column], expected)
                finally:
                    host.close()

        host, _, session, revision = self.create("cq_ww_vhf", sent_exchange="jn88xx")
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      fields={"callsign": "K1ABC", "other_2": "fn31pr"})
            row = self.read(host, session, "log")["rows"][0]
            self.assertEqual((row["SentNr"], row["NR"]), ("JN88", "FN31"))
        finally:
            host.close()

    def test_numeric_band_scoring_overlays(self):
        host, _, session, revision = self.create("cq_ww_vhf", frequency=50125000)
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      fields={"callsign": "K1ABC", "other_2": "FN31"})
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      frequencyHz=144100000,
                                      fields={"callsign": "DL1ABC", "other_2": "JO60"})
            rows = {row["Band"]: row["Points"] for row in self.read(host, session, "log")["rows"]}
            self.assertEqual((rows[50.0], rows[144.0]), (1, 2))
        finally:
            host.close()

        host, _, session, revision = self.create("vhf_sprint", frequency=50125000)
        try:
            for frequency, call, grid in ((50125000, "K1ABC", "FN31"),
                                          (144100000, "DL1ABC", "JO60")):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          frequencyHz=frequency,
                                          fields={"callsign": call, "other_2": grid})
            self.assertEqual({row["Points"] for row in self.read(host, session, "log")["rows"]}, {1})
        finally:
            host.close()

        points = {}
        for frequency, band in ((50125000, 50.0), (144300000, 144.0), (432200000, 432.0)):
            host, _, session, revision = self.create("ta_vhf_uhf_contest", frequency=frequency)
            try:
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          fields={"callsign": "K1ABC", "other_2": "101 JO60AA"})
                points[band] = self.read(host, session, "log")["rows"][0]["Points"]
            finally:
                host.close()
        self.assertGreater(points[50.0], 1)
        self.assertEqual(points[144.0], points[50.0] * 2)
        self.assertEqual(points[432.0], points[50.0] * 3)

    def test_serial_scope_and_restart(self):
        for plugin_id in ("darc_vhf", "nac_vhf", "ta_vhf_uhf_contest"):
            with self.subTest(plugin=plugin_id):
                host, root, session, revision = self.create(plugin_id, frequency=144300000)
                try:
                    projection = self.read(host, session, "projection")["projection"]
                    self.assertEqual(projection["reservedSerial"], 1)
                    _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                              fields={"callsign": "K1ABC", "other_2": "101 JO60AA"})
                finally:
                    host.close()
                host = Host(root)
                try:
                    projection = self.read(host, session, "session_open")["projection"]
                    self.assertEqual(projection["reservedSerial"], 2)
                    values = {field["id"]: field["value"] for field in projection["fields"]}
                    self.assertEqual(values["other_1"], "002")
                finally:
                    host.close()

        host, _, session, revision = self.create(
            "john_moyle_field_day", frequency=144300000, operator_category="MULTI-OP")
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      fields={"callsign": "K1ABC", "other_2": "101"})
            changed, revision = self.mutate(host, session, revision, "draft_apply",
                                            frequencyHz=432200000)
            values = {field["id"]: field["value"] for field in changed["projection"]["fields"]}
            self.assertEqual((changed["projection"]["reservedSerial"], values["other_1"]), (1, "001"))
        finally:
            host.close()

    def test_jmmfd_timestamp_blocks_dupes_and_multiplier_tie_break(self):
        countries = deepcopy(fixtures.CTY)
        for call in ("VK4ABC", "VK2AAA", "VK2AAB"):
            countries[call] = {"entity": "Australia", "continent": "OC", "cq": 30,
                               "itu": 59, "primary_pfx": "VK"}
        host, _, session, revision = self.create(
            "john_moyle_field_day", frequency=144300000,
            station={"Call": "VK4ABC", "GridSquare": "QG62"}, countries=countries)
        try:
            first = "00000000-0000-4000-8000-000000000001"
            second = "00000000-0000-4000-8000-000000000002"
            for qso_id, call in ((second, "VK2AAB"), (first, "VK2AAA")):
                _, revision = self.mutate(
                    host, session, revision, "qso_commit", qsoID=qso_id,
                    timestamp="2026-10-21 01:30:00", fields={"callsign": call, "other_2": "101"})
            rows = {row["ID"]: row for row in self.read(host, session, "log")["rows"]}
            self.assertEqual((rows[first]["MiscText"], rows[second]["MiscText"]), ("0", "0"))
            # Stable chronological replay uses SQLite row order as its durable
            # tie-break when two contacts share one UTC second.
            self.assertEqual((rows[first]["IsMultiplier1"], rows[second]["IsMultiplier1"]), (0, 1))

            _, revision = self.mutate(
                host, session, revision, "qso_commit", qsoID=uid(),
                timestamp="2026-10-21 02:00:00",
                fields={"callsign": "VK2AAA", "other_2": "102"})
            same_block = [row for row in self.read(host, session, "log")["rows"]
                          if row["Call"] == "VK2AAA" and row["TS"].endswith("02:00:00")][0]
            self.assertEqual(same_block["Points"], 0)
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 04:00:00",
                                      fields={"callsign": "VK2AAA", "other_2": "102"})
            replayed, revision = self.mutate(host, session, revision, "recalculate")
            self.assertEqual(replayed["projection"]["score"], self.read(host, session, "score")["score"])
        finally:
            host.close()

    def test_cq_vhf_rover_grid_survives_setup_edit_replay_and_restart(self):
        host, root, session, revision = self.create("cq_ww_vhf", frequency=144100000)
        qso_id = uid()
        try:
            _, revision = self.mutate(host, session, revision, "rover_location", location="QG62")
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                      timestamp="2026-10-21 01:30:00",
                                      fields={"callsign": "K1ABC", "other_2": "FN31"})
            setup = self.read(host, session, "setup_get")["setup"]
            setup["settings"]["SentExchange"] = "JN89"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=qso_id,
                                      fields={"receive": "589"}, reason="Report correction")
            _, revision = self.mutate(host, session, revision, "recalculate")
            row = self.read(host, session, "log")["rows"][0]
            self.assertEqual((row["SentNr"], row["RoverLocation"]), ("QG62", "QG62"))
        finally:
            host.close()
        host = Host(root)
        try:
            row = self.read(host, session, "log")["rows"][0]
            self.assertEqual((row["SentNr"], row["RoverLocation"]), ("QG62", "QG62"))
        finally:
            host.close()

    def test_nac_first_large_square_bonus_is_applied_once(self):
        host, _, session, revision = self.create("nac_vhf", frequency=144300000)
        try:
            for call, exchange in (("K1ABC", "101 JO60AA"), ("DL1ABC", "102 JO60AA")):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          fields={"callsign": call, "other_2": exchange})
            rows = {row["Call"]: row for row in self.read(host, session, "log")["rows"]}
            self.assertEqual(rows["K1ABC"]["Points"] - rows["DL1ABC"]["Points"], 500)
            score = self.read(host, session, "score")["score"]
            self.assertEqual((score["gridSquares"], score["multipliers"]), (1, 1))
        finally:
            host.close()


if __name__ == "__main__":
    unittest.main()
