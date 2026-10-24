"""Real host copy/page admission, invalidation and read-only invariants."""
from copy import deepcopy
import unittest
import test_cq_ww_ssb_host as cq_fixture


class AnalyticsHostTests(unittest.TestCase):
    setUp = cq_fixture.CQWWSSBHostTests.setUp
    tearDown = cq_fixture.CQWWSSBHostTests.tearDown
    call = cq_fixture.CQWWSSBHostTests.call
    mutate = cq_fixture.CQWWSSBHostTests.mutate
    read = cq_fixture.CQWWSSBHostTests.read
    log = cq_fixture.CQWWSSBHostTests.log
    def test_copy_pages_are_stable_while_draft_changes_and_release_is_bounded(self):
        qso = self.log()
        store = self.host.database(self.session)
        before = deepcopy(store.state(self.session))
        operations = store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"]
        meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        self.assertEqual(meta["total"], 1)
        self.assertEqual(meta["score"], self.read("score")["score"])
        self.assertFalse(store.conn.in_transaction)
        page = self.read("analytics", workspaceGeneration=self.workspace, action="page",
                         snapshotID=meta["snapshotID"], offset=0, limit=500)
        row = page["rows"][0]
        self.assertEqual((row["id"], row["band"], row["zone"], row["points"]), (qso, "20m", "5", 3))
        self.assertEqual(store.state(self.session), before)
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"], operations)
        self.mutate("draft_apply", fields={"callsign":"DL1ABC"})
        self.assertTrue(self.read("analytics", workspaceGeneration=self.workspace, action="check", snapshotID=meta["snapshotID"])["current"])
        self.log("DL1ABC", "14", minute=1)
        self.assertFalse(self.read("analytics", workspaceGeneration=self.workspace, action="check", snapshotID=meta["snapshotID"])["current"])
        self.assertEqual(self.read("analytics", workspaceGeneration=self.workspace, action="page",
                                   snapshotID=meta["snapshotID"], offset=0, limit=500), page)
        self.read("analytics", workspaceGeneration=self.workspace, action="release", snapshotID=meta["snapshotID"])
        with self.assertRaises(Exception):
            self.read("analytics", workspaceGeneration=self.workspace, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500)

    def test_settings_corrections_deletions_and_workspace_invalidate(self):
        qso = self.log()
        meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        self.mutate("qso_delete", qsoID=qso, reason="analytics test")
        self.assertFalse(self.read("analytics", workspaceGeneration=self.workspace, action="check", snapshotID=meta["snapshotID"])["current"])
        with self.assertRaises(Exception):
            self.read("analytics", workspaceGeneration="wrong", action="prepare")
        for extra in ({"sql":"DELETE FROM DXLOG"},{"action":"commit"}):
            with self.assertRaises(Exception):
                self.read("analytics", workspaceGeneration=self.workspace, action="prepare", **extra) if "action" not in extra else self.read("analytics",workspaceGeneration=self.workspace,**extra)

    def test_empty_log_and_page_bounds(self):
        meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        self.assertEqual(meta["total"], 0)
        for offset, limit in [(-1,1),(0,501),(False,1),(1,1)]:
            with self.assertRaises(Exception):
                self.read("analytics",workspaceGeneration=self.workspace,action="page",snapshotID=meta["snapshotID"],offset=offset,limit=limit)

    def test_cq_ww_eligibility_uses_host_credit_scope_and_zero_point_support(self):
        self.log("OM0A", "15")
        self.log("OM0A", "15", minute=1)
        meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        page = self.read("analytics",workspaceGeneration=self.workspace,action="page",snapshotID=meta["snapshotID"],offset=0,limit=500)
        self.assertEqual([row["multiplierEligible"] for row in page["rows"]], [True, False])
        self.assertEqual([row["points"] for row in page["rows"]], [0, 0])
        self.assertEqual(meta["score"]["multipliers"], 2)

    def test_backdated_entry_and_correction_preserve_host_duplicate_order_in_copy(self):
        original = self.log("K1ABC", "5", minute=10)
        duplicate = self.log("K1ABC", "5", minute=0)
        meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        page = self.read("analytics", workspaceGeneration=self.workspace, action="page",
                         snapshotID=meta["snapshotID"], offset=0, limit=500)
        self.assertEqual([row["id"] for row in page["rows"]], [duplicate, original])
        self.assertGreater(page["rows"][0]["sourceOrder"], page["rows"][1]["sourceOrder"])
        self.assertEqual([row["multiplierEligible"] for row in page["rows"]], [False, True])
        self.mutate("qso_correct", qsoID=duplicate, timestamp="2026-10-20 08:05:00",
                    reason="Correct duplicate timestamp")
        corrected = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        corrected_page = self.read("analytics", workspaceGeneration=self.workspace, action="page",
                                   snapshotID=corrected["snapshotID"], offset=0, limit=500)
        # Recalculation may rewrite rowids. Export the current host order, never
        # an order inferred in the renderer from the editable timestamps.
        stored = self.host.database(self.session).exec_sql_mult("SELECT ID,rowid AS ordering FROM DXLOG ORDER BY TS,rowid")
        self.assertEqual([(row["id"], row["sourceOrder"]) for row in corrected_page["rows"]],
                         [(row["ID"], row["ordering"]) for row in stored])
