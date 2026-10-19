from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.store import CALLHISTORY_COLUMNS, Store


def row(call, zone="", user_text=""):
    values = {column: "" for column in CALLHISTORY_COLUMNS}
    values.update(Call=call, CqZone=zone, UserText=user_text)
    return values


class CallHistoryStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.path = Path(self.temporary.name) / "contest.sqlite"
        self.store = Store(self.path)

    def tearDown(self):
        self.store.close()
        self.temporary.cleanup()

    def mutate(self, action):
        self.store.begin()
        try:
            value = action()
        except Exception:
            self.store.finish(False)
            raise
        self.store.finish(True)
        return value

    def activate(self, generation, digest, rows):
        self.mutate(lambda: self.store.begin_callhistory_stage(generation, digest, len(rows)))
        for offset in range(0, len(rows), 2):
            chunk = rows[offset:offset + 2]
            self.mutate(lambda offset=offset, chunk=chunk:
                        self.store.append_callhistory_stage(generation, digest, offset, chunk))
        self.mutate(lambda: self.store.activate_callhistory_stage(generation, digest, len(rows)))

    def test_chunked_activation_preserves_duplicates_order_and_generation_after_reopen(self):
        rows = [row("K1ABC", "5", "first"), row("K1ABC", "4", "second"), row("DL1ABC", "14", "third")]
        self.activate("generation-a", "a" * 64, rows)
        self.assertEqual(self.store.callhistory_status(), {
            "generation": "generation-a", "digest": "a" * 64, "rowCount": 3,
        })
        self.assertEqual(
            [item["UserText"] for item in self.store.exec_sql_mult("SELECT * FROM CALLHISTORY ORDER BY rowid")],
            ["first", "second", "third"],
        )
        # The pinned CQ WW plugin requests CQZone although upstream SQLite
        # publishes CqZone. xLog deliberately provides case-insensitive access.
        self.assertEqual(self.store.fetch_call_history("K1ABC").get("CQZone"), 5)
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.callhistory_status()["generation"], "generation-a")

    def test_incomplete_or_failed_candidate_rolls_back_without_replacing_active_history(self):
        self.activate("generation-old", "b" * 64, [row("K1OLD", "5", "kept")])
        self.mutate(lambda: self.store.begin_callhistory_stage("generation-new", "c" * 64, 2))
        self.mutate(lambda: self.store.append_callhistory_stage(
            "generation-new", "c" * 64, 0, [row("FAIL", "1", "candidate")]))
        with self.assertRaises(ValueError):
            self.mutate(lambda: self.store.activate_callhistory_stage("generation-new", "c" * 64, 2))
        self.assertEqual(self.store.callhistory_status()["generation"], "generation-old")
        self.assertEqual(self.store.fetch_call_history("K1OLD")["UserText"], "kept")

        self.store.conn.execute("""
            CREATE TRIGGER reject_failed_history BEFORE INSERT ON CALLHISTORY
            WHEN NEW.Call='FAIL' BEGIN SELECT RAISE(ABORT, 'injected failure'); END
        """)
        self.store.conn.commit()
        self.mutate(lambda: self.store.cancel_callhistory_stage())
        self.mutate(lambda: self.store.begin_callhistory_stage("generation-new", "c" * 64, 1))
        self.mutate(lambda: self.store.append_callhistory_stage(
            "generation-new", "c" * 64, 0, [row("FAIL", "1", "candidate")]))
        with self.assertRaises(Exception):
            self.mutate(lambda: self.store.activate_callhistory_stage("generation-new", "c" * 64, 1))
        self.assertEqual(self.store.callhistory_status()["generation"], "generation-old")
        self.assertEqual(self.store.fetch_call_history("K1OLD")["UserText"], "kept")

    def test_stage_rejects_stale_generation_offsets_and_unknown_columns(self):
        self.mutate(lambda: self.store.begin_callhistory_stage("generation-a", "d" * 64, 1))
        with self.assertRaises(ValueError):
            self.mutate(lambda: self.store.append_callhistory_stage(
                "generation-b", "d" * 64, 0, [row("K1ABC")]))
        with self.assertRaises(ValueError):
            self.mutate(lambda: self.store.append_callhistory_stage(
                "generation-a", "d" * 64, 1, [row("K1ABC")]))
        invalid = row("K1ABC")
        invalid["Unknown"] = "not admitted"
        with self.assertRaises(ValueError):
            self.mutate(lambda: self.store.append_callhistory_stage(
                "generation-a", "d" * 64, 0, [invalid]))


if __name__ == "__main__":
    unittest.main()
