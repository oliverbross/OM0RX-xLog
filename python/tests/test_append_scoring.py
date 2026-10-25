"""Regression and workload checks for chronological contest appends."""
from datetime import datetime, timedelta
from time import perf_counter
import unittest
from unittest.mock import patch

from contest_host.host import Host
import test_oceania_host as fixtures


class AppendScoringTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.OceaniaHostTests()
        self.case.setUp()

    def tearDown(self):
        self.case.tearDown()

    def test_append_matches_full_rebuild_points_multipliers_and_score(self):
        for index, (call, frequency) in enumerate([
            ("VK4ABC", 14025000), ("VK4XYZ", 14025000),
            ("ZL1ABC", 14025000), ("VK4ABC", 7025000),
        ]):
            self.case.log(call, index, frequency)
            store = self.case.host.database(self.case.session)
            before = store.fetch_all_contacts_asc()
            score = self.case.read("score")["score"]
            # Corrections remain the independent full-replay authority.
            with patch.object(Host, "recalculate_append", side_effect=lambda desk, row: Host.rebuild(desk)):
                self.case.log("K1ABC", 30 + index)
            after = {row["ID"]: row for row in store.fetch_all_contacts_asc()}
            for row in before:
                self.assertEqual(after[row["ID"]], row)
            self.assertEqual(self.case.read("score")["score"]["points"], score["points"])

    def test_duplicate_append_preserves_prior_multipliers_and_older_insert_replays(self):
        first = self.case.log(minute=10)
        store = self.case.host.database(self.case.session)
        prior = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (first,))
        with patch.object(Host, "rebuild", side_effect=AssertionError("Append replayed history")):
            duplicate = self.case.log(minute=20)
        self.assertEqual(store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (first,)), prior)
        self.assertEqual(store.exec_sql("SELECT Points FROM DXLOG WHERE ID=?", (duplicate,))["Points"], 0)
        with patch.object(Host, "rebuild", wraps=Host.rebuild) as rebuild:
            earlier = self.case.log(minute=0)
            rebuild.assert_called_once()
        self.assertEqual(store.exec_sql("SELECT Points FROM DXLOG WHERE ID=?", (earlier,))["Points"], 1)
        self.assertEqual(store.exec_sql("SELECT Points FROM DXLOG WHERE ID=?", (first,))["Points"], 0)

    def test_append_work_does_not_rewrite_existing_rows_as_the_log_grows(self):
        self.case.log()
        store = self.case.host.database(self.case.session)
        base = store.exec_sql("SELECT * FROM DXLOG LIMIT 1")
        columns = list(base)
        insert = "INSERT INTO DXLOG (" + ",".join(columns) + ") VALUES (" + ",".join("?" for _ in columns) + ")"
        identity = store.exec_sql("SELECT raw_fields,country FROM xlog_qso_identity LIMIT 1")
        stamp = datetime(2026, 10, 20, 8)
        previous_count = 1
        for count in (100, 1_000, 3_000):
            for index in range(previous_count, count):
                row = dict(base)
                row["ID"] = fixtures.uid()
                row["TS"] = (stamp + timedelta(seconds=index)).strftime("%Y-%m-%d %H:%M:%S")
                store.conn.execute(insert, [row[column] for column in columns])
                store.conn.execute("INSERT INTO xlog_qso_identity VALUES (?,?,?,0)",
                                   (row["ID"], identity["raw_fields"], identity["country"]))
            store.conn.commit()
            traced = []
            store.conn.set_trace_callback(traced.append)
            start = perf_counter()
            # Strictly later than every seed row and previous measured append.
            self.case.mutate("qso_commit", timestamp=f"2026-10-21 00:{count // 100:02}:00",
                             fields={"callsign": "VK4XYZ", "other_2": "012"})
            elapsed = perf_counter() - start
            store.conn.set_trace_callback(None)
            print(f"CONTEST_BENCHMARK rows={count} append_ms={elapsed * 1000:.3f} sql_statements={len(traced)}")
            normalized = [sql.strip().lower() for sql in traced]
            self.assertNotIn("delete from dxlog", normalized)
            self.assertEqual(sum(sql.startswith("insert into dxlog") for sql in normalized), 1)
            self.assertLess(len(traced), 100, "Append must not replay every prior QSO")
            previous_count = count


if __name__ == "__main__":
    unittest.main()
