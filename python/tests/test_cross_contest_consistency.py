"""Shared policies and family views through the real host, disposable roots only."""
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
import test_host as fixtures


class CrossContestConsistencyTests(unittest.TestCase):
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.host = Host(Path(self.temporary.name).resolve() / "host")

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def create(self, plugin, sent="", mode="CW", station="OM0RX"):
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0
        self.call("session_create", {"sessionID": self.session, "workspaceGeneration": self.workspace,
            "operationID": fixtures.uid(), "expectedRevision": 0, "pluginID": plugin,
            "station": {"Call": station, "Name": "OLIVER", "GridSquare": "JN88XX", "CQZone": "15", "IARUZone": "28"},
            "frequencyHz": 14250000 if mode == "SSB" else 14025000, "mode": mode,
            "settings": {"SentExchange": sent, "ModeCategory": mode, "OperatorCategory": "SINGLE-OP",
                         "BandCategory": "ALL", "PowerCategory": "LOW"},
            "reference": {"id": "cross-contest-test", "countries": deepcopy(fixtures.CTY)}})

    def log(self, fields, minute=0, frequency=14025000):
        qso = fixtures.uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-20 09:{minute:02}:00",
                    frequencyHz=frequency, fields=fields)
        return qso

    def preview(self, call="K1ABC", frequency=14025000, mode="CW"):
        return self.read("spot_points_preview", workspaceGeneration=self.workspace,
                         expectedRevision=self.revision, spots=[{"spotID": "test", "callsign": call,
                         "frequencyHz": frequency, "mode": mode}])["spots"][0]

    def test_initial_families_navigation_policy_and_received_report(self):
        for plugin, sent, mode, next_field in [("cq_ww_cw", "15", "CW", "other_2"),
                ("cq_ww_ssb", "15", "SSB", "other_2"), ("cq_wpx_ssb", "", "SSB", "other_2"),
                ("naqp_ssb", "OLIVER DX", "SSB", "other_1"),
                ("arrl_ss_phone", "A OM0RX 67 CT", "SSB", "other_2")]:
            with self.subTest(plugin=plugin):
                self.create(plugin, sent, mode)
                view = self.read("projection")["projection"]
                self.assertEqual(view["spaceNext"], {"callsign": next_field})
                self.assertEqual(view["entryPolicy"]["enter"], "manual" if plugin == "cq_ww_ssb" else "esm")
                if plugin != "naqp_ssb":
                    self.assertIn("sent", view["tabNext"])
                setup = self.read("setup_get")["setup"]
                setup["preferences"].update(enterPolicy="manual", vfoClearPolicy="on")
                self.mutate("setup_save", setup=setup)
                view = self.mutate("draft_apply", fields={"callsign": "K1ABC", "receive": "57" if mode == "SSB" else "579"})["projection"]
                reserved = view["reservedSerial"]
                before = {field["id"]: field for field in view["fields"]}
                cleared = self.mutate("draft_apply", frequencyHz=14027000, observedVFOChange=True)["projection"]
                after = {field["id"]: field for field in cleared["fields"]}
                self.assertEqual(cleared["reservedSerial"], reserved)
                self.assertEqual(after["receive"]["value"], before["receive"]["value"])
                self.assertEqual(after["callsign"]["value"], "")
                for field in before.values():
                    if field["readOnly"]:
                        self.assertEqual(after[field["id"]]["value"], field["value"])
                setup["preferences"].update(vfoClearPolicy="off", enterPolicy="esm", useESM=False)
                self.mutate("setup_save", setup=setup)
                self.mutate("draft_apply", fields={"callsign": "DL1ABC"})
                kept = self.mutate("draft_apply", frequencyHz=14028000, observedVFOChange=True)["projection"]
                self.assertEqual(kept["entryPolicy"]["enter"], "esm")
                self.assertEqual(kept["fields"][0]["value"], "DL1ABC")

    def test_incomplete_spots_keep_dupe_without_reserving_or_fabricating_exchange(self):
        for plugin, sent, mode, fields in [
                ("cq_wpx_cw", "", "CW", {"other_2": "100"}),
                ("arrl_ss_phone", "A OM0RX 67 CT", "SSB", {"other_2": "123 A 67 CT"}),
                ("naqp_ssb", "OLIVER DX", "SSB", {"other_1": "ALICE", "other_2": "CT"}),
                ("cwt", "OLIVER 123", "CW", {"other_1": "ALICE", "other_2": "100"})]:
            with self.subTest(plugin=plugin):
                self.create(plugin, sent, mode)
                self.log({"callsign": "K1ABC", **fields})
                store = self.host.database(self.session)
                before = deepcopy(store.state(self.session))
                rows = store.fetch_all_contacts_asc()
                ops = store.exec_sql("SELECT count(*) AS n FROM xlog_operation")
                dupe = self.preview(mode=mode)
                self.assertIs(dupe["dupe"], True)
                self.assertIsNone(dupe["points"])
                self.assertIsNone(dupe["multiplierCount"])
                self.assertFalse(self.preview("DL1ABC", mode=mode)["dupe"])
                if plugin == "arrl_ss_phone":
                    self.assertTrue(self.preview(frequency=7025000, mode=mode)["dupe"])
                else:
                    self.assertFalse(self.preview(frequency=7025000, mode=mode)["dupe"])
                self.assertEqual(store.state(self.session), before)
                self.assertEqual(store.fetch_all_contacts_asc(), rows)
                self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_operation"), ops)

    def test_global_prefix_and_section_identity_and_delete_promotion(self):
        for plugin, sent, fields, dimension in [("cq_wpx_cw", "", {"other_2": "100"}, "prefix"),
                ("arrl_ss_phone", "A OM0RX 67 CT", {"other_2": "123 A 67 CT"}, "section")]:
            with self.subTest(plugin=plugin):
                self.create(plugin, sent, "SSB" if plugin.endswith("phone") else "CW")
                first = self.log({"callsign": "K1ABC", **fields})
                self.log({"callsign": "K1ABC", **fields}, 1, 7025000)
                score = self.read("score")
                view = score["multiplierViews"][0]
                self.assertEqual((view["id"], view["scope"], view["status"], view["total"]), (dimension, "contest", "supported", 1))
                self.assertEqual(len(view["rows"]), 1)
                self.assertEqual(score["statistics"]["total"]["countries"], 0)
                self.assertEqual(score["statistics"]["total"]["zones"], 0)
                self.mutate("qso_delete", qsoID=first, reason="disposable promotion")
                self.assertEqual(self.read("score")["multiplierViews"][0]["total"], 1)
                meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
                page = self.read("analytics", workspaceGeneration=self.workspace, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500)
                self.assertTrue(meta["multiplierAdapter"])
                self.assertEqual(len(page["rows"][0]["creditedKeys"]), 1)

    def test_disabled_duplicate_is_unknown_in_spots(self):
        self.create("general_logging", "", "CW")
        self.assertFalse(self.read("projection")["projection"]["duplicateChecking"])
        self.assertIsNone(self.preview()["dupe"])

    def test_mixed_entry_category_filters_spots_independently_of_live_mode(self):
        self.create("iaru_hf", "28", "CW")
        self.assertEqual(self.preview(mode="SSB")["reason"], "unsupported_mode")
        setup = self.read("setup_get")["setup"]
        setup["settings"]["ModeCategory"] = "MIXED"
        self.mutate("setup_save", setup=setup)
        self.assertIsNone(self.preview(mode="SSB")["reason"])

    def test_rtty_alias_has_duplicate_scope_without_fictitious_state_or_serial(self):
        self.create("cq_wpx_rtty", "", "RTTY")
        self.log({"callsign": "K1ABC", "other_2": "100"})
        preview = self.preview(mode="USB-D")
        self.assertTrue(preview["dupe"])
        self.assertIsNone(preview["points"])
        self.assertEqual(preview["reason"], "exchange_required")

    def test_family_dimensions_reconcile_after_correction_and_deletion(self):
        cases = [
            ("naqp_ssb", "OLIVER DX", "SSB", "OM0RX", {"other_1": "ALICE", "other_2": "CT"}, {"other_2": "PA"}, "spc"),
            ("k1usn_sst", "OLIVER DX", "CW", "OM0RX", {"other_1": "ALICE", "other_2": "CT"}, {"other_2": "PA"}, "spc"),
            ("cwt", "OLIVER 123", "CW", "OM0RX", {"other_1": "ALICE", "other_2": "100"}, {"other_2": "200"}, "call"),
            ("cwo", "OLIVER", "CW", "OM0RX", {"other_2": "100 ALICE"}, {"other_2": "200 ALICE"}, "call"),
            ("icwc_mst", "OLIVER", "CW", "OM0RX", {"other_2": "ALICE 100"}, {"other_2": "ALICE 200"}, "call"),
            ("weekly_rtty", "OLIVER DX", "RTTY", "OM0RX", {"other_1": "ALICE", "other_2": "CT"}, {"other_2": "PA"}, "call"),
            ("arrl_dx_ssb", "100", "SSB", "OM0RX", {"other_2": "CT"}, {"other_2": "PA"}, "state"),
            ("arrl_dx_cw", "CT", "CW", "K1ABC", {"other_2": "100"}, {"other_2": "200"}, "country"),
            ("iaru_hf", "28", "CW", "OM0RX", {"other_2": "8"}, {"other_2": "ARRL"}, "ituZone"),
            ("cq_ww_rtty", "15 DX", "RTTY", "OM0RX", {"other_1": "5", "other_2": "CT"}, {"other_2": "PA"}, "state"),
        ]
        for plugin, sent, mode, station, fields, correction, dimension in cases:
            with self.subTest(plugin=plugin):
                self.create(plugin, sent, mode, station)
                call = "DL1ABC" if station == "K1ABC" else "K1ABC"
                first = self.log({"callsign": call, **fields})
                self.log({"callsign": call, **fields}, 1, 7025000)
                initial = self.read("score")
                self.assertIn(dimension, [view["id"] for view in initial["multiplierViews"]])
                for method, params in [("qso_correct", {"fields": correction}), ("qso_delete", {})]:
                    self.mutate(method, qsoID=first, reason="disposable dimensions", **params)
                    score = self.read("score")
                    views = score["multiplierViews"]
                    self.assertTrue(all(view["status"] == "supported" for view in views), views)
                    self.assertEqual(sum(view["total"] for view in views), score["score"]["multipliers"])
                    meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
                    self.assertTrue(meta["multiplierAdapter"])
                    page = self.read("analytics", workspaceGeneration=self.workspace, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500)
                    keys = {key for row in page["rows"] for key in row["creditedKeys"]}
                    self.assertEqual(len(keys), score["score"]["multipliers"])
                    if plugin == "cq_ww_rtty":
                        self.assertEqual(page["rows"][0]["zone"], "5")
                    if plugin == "iaru_hf":
                        self.assertEqual(page["rows"][0]["zone"], "Unknown")


if __name__ == "__main__":
    unittest.main()
