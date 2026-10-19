"""Upstream SQL semantics, with host-owned atomic mutation receipts."""
import json
from pathlib import Path
import sqlite3

from .upstream import VENDOR, load_cqww

load_cqww()
from not1mm.lib.database import DataBase


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


class Store(DataBase):
    def __init__(self, path):
        self.atomic = False
        super().__init__(str(path), VENDOR / "not1mm/data", 1)
        self.conn.executescript("""
            CREATE UNIQUE INDEX IF NOT EXISTS xlog_dxlog_identity ON DXLOG(ID);
            CREATE TABLE IF NOT EXISTS xlog_session(id TEXT PRIMARY KEY, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_operation(operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_qso_identity(id TEXT PRIMARY KEY, raw_fields TEXT NOT NULL, country TEXT, deleted INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS xlog_qso_audit(sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, qso_id TEXT NOT NULL, kind TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT NOT NULL);
        """)
        self.conn.commit()

    def connect(self, database):
        self.database = database
        self.conn = sqlite3.connect(database, timeout=5)
        self.conn.row_factory = self.row_factory
        self.conn.execute("PRAGMA journal_mode=DELETE")
        self.conn.execute("PRAGMA synchronous=FULL")
        self.conn.execute("PRAGMA foreign_keys=ON")

    def update_dxlog_table(self):
        # Upstream blindly ALTERs and suppresses the duplicate-column error.
        columns = {row["name"].lower() for row in self.conn.execute("PRAGMA table_info(DXLOG)")}
        if "dirty" not in columns:
            self.exec_sql_commit("ALTER TABLE DXLOG ADD dirty INTEGER DEFAULT 1")

    def exec_sql(self, query, params=()):
        return self.conn.execute(query, params).fetchone() or {}

    def exec_sql_mult(self, query, params=()):
        return self.conn.execute(query, params).fetchall()

    def exec_sql_commit(self, query, params=(), commit=True, error_logger=None):
        self.conn.execute(query, params)
        if commit and not self.atomic:
            self.conn.commit()

    def commit_it(self):
        if not self.atomic:
            self.conn.commit()

    def begin(self):
        self.conn.execute("BEGIN IMMEDIATE")
        self.atomic = True

    def finish(self, success):
        try:
            self.conn.commit() if success else self.conn.rollback()
        finally:
            self.atomic = False

    def state(self, session_id):
        row = self.exec_sql("SELECT state FROM xlog_session WHERE id=?", (session_id,))
        return json.loads(row["state"]) if row else None

    def save_state(self, state):
        self.conn.execute("INSERT INTO xlog_session VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state", (state["sessionID"], canonical(state)))

    def close(self):
        self.conn.close()
