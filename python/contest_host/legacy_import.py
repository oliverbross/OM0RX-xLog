"""Read-only inspection of legacy Not1MM SQLite contest databases."""
import hashlib
import json
from pathlib import Path
import sqlite3


MAX_SOURCE_BYTES = 512 * 1024 * 1024
MAX_SOURCE_ROWS = 250_000


class LegacyImportError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise LegacyImportError("source_schema", "Legacy database contains an unsupported cell value") from error


def _snapshot(path):
    supplied = Path(path).absolute()
    try:
        stat = supplied.lstat()
    except (OSError, TypeError) as error:
        raise LegacyImportError("source_unavailable", "Legacy database is unavailable") from error
    if supplied.is_symlink() or not supplied.is_file():
        raise LegacyImportError("source_unsafe", "Legacy database must be a regular, non-symlink file")
    if stat.st_size > MAX_SOURCE_BYTES:
        raise LegacyImportError("source_too_large", "Legacy database exceeds the 512 MiB import limit")
    digest = hashlib.sha256()
    try:
        with supplied.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise LegacyImportError("source_unavailable", "Legacy database could not be read") from error
    identity = hashlib.sha256(f"not1mm-sqlite\0{stat.st_dev}\0{stat.st_ino}".encode("ascii")).hexdigest()
    return supplied, {"identity": identity, "fileDigest": digest.hexdigest(), "byteLength": stat.st_size}


def _connect(path):
    connection = None
    try:
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "DXLOG" not in tables or "ContestInstance" not in tables:
            raise LegacyImportError("source_schema", "File is not a legacy Not1MM contest database")
        return connection, tables
    except LegacyImportError:
        if connection is not None:
            connection.close()
        raise
    except sqlite3.Error as error:
        if connection is not None:
            connection.close()
        raise LegacyImportError("source_schema", "Legacy database schema could not be read") from error


def _rows(connection, query, params=()):
    try:
        return [dict(row) for row in connection.execute(query, params)]
    except sqlite3.Error as error:
        raise LegacyImportError("source_schema", "Legacy database does not contain the expected contest fields") from error


def _host_values(row):
    """Keep only values accepted by the existing contest creation envelope."""
    return {key: value for key, value in row.items()
            if isinstance(value, (str, int)) and not isinstance(value, bool)}


def _source_digest(connection, tables):
    """Hash relevant logical rows so committed WAL content is part of source identity."""
    digest = hashlib.sha256(b"xlog-not1mm-source-v1\0")
    for table in ("ContestInstance", "Station", "DXLOG"):
        if table not in tables:
            continue
        schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()[0]
        digest.update(_canonical({"table": table, "schema": schema}).encode("utf-8"))
        for row in connection.execute(f'SELECT rowid AS __source_rowid__,* FROM "{table}" ORDER BY rowid'):
            digest.update(_canonical(dict(row)).encode("utf-8"))
            digest.update(b"\n")
    return digest.hexdigest()


def inspect_source(path, contest_nr=None, include_rows=False):
    """Return a stable preview, optionally with exact rows for an acknowledged import."""
    supplied, before = _snapshot(path)
    connection, tables = _connect(supplied)
    try:
        logical_digest = _source_digest(connection, tables)
        contest_columns = {row[1] for row in connection.execute("PRAGMA table_info(ContestInstance)")}
        if not {"ContestName", "ContestNR"} <= contest_columns:
            raise LegacyImportError("source_schema", "Legacy contest metadata is incomplete")
        contests = _rows(connection, "SELECT * FROM ContestInstance ORDER BY ContestNR,ContestID")
        previews = []
        selected = None
        for contest in contests:
            number = contest.get("ContestNR")
            if type(number) is not int:
                continue
            summary = dict(connection.execute(
                "SELECT count(*) AS rowCount,min(TS) AS firstUTC,max(TS) AS lastUTC "
                "FROM DXLOG WHERE ContestNR=?", (number,)
            ).fetchone())
            first_frequency = connection.execute(
                "SELECT Freq FROM DXLOG WHERE ContestNR=? ORDER BY TS,rowid LIMIT 1", (number,)
            ).fetchone()
            frequency_khz = first_frequency[0] if first_frequency else None
            frequency_hz = round(float(frequency_khz) * 1000) if isinstance(frequency_khz, (int, float)) else None
            exchanges = [row[0] for row in connection.execute(
                "SELECT DISTINCT Exchange1 FROM DXLOG WHERE ContestNR=? AND Exchange1<>'' "
                "ORDER BY Exchange1 LIMIT 64", (number,)
            )]
            preview = {"contestNR": number, "contestName": contest.get("ContestName") or "",
                       "rowCount": summary["rowCount"], "firstUTC": summary["firstUTC"],
                       "lastUTC": summary["lastUTC"], "frequencyHz": frequency_hz,
                       "exchangeValues": exchanges,
                       "settings": _host_values(contest)}
            previews.append(preview)
            if contest_nr == number:
                selected = preview
        station_rows = _rows(connection, "SELECT * FROM Station ORDER BY rowid LIMIT 1") if "Station" in tables else []
        station = _host_values(station_rows[0]) if station_rows else None
        result = {"source": {"identity": before["identity"], "digest": logical_digest,
                             "byteLength": before["byteLength"]},
                  "contests": previews, "station": station}
        if contest_nr is not None:
            if selected is None:
                raise LegacyImportError("source_contest_missing", "Selected contest is not present in the legacy database")
            if selected["rowCount"] > MAX_SOURCE_ROWS:
                raise LegacyImportError("source_too_large", "Legacy contest exceeds the 250,000 QSO import limit")
            result["contest"] = selected
            if include_rows:
                rows = _rows(connection, "SELECT rowid AS __source_rowid__,* FROM DXLOG WHERE ContestNR=? ORDER BY rowid", (contest_nr,))
                result["rows"] = rows
        connection.rollback()
    finally:
        connection.close()
    _, after = _snapshot(supplied)
    if after != before:
        raise LegacyImportError("source_changed", "Legacy database changed while it was being read")
    return result


def row_digest(raw_fields):
    return hashlib.sha256(_canonical(raw_fields).encode("utf-8")).hexdigest()
