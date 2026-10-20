from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError
from contest_host.store import CALLHISTORY_COLUMNS


def uid():
    return str(uuid.uuid4())


def row(call, zone="", user_text=""):
    values = {column: "" for column in CALLHISTORY_COLUMNS}
    values.update(Call=call, CqZone=zone, UserText=user_text)
    return values


CTY = {
    "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
    "K1ABC": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
}


class CallHistoryHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.call("session_create", {"sessionID": self.session, "workspaceGeneration": self.workspace,
            "operationID": uid(), "expectedRevision": 0, "pluginID": "cq_ww_cw",
            "station": {"Call": "OM0RX", "GridSquare": "JN88"}, "frequencyHz": 14_025_000,
            "settings": {"SentExchange": "15", "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL", "PowerCategory": "LOW"},
            "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)}})

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def scope(self, **values):
        return {"sessionID": self.session, "workspaceGeneration": self.workspace, **values}

    def mutate(self, method, **values):
        return self.call(method, self.scope(operationID=uid(), expectedRevision=self.revision, **values))

    def activate(self, generation, digest, rows):
        self.call("history_stage_begin", self.scope(generation=generation, digest=digest, rowCount=len(rows)))
        for offset in range(0, len(rows), 2):
            self.call("history_stage_chunk", self.scope(
                generation=generation, digest=digest, offset=offset, rows=rows[offset:offset + 2]))
        return self.call("history_stage_commit", self.scope(
            generation=generation, digest=digest, rowCount=len(rows)))

    def set_enabled(self, enabled):
        setup = self.call("setup_get", self.scope())["setup"]
        setup["preferences"]["callHistory"] = enabled
        self.mutate("setup_save", setup=setup)

    def test_chunked_activation_drives_actual_plugin_prefill_only_when_enabled(self):
        self.assertIsNone(self.call("history_status", self.scope())["activation"])
        generation, digest = uid(), "a" * 64
        result = self.activate(generation, digest, [row("K1ABC", "4", "Minnesota")])
        self.assertEqual(result["activation"], {"generation": generation, "digest": digest, "rowCount": 1})

        legacy = self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})["projection"]
        self.assertEqual(legacy["history"], "K1ABC, 4, Minnesota")

        self.set_enabled(False)
        disabled = self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})["projection"]
        self.assertEqual(disabled["history"], "")
        self.assertEqual(next(item["value"] for item in disabled["fields"] if item["id"] == "other_2"), "5")

        self.set_enabled(True)
        enabled = self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})["projection"]
        self.assertEqual(enabled["history"], "K1ABC, 4, Minnesota")
        # Pinned CQ WW first derives the zone from CTY; history then preserves
        # that non-blank exchange while publishing its actual UserText line.
        self.assertEqual(next(item["value"] for item in enabled["fields"] if item["id"] == "other_2"), "5")

        self.set_enabled(False)
        disabled_again = self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})["projection"]
        self.assertEqual(disabled_again["history"], "")
        self.assertEqual(next(item["value"] for item in disabled_again["fields"] if item["id"] == "other_2"), "5")

    def test_plugin_history_is_cleared_for_the_next_qso(self):
        self.activate(uid(), "8" * 64, [row("K1ABC", "5", "current contact")])
        populated = self.mutate(
            "draft_apply", fields={"callsign": "K1ABC", "other_2": ""}
        )["projection"]
        self.assertEqual(populated["history"], "K1ABC, 5, current contact")

        next_qso = self.mutate("qso_commit")["projection"]

        self.assertEqual(next(item["value"] for item in next_qso["fields"] if item["id"] == "callsign"), "")
        self.assertEqual(next_qso["history"], "")

    def test_restart_status_and_failed_replacement_retain_active_generation(self):
        generation, digest = uid(), "b" * 64
        self.activate(generation, digest, [row("K1ABC", "5", "kept")])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.call("history_status", self.scope())["activation"]["generation"], generation)

        candidate, candidate_digest = uid(), "c" * 64
        self.call("history_stage_begin", self.scope(
            generation=candidate, digest=candidate_digest, rowCount=2))
        self.call("history_stage_chunk", self.scope(
            generation=candidate, digest=candidate_digest, offset=0, rows=[row("K1ABC", "4", "candidate")]))
        with self.assertRaises(HostError) as error:
            self.call("history_stage_commit", self.scope(
                generation=candidate, digest=candidate_digest, rowCount=2))
        self.assertEqual(error.exception.code, "history_activation_failed")
        self.assertEqual(self.call("history_status", self.scope())["activation"]["generation"], generation)

    def test_plugin_history_line_combines_individually_bounded_values_without_truncation(self):
        user_text = "M" * 506
        self.activate(uid(), "9" * 64, [row("K1ABC", "05", user_text)])

        projection = self.mutate(
            "draft_apply", fields={"callsign": "K1ABC", "other_2": ""}
        )["projection"]

        self.assertEqual(projection["history"], f"K1ABC, 5, {user_text}")
        self.assertGreater(len(projection["history"].encode("utf-8")), 512)

    def test_scope_methods_and_rows_are_strict(self):
        generation, digest = uid(), "d" * 64
        with self.assertRaises(HostError):
            self.call("history_status", {**self.scope(), "extra": True})
        with self.assertRaises(HostError) as error:
            self.call("history_stage_begin", {**self.scope(generation=generation, digest=digest, rowCount=1),
                                               "workspaceGeneration": uid()})
        self.assertEqual(error.exception.code, "stale_context")
        self.call("history_stage_begin", self.scope(generation=generation, digest=digest, rowCount=1))
        invalid = row("K1ABC")
        invalid["Unknown"] = "not accepted"
        with self.assertRaises(HostError):
            self.call("history_stage_chunk", self.scope(
                generation=generation, digest=digest, offset=0, rows=[invalid]))
        oversized = row("K1ABC")
        oversized["UserText"] = "X" * 513
        with self.assertRaises(HostError):
            self.call("history_stage_chunk", self.scope(
                generation=generation, digest=digest, offset=0, rows=[oversized]))

    def test_stale_cancel_does_not_remove_the_current_host_stage(self):
        first, current = uid(), uid()
        self.call("history_stage_begin", self.scope(generation=first, digest="e" * 64, rowCount=1))
        self.call("history_stage_begin", self.scope(generation=current, digest="f" * 64, rowCount=1))
        with self.assertRaises(HostError) as error:
            self.call("history_stage_cancel", self.scope(generation=first, digest="e" * 64))
        self.assertEqual(error.exception.code, "history_activation_failed")
        self.call("history_stage_chunk", self.scope(
            generation=current, digest="f" * 64, offset=0, rows=[row("K1ABC", "5", "current")]))
        self.call("history_stage_commit", self.scope(
            generation=current, digest="f" * 64, rowCount=1))
        self.assertEqual(self.call("history_status", self.scope())["activation"]["generation"], current)


if __name__ == "__main__":
    unittest.main()
