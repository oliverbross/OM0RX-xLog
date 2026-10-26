"""Bounded disposable 20k-row Host/SQLite probe, with observed timings only.

Rows are copies of one real WPX commit, not a sponsor-scoring qualification or
20,000 serial allocations. No production store, package, native output or account
is opened. Every read/mutation under measurement uses the actual Host dispatcher.
"""
from copy import deepcopy
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import platform
import sqlite3
from tempfile import TemporaryDirectory
from time import perf_counter
import unittest
import uuid

from contest_host.host import Host


class ProductivityLoadTests(unittest.TestCase):
    def test_20000_synthetic_copied_contacts_sort_filter_commit_and_readback(self):
        fixture = deepcopy(json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())["cq_wpx_cw"])
        with TemporaryDirectory(prefix="xlog-wave1-load-") as directory:
            host = Host(Path(directory).resolve())
            session, generation = str(uuid.uuid4()), str(uuid.uuid4())
            revision = 0
            timings = {}

            def read(method, **params):
                return host.dispatch({"id": str(uuid.uuid4()), "method": method,
                                      "params": {"sessionID": session, **params}})

            def mutate(method, **params):
                nonlocal revision
                result = read(method, operationID=str(uuid.uuid4()), expectedRevision=revision, **params)
                revision = result["revision"]
                return result

            def measured(name, action):
                started = perf_counter()
                value = action()
                timings[name] = round((perf_counter() - started) * 1000, 3)
                return value

            try:
                state = fixture["state"]
                created = mutate("session_create", pluginID="cq_wpx_cw", workspaceGeneration=generation,
                                 station=state["station"], settings=state["settings"], reference=state["reference"],
                                 frequencyHz=state["draft"]["frequencyHz"], mode=fixture["mode"])
                fields = {field["id"]: field["value"] for field in created["projection"]["fields"]}
                fields.update(fixture["fields"])
                fields["other_1"] = str(created["projection"]["reservedSerial"]).zfill(3)
                seed_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "xlog-wave1-load/seed"))
                mutate("qso_commit", qsoID=seed_id, fields=fields, timestamp="2026-10-24 00:00:00")
                store = host.database(session)
                seed = store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (seed_id,))
                identity = store.exec_sql("SELECT * FROM xlog_qso_identity WHERE id=?", (seed_id,))
                columns = list(seed)
                insert = "INSERT INTO DXLOG (" + ",".join('"' + column + '"' for column in columns) + ") VALUES (" + ",".join("?" for _ in columns) + ")"
                rows, identities = [], []
                expected_filter = [seed["Call"]] if "K1AB" in seed["Call"] else []
                expected_frequency = [(float(seed["Freq"]), seed_id)]
                start = datetime(2026, 10, 24)
                for ordinal in range(2, 20001):
                    # Four alphabetic suffix letters keep the seed's K1 WPX prefix.
                    number, suffix = ordinal, ""
                    for _ in range(4):
                        suffix = chr(65 + number % 26) + suffix
                        number //= 26
                    call = "K1" + suffix
                    item = dict(seed)
                    item.update(ID=str(uuid.uuid5(uuid.NAMESPACE_URL, f"xlog-wave1-load/{ordinal}")),
                                TS=(start + timedelta(seconds=ordinal)).strftime("%Y-%m-%d %H:%M:%S"),
                                Call=call, SentNr=ordinal, NR=ordinal,
                                Freq=14000.0 + (ordinal % 500) / 10, QSXFreq=14000.0 + (ordinal % 500) / 10,
                                IsMultiplier1=0, IsMultiplier2=0, isMultiplier3=0)
                    raw = json.loads(identity["raw_fields"])
                    raw.update(callsign=call, other_1=str(ordinal), other_2=str(ordinal))
                    rows.append(tuple(item[column] for column in columns))
                    identities.append((item["ID"], json.dumps(raw), identity["country"], 0))
                    expected_frequency.append((float(item["Freq"]), item["ID"]))
                    if "K1AB" in call:
                        expected_filter.append(call)
                store.begin()
                try:
                    store.conn.executemany(insert, rows)
                    store.conn.executemany("INSERT INTO xlog_qso_identity VALUES(?,?,?,?)", identities)
                    store.finish(True)
                except BaseException:
                    store.finish(False)
                    raise

                def fingerprint():
                    payload = json.dumps(store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID"), sort_keys=True)
                    return hashlib.sha256(payload.encode()).hexdigest()

                original_fingerprint = fingerprint()
                before_projection = read("projection")["projection"]
                self.assertEqual(before_projection["score"]["qsos"], 20000)
                ordered = measured("received_serial_sort_ms", lambda: read("log_page", sort="receivedSerial",
                                   direction="descending", offset=0, limit=25, expectedRevision=revision))
                self.assertEqual(ordered["total"], 20000)
                self.assertEqual([int(row["NR"]) for row in ordered["rows"]], list(range(20000, 19975, -1)))
                deep = measured("sent_serial_deep_page_ms", lambda: read("log_page", sort="sentSerial",
                                direction="ascending", offset=10000, limit=25, expectedRevision=revision))
                self.assertEqual([int(row["SentNr"]) for row in deep["rows"]], list(range(10001, 10026)))
                frequencies = measured("frequency_deep_page_ms", lambda: read("log_page", sort="frequency",
                                       direction="descending", offset=5000, limit=25, expectedRevision=revision))
                self.assertEqual([(float(row["Freq"]), row["ID"]) for row in frequencies["rows"]],
                                 sorted(expected_frequency, key=lambda item: (-item[0], item[1]))[5000:5025])
                filtered = measured("callsign_filter_ms", lambda: read("log_page", sort="call", direction="ascending",
                                    query="K1AB", offset=0, limit=100, expectedRevision=revision))
                self.assertEqual(filtered["total"], len(expected_filter))
                self.assertEqual([row["Call"] for row in filtered["rows"]], sorted(expected_filter)[:100])
                self.assertEqual(fingerprint(), original_fingerprint)
                self.assertEqual(read("projection")["projection"], before_projection)

                current_fields = {field["id"]: field["value"] for field in before_projection["fields"]}
                current_fields.update(callsign="N0LOAD", other_2="543")
                final_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "xlog-wave1-load/final"))
                committed = measured("durable_commit_ms", lambda: mutate("qso_commit", qsoID=final_id,
                                     fields=current_fields, timestamp="2026-10-25 00:00:00"))
                self.assertEqual(committed["projection"]["score"]["qsos"], 20001)
                readback = measured("committed_contact_readback_ms", lambda: read("log_page", query="N0LOAD",
                                    expectedRevision=revision, limit=10))
                self.assertEqual(readback["total"], 1)
                row = readback["rows"][0]
                self.assertEqual((row["ID"], row["Call"], int(row["NR"])), (final_id, "N0LOAD", 543))
                self.assertEqual(row["raw_fields"]["other_2"], "543")
                self.assertEqual(int(row["SentNr"]), before_projection["reservedSerial"])
                self.assertEqual(read("log_page", limit=1)["total"], 20001)
                self.assertEqual(store.exec_sql("SELECT * FROM DXLOG WHERE ID=?", (seed_id,)), seed)
                # Exclude the one deliberate append: all 20k copied contact fields must remain byte-equivalent.
                existing = store.exec_sql_mult("SELECT * FROM DXLOG WHERE ID<>? ORDER BY ID", (final_id,))
                self.assertEqual(hashlib.sha256(json.dumps(existing, sort_keys=True).encode()).hexdigest(), original_fingerprint)
                print("Wave1 disposable Host/SQLite 20k probe " + json.dumps({
                    "synthetic_contacts_before": 20000, "contacts_after": 20001,
                    "platform": platform.platform(), "machine": platform.machine(),
                    "python": platform.python_version(), "sqlite": sqlite3.sqlite_version,
                    "observed_ms": timings, "scope": "single local run; copied-row load; no latency target or scoring certification",
                }, sort_keys=True), flush=True)
            finally:
                host.close()
