"""Upstream SQL semantics, with host-owned atomic mutation receipts."""
import json
from pathlib import Path
import sqlite3

from .upstream import VENDOR, load_cqww
from .plugins import CQ_WW_PLUGINS

load_cqww()
from not1mm.lib.database import DataBase


CALLHISTORY_COLUMNS = (
    "Call", "Name", "Loc1", "Loc2", "Sect", "State", "CK", "BirthDate",
    "Exch1", "Misc", "Power", "CqZone", "ITUZone", "UserText", "LastUpdateNote",
)


class CallHistoryRow(dict):
    """Retain upstream spelling while making its CQZone/CqZone lookup defect harmless."""

    def get(self, key, default=None):
        if key in self:
            return super().get(key, default)
        if isinstance(key, str):
            folded = key.casefold()
            for candidate, value in self.items():
                if isinstance(candidate, str) and candidate.casefold() == folded:
                    return value
        return default


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


class Store(DataBase):
    def __init__(self, path):
        self.atomic = False
        self.plugin_id = None
        super().__init__(str(path), VENDOR / "not1mm/data", 1)
        self.conn.executescript("""
            CREATE UNIQUE INDEX IF NOT EXISTS xlog_dxlog_identity ON DXLOG(ID);
            CREATE TABLE IF NOT EXISTS xlog_session(id TEXT PRIMARY KEY, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_operation(operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_output_claim(operation_id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS xlog_serial(draft_id TEXT PRIMARY KEY, serial INTEGER NOT NULL UNIQUE, operation_id TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_qso_identity(id TEXT PRIMARY KEY, raw_fields TEXT NOT NULL, country TEXT, deleted INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS xlog_qso_audit(sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, qso_id TEXT NOT NULL, kind TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_callhistory_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                generation TEXT NOT NULL, digest TEXT NOT NULL, row_count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_callhistory_stage_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                generation TEXT NOT NULL, digest TEXT NOT NULL, expected_count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS xlog_callhistory_stage(ordinal INTEGER PRIMARY KEY,
                Call TEXT NOT NULL, Name TEXT, Loc1 TEXT, Loc2 TEXT, Sect TEXT, State TEXT, CK TEXT,
                BirthDate TEXT, Exch1 TEXT, Misc TEXT, Power TEXT, CqZone TEXT, ITUZone TEXT,
                UserText TEXT, LastUpdateNote TEXT);
        """)
        # Retain every issued reservation when introducing per-band scopes.
        columns = {row["name"] for row in self.conn.execute("PRAGMA table_info(xlog_serial)")}
        if "scope" not in columns:
            self.conn.executescript("""
                BEGIN IMMEDIATE;
                ALTER TABLE xlog_serial RENAME TO xlog_serial_legacy;
                CREATE TABLE xlog_serial(draft_id TEXT NOT NULL, serial INTEGER NOT NULL,
                    operation_id TEXT NOT NULL, scope TEXT NOT NULL,
                    PRIMARY KEY(draft_id,scope), UNIQUE(scope,serial));
                INSERT INTO xlog_serial SELECT draft_id,serial,operation_id,'contest' FROM xlog_serial_legacy;
                DROP TABLE xlog_serial_legacy;
                COMMIT;
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

    @staticmethod
    def cq_ww_multiplier_filter(alias="q"):
        return (
            f"{alias}.CountryPrefix <> '' AND NOT EXISTS ("
            "SELECT 1 FROM DXLOG AS prior "
            f"WHERE prior.ContestNR = {alias}.ContestNR "
            f"AND prior.Call = {alias}.Call AND prior.Band = {alias}.Band "
            f"AND prior.rowid < {alias}.rowid)"
        )

    def fetch_zn_band_count(self):
        if self.plugin_id in CQ_WW_PLUGINS:
            return self.exec_sql(
                "select count(DISTINCT(q.ZN || ':' || q.Band)) as zb_count "
                "from DXLOG as q where q.ContestNR = ? and "
                f"{self.cq_ww_multiplier_filter()};",
                (self.current_contest,),
            )
        return super().fetch_zn_band_count()

    def fetch_country_band_count(self):
        if self.plugin_id in CQ_WW_PLUGINS:
            return self.exec_sql(
                "select count(DISTINCT(q.CountryPrefix || ':' || q.Band)) as cb_count "
                "from DXLOG as q where q.ContestNR = ? and "
                f"{self.cq_ww_multiplier_filter()};",
                (self.current_contest,),
            )
        return super().fetch_country_band_count()

    def fetch_state_band_count(self):
        return int(self.exec_sql(
            "SELECT count(DISTINCT(q.Exchange1 || ':' || q.Band)) AS spc_count "
            "FROM DXLOG AS q WHERE q.ContestNR=? AND q.Exchange1 <> 'DX' AND "
            f"{self.cq_ww_multiplier_filter()}",
            (self.current_contest,),
        ).get("spc_count", 0))

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

    def callhistory_status(self):
        row = self.exec_sql("SELECT generation,digest,row_count FROM xlog_callhistory_state WHERE singleton=1")
        if not row:
            return None
        return {"generation": row["generation"], "digest": row["digest"], "rowCount": row["row_count"]}

    def begin_callhistory_stage(self, generation, digest, expected_count):
        self.conn.execute("DELETE FROM xlog_callhistory_stage")
        self.conn.execute("DELETE FROM xlog_callhistory_stage_meta")
        self.conn.execute(
            "INSERT INTO xlog_callhistory_stage_meta VALUES(1,?,?,?)",
            (generation, digest, expected_count),
        )

    def append_callhistory_stage(self, generation, digest, offset, rows):
        meta = self.exec_sql(
            "SELECT generation,digest,expected_count FROM xlog_callhistory_stage_meta WHERE singleton=1"
        )
        if not meta or meta["generation"] != generation or meta["digest"] != digest:
            raise ValueError("Call-history stage is stale")
        actual = self.exec_sql("SELECT count(*) AS value FROM xlog_callhistory_stage")["value"]
        if actual == offset + len(rows):
            columns = ",".join(CALLHISTORY_COLUMNS)
            existing = self.exec_sql_mult(
                f"SELECT {columns} FROM xlog_callhistory_stage WHERE ordinal>=? AND ordinal<? ORDER BY ordinal",
                (offset, offset + len(rows)),
            )
            if len(existing) == len(rows) and all(
                all(str(candidate[key] if candidate[key] is not None else "") == row[key]
                    for key in CALLHISTORY_COLUMNS)
                for candidate, row in zip(existing, rows)
            ):
                return
        if actual != offset or offset + len(rows) > meta["expected_count"]:
            raise ValueError("Call-history stage offset is invalid")
        placeholders = ",".join("?" for _ in range(len(CALLHISTORY_COLUMNS) + 1))
        sql = f"INSERT INTO xlog_callhistory_stage VALUES({placeholders})"
        for index, row in enumerate(rows, offset):
            if set(row) != set(CALLHISTORY_COLUMNS) or not all(isinstance(row[key], str) for key in CALLHISTORY_COLUMNS):
                raise ValueError("Call-history row is invalid")
            self.conn.execute(sql, (index, *(row[key] for key in CALLHISTORY_COLUMNS)))

    def activate_callhistory_stage(self, generation, digest, expected_count):
        active = self.callhistory_status()
        if active == {"generation": generation, "digest": digest, "rowCount": expected_count}:
            return
        meta = self.exec_sql(
            "SELECT generation,digest,expected_count FROM xlog_callhistory_stage_meta WHERE singleton=1"
        )
        actual = self.exec_sql("SELECT count(*) AS value FROM xlog_callhistory_stage").get("value", 0)
        if (not meta or meta["generation"] != generation or meta["digest"] != digest or
                meta["expected_count"] != expected_count or actual != expected_count):
            raise ValueError("Call-history stage is incomplete")
        columns = ",".join(CALLHISTORY_COLUMNS)
        self.conn.execute("DELETE FROM CALLHISTORY")
        self.conn.execute(
            f"INSERT INTO CALLHISTORY({columns}) SELECT {columns} FROM xlog_callhistory_stage ORDER BY ordinal"
        )
        self.conn.execute(
            "INSERT INTO xlog_callhistory_state VALUES(1,?,?,?) "
            "ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation,digest=excluded.digest,row_count=excluded.row_count",
            (generation, digest, expected_count),
        )
        self.conn.execute("DELETE FROM xlog_callhistory_stage")
        self.conn.execute("DELETE FROM xlog_callhistory_stage_meta")

    def cancel_callhistory_stage(self, generation, digest):
        meta = self.exec_sql(
            "SELECT generation,digest FROM xlog_callhistory_stage_meta WHERE singleton=1"
        )
        if not meta:
            return
        if meta["generation"] != generation or meta["digest"] != digest:
            raise ValueError("Call-history stage is stale")
        self.conn.execute("DELETE FROM xlog_callhistory_stage")
        self.conn.execute("DELETE FROM xlog_callhistory_stage_meta")

    def fetch_call_history(self, call):
        row = super().fetch_call_history(call)
        return CallHistoryRow(row) if row else row

    def fetch_wpx_exists_before_contact(self, wpx, timestamp, qso_id):
        """Pinned WPX lookup with the host's stable same-second replay order."""
        return self.exec_sql(
            "SELECT count(*) AS wpx_count FROM DXLOG WHERE WPXPrefix=? AND ContestNR=? "
            "AND (TS < ? OR (TS=? AND rowid < (SELECT rowid FROM DXLOG WHERE ID=?)))",
            (wpx, self.current_contest, timestamp, timestamp, qso_id),
        )

    def fetch_band_lastletter_exists_before_contact(self, band, call, timestamp, qso_id):
        """Stable OK1WC multiplier lookup for contacts sharing one UTC second."""
        return self.exec_sql(
            "SELECT count(*) AS count FROM DXLOG WHERE Band=? AND substr(Call,-1)=substr(?,-1) "
            "AND ContestNR=? AND (TS<? OR (TS=? AND rowid<(SELECT rowid FROM DXLOG WHERE ID=?)))",
            (band, call, self.current_contest, timestamp, timestamp, qso_id),
        )

    def close(self):
        self.conn.close()
