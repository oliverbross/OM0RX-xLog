import hashlib
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import uuid

from contest_host.store import DataBase, Store
from contest_host.upstream import VENDOR


class StoreCatalogSeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Compare every field against the original verified Not1MM owner,
        # rather than duplicate its schema or catalog values in this fixture.
        original = DataBase(":memory:", VENDOR / "not1mm/data", 1)
        try:
            cls.original_rows = original.conn.execute("SELECT * FROM Contest ORDER BY Name").fetchall()
            cls.original_schema = original.conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='Contest'"
            ).fetchone()["sql"]
        finally:
            original.conn.close()
        cls.manifest_bytes = (VENDOR.parent / "source-manifest.json").read_bytes()

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.path = Path(self.temporary.name) / "contest.sqlite"
        self.connections = []

    def tearDown(self):
        for connection in self.connections:
            connection.close()
        self.temporary.cleanup()

    def test_fresh_catalog_is_exact_and_all_pinned_inserts_share_one_transaction(self):
        real_connect = sqlite3.connect
        seed_transactions = []

        def connect(*args, **kwargs):
            connection = real_connect(*args, **kwargs)
            self.connections.append(connection)

            def trace(statement):
                if statement.strip().upper().startswith('INSERT INTO "CONTEST"'):
                    seed_transactions.append(connection.in_transaction)

            connection.set_trace_callback(trace)
            return connection

        with patch("contest_host.store.sqlite3.connect", side_effect=connect):
            store = Store(self.path)
        self.assertIs(store.conn, self.connections[0])
        self.assertEqual(len(self.original_rows), 251)
        self.assertEqual(store.conn.execute("SELECT * FROM Contest ORDER BY Name").fetchall(), self.original_rows)
        self.assertEqual(store.conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='Contest'"
        ).fetchone()["sql"], self.original_schema)
        self.assertEqual(seed_transactions, [True] * 251)
        self.assertFalse(store.conn.in_transaction)
        self.assertFalse(store.atomic)
        self.assertEqual(store.conn.execute("PRAGMA journal_mode").fetchone()["journal_mode"], "delete")
        self.assertEqual(store.conn.execute("PRAGMA synchronous").fetchone()["synchronous"], 2)
        self.assertEqual(store.conn.execute("PRAGMA foreign_keys").fetchone()["foreign_keys"], 1)

        # Restoring the real connection must preserve the existing canonical
        # mutation contract; the initialization adapter cannot commit this write.
        store.begin()
        store.exec_sql_commit("INSERT INTO xlog_operation VALUES(?,?,?)", ("rollback-proof", "{}", "{}"))
        self.assertTrue(store.conn.in_transaction)
        store.finish(False)
        self.assertEqual(store.exec_sql("SELECT * FROM xlog_operation WHERE operation_id='rollback-proof'"), {})

        manifest = json.loads(self.manifest_bytes)
        for relative, expected in manifest["sha256"].items():
            self.assertEqual(hashlib.sha256((VENDOR / relative).read_bytes()).hexdigest(), expected, relative)
        self.assertEqual((VENDOR.parent / "source-manifest.json").read_bytes(), self.manifest_bytes)

    def test_nonempty_catalog_keeps_custom_row_contact_identity_and_original_source(self):
        store = Store(self.path)
        self.connections.append(store.conn)
        custom = dict(self.original_rows[0], Name="XLOGTEST", DisplayName="Private catalog sentinel")
        columns = tuple(custom)
        store.conn.execute(
            f"INSERT INTO Contest ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            tuple(custom.values()),
        )
        identity = uuid.uuid4().hex
        store.conn.execute("INSERT INTO DXLOG(TS,Call,Run1Run2,ID) VALUES(?,?,?,?)",
                           ("2026-11-03 00:00:00", "K1TEST", "Run1", identity))
        store.conn.commit()
        catalog = store.conn.execute("SELECT * FROM Contest ORDER BY Name").fetchall()
        contact = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (identity,))
        source = (VENDOR / "not1mm/data/contests.sql").read_bytes()
        store.close()
        reopened = Store(self.path)
        self.connections.append(reopened.conn)
        self.assertEqual(reopened.conn.execute("SELECT * FROM Contest ORDER BY Name").fetchall(), catalog)
        self.assertEqual(reopened.exec_sql("SELECT * FROM Contest WHERE Name='XLOGTEST'"), custom)
        self.assertEqual(reopened.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (identity,)), contact)
        self.assertEqual((VENDOR / "not1mm/data/contests.sql").read_bytes(), source)
        self.assertIsInstance(reopened.conn, sqlite3.Connection)
        self.assertFalse(reopened.conn.in_transaction)

    def test_mid_seed_failure_rolls_back_restores_connection_and_allows_exact_retry(self):
        real_connect = sqlite3.connect
        attempted_inserts = []

        def connect(*args, **kwargs):
            connection = real_connect(*args, **kwargs)
            self.connections.append(connection)

            def authorize(action, first, second, database, trigger):
                if action == sqlite3.SQLITE_INSERT and first == "Contest":
                    attempted_inserts.append(connection.in_transaction)
                    if len(attempted_inserts) == 10:
                        return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            connection.set_authorizer(authorize)
            return connection

        failed = Store.__new__(Store)
        with patch("contest_host.store.sqlite3.connect", side_effect=connect):
            with self.assertRaises(sqlite3.DatabaseError):
                Store.__init__(failed, self.path)
        self.assertEqual(attempted_inserts, [True] * 10)
        self.assertIs(failed.conn, self.connections[0], "The scoped delegate must be removed even when seeding raises")
        self.assertFalse(failed.conn.in_transaction)
        self.assertFalse(failed.atomic)
        self.assertEqual(failed.conn.execute("SELECT count(*) AS total FROM Contest").fetchone()["total"], 0)
        self.assertEqual(failed.conn.execute("PRAGMA integrity_check").fetchone()["integrity_check"], "ok")
        # A second real connection can acquire a write transaction: rollback
        # released the failed initialization lock without closing the first one.
        with real_connect(self.path, timeout=0) as probe:
            probe.execute("BEGIN IMMEDIATE")
            probe.rollback()
        failed.close()
        retried = Store(self.path)
        self.connections.append(retried.conn)
        self.assertEqual(retried.conn.execute("SELECT * FROM Contest ORDER BY Name").fetchall(), self.original_rows)
        self.assertIsInstance(retried.conn, sqlite3.Connection)
        self.assertFalse(retried.conn.in_transaction)


if __name__ == "__main__":
    unittest.main()
