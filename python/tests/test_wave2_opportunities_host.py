"""W09 conditional values use real plugin previews and disposable Host/SQLite."""
from copy import deepcopy
import unittest

from contest_host.host import HostError
import test_host as fixtures


class OpportunitiesHostTests(unittest.TestCase):
    setUp = fixtures.HostTests.setUp
    tearDown = fixtures.HostTests.tearDown
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    log = fixtures.HostTests.log

    def create_other(self, plugin, band="ALL"):
        params = deepcopy(self.create)
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0
        params.update(sessionID=self.session, workspaceGeneration=self.workspace,
                      operationID=fixtures.uid(), expectedRevision=0, pluginID=plugin)
        params["settings"]["BandCategory"] = band
        if plugin.startswith("cq_wpx"):
            params["settings"]["SentExchange"] = ""
        params["reference"]["countries"]["K2ABC"] = deepcopy(fixtures.CTY["K1ABC"])
        self.call("session_create", params)

    @staticmethod
    def candidate(call, frequency=14_025_000, mode="CW"):
        return {"spotID": call + str(frequency), "callsign": call, "frequencyHz": frequency, "mode": mode}

    def preview(self, spots, **params):
        return self.read("contest_opportunities", workspaceGeneration=self.workspace,
                         expectedRevision=self.revision, spots=spots, **params)

    def persistent_snapshot(self):
        store = self.host.database(self.session)
        tables = ("DXLOG", "xlog_session", "xlog_serial", "xlog_operation", "xlog_qso_audit", "xlog_draft_contact")
        return {table: [dict(row) for row in store.conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
                for table in tables}

    def test_wpx_unknown_serial_retains_independent_dupe_without_fabricated_exchange(self):
        self.create_other("cq_wpx_cw")
        self.log("K1ABC", "123")
        self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_2": "987"})
        before = self.persistent_snapshot()
        result = self.preview([self.candidate("K1ABC"), self.candidate("K2ABC")])
        dupe, new = result["spots"]
        self.assertIs(dupe["dupe"], True)
        self.assertIs(new["dupe"], False)
        # Dupe zero is independently knowable; a new QSO's gain is unavailable.
        self.assertEqual(dupe["conditionalScoreGain"], 0)
        self.assertIsNone(new["conditionalScoreGain"])
        for row in (dupe, new):
            self.assertEqual(row["reason"], "exchange_required")
            self.assertIsNone(row["points"])
            self.assertIsNone(row["multiplierCount"])
            self.assertEqual(row["inferredExchange"], {})
            self.assertEqual(row["newDimensions"], [])
            self.assertFalse(row["dimensionsVerified"])
            self.assertIn("not heard exchange", row["exchangeProvenance"])
        self.assertEqual(self.persistent_snapshot(), before)
        self.assertFalse(self.host.database(self.session).conn.in_transaction)

    def test_cqww_shared_country_zone_values_are_conditional_and_nonadditive(self):
        self.create_other("cq_ww_cw")
        self.log("DL1ABC", "14")
        # EU Germany: 1 point, two multipliers -> 2. Each new US station is
        # 3 points and shares the same new country+zone: (1+3)*4 - 1*2 = 14.
        self.assertEqual(self.read("score")["score"]["total"], 2)
        before = self.persistent_snapshot()
        first, second = self.preview([self.candidate("K1ABC"), self.candidate("K2ABC")])["spots"]
        self.assertEqual(first["conditionalScoreGain"], 14)
        self.assertEqual(second["conditionalScoreGain"], 14)
        self.assertEqual(first["newDimensions"], second["newDimensions"])
        self.assertEqual(len(first["newDimensions"]), 2)
        self.assertEqual({(item["dimension"], item["value"], item["scope"]) for item in first["newDimensions"]},
                         {("country", "K", "20m"), ("zone", "5", "20m")})
        self.assertTrue(first["dimensionsVerified"])
        self.assertIs(first["dupe"], False)
        self.assertIs(second["dupe"], False)
        self.assertIn("Conditional", first["valueBasis"])
        self.assertEqual(first["inferredExchange"]["other_2"], "5")
        self.assertEqual(self.persistent_snapshot(), before)
        self.log("K1ABC", "5", minute=1)
        self.assertEqual(self.read("score")["score"]["total"], 16)
        after_first = self.persistent_snapshot()
        dupe, remaining = self.preview([self.candidate("K1ABC"), self.candidate("K2ABC")])["spots"]
        self.assertIs(dupe["dupe"], True)
        self.assertEqual(dupe["conditionalScoreGain"], 0)
        self.assertEqual(dupe["newDimensions"], [])
        # Shared multipliers are now worked: only 3 additional QSO points * 4.
        self.assertEqual(remaining["conditionalScoreGain"], 12)
        self.assertEqual(remaining["newDimensions"], [])
        self.assertEqual(self.persistent_snapshot(), after_first)
        self.log("K2ABC", "5", minute=2)
        actual_gain = self.read("score")["score"]["total"] - 2
        self.assertEqual(actual_gain, 26)
        self.assertNotEqual(actual_gain, first["conditionalScoreGain"] + second["conditionalScoreGain"])

    def test_preview_never_reserves_serials_mutates_draft_or_persists_insert_receipts(self):
        self.create_other("cq_ww_cw")
        self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_2": "14", "sent": "579"})
        before = self.persistent_snapshot()
        result = self.preview([self.candidate("K1ABC"), self.candidate("OM1ABC"), self.candidate("UNKNOWN1")])
        self.assertEqual(result["revision"], self.revision)
        self.assertEqual(result["workspaceGeneration"], self.workspace)
        self.assertIsNone(result["spots"][2]["conditionalScoreGain"])
        self.assertEqual(self.persistent_snapshot(), before)
        self.assertFalse(self.host.database(self.session).conn.in_transaction)

    def test_single_band_and_invalid_mode_cannot_become_actionable_values(self):
        self.create_other("cq_ww_cw", band="20M")
        before = self.persistent_snapshot()
        excluded = self.preview([self.candidate("K1ABC", frequency=7_025_000)])["spots"][0]
        self.assertEqual(excluded["reason"], "ineligible_category")
        self.assertIsNone(excluded["conditionalScoreGain"])
        self.assertEqual(excluded["newDimensions"], [])
        self.assertIsNone(excluded["dupe"])
        with self.assertRaises(HostError):
            self.preview([self.candidate("K1ABC", mode="SSB")])
        self.assertEqual(self.persistent_snapshot(), before)

    def test_stale_workspace_and_revision_reject_without_side_effects(self):
        before = self.persistent_snapshot()
        for changed, code in (({"workspaceGeneration": fixtures.uid()}, "stale_context"),
                              ({"expectedRevision": self.revision + 1}, "stale_revision")):
            with self.subTest(code=code), self.assertRaises(HostError) as failure:
                self.read("contest_opportunities", **{
                    "workspaceGeneration": self.workspace, "expectedRevision": self.revision,
                    "spots": [self.candidate("K1ABC")], **changed})
            self.assertEqual(failure.exception.code, code)
            self.assertEqual(self.persistent_snapshot(), before)


if __name__ == "__main__":
    unittest.main()
