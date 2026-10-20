"""Shared production-host acceptance for the four pinned original 10-10 plugins."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


PLUGINS = {
    "10_10_fall_cw": ("CW", "599", "c7e0c822a75ba2354d20c58269dd1e2fb8df543ec8ec66ad304915d2562f63b4"),
    "10_10_spring_cw": ("CW", "599", "a0abdb0269d9ca5938cd5784bfae8eab756369f0a2dc2c8e2c5f72c2e836fcd3"),
    "10_10_winter_phone": ("SSB", "59", "b07011970d2c56d2e1400c5035c78bcac4e3435fc20dcef842a547164f0660de"),
    "10_10_summer_phone": ("SSB", "59", "a15484dc4e954bd4ca014e351d3f96c9e5a6345d158279c6b10fc31b3f5275f4"),
}


class Session:
    def __init__(self, root, plugin_id):
        self.root = Path(root).resolve()
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0
        self.plugin_id = plugin_id
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": fixtures.uid(), "expectedRevision": 0,
                       "pluginID": plugin_id, "station": {"Call": "OM0RX"},
                       "frequencyHz": 28300000,
                       "settings": {"SentExchange": "OLIVER 12345 NT"},
                       "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)}}
        self.call("session_create", self.create)

    def close(self):
        self.host.close()

    def call(self, method, params):
        result = self.host.dispatch({"id": fixtures.uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def mutate(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, "operationID": fixtures.uid(),
                                  "expectedRevision": self.revision, **kwargs})

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def log(self, call, exchange, minute, frequency=28300000):
        qso_id = fixtures.uid()
        self.mutate("qso_commit", qsoID=qso_id, timestamp=f"2026-10-20 08:{minute:02}:00",
                    frequencyHz=frequency, fields={"callsign": call, "other_2": exchange})
        return qso_id


class TenTenHostTests(unittest.TestCase):
    def sessions(self):
        for plugin_id in PLUGINS:
            with TemporaryDirectory() as raw:
                session = Session(Path(raw) / "host", plugin_id)
                try:
                    yield plugin_id, session
                finally:
                    session.close()

    def test_original_hash_import_catalog_layout_and_prefill(self):
        for plugin_id, session in self.sessions():
            mode, report, source_hash = PLUGINS[plugin_id]
            source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
            self.assertEqual(sha256(source.read_bytes()).hexdigest(), source_hash)
            self.assertEqual(load_plugin(plugin_id).__file__, str(source))
            catalog = session.host.dispatch({"id": fixtures.uid(), "method": "catalog", "params": {}})
            self.assertIn(plugin_id, [item["id"] for item in catalog["plugins"]])
            view = session.read("projection")["projection"]
            fields = {field["id"]: field for field in view["fields"]}
            self.assertEqual((view["mode"], view["supportedModes"], view["supportedBands"]),
                             (mode, [mode], ["10m"]))
            self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), (report, report))
            self.assertEqual((fields["other_1"]["visible"], fields["other_1"]["value"]),
                             (False, "OLIVER 12345 NT"))
            self.assertEqual(fields["other_2"]["label"], "Name 1010# SPC")
            self.assertEqual(view["tabNext"]["receive"], "other_2")
            self.assertEqual(view["tabPrevious"]["other_2"], "receive")
            self.assertEqual(view["nextField"], "other_2")

    def test_points_zero_member_global_dupe_and_comment_quirk(self):
        for plugin_id, session in self.sessions():
            first = session.log("K1ABC", "ALICE 12345 CT", 0)
            duplicate = session.log("K1ABC", "ALICE 0 CT", 1, 28500000)
            nonmember = session.log("DL1ABC", "BOB 0 BY", 2)
            rows = {row["ID"]: row for row in session.read("log")["rows"]}
            self.assertEqual((rows[first]["Points"], rows[duplicate]["Points"], rows[nonmember]["Points"]),
                             (2, 0, 1))
            self.assertEqual((rows[first]["Name"], rows[first]["Comment"]),
                             ("ALICE", load_plugin(plugin_id).name))
            score = session.read("score")["score"]
            self.assertEqual(score, {"qsos": 3, "points": 3, "countries": 0, "zones": 0,
                                     "multipliers": 0, "total": 3})
            session.mutate("draft_apply", frequencyHz=28500000, fields={"callsign": "K1ABC"})
            self.assertTrue(session.read("projection")["projection"]["dupe"])

    def test_correction_delete_row_specific_rescore_and_restart(self):
        for plugin_id, session in self.sessions():
            first = session.log("K1ABC", "ALICE 12345 CT", 0)
            duplicate = session.log("K1ABC", "ALICE 0 CT", 1)
            session.log("DL1ABC", "BOB 0 BY", 2)
            self.assertEqual(session.read("score")["score"]["total"], 3)
            session.mutate("qso_correct", qsoID=first,
                           fields={"callsign": "OM1ABC", "other_2": "CAROL 123 NT"})
            rows = {row["ID"]: row for row in session.read("log")["rows"]}
            self.assertEqual((rows[first]["Points"], rows[duplicate]["Points"]), (2, 1))
            self.assertEqual(session.read("score")["score"]["total"], 4)
            session.mutate("qso_delete", qsoID=first)
            self.assertEqual(session.read("score")["score"]["total"], 2)
            session.host.close()
            session.host = Host(session.root)
            self.assertEqual(session.read("score")["score"]["total"], 2)

    def test_original_validate_and_configured_exchange_are_atomic(self):
        accepted = "  ÁlIce   １２３   ñt  "
        for plugin_id, session in self.sessions():
            session.log("K1ABC", accepted, 0)
            row = session.read("log")["rows"][0]
            self.assertEqual((row["NR"], row["Points"]), (accepted.upper(), 2))
            before_revision = session.revision
            with self.assertRaisesRegex(HostError, "NAME 10-10# SPC"):
                session.mutate("qso_commit", fields={"callsign": "DL1ABC", "other_2": "BOB NOPE BY"})
            self.assertEqual((session.revision, session.read("log")["total"]), (before_revision, 1))
            setup = session.read("setup_get")["setup"]
            setup["settings"]["SentExchange"] = "OLIVER NOPE NT"
            with self.assertRaisesRegex(HostError, "NAME 10-10# SPC"):
                session.mutate("setup_save", setup=setup)
            self.assertEqual(session.read("setup_get")["setup"]["settings"]["SentExchange"],
                             "OLIVER 12345 NT")

    def test_original_run_and_s_and_p_esm_with_phone_output_guard(self):
        for plugin_id, session in self.sessions():
            mode = PLUGINS[plugin_id][0]
            session.mutate("run_state", run=True)
            result = session.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
            self.assertEqual([action["key"] for action in result["actions"]],
                             ["F2", "F3"] if mode == "CW" else [])
            result = session.mutate("esm", field="other_2", fields={"other_2": "ALICE 123 CT"})
            self.assertEqual([action["key"] for action in result["actions"]], ["F4"] if mode == "CW" else [])
            session.mutate("run_state", run=False)
            result = session.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
            self.assertEqual([action["key"] for action in result["actions"]], ["F5"] if mode == "CW" else [])
            result = session.mutate("esm", field="other_2", fields={"other_2": "BOB 0 BY"})
            self.assertEqual([action["key"] for action in result["actions"]], ["F3"] if mode == "CW" else [])
            self.assertEqual(session.read("log")["total"], 2)

    def test_exact_original_cabrillo_content_and_phone_mode_mapping(self):
        for plugin_id, session in self.sessions():
            mode, report, _ = PLUGINS[plugin_id]
            session.log("K1ABC", "ALICE 12345 CT", 0)
            content = session.read("export")["content"]
            qso_mode = "CW" if mode == "CW" else "PH"
            qso = (f"QSO: 28300 {qso_mode} 2026-10-20 0800 "
                   f"{'OM0RX'.ljust(13)} {report.ljust(3)} {'OLIVER 12345 NT'.ljust(6)} "
                   f"{'K1ABC'.ljust(13)} {report.ljust(3)} {'ALICE 12345 CT'.ljust(6)}")
            expected = "\r\n".join([
                "START-OF-LOG: 3.0", "CREATED-BY: Not1MM v26.10.11", "CONTEST: 10-10",
                "CALLSIGN: OM0RX", "LOCATION: ", "CATEGORY-OPERATOR: ", "CATEGORY-ASSISTED: ",
                "CATEGORY-BAND: ", f"CATEGORY-MODE: {mode}", "CATEGORY-TRANSMITTER: ",
                "GRID-LOCATOR: ", "CATEGORY-POWER: ", "CLAIMED-SCORE: 2", "OPERATORS: OM0RX",
                "NAME: ", "ADDRESS: ", "ADDRESS-CITY: ", "ADDRESS-STATE-PROVINCE: ",
                "ADDRESS-POSTALCODE: ", "ADDRESS-COUNTRY: ", "EMAIL: ", qso, "END-OF-LOG:", "",
            ])
            self.assertEqual(content, expected)
            filename = session.read("export")["filename"]
            self.assertTrue(filename.startswith("OM0RX_10-10_") and filename.endswith(".log"))


if __name__ == "__main__":
    unittest.main()
