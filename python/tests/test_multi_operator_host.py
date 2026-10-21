from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest
import uuid

from contest_host.host import Host, HostError


def uid():
    return str(uuid.uuid4())


CTY = {
    "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
    "K1ABC": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
}


class MultiOperatorHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace = uid(), uid()
        self.host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": self.session, "workspaceGeneration": self.workspace,
            "operationID": uid(), "expectedRevision": 0, "pluginID": "cq_wpx_cw",
            "station": {"Call": "OM0RX", "GridSquare": "JN88"}, "frequencyHz": 14025000,
            "settings": {"SentExchange": "CONFIGURED"},
            "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)},
        }})

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, **params):
        return self.host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": self.session, "workspaceGeneration": self.workspace, **params,
        }})

    def reserve(self, request_id=None, frequency=14025000):
        return self.call("multi_serial_reserve", requestID=request_id or uid(), frequencyHz=frequency)

    def remote(self, request_id=None, **params):
        return self.call("multi_contact_apply", requestID=request_id or uid(), **params)

    def test_concurrent_serials_are_unique_and_request_receipts_replay_or_conflict(self):
        request_ids = [uid(), uid()]
        barrier = threading.Barrier(2)
        results, failures = [], []

        def allocate(request_id):
            host = Host(self.root)
            try:
                barrier.wait()
                result = host.dispatch({"id": uid(), "method": "multi_serial_reserve", "params": {
                    "sessionID": self.session, "workspaceGeneration": self.workspace,
                    "requestID": request_id, "frequencyHz": 14025000,
                }})
                results.append(result)
            except BaseException as error:
                failures.append(error)
            finally:
                host.close()

        threads = [threading.Thread(target=allocate, args=(request_id,)) for request_id in request_ids]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(failures, [])
        self.assertEqual(sorted(result["serial"] for result in results), [2, 3])
        self.assertEqual({result["scope"] for result in results}, {"contest"})

        original = next(result for result in results if result["requestID"] == request_ids[0])
        replay = self.reserve(request_ids[0])
        self.assertEqual(replay["serial"], original["serial"])
        self.assertTrue(replay["replayed"])
        with self.assertRaises(HostError) as failure:
            self.reserve(request_ids[0], 7025000)
        self.assertEqual(failure.exception.code, "payload_conflict")
        with self.assertRaises(HostError) as failure:
            self.host.dispatch({"id": uid(), "method": "multi_serial_reserve", "params": {
                "sessionID": self.session, "workspaceGeneration": uid(),
                "requestID": uid(), "frequencyHz": 14025000,
            }})
        self.assertEqual(failure.exception.code, "stale_context")

    def test_remote_apply_dupe_conflicts_and_revision_cursor_changes_survive_restart(self):
        serial_request = uid()
        reservation = self.reserve(serial_request)
        dupe_request = uid()
        inquiry = self.call("multi_dupe_inquiry", requestID=dupe_request, call="k1abc",
                            frequencyHz=14025000, mode="CW", timestamp="2026-10-22 02:00:00")
        self.assertFalse(inquiry["isDupe"])

        qso_id, commit_request = uid(), uid()
        local_projection = self.host.dispatch({"id": uid(), "method": "projection",
                                               "params": {"sessionID": self.session}})["projection"]
        commit_params = {"action": "commit", "qsoID": qso_id, "timestamp": "2026-10-22 02:00:00",
                         "frequencyHz": 14025000, "serialRequestID": serial_request,
                         "operator": "OM0RX/P", "fields": {"callsign": "K1ABC", "other_2": "123"}}
        committed = self.remote(commit_request, **commit_params)
        self.assertEqual((committed["action"], committed["qsoID"], committed["changeRevision"]),
                         ("commit", qso_id, committed["revision"]))
        self.assertEqual((committed["projection"]["draftID"], committed["projection"]["fields"]),
                         (local_projection["draftID"], local_projection["fields"]))
        row = self.host.database(self.session).exec_sql("SELECT SentNr,Operator FROM DXLOG WHERE ID=?", (qso_id,))
        self.assertEqual((row["SentNr"], row["Operator"]), (reservation["serial"], "OM0RX/P"))
        self.assertEqual(self.remote(commit_request, **commit_params)["changeRevision"], committed["changeRevision"])
        self.assertTrue(self.remote(commit_request, **commit_params)["replayed"])
        conflicting_payload = deepcopy(commit_params)
        conflicting_payload["fields"]["other_2"] = "124"
        with self.assertRaises(HostError) as failure:
            self.remote(commit_request, **conflicting_payload)
        self.assertEqual(failure.exception.code, "payload_conflict")
        with self.assertRaises(HostError) as failure:
            self.remote(uid(), **commit_params)
        self.assertEqual(failure.exception.code, "contact_conflict")

        after = self.call("multi_dupe_inquiry", requestID=uid(), call="K1ABC",
                          frequencyHz=14025000, mode="CW", timestamp="2026-10-22 02:01:00")
        self.assertTrue(after["isDupe"])
        self.assertFalse(self.call("multi_dupe_inquiry", requestID=dupe_request, call="k1abc",
                                   frequencyHz=14025000, mode="CW",
                                   timestamp="2026-10-22 02:00:00")["isDupe"])

        corrected = self.remote(action="correct", qsoID=qso_id, baseRevision=committed["changeRevision"],
                                fields={"other_2": "456"}, reason="remote correction")
        with self.assertRaises(HostError) as failure:
            self.remote(action="delete", qsoID=qso_id, baseRevision=committed["changeRevision"],
                        reason="stale delete")
        self.assertEqual(failure.exception.code, "contact_conflict")
        deleted = self.remote(action="delete", qsoID=qso_id, baseRevision=corrected["changeRevision"],
                              reason="remote delete")

        first_request = uid()
        first = self.call("multi_changes", requestID=first_request, afterRevision=0, limit=2)
        self.assertEqual([change["kind"] for change in first["changes"]], ["commit", "correct"])
        self.assertTrue(first["hasMore"])
        self.assertEqual(first["nextRevision"], corrected["changeRevision"])
        replay = self.call("multi_changes", requestID=first_request, afterRevision=0, limit=2)
        self.assertEqual(replay["changes"], first["changes"])
        self.assertTrue(replay["replayed"])

        self.host.close()
        self.host = Host(self.root)
        second = self.call("multi_changes", requestID=uid(), afterRevision=first["nextRevision"], limit=2)
        self.assertEqual([(change["kind"], change["revision"]) for change in second["changes"]],
                         [("delete", deleted["changeRevision"])])
        self.assertFalse(second["hasMore"])
        self.assertEqual(second["nextRevision"], second["currentRevision"])
        row = self.host.database(self.session).exec_sql(
            "SELECT qso_id FROM xlog_serial WHERE draft_id=?", (serial_request,)
        )
        self.assertEqual(row["qso_id"], qso_id)

    def test_interrupted_schema_upgrade_repairs_index_and_null_audit_revision(self):
        serial_request = uid()
        self.reserve(serial_request)
        store = self.host.database(self.session)
        store.conn.execute("DROP INDEX xlog_serial_qso")
        store.conn.executescript("""
            ALTER TABLE xlog_qso_audit RENAME TO xlog_qso_audit_complete;
            CREATE TABLE xlog_qso_audit(sequence INTEGER PRIMARY KEY, revision INTEGER,
                operation_id TEXT NOT NULL, qso_id TEXT NOT NULL, kind TEXT NOT NULL,
                before_json TEXT, after_json TEXT, reason TEXT NOT NULL);
            INSERT INTO xlog_qso_audit SELECT * FROM xlog_qso_audit_complete;
            DROP TABLE xlog_qso_audit_complete;
        """)
        store.conn.execute(
            "INSERT INTO xlog_qso_audit(sequence,revision,operation_id,qso_id,kind,before_json,after_json,reason) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (999, None, uid(), uid(), "commit", None, "{}", "simulated interrupted migration"),
        )
        store.conn.commit()
        self.host.close()
        self.host = Host(self.root)
        repaired = self.host.database(self.session)
        indexes = {row["name"] for row in repaired.conn.execute("PRAGMA index_list(xlog_serial)")}
        self.assertIn("xlog_serial_qso", indexes)
        self.assertEqual(repaired.exec_sql("SELECT revision FROM xlog_qso_audit WHERE sequence=999")["revision"], 999)


if __name__ == "__main__":
    unittest.main()
