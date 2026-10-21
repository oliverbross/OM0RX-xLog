"""Pinned Not1MM utility and dupe-type-4 plugins through the bounded host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "dxpedition": "7af5440718a7d4910b3c4eeac31a927001c63f6ef806370aa74de0f8b0993bc8",
    "general_logging": "e016498859d98cc915c2e1bfd1c3aa616fcba827c579ede193347ef39766f26d",
    "randomgram": "d93f7009517c4d179062ddd74327dbb90f9800a5e4ecfe6660fda310596112e9",
    "qso_party_rst": "f3d97ca32cdd4a6779153e82d4d75ff1daca2aed27107a514b09e5dcb7e033ef",
    "qso_party_sn": "1d1ba1669c7308eff804b1c589a35fa523df210c23e1c88db46070e247330325",
}
CASES = {
    "dxpedition": ({"callsign": "K1ABC", "sent": "599", "receive": "579"}, 0),
    "general_logging": ({"callsign": "K1ABC", "other_1": "Alice", "other_2": "portable"}, 0),
    "randomgram": ({"callsign": "K1ABC", "other_1": "ABC", "other_2": "XYZ"}, 2),
    "qso_party_rst": ({"callsign": "K1ABC", "other_1": "NEW"}, 2),
    "qso_party_sn": ({"callsign": "K1ABC", "sent": "17", "receive": "42", "other_1": "NEW"}, 2),
}


class Type4UtilityPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, plugin_id):
        root = Path(self.temporary.name).resolve() / f"{plugin_id}-{uid()}"
        host, session = Host(root), uid()
        result = host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": uid(), "operationID": uid(),
            "expectedRevision": 0, "pluginID": plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88XX"},
            "frequencyHz": 7025000, "mode": "CW",
            "settings": {"SentExchange": "NIT", "ModeCategory": "CW",
                         "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL",
                         "PowerCategory": "LOW"},
            "reference": {"id": "type4-cty-v1", "countries": deepcopy(fixtures.CTY)},
        }})
        return host, root, session, result["revision"]

    @staticmethod
    def mutate(host, session, revision, method, **params):
        result = host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": session, "operationID": uid(), "expectedRevision": revision, **params}})
        return result, result["revision"]

    @staticmethod
    def read(host, session, method, **params):
        return host.dispatch({"id": uid(), "method": method,
                              "params": {"sessionID": session, **params}})

    def test_exact_source_catalog_layout_and_dxpedition_running_facade(self):
        expected = {
            "dxpedition": ("DX-Pedition", ["CW", "SSB"]),
            "general_logging": ("General Logging", ["CW", "SSB"]),
            "randomgram": ("RandomGram", ["CW"]),
            "qso_party_rst": ("QSO PARTY RST", ["CW", "SSB"]),
            "qso_party_sn": ("QSO PARTY SN", ["CW", "SSB"]),
        }
        for plugin_id, digest in HASHES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                self.assertEqual(load_plugin(plugin_id).dupe_type, 4)
                host, _, session, _ = self.create(plugin_id)
                try:
                    view = self.read(host, session, "projection")["projection"]
                    self.assertEqual((view["pluginName"], view["supportedModes"]), expected[plugin_id])
                    self.assertTrue(view["allowDuplicateCommit"])
                    self.assertFalse(view["dupe"])
                    self.assertEqual(view["dupeExplanation"], "Duplicate checking disabled.")
                    if plugin_id == "dxpedition":
                        self.assertTrue(view["run"])
                    fields = {item["id"]: item for item in view["fields"]}
                    self.assertEqual(fields["other_2"]["visible"], plugin_id in {"general_logging", "randomgram"})
                finally:
                    host.close()

    def test_repeated_calls_commit_and_zero_or_simple_score(self):
        for plugin_id, (fields, points) in CASES.items():
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    for second in (0, 1):
                        _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                                  timestamp=f"2026-10-21 10:00:0{second}", fields=fields)
                    rows = self.read(host, session, "log")["rows"]
                    self.assertEqual([row["Points"] or 0 for row in rows], [points, points])
                    score = self.read(host, session, "score")["score"]
                    self.assertEqual(score["qsos"], 2)
                    self.assertEqual(score["points"], points * 2)
                    self.assertEqual(score["multipliers"], 1 if plugin_id.startswith("qso_party_") else 0)
                    self.assertEqual(score["total"], points * 2 if plugin_id.startswith("qso_party_") else 0)
                finally:
                    host.close()

    def test_draft_commit_edit_delete_restart_replay_and_historical_sent_fields(self):
        host, root, session, revision = self.create("qso_party_sn")
        first, second = uid(), uid()
        try:
            draft, revision = self.mutate(host, session, revision, "draft_apply",
                                           fields={"callsign": "K1ABC", "sent": "17", "receive": "42", "other_1": "NEW"})
            self.assertEqual({item["id"]: item["value"] for item in draft["projection"]["fields"]}["sent"], "17")
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=first,
                                      timestamp="2026-10-21 11:00:00",
                                      fields={"callsign": "K1ABC", "sent": "17", "receive": "42", "other_1": "NEW"})
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=second,
                                      timestamp="2026-10-21 11:00:01",
                                      fields={"callsign": "K1ABC", "sent": "18", "receive": "43", "other_1": "OLD"})
            setup = self.read(host, session, "setup_get")["setup"]
            setup["settings"]["SentExchange"] = "NEWSETUP"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=first,
                                      fields={"other_1": "OLD"}, reason="Correct county")
            row = next(row for row in self.read(host, session, "log")["rows"] if row["ID"] == first)
            self.assertEqual((row["SentNr"], row["NR"], row["Exchange1"]), (17, 42, "OLD"))
            _, revision = self.mutate(host, session, revision, "qso_delete", qsoID=second,
                                      reason="Remove test QSO")
            _, revision = self.mutate(host, session, revision, "recalculate")
        finally:
            host.close()
        host = Host(root)
        try:
            rows = self.read(host, session, "log")["rows"]
            self.assertEqual(len(rows), 1)
            self.assertEqual((rows[0]["SentNr"], rows[0]["NR"]), (17, 42))
            self.assertEqual(self.read(host, session, "score")["score"]["total"], 2)
        finally:
            host.close()

    def test_exports_and_esm_function_keys(self):
        for plugin_id in HASHES:
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    fields = CASES[plugin_id][0]
                    _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                              timestamp="2026-10-21 12:00:00", fields=fields)
                    adif = self.read(host, session, "export_prepare", format="adif")
                    self.assertEqual(adif["format"], "adif")
                    if plugin_id.startswith("qso_party_"):
                        cabrillo = self.read(host, session, "export")["content"]
                        self.assertIn("CONTEST: QSO_PARTY\r\n", cabrillo)
                        self.assertIn("QSO:", cabrillo)
                    else:
                        with self.assertRaisesRegex(HostError, "Plugin export failed"):
                            self.read(host, session, "export")
                    view, revision = self.mutate(host, session, revision, "draft_apply",
                                                 fields={"callsign": "K1ABC"})
                    action, revision = self.mutate(host, session, revision, "function_key", key="F2")
                    self.assertEqual(action["actions"][0]["kind"], "function_key")
                finally:
                    host.close()


if __name__ == "__main__":
    unittest.main()
