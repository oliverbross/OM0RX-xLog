"""Operating-plan durability and log-evidence reads on disposable Host/SQLite."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError


class Wave2OperatingHostTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name).resolve()
        self.host = Host(self.root)
        self.create("cq_wpx_cw", "2026-05-30 00:00:00")

    def tearDown(self):
        self.host.close()
        self.directory.cleanup()

    def create(self, plugin, start):
        self.session, self.generation = str(uuid.uuid4()), str(uuid.uuid4())
        self.revision = 0
        fixture = deepcopy(json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())[plugin])
        state = fixture["state"]
        settings = {**state["settings"], "StartDate": start, "OperatorCategory": "SINGLE-OP",
                    "TransmitterCategory": "ONE", "BandCategory": "ALL", "OverlayCategory": "N/A"}
        self.mutate("session_create", pluginID=plugin, workspaceGeneration=self.generation,
                    station=state["station"], settings=settings, reference=state["reference"],
                    frequencyHz=state["draft"]["frequencyHz"], mode=fixture["mode"])

    def read(self, method="operating_info", **params):
        return self.host.dispatch({"id": str(uuid.uuid4()), "method": method,
                                   "params": {"sessionID": self.session, **params}})

    def context(self, **params):
        return {"workspaceGeneration": self.generation, "expectedRevision": self.revision,
                "now": "2026-06-01T00:00:00Z", **params}

    def mutate(self, method, **params):
        result = self.read(method, operationID=str(uuid.uuid4()), expectedRevision=self.revision, **params)
        self.revision = result["revision"]
        return result

    def test_saved_adoption_and_plan_survive_restart_with_log_bytes_unchanged(self):
        store = self.host.database(self.session)
        for stamp in ("2026-05-30 00:00:00", "2026-05-30 01:01:00"):
            store.log_contact({**store.get_empty(), "ID": str(uuid.uuid4()), "Call": "K1ABC", "Band": 14,
                               "Mode": "CW", "TS": stamp, "ContestNR": store.current_contest})
        store.conn.commit()
        before = deepcopy(store.fetch_all_contacts_asc())
        self.assertIsNone(self.read(**self.context())["profile"])
        plan = {"ruleProfileID": "wpx-2026-single-op", "note": "Rest 02–04 UTC; target 500 QSOs"}
        self.mutate("operating_plan_save", workspaceGeneration=self.generation, plan=plan)
        result = self.read(**self.context())
        self.assertEqual(result["plan"], plan)
        self.assertEqual(result["offTime"]["qualifyingLogOffMinutes"], 60)
        self.assertEqual(result["allowance"]["reconstructedMinutes"], 2)
        self.assertEqual(store.fetch_all_contacts_asc(), before)
        revision = store.state(self.session)["revision"]
        changes = store.conn.total_changes
        self.assertEqual(self.read(**self.context()), result)
        self.assertEqual(store.state(self.session)["revision"], revision)
        self.assertEqual(store.conn.total_changes, changes)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read(**self.context()), result)
        self.assertEqual(self.host.database(self.session).fetch_all_contacts_asc(), before)

    def test_reads_and_adoption_fence_workspace_and_revision(self):
        for context, code in ((self.context(expectedRevision=self.revision - 1), "stale_revision"),
                              (self.context(workspaceGeneration=str(uuid.uuid4())), "stale_context")):
            with self.subTest(code=code), self.assertRaises(HostError) as raised:
                self.read(**context)
            self.assertEqual(raised.exception.code, code)
        original = self.revision
        self.mutate("operating_plan_save", workspaceGeneration=self.generation,
                    plan={"ruleProfileID": "wpx-2026-single-op", "note": "Plan, not measurement"})
        with self.assertRaises(HostError):
            self.read("operating_plan_save", operationID=str(uuid.uuid4()), expectedRevision=original,
                      workspaceGeneration=self.generation, plan={"ruleProfileID": "", "note": "Stale"})
        self.assertEqual(self.read(**self.context())["plan"]["note"], "Plan, not measurement")

    def test_cqww_cannot_reuse_wpx_rules_or_claim_observed_durations(self):
        self.create("cq_ww_ssb", "2026-10-24 00:00:00")
        self.mutate("operating_plan_save", workspaceGeneration=self.generation,
                    plan={"ruleProfileID": "wpx-2026-multi-one", "note": "Review category"})
        result = self.read(**self.context(now="2026-10-26T00:00:00Z"))
        self.assertIsNone(result["profile"])
        self.assertIn("CW/SSB only", result["unverifiedReason"])
        self.assertIsNone(result["bandChanges"])
        self.assertIsNone(result["observedOperatingSeconds"])
        self.assertEqual(result["compliance"], "unverified")


if __name__ == "__main__":
    unittest.main()
