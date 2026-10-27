"""Durable reminder schedule delivery and evidence-only planned move lifecycle."""
from copy import deepcopy
import json
import unittest

from contest_host.strategy import MAX_HISTORY, MAX_ITEMS, mutate, projection, reconcile_worked


def require(condition, message, code="invalid_request"):
    if not condition:
        raise ValueError(f"{code}: {message}")


class StrategyTests(unittest.TestCase):
    def setUp(self):
        self.state = {"draft": {"id": "protected-draft", "call": "K1HOLD"}}

    def apply(self, action, itemID="sked-a", **values):
        return mutate(self.state, {"action": action, "itemID": itemID, **values}, require,
                      now_utc=values.pop("now_utc", "2026-10-27T23:59:00Z"))

    def add(self, itemID="sked-a", **values):
        return self.apply("sked_add", itemID, callsign="K1ABC", text="Return contact",
                          frequencyHz=14025000, mode="CW", dueUTC="2026-10-28T00:01:00Z", **values)

    def restart(self):
        self.state = json.loads(json.dumps(self.state))

    def test_midnight_restart_clock_correction_delivers_schedule_once(self):
        self.add()
        self.assertEqual(self.apply("claim_due")["notifications"], [])
        self.restart()
        first = self.apply("claim_due", now_utc="2026-10-28T00:05:00Z")
        self.assertEqual([row["id"] for row in first["notifications"]], ["sked-a"])
        self.restart()
        for instant in ["2026-10-27T23:00:00Z", "2026-10-28T03:00:00Z"]:
            self.assertEqual(self.apply("claim_due", now_utc=instant)["notifications"], [])
        self.assertEqual(self.state["draft"], {"id": "protected-draft", "call": "K1HOLD"})

    def test_snooze_survives_sleep_with_exactly_one_new_delivery(self):
        self.add()
        self.apply("claim_due", now_utc="2026-10-28T00:01:00Z")
        self.apply("sked_snooze", dueUTC="2026-10-28T00:15:00Z", now_utc="2026-10-28T00:05:00Z")
        self.restart()
        self.assertEqual(self.apply("claim_due", now_utc="2026-10-28T00:14:00Z")["notifications"], [])
        resumed = self.apply("claim_due", now_utc="2026-10-28T08:30:00Z")
        self.assertEqual(len(resumed["notifications"]), 1)
        self.assertEqual(self.apply("claim_due", now_utc="2026-10-28T08:30:01Z")["notifications"], [])

    def test_overdue_batch_claims_all_and_history_is_not_discarded(self):
        for index in range(30):
            self.add(itemID=f"sked-{index:02}")
        result = self.apply("claim_due", now_utc="2026-11-01T12:00:00Z")
        self.assertEqual(len(result["notifications"]), 30)
        self.restart()
        self.assertEqual(self.apply("claim_due", now_utc="2026-11-02T12:00:00Z")["notifications"], [])
        self.assertEqual(len(self.state["strategy"]["skeds"]), 30)

    def test_closed_items_remain_with_history_and_dismiss_can_snooze(self):
        self.add()
        self.apply("sked_dismiss")
        self.assertEqual(self.apply("claim_due", now_utc="2026-10-28T01:00:00Z")["notifications"], [])
        self.apply("sked_snooze", dueUTC="2026-10-28T02:00:00Z")
        self.apply("sked_complete")
        self.restart()
        item = self.state["strategy"]["skeds"][0]
        self.assertEqual(item["status"], "completed")
        self.assertEqual([row["action"] for row in item["history"]],
                         ["sked_add", "sked_dismiss", "sked_snooze", "sked_complete"])
        with self.assertRaisesRegex(ValueError, "closed"):
            self.apply("sked_snooze", dueUTC="2026-10-29T00:00:00Z")

    def test_edit_keeps_identity_and_only_due_change_rearms_notification(self):
        self.add()
        self.apply("claim_due", now_utc="2026-10-28T00:02:00Z")
        self.apply("sked_edit", note="Target radio not available")
        self.assertEqual(self.apply("claim_due", now_utc="2026-10-28T00:03:00Z")["notifications"], [])
        self.apply("sked_edit", dueUTC="2026-10-28T00:04:00Z")
        self.assertEqual(self.apply("claim_due", now_utc="2026-10-28T00:05:00Z")["notifications"][0]["id"], "sked-a")

    def test_invalid_time_or_snooze_is_atomic(self):
        self.add()
        before = deepcopy(self.state)
        for due in [None, "2026-10-28T00:01:00", "2026-10-28T00:01:00+09:30", "2026-02-30T00:00:00Z"]:
            with self.assertRaises(ValueError):
                self.apply("sked_edit", dueUTC=due)
            self.assertEqual(self.state, before)
        with self.assertRaisesRegex(ValueError, "later than now"):
            self.apply("sked_snooze", dueUTC="2026-10-27T23:58:00Z")
        self.assertEqual(self.state, before)

    def test_capacity_preserves_records_and_refuses_discarding_history(self):
        self.add()
        record = self.state["strategy"]["skeds"][0]
        record["history"] *= MAX_HISTORY
        before = deepcopy(self.state)
        with self.assertRaisesRegex(ValueError, "history is full"):
            self.apply("sked_cancel")
        self.assertEqual(self.state, before)
        self.state["strategy"]["skeds"] = [{**deepcopy(record), "id": str(index)} for index in range(MAX_ITEMS)]
        with self.assertRaisesRegex(ValueError, "capacity"):
            self.add()
        self.assertEqual(len(self.state["strategy"]["skeds"]), MAX_ITEMS)

    def test_planned_lifecycle_survives_restart_and_only_dxlog_can_work_it(self):
        self.add()
        self.apply("move_add", "move-a", callsign="K1ABC", band="20m", mode="SSB", skedID="sked-a")
        for status in ["Planned", "Requested", "Waiting"]:
            self.apply("move_state", "move-a", status=status)
        self.restart()
        before = deepcopy(self.state)
        with self.assertRaisesRegex(ValueError, "committed QSO"):
            self.apply("move_state", "move-a", status="Worked")
        self.assertEqual(self.state, before)
        row = {"ID": "real-qso", "Call": "K1ABC", "Band": 14.0, "Mode": "USB"}
        reconcile_worked(self.state, [{**row, "Band": 7.0}, {**row, "Mode": "CW"}], {14.0: "20m", 7.0: "40m"})
        self.assertEqual(self.state["strategy"]["moves"][0]["status"], "Waiting")
        reconcile_worked(self.state, [row], {14.0: "20m"})
        self.restart()
        move = self.state["strategy"]["moves"][0]
        self.assertEqual((move["status"], move["workedQSOID"], move["id"]), ("Worked", "real-qso", "move-a"))
        reconcile_worked(self.state, [], {14.0: "20m"})
        self.assertEqual(self.state["strategy"]["moves"][0]["status"], "Waiting")

    def test_projection_is_defensive_and_abandoned_moves_do_not_reopen(self):
        self.apply("move_add", "move-a", callsign="K1ABC", band="20m", mode="CW", status="Abandoned")
        reconcile_worked(self.state, [{"ID": "real", "Call": "K1ABC", "Band": 14.0, "Mode": "CW"}], {14.0: "20m"})
        self.assertEqual(self.state["strategy"]["moves"][0]["status"], "Abandoned")
        result = projection(self.state)
        result["moves"].clear()
        self.assertEqual(len(self.state["strategy"]["moves"]), 1)

    def test_malformed_saved_item_is_preserved_and_not_overwritten(self):
        self.add()
        for field, invalid in [("dueUTC", None), ("schedule", True), ("status", []), ("history", {})]:
            broken = deepcopy(self.state)
            broken["strategy"]["skeds"][0][field] = invalid
            original = deepcopy(broken)
            with self.assertRaises(ValueError):
                mutate(broken, {"action": "claim_due"}, require)
            self.assertEqual(broken, original)
            with self.assertRaises(ValueError):
                projection(broken)

    def test_rtty_aliases_reuse_existing_plugin_mode_family(self):
        self.apply("move_add", "move-rtty", callsign="K1ABC", band="20m", mode="RTTY", status="Planned")
        reconcile_worked(self.state, [{"ID": "committed-rtty", "Call": "K1ABC", "Band": 14.0, "Mode": "USB-D"}], {14.0: "20m"})
        self.assertEqual(self.state["strategy"]["moves"][0]["workedQSOID"], "committed-rtty")


if __name__ == "__main__":
    unittest.main()
