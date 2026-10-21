"""Second eight-plugin pinned Not1MM host batch."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.plugins import PLUGIN_REGISTRY, RTTY_MODES
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "agcw_qrp": "fc73ecd9a4ae2252332496f410d1b7bfb770499722818ba5356a9d81784e375c",
    "raem": "96e4d4fc89b0f0cf992991d29fe5eb67cfdd8970092ae18a6b42e8468388d5fe",
    "rda_contest": "ae456e63e6157b80481557876c5323ab6b980d5e5b044b882712ca8bfad1f9fc",
    "rdxc": "172f96776943a988ae5139f09beb0a4e1fb74da07b89c0456f0bbd9ce3579c0d",
    "rsgb_iota": "2c1c15b1aa962b65f95b50e955118ff5574950a7a4b60915825f3359bf1ab33a",
    "stew_perry_topband": "e6d9e75f13c12e76ed1c8013f7a452acae4492208d647a95c1edc8069e9e20c6",
    "ukeidx": "0ffdf2c6f30f10762b718dece31e2f37028406f6b59845884f3ebbbc9b224228",
    "wia_remembrance": "539627f036aa235ad5ecdc3a5c1ee4590f3fae3975f850ef0b9b7b1ca3df14af",
}
SETTINGS = {"agcw_qrp": "# QRP NM", "raem": "48N17O", "rda_contest": "#", "rdxc": "#",
            "rsgb_iota": "# EU005", "stew_perry_topband": "JN88", "ukeidx": "# DX",
            "wia_remembrance": "#"}
FIELDS = {
    "agcw_qrp": ({"other_2": "101 QRP 1234"}, {"other_2": "102 MP NM"}),
    "raem": ({"other_1": "101", "other_2": "40N74W"}, {"other_1": "102", "other_2": "52N13O"}),
    "rda_contest": ({"other_2": "101"}, {"other_2": "102"}),
    "rdxc": ({"other_2": "101"}, {"other_2": "102"}),
    "rsgb_iota": ({"other_2": "101 NA001"}, {"other_2": "102"}),
    "stew_perry_topband": ({"other_1": "FN20"}, {"other_1": "JO62"}),
    "ukeidx": ({"other_2": "101 AB"}, {"other_2": "102 CD"}),
    "wia_remembrance": ({"other_2": "10"}, {"other_2": "20"}),
}


class SecondRemainingPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, plugin_id, station=None, countries=None, sent_exchange=None, frequency=None):
        root = Path(self.temporary.name).resolve() / f"{plugin_id}-{uid()}"
        host, session = Host(root), uid()
        station = station or {"Call": "OM0RX", "GridSquare": "JN88"}
        reference = deepcopy(countries or fixtures.CTY)
        frequency = frequency or (1825000 if plugin_id == "stew_perry_topband" else 7025000)
        settings = {"SentExchange": sent_exchange if sent_exchange is not None else SETTINGS[plugin_id],
                    "ModeCategory": "MIXED" if len(PLUGIN_REGISTRY[plugin_id].modes) > 1 else "CW",
                    "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL", "PowerCategory": "LOW"}
        if plugin_id == "wia_remembrance":
            settings["ContestUTCOffsetMinutes"] = 570
        result = host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": uid(), "operationID": uid(),
            "expectedRevision": 0, "pluginID": plugin_id, "station": station,
            "frequencyHz": frequency, "mode": "CW",
            "settings": settings,
            "reference": {"id": "batch-two-cty-v1", "countries": reference},
        }})
        return host, root, session, result["revision"]

    @staticmethod
    def mutate(host, session, revision, method, **params):
        result = host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": session, "operationID": uid(), "expectedRevision": revision, **params}})
        return result, result["revision"]

    @staticmethod
    def read(host, session, method, **params):
        return host.dispatch({"id": uid(), "method": method, "params": {"sessionID": session, **params}})

    def test_exact_sources_catalog_and_dynamic_contracts(self):
        self.assertEqual(len(PLUGIN_REGISTRY), 87)
        for plugin_id, digest in HASHES.items():
            source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
            self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
            self.assertEqual(load_plugin(plugin_id).__file__, str(source))
        self.assertEqual(PLUGIN_REGISTRY["wia_remembrance"].modes,
                         ("CW", "SSB", "FM", *RTTY_MODES))
        self.assertNotIn("30m", PLUGIN_REGISTRY["wia_remembrance"].bands)
        for plugin_id, expected in (("rsgb_iota", "001 EU005"), ("ukeidx", "001 DX")):
            host, _, session, _ = self.create(plugin_id)
            try:
                view = self.read(host, session, "projection")["projection"]
                fields = {item["id"]: item["value"] for item in view["fields"]}
                self.assertEqual((view["reservedSerial"], fields["other_1"]), (1, expected))
            finally:
                host.close()

        host, _, session, revision = self.create("agcw_qrp", sent_exchange="007 QRP NM")
        try:
            view = self.read(host, session, "projection")["projection"]
            fields = {item["id"]: item["value"] for item in view["fields"]}
            self.assertIsNone(view["reservedSerial"])
            self.assertEqual(fields["other_1"], "007 QRP NM")
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 00:30:00",
                                      fields={"callsign": "K1ABC", "other_2": "101 QRP 1234"})
            self.assertEqual(self.read(host, session, "log")["rows"][0]["SentNr"], "007 QRP NM")
        finally:
            host.close()

        countries = deepcopy(fixtures.CTY)
        countries["UA1ABC"] = {"entity": "European Russia", "continent": "EU", "cq": 16,
                               "itu": 29, "primary_pfx": "UA"}
        host, _, session, _ = self.create("rda_contest", {"Call": "UA1ABC", "GridSquare": "KO59"},
                                           countries, "MO01")
        try:
            view = self.read(host, session, "projection")["projection"]
            fields = {item["id"]: item["value"] for item in view["fields"]}
            self.assertIsNone(view["reservedSerial"])
            self.assertEqual(fields["other_1"], "MO01")
        finally:
            host.close()

        host, _, session, _ = self.create(
            "stew_perry_topband", {"Call": "OM0RX", "GridSquare": "JN88TQ"},
            sent_exchange="JN88")
        try:
            setup = self.read(host, session, "setup_get")["setup"]
            self.assertEqual((setup["station"]["GridSquare"], setup["settings"]["SentExchange"]),
                             ("JN88TQ", "JN88"))
        finally:
            host.close()

    def test_all_eight_lifecycle_score_history_exports_and_restart(self):
        for plugin_id in HASHES:
            with self.subTest(plugin=plugin_id):
                host, root, session, revision = self.create(plugin_id)
                first, second = uid(), uid()
                try:
                    draft, revision = self.mutate(host, session, revision, "draft_apply",
                                                   fields={"callsign": "K1ABC", **FIELDS[plugin_id][0]})
                    self.assertEqual(draft["projection"]["fields"][0]["value"], "K1ABC")
                    for index, (qso_id, call, fields) in enumerate(((first, "K1ABC", FIELDS[plugin_id][0]),
                                                                    (second, "DL1ABC", FIELDS[plugin_id][1]))):
                        _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                                  timestamp=f"2026-10-21 0{index + 1}:30:00",
                                                  fields={"callsign": call, **fields})
                    score = self.read(host, session, "score")["score"]
                    self.assertEqual(score["qsos"], 2)
                    _, revision = self.mutate(host, session, revision, "recalculate")
                    self.assertEqual(self.read(host, session, "score")["score"], score)
                    if plugin_id == "rsgb_iota":
                        self.assertEqual((score["points"], score["multipliers"], score["total"]), (20, 1, 40))
                    if plugin_id == "stew_perry_topband":
                        self.assertGreater(score["points"], 2)
                        projected = {item["id"]: item["value"] for item in
                                     self.read(host, session, "projection")["projection"]["fields"]}
                        self.assertEqual(projected["other_1"], "")
                    self.assertIn("QSO:", self.read(host, session, "export")["content"])
                    self.assertEqual(self.read(host, session, "export_prepare", format="adif")["format"], "adif")

                    before = next(row for row in self.read(host, session, "log")["rows"] if row["ID"] == first)
                    _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=first,
                                              fields={"receive": "589"}, reason="Unrelated report correction")
                    after = next(row for row in self.read(host, session, "log")["rows"] if row["ID"] == first)
                    self.assertEqual(after["SentNr"], before["SentNr"])
                    self.assertEqual(after["MiscText"], before["MiscText"])
                    if plugin_id == "raem":
                        setup = self.read(host, session, "setup_get")["setup"]
                        setup["settings"]["SentExchange"] = "33N117W"
                        _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
                        self.assertIn("48N17O", self.read(host, session, "export")["content"])
                    if plugin_id == "stew_perry_topband":
                        setup = self.read(host, session, "setup_get")["setup"]
                        setup["station"]["GridSquare"] = "FN31"
                        setup["settings"]["SentExchange"] = "FN31"
                        _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
                        self.assertIn("JN88", self.read(host, session, "export")["content"])
                    _, revision = self.mutate(host, session, revision, "qso_delete", qsoID=second,
                                              reason="Focused deletion")
                    _, revision = self.mutate(host, session, revision, "recalculate")
                finally:
                    host.close()
                host = Host(root)
                try:
                    self.assertEqual(len(self.read(host, session, "log")["rows"]), 1)
                    self.assertIn("QSO:", self.read(host, session, "export")["content"])
                finally:
                    host.close()

    def test_timestamp_scoring_dupe_and_same_second_multiplier_replay(self):
        countries = deepcopy(fixtures.CTY)
        countries["G1ABC"] = {"entity": "England", "continent": "EU", "cq": 14,
                              "itu": 27, "primary_pfx": "G"}
        host, _, session, revision = self.create("ukeidx", {"Call": "G1ABC", "GridSquare": "IO91"}, countries)
        try:
            for call, timestamp in (("K1ABC", "2026-10-21 01:30:00"), ("DL1ABC", "2026-10-21 05:00:00")):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(), timestamp=timestamp,
                                          fields={"callsign": call, "other_2": "101 AB"})
            rows = {row["Call"]: row for row in self.read(host, session, "log")["rows"]}
            # Low-band values use the source's intended branch; only the QSO
            # timestamp supplies the deterministic 0100-0459 bonus.
            self.assertEqual(rows["K1ABC"]["Points"], 16)
            self.assertEqual(rows["DL1ABC"]["Points"], 4)
        finally:
            host.close()

        # A world station earns 2 points for another world station and 15 for
        # an island.  One IOTA reference produces one multiplier, while the
        # pinned implementation deliberately scores with (multipliers + 1).
        host, _, session, revision = self.create("rsgb_iota", sent_exchange="#")
        try:
            for call, exchange in (("K1ABC", "101"), ("DL1ABC", "102 EU005")):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          timestamp="2026-10-21 07:30:00",
                                          fields={"callsign": call, "other_2": exchange})
            score = self.read(host, session, "score")["score"]
            self.assertEqual((score["points"], score["multipliers"], score["total"]), (17, 1, 34))
        finally:
            host.close()

        host, _, session, revision = self.create(
            "stew_perry_topband", {"Call": "OM0RX", "GridSquare": "JN88TQ"},
            sent_exchange="JN88")
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 07:45:00",
                                      fields={"callsign": "K1ABC", "other_1": "FN20"})
            original = self.read(host, session, "log")["rows"][0]["Points"]
            setup = self.read(host, session, "setup_get")["setup"]
            setup["station"]["GridSquare"] = "FN31"
            setup["settings"]["SentExchange"] = "FN31"
            setup["settings"]["PowerCategory"] = "HIGH"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "recalculate")
            row = self.read(host, session, "log")["rows"][0]
            self.assertEqual((row["Points"], row["Power"], row["MiscText"]),
                             (original, "LOW", "JN88|JN88TQ"))
        finally:
            host.close()

        host, _, session, revision = self.create("wia_remembrance")
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 00:00:00",
                                      fields={"callsign": "K1ABC", "other_2": "10"})
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 03:00:00",
                                      fields={"callsign": "K1ABC", "other_2": "10"})
            rows = list(reversed(self.read(host, session, "log")["rows"]))
            self.assertGreater(rows[1]["Points"], 0)
        finally:
            host.close()

        host, _, session, revision = self.create("agcw_qrp")
        try:
            for call in ("K1ABC", "DL1ABC"):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          timestamp="2026-10-21 03:00:00",
                                          fields={"callsign": call, "other_2": "101 QRP 1234"})
            self.assertEqual(sum(row["IsMultiplier1"] for row in self.read(host, session, "log")["rows"]), 1)
        finally:
            host.close()

        countries = deepcopy(fixtures.CTY)
        countries.update({
            "UA1AAA": {"entity": "European Russia", "continent": "EU", "cq": 16,
                       "itu": 29, "primary_pfx": "UA"},
            "UA2BBB": {"entity": "European Russia", "continent": "EU", "cq": 16,
                       "itu": 29, "primary_pfx": "UA"},
            "K2DEF": {"entity": "United States", "continent": "NA", "cq": 5,
                      "itu": 8, "primary_pfx": "K"},
        })
        for plugin_id, calls, received, multiplier in (
                ("rda_contest", ("UA1AAA", "UA2BBB"), "MO01", "IsMultiplier1"),
                ("rdxc", ("K1ABC", "K2DEF"), "101", "IsMultiplier2")):
            host, _, session, revision = self.create(plugin_id, countries=countries)
            try:
                for call in calls:
                    _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                              timestamp="2026-10-21 06:00:00",
                                              fields={"callsign": call, "other_2": received})
                self.assertEqual(sum(row[multiplier] for row in self.read(host, session, "log")["rows"]), 1)
            finally:
                host.close()

    def test_pinned_scoring_boundaries_and_historical_replay(self):
        host, _, session, revision = self.create("raem", sent_exchange="33N117W")
        try:
            qso_id = uid()
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                      timestamp="2026-10-21 07:00:00",
                                      fields={"callsign": "K1ABC", "other_1": "101", "other_2": "40N100W"})
            self.assertEqual(self.read(host, session, "log")["rows"][0]["Points"], 74)
            setup = self.read(host, session, "setup_get")["setup"]
            setup["settings"]["SentExchange"] = "48N17O"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "recalculate")
            self.assertEqual(self.read(host, session, "log")["rows"][0]["Points"], 74)
        finally:
            host.close()

        countries = deepcopy(fixtures.CTY)
        countries["UA1AAA"] = {"entity": "European Russia", "continent": "EU", "cq": 16,
                               "itu": 29, "primary_pfx": "UA"}
        for plugin_id in ("rda_contest", "rdxc"):
            host, _, session, revision = self.create(plugin_id, countries=countries)
            try:
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          timestamp="2026-10-21 08:00:00",
                                          fields={"callsign": "UA1AAA", "other_2": "MO01"})
                row = self.read(host, session, "log")["rows"][0]
                self.assertEqual(row["Points"], 10)
                self.assertEqual(row["IsMultiplier1"], 1)
                if plugin_id == "rdxc":
                    self.assertEqual(row["IsMultiplier2"], 1)
            finally:
                host.close()

        host, _, session, revision = self.create("wia_remembrance")
        try:
            for call, timestamp in (("K1ABC", "2026-10-20 15:30:00"),
                                    ("DL1ABC", "2026-10-20 20:31:00")):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          timestamp=timestamp, fields={"callsign": call, "other_2": "10"})
            rows = {row["Call"]: row for row in self.read(host, session, "log")["rows"]}
            self.assertEqual((rows["K1ABC"]["Points"], rows["DL1ABC"]["Points"]), (6, 2))
        finally:
            host.close()

        host, _, session, revision = self.create("wia_remembrance", frequency=1825000)
        try:
            for call, timestamp in (("K1ABC", "2026-10-20 15:30:00"),
                                    ("DL1ABC", "2026-10-20 20:30:00")):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          timestamp=timestamp, fields={"callsign": call, "other_2": "10"})
            rows = {row["Call"]: row for row in self.read(host, session, "log")["rows"]}
            self.assertEqual((rows["K1ABC"]["Points"], rows["DL1ABC"]["Points"]), (12, 12))
        finally:
            host.close()

    def test_raem_replay_and_memorial_bonus_survive_rebuild(self):
        host, _, session, revision = self.create("raem", sent_exchange="33N117W")
        try:
            operation = uid()
            request = {"id": uid(), "method": "draft_apply", "params": {
                "sessionID": session, "operationID": operation, "expectedRevision": revision,
                "fields": {"callsign": "RAEM", "other_1": "101", "other_2": "40N100W"}}}
            first = host.dispatch(request)
            replayed = host.dispatch({**request, "id": uid()})
            fields = {field["id"]: field for field in replayed["projection"]["fields"]}
            self.assertEqual((replayed["replayed"], fields["sent"]["value"], fields["sent"]["readOnly"]),
                             (True, "001", True))
            self.assertEqual((fields["other_1"]["value"], fields["other_1"]["readOnly"]), ("101", False))
            revision = first["revision"]
            qso_id = uid()
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                      timestamp="2026-10-21 07:00:00")
            original = self.read(host, session, "log")["rows"][0]["Points"]
            self.assertGreaterEqual(original, 350)
            _, revision = self.mutate(host, session, revision, "recalculate")
            self.assertEqual(self.read(host, session, "log")["rows"][0]["Points"], original)
        finally:
            host.close()

    def test_russian_exchange_forms_score_breakdown_and_historical_sent_correction(self):
        countries = deepcopy(fixtures.CTY)
        countries.update({
            "UA1ABC": {"entity": "European Russia", "continent": "EU", "cq": 16,
                       "itu": 29, "primary_pfx": "UA"},
            "UA2BBB": {"entity": "European Russia", "continent": "EU", "cq": 16,
                       "itu": 29, "primary_pfx": "UA"},
        })
        host, _, session, revision = self.create(
            "rda_contest", {"Call": "UA1ABC", "GridSquare": "KO59"}, countries, "MO-01")
        try:
            qso_id = uid()
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                      timestamp="2026-10-21 08:00:00",
                                      fields={"callsign": "UA2BBB", "other_2": "MO-01"})
            score = self.read(host, session, "score")["score"]
            self.assertEqual((score["countries"], score["rdaDistricts"], score["multipliers"]), (1, 1, 2))
            setup = self.read(host, session, "setup_get")["setup"]
            setup["settings"]["SentExchange"] = "SP-01"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=qso_id,
                                      fields={"receive": "589"}, reason="Report only")
            row = self.read(host, session, "log")["rows"][0]
            self.assertEqual((row["SentNr"], row["RCV"]), ("MO-01", "589"))
        finally:
            host.close()

        host, _, session, revision = self.create("rdxc", countries=countries)
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 09:00:00",
                                      fields={"callsign": "UA1ABC", "other_2": "MO"})
            score = self.read(host, session, "score")["score"]
            self.assertEqual((score["countries"], score["oblasts"], score["multipliers"]), (1, 1, 2))
        finally:
            host.close()

    def test_fixed_agcw_history_and_rsgb_ukei_serial_validation(self):
        host, _, session, revision = self.create("agcw_qrp", sent_exchange="007 QRP NM")
        try:
            qso_id = uid()
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                      timestamp="2026-10-21 10:00:00",
                                      fields={"callsign": "K1ABC", "other_2": "101 QRP 1234"})
            setup = self.read(host, session, "setup_get")["setup"]
            setup["settings"]["SentExchange"] = "009 MP NM"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=qso_id,
                                      fields={"receive": "589"}, reason="Report only")
            self.assertEqual(self.read(host, session, "log")["rows"][0]["SentNr"], "007 QRP NM")
        finally:
            host.close()

        host, _, session, revision = self.create("ukeidx")
        try:
            qso_id = uid()
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso_id,
                                      timestamp="2026-10-21 11:00:00",
                                      fields={"callsign": "K1ABC", "other_2": "101AB"})
            with self.assertRaisesRegex(HostError, "positive serial"):
                self.mutate(host, session, revision, "qso_correct", qsoID=qso_id,
                            fields={"other_1": "0 DX"}, reason="Invalid sent serial")
        finally:
            host.close()

        with self.assertRaisesRegex(HostError, "sent exchange"):
            self.create("rsgb_iota", sent_exchange="0 EU005")


if __name__ == "__main__":
    unittest.main()
