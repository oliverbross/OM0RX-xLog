"""Pinned Estonian contest family through the executable Not1MM host."""
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
    "ES1ABC": {"entity": "Estonia", "continent": "EU", "cq": 15, "itu": 29,
               "primary_pfx": "ES"},
    "ES5AAA": {"entity": "Estonia", "continent": "EU", "cq": 15, "itu": 29,
               "primary_pfx": "ES"},
}
HASHES = {
    "es_field_day": "b0dbe23dc1d41aa313eaa76955a7999be3a2066f404daacb66a9cd33dd9d94b4",
    "es_ll_kv": "68996afb0fd28d9f7e0f31481bea7644e9a2a7391ad384301e7cff43edf37a61",
    "es_manual_key": "785c7367ea9f3d19b11c40bc2d890564e13f1e34dd91c61ba5739b875a9ac9db",
    "es_open": "5b9563e0df2cb275ee1e13ac3d6d8653d566c74d922fdab9d6f4779b03618333",
}


class EstonianHost:
    def __init__(self, root, plugin_id):
        self.host = Host(root)
        self.plugin_id = plugin_id
        self.session, self.workspace, self.revision = uid(), uid(), 0
        station = {"Call": "ES1ABC", "GridSquare": "KO29", "State": "HM",
                   "LicenseClass": "05"}
        self.call("session_create", {
            "sessionID": self.session, "workspaceGeneration": self.workspace,
            "operationID": uid(), "expectedRevision": 0, "pluginID": plugin_id,
            "station": station, "frequencyHz": 7025000,
            "settings": {"SentExchange": "#", "StartDate": "2026-10-21 08:00:00",
                         "ModeCategory": "CW", "OperatorCategory": "SINGLE-OP",
                         "BandCategory": "ALL", "PowerCategory": "LOW"},
            "reference": {"id": "estonian-cty-v1", "countries": deepcopy(CTY)},
        })

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def mutate(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, "operationID": uid(),
                                  "expectedRevision": self.revision, **kwargs})

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def log(self, timestamp, exchange, call="K1ABC"):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=timestamp,
                    fields={"callsign": call, "other_2": exchange})
        return qso


class EstonianPluginHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_sources_catalog_projection_and_setup_validation(self):
        expected_sent = {
            "es_field_day": "001 HM", "es_ll_kv": "001",
            "es_manual_key": "05001", "es_open": "001",
        }
        for plugin_id, digest in HASHES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                case = EstonianHost(self.root / plugin_id, plugin_id)
                try:
                    projection = case.read("projection")["projection"]
                    fields = {field["id"]: field for field in projection["fields"]}
                    self.assertEqual(projection["reservedSerial"], 1)
                    self.assertEqual(fields["other_1"]["value"], expected_sent[plugin_id])
                    self.assertTrue(fields["other_1"]["readOnly"])
                    self.assertEqual(fields["other_2"]["label"], "SN")
                finally:
                    case.host.close()

        case = EstonianHost(self.root / "validation", "es_open")
        try:
            bad = {"pluginID": "es_open", "workspaceGeneration": uid(),
                   "station": {"Call": "ES1ABC"}, "frequencyHz": 7025000,
                   "settings": {"SentExchange": "#", "StartDate": "not-a-date"},
                   "reference": {"id": "estonian-cty-v1", "countries": deepcopy(CTY)}}
            with self.assertRaisesRegex(HostError, "start must be UTC"):
                case.host.new_state(uid(), bad)
        finally:
            case.host.close()

    def test_period_duplicates_scoring_and_exchange_validation(self):
        cases = {
            "es_field_day": ("001", "2026-10-21 08:31:00", 2),
            "es_ll_kv": ("001", "2026-10-21 08:16:00", 4),
            "es_manual_key": ("05001", "2026-10-21 08:16:00", 65),
            "es_open": ("001", "2026-10-21 09:01:00", 0),
        }
        for plugin_id, (exchange, next_period, total) in cases.items():
            with self.subTest(plugin=plugin_id):
                case = EstonianHost(self.root / f"score-{plugin_id}", plugin_id)
                try:
                    first = case.log("2026-10-21 08:01:00", exchange)
                    duplicate = case.log("2026-10-21 08:05:00", exchange)
                    third = case.log(next_period, exchange)
                    rows = {row["ID"]: row for row in case.read("log")["rows"]}
                    self.assertGreater(rows[first]["Points"], 0)
                    self.assertEqual(rows[duplicate]["Points"], 0)
                    self.assertGreater(rows[third]["Points"], 0)
                    self.assertEqual(case.read("score")["score"]["total"], total,
                                     [(row["TS"], row["Points"], row["CountryPrefix"], row["WPXPrefix"])
                                      for row in rows.values()])
                    with self.assertRaisesRegex(HostError, "exchange|received serial"):
                        case.mutate("qso_commit", timestamp="2026-10-21 08:20:00",
                                    fields={"callsign": "DL1ABC", "other_2": "BAD"})
                finally:
                    case.host.close()

    def test_field_day_multiplier_and_open_correction_restart_export(self):
        field_day = EstonianHost(self.root / "field-day", "es_field_day")
        try:
            field_day.log("2026-10-21 08:01:00", "001 HM", "ES5AAA")
            score = field_day.read("score")["score"]
            self.assertEqual((score["points"], score["multipliers"], score["total"]), (1, 1, 2))
            with self.assertRaisesRegex(HostError, "valid region"):
                field_day.mutate("qso_commit", timestamp="2026-10-21 08:20:00",
                                 fields={"callsign": "ES5AAA", "other_2": "002 ZZ"})
        finally:
            field_day.host.close()

        contest = EstonianHost(self.root / "open", "es_open")
        qso = contest.log("2026-10-21 08:01:00", "001")
        contest.mutate("qso_correct", qsoID=qso, fields={"callsign": "DL1ABC"},
                       reason="Correct callsign")
        self.assertEqual(contest.read("score")["score"]["total"], 0)
        contest.host.close()
        contest.host = Host(self.root / "open")
        try:
            self.assertEqual(contest.read("score")["score"]["total"], 0)
            export = contest.read("export")["content"]
            self.assertIn("CONTEST: ES-OPEN-HF\r\n", export)
            self.assertIn("CLAIMED-SCORE: 0\r\n", export)
            self.assertIn("DL1ABC", export)
        finally:
            contest.host.close()


if __name__ == "__main__":
    unittest.main()
