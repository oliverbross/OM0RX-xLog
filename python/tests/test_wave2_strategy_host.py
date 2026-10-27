"""W04/W09 use the real host transaction, operation receipts and DXLOG commits."""
from copy import deepcopy
import unittest

from contest_host.host import Host, HostError
import test_host as fixtures


class StrategyHostTests(unittest.TestCase):
    setUp = fixtures.HostTests.setUp
    tearDown = fixtures.HostTests.tearDown
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    log = fixtures.HostTests.log

    def strategy(self, action, **values):
        return self.mutate("contest_strategy_apply", workspaceGeneration=self.workspace,
                           action=action, nowUTC="2026-10-27T23:59:00Z", **values)

    def add(self):
        return self.strategy("sked_add", itemID="sked-a", callsign="K1ABC", text="Return contact",
                             frequencyHz=14025000, mode="CW", dueUTC="2026-10-28T00:01:00Z", radioID="radio2")

    def snapshot(self):
        return self.read("contest_strategy", workspaceGeneration=self.workspace,
                         expectedRevision=self.revision, nowUTC="2026-10-28T00:05:00Z")

    def restart(self):
        self.host.close()
        self.host = Host(self.root)

    def test_lost_claim_reply_replays_same_receipt_and_new_claim_cannot_redeliver_after_restart(self):
        added = self.add()
        self.assertEqual(added["actions"], [])
        params = {"sessionID": self.session, "workspaceGeneration": self.workspace, "operationID": fixtures.uid(),
                  "expectedRevision": self.revision, "action": "claim_due", "nowUTC": "2026-10-28T00:05:00Z"}
        claimed = self.call("contest_strategy_apply", params)
        self.assertEqual([row["id"] for row in claimed["waveResult"]["notifications"]], ["sked-a"])
        self.assertEqual(claimed["actions"], [])
        self.restart()
        replayed = self.call("contest_strategy_apply", params)
        self.assertTrue(replayed["replayed"])
        self.assertEqual(replayed["waveResult"], claimed["waveResult"])
        self.assertEqual(self.strategy("claim_due")["waveResult"]["notifications"], [])
        self.assertEqual(len(self.snapshot()["skeds"]), 1)
        self.assertEqual(self.snapshot()["skeds"][0]["deliveredSchedule"], 1)

    def test_load_protects_occupied_call_and_exchange_only_draft(self):
        self.add()
        for fields in [{"callsign": "DL1ABC", "other_2": "14"}, {"callsign": "", "other_2": "14"}]:
            self.mutate("draft_apply", fields=fields)
            before = deepcopy(self.host.database(self.session).state(self.session))
            with self.assertRaises(HostError) as raised:
                self.strategy("sked_load", itemID="sked-a", draftID=before["draft"]["id"])
            self.assertEqual(raised.exception.code, "occupied_draft")
            self.assertEqual(self.host.database(self.session).state(self.session), before)
            self.assertEqual(self.snapshot()["skeds"][0]["status"], "active")
            self.assertEqual(self.read("log")["total"], 0)

    def test_explicit_empty_draft_load_has_no_station_output_or_automatic_completion(self):
        self.add()
        draft = self.host.database(self.session).state(self.session)["draft"]
        loaded = self.strategy("sked_load", itemID="sked-a", draftID=draft["id"])
        fields = {row["id"]: row["value"] for row in loaded["projection"]["fields"]}
        self.assertEqual(fields["callsign"], "K1ABC")
        self.assertEqual(loaded["actions"], [])
        self.assertEqual(self.snapshot()["skeds"][0]["status"], "active")
        self.assertEqual(self.read("log")["total"], 0)
        self.restart()
        self.assertEqual(self.snapshot()["skeds"][0]["id"], "sked-a")

    def test_move_survives_restart_and_worked_requires_committed_matching_evidence(self):
        self.strategy("move_add", itemID="move-a", callsign="K1ABC", band="20m", mode="CW", status="Planned")
        self.strategy("move_state", itemID="move-a", status="Requested")
        self.restart()
        self.assertEqual(self.snapshot()["moves"][0]["status"], "Requested")
        with self.assertRaisesRegex(HostError, "committed QSO"):
            self.strategy("move_state", itemID="move-a", status="Worked")
        qso = self.log()
        move = self.snapshot()["moves"][0]
        self.assertEqual((move["status"], move["workedQSOID"]), ("Worked", qso))
        self.mutate("qso_correct", qsoID=qso, fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Disposable evidence correction")
        self.assertEqual(self.snapshot()["moves"][0]["status"], "Waiting")
        self.mutate("qso_correct", qsoID=qso, fields={"callsign": "K1ABC", "other_2": "5"}, reason="Disposable evidence restoration")
        self.assertEqual(self.snapshot()["moves"][0]["status"], "Worked")
        self.mutate("qso_delete", qsoID=qso, reason="Disposable evidence deletion")
        self.assertEqual(self.snapshot()["moves"][0]["status"], "Waiting")

    def test_revision_and_workspace_fences_preserve_saved_items(self):
        self.add()
        before = deepcopy(self.host.database(self.session).state(self.session))
        for bad in [{"expectedRevision": 0}, {"workspaceGeneration": fixtures.uid()}]:
            params = {"sessionID": self.session, "workspaceGeneration": self.workspace, "operationID": fixtures.uid(),
                      "expectedRevision": self.revision, "action": "sked_cancel", "itemID": "sked-a", **bad}
            with self.assertRaises(HostError):
                self.call("contest_strategy_apply", params)
            self.assertEqual(self.host.database(self.session).state(self.session), before)


if __name__ == "__main__":
    unittest.main()
