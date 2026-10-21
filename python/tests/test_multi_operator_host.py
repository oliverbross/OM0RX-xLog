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

    def create_replica_session(self):
        session, workspace = uid(), uid()
        created = self.host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": uid(), "expectedRevision": 0, "pluginID": "cq_wpx_cw",
            "station": {"Call": "OM0RX", "GridSquare": "JN88"}, "frequencyHz": 14025000,
            "settings": {"SentExchange": "CONFIGURED"},
            "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)},
        }})
        return session, workspace, created["projection"]

    @staticmethod
    def replica_reservation(result):
        return {key: deepcopy(result[key]) for key in
                ("requestID", "scope", "serial", "sentExchange", "allocatedFieldID", "authority")}

    def apply_replica(self, session, workspace, projection, changes, reservation=None,
                      operation_id=None, authored_qso=None, mutate=None):
        cursor = projection.get("replicaCursor") or {}
        params = {
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": operation_id or uid(), "expectedRevision": projection["revision"],
            "authority": deepcopy(changes["authority"]),
            "fromCursor": {"revision": cursor.get("revision", 0),
                           "sequence": cursor.get("sequence", 0)},
            "toCursor": {"revision": changes["nextRevision"], "sequence": changes["nextSequence"]},
            "historyComplete": not changes["hasMore"],
            "changes": deepcopy(changes["changes"]),
        }
        if reservation is not None:
            params["nextReservation"] = self.replica_reservation(reservation)
        if authored_qso:
            params.update({"draftID": projection["draftID"], "authoredQSOID": authored_qso})
        if mutate:
            mutate(params)
        return self.host.dispatch({"id": uid(), "method": "multi_replica_apply", "params": params}), params

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
            INSERT INTO xlog_qso_audit(sequence,revision,operation_id,qso_id,kind,before_json,after_json,reason)
                SELECT sequence,revision,operation_id,qso_id,kind,before_json,after_json,reason
                FROM xlog_qso_audit_complete;
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
        with self.assertRaises(HostError) as failure:
            self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        self.assertEqual(failure.exception.code, "replica_change_unsupported")

    def test_replica_apply_is_atomic_idempotent_and_advances_authored_draft(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        serial_request = uid()
        self.reserve(serial_request)
        qso_id = uid()
        committed = self.remote(action="commit", qsoID=qso_id, timestamp="2026-10-22 03:00:00",
                                frequencyHz=14025000, serialRequestID=serial_request,
                                fields={"callsign": "K1ABC", "other_2": "101"})
        changes = self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        next_reservation = self.reserve(uid())
        applied, params = self.apply_replica(replica_session, replica_workspace, replica_projection,
                                             changes, next_reservation, authored_qso=qso_id)
        self.assertEqual(applied["replicaCursor"],
                         {"revision": changes["nextRevision"], "sequence": changes["nextSequence"]})
        self.assertNotEqual(applied["projection"]["draftID"], replica_projection["draftID"])
        self.assertEqual(applied["projection"]["reservedSerial"], next_reservation["serial"])
        self.assertEqual(applied["projection"]["authoritySerialRequestID"], next_reservation["requestID"])
        master_row = self.host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
        replica_row = self.host.database(replica_session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso_id,))
        self.assertEqual(replica_row, master_row)
        replay = self.host.dispatch({"id": uid(), "method": "multi_replica_apply", "params": params})
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["projection"]["draftID"], applied["projection"]["draftID"])
        conflict = deepcopy(params); conflict["changes"] = []
        with self.assertRaises(HostError) as failure:
            self.host.dispatch({"id": uid(), "method": "multi_replica_apply", "params": conflict})
        self.assertEqual(failure.exception.code, "payload_conflict")
        with self.assertRaises(HostError) as failure:
            self.host.dispatch({"id": uid(), "method": "qso_commit", "params": {
                "sessionID": replica_session, "operationID": uid(),
                "expectedRevision": applied["revision"], "draftID": applied["projection"]["draftID"],
            }})
        self.assertEqual(failure.exception.code, "replica_read_only")

        self.host.close(); self.host = Host(self.root)
        reopened = self.host.dispatch({"id": uid(), "method": "projection",
                                      "params": {"sessionID": replica_session}})["projection"]
        self.assertEqual(reopened["replicaCursor"], applied["replicaCursor"])
        self.assertEqual(reopened["authoritySerialRequestID"], next_reservation["requestID"])

        empty = self.call("multi_changes", requestID=uid(),
                          afterRevision=reopened["replicaCursor"]["revision"],
                          afterSequence=reopened["replicaCursor"]["sequence"], limit=100)
        replica_store = self.host.database(replica_session)
        before_poll = {
            "revision": reopened["revision"], "draftID": reopened["draftID"],
            "serial": reopened["reservedSerial"],
            "requestID": reopened["authoritySerialRequestID"],
            "serialCount": replica_store.exec_sql("SELECT count(*) AS n FROM xlog_serial")["n"],
            "receiptCount": replica_store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"],
        }
        polled, first_poll_params = self.apply_replica(
            replica_session, replica_workspace, reopened, empty)
        polled_again, second_poll_params = self.apply_replica(
            replica_session, replica_workspace, polled["projection"], empty)
        after_poll = self.host.database(replica_session)
        self.assertEqual(
            {"revision": polled_again["revision"], "draftID": polled_again["projection"]["draftID"],
             "serial": polled_again["projection"]["reservedSerial"],
             "requestID": polled_again["projection"]["authoritySerialRequestID"],
             "serialCount": after_poll.exec_sql("SELECT count(*) AS n FROM xlog_serial")["n"],
             "receiptCount": after_poll.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"]},
            before_poll,
        )
        self.assertFalse(after_poll.exec_sql("SELECT operation_id FROM xlog_operation WHERE operation_id IN (?,?)",
                                             (first_poll_params["operationID"], second_poll_params["operationID"])))
        with self.assertRaises(HostError) as failure:
            self.apply_replica(replica_session, replica_workspace, polled_again["projection"],
                               empty, next_reservation)
        self.assertEqual(failure.exception.code, "serial_conflict")

        newer_qso = uid()
        newer = self.remote(action="commit", qsoID=newer_qso, timestamp="2026-10-22 03:01:00",
                            frequencyHz=14025000, serialRequestID=next_reservation["requestID"],
                            fields={"callsign": "K1ABC", "other_2": "201"})
        authored_page = self.call("multi_changes", requestID=uid(),
                                  afterRevision=polled_again["replicaCursor"]["revision"],
                                  afterSequence=polled_again["replicaCursor"]["sequence"], limit=100)
        with self.assertRaises(HostError) as failure:
            self.apply_replica(replica_session, replica_workspace, polled_again["projection"],
                               authored_page, authored_qso=newer_qso)
        self.assertEqual(failure.exception.code, "serial_not_found")
        replacement_reservation = self.reserve(uid())
        authored_replica, _ = self.apply_replica(
            replica_session, replica_workspace, polled_again["projection"], authored_page,
            replacement_reservation, authored_qso=newer_qso)
        self.assertEqual(authored_replica["projection"]["authoritySerialRequestID"],
                         replacement_reservation["requestID"])
        corrected = self.remote(action="correct", qsoID=qso_id,
                                baseRevision=committed["changeRevision"], fields={"other_2": "202"})
        correction_page = self.call("multi_changes", requestID=uid(),
                                    afterRevision=authored_replica["replicaCursor"]["revision"],
                                    afterSequence=authored_replica["replicaCursor"]["sequence"], limit=100)
        self.assertEqual(self.host.database(replica_session).replica()["coordination_digest"],
                         correction_page["authority"]["coordinationDigest"])
        serial_count = self.host.database(replica_session).exec_sql("SELECT count(*) AS n FROM xlog_serial")["n"]
        corrected_replica, _ = self.apply_replica(replica_session, replica_workspace,
                                                   authored_replica["projection"],
                                                   correction_page)
        self.assertEqual(corrected_replica["projection"]["authoritySerialRequestID"],
                         replacement_reservation["requestID"])
        self.assertEqual(self.host.database(replica_session).exec_sql(
            "SELECT count(*) AS n FROM xlog_serial")["n"], serial_count)
        self.assertEqual(self.host.database(replica_session).exec_sql(
            "SELECT * FROM DXLOG WHERE ID=?", (qso_id,)), self.host.database(self.session).exec_sql(
                "SELECT * FROM DXLOG WHERE ID=?", (qso_id,)))
        self.host.close(); self.host = Host(self.root)
        replica_log = self.host.dispatch({"id": uid(), "method": "log",
                                          "params": {"sessionID": replica_session}})["rows"]
        partial = self.host.dispatch({"id": uid(), "method": "check_partial", "params": {
            "sessionID": replica_session, "query": "K1ABC",
        }})["rows"]
        self.assertEqual(next(row for row in replica_log if row["ID"] == qso_id)["change_revision"],
                         corrected["changeRevision"])
        self.assertEqual(next(row for row in replica_log if row["ID"] == newer_qso)["change_revision"],
                         newer["changeRevision"])
        self.assertEqual(partial[0]["ID"], qso_id)
        self.assertEqual(partial[0]["change_revision"], corrected["changeRevision"])
        deleted = self.remote(action="delete", qsoID=qso_id,
                              baseRevision=corrected["changeRevision"], reason="authority delete")
        deletion_page = self.call("multi_changes", requestID=uid(),
                                  afterRevision=corrected_replica["replicaCursor"]["revision"],
                                  afterSequence=corrected_replica["replicaCursor"]["sequence"], limit=100)
        deleted_replica, _ = self.apply_replica(replica_session, replica_workspace,
                                                 corrected_replica["projection"], deletion_page)
        self.assertEqual(deleted_replica["projection"]["authoritySerialRequestID"],
                         replacement_reservation["requestID"])
        self.assertEqual(self.host.database(replica_session).exec_sql(
            "SELECT count(*) AS n FROM xlog_serial")["n"], serial_count)
        self.assertFalse(self.host.database(replica_session).exec_sql(
            "SELECT ID FROM DXLOG WHERE ID=?", (qso_id,)))
        self.assertNotIn(qso_id, {row["ID"] for row in self.host.dispatch(
            {"id": uid(), "method": "log", "params": {"sessionID": replica_session}})["rows"]})
        remaining_partial = self.host.dispatch({"id": uid(), "method": "check_partial", "params": {
            "sessionID": replica_session, "query": "K1ABC",
        }})
        self.assertNotIn(qso_id, {row["ID"] for row in remaining_partial["rows"]})
        self.assertEqual(remaining_partial["total"], 1)
        self.assertEqual(deleted_replica["replicaCursor"]["revision"], deleted["changeRevision"])

        for method in ("legacy_import", "esm", "function_key", "qso_commit", "qso_correct",
                       "qso_delete", "digital_ingest", "recalculate", "setup_save",
                       "rover_location", "multi_contact_apply"):
            operation = {"sessionID": replica_session, "workspaceGeneration": replica_workspace,
                         "expectedRevision": deleted_replica["revision"], "operationID": uid()}
            if method == "multi_contact_apply":
                operation.pop("operationID"); operation["requestID"] = uid()
            with self.assertRaises(HostError) as failure:
                self.host.dispatch({"id": uid(), "method": method, "params": operation})
            self.assertEqual(failure.exception.code, "replica_read_only")

    def test_replica_rejects_stale_context_configuration_cursor_and_before_image_without_partial_write(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        serial_request = uid(); self.reserve(serial_request)
        qso_id = uid()
        self.remote(action="commit", qsoID=qso_id, timestamp="2026-10-22 03:10:00",
                    frequencyHz=14025000, serialRequestID=serial_request,
                    fields={"callsign": "K1ABC", "other_2": "102"})
        changes = self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        reservation = self.reserve(uid())
        cases = []
        cases.append(lambda p: p.update(workspaceGeneration=uid()))
        cases.append(lambda p: p["authority"].update(coordinationDigest="0" * 64))
        cases.append(lambda p: p["fromCursor"].update(revision=1))
        cases.append(lambda p: p["changes"][0].update(before={}))
        cases.append(lambda p: p["changes"].append(deepcopy(p["changes"][0])))
        for mutate in cases:
            with self.assertRaises(HostError):
                self.apply_replica(replica_session, replica_workspace, replica_projection,
                                   changes, reservation, authored_qso=qso_id, mutate=mutate)
            store = self.host.database(replica_session)
            self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM DXLOG")["n"], 0)
            self.assertFalse(store.replica())

    def test_replica_rejects_omitted_prefix_and_cursor_only_advances_without_partial_write(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        first_serial, second_serial = uid(), uid()
        self.reserve(first_serial)
        first_qso = uid()
        self.remote(action="commit", qsoID=first_qso, timestamp="2026-10-22 03:20:00",
                    frequencyHz=14025000, serialRequestID=first_serial,
                    fields={"callsign": "K1ABC", "other_2": "201"})
        self.reserve(second_serial)
        second_qso = uid()
        self.remote(action="commit", qsoID=second_qso, timestamp="2026-10-22 03:21:00",
                    frequencyHz=14025000, serialRequestID=second_serial,
                    fields={"callsign": "K1ABC", "other_2": "202"})
        page = self.call("multi_changes", requestID=uid(), afterRevision=0,
                         afterSequence=0, limit=100)
        reservation = self.reserve(uid())
        mutations = [
            (lambda params: params.update(
                changes=params["changes"][1:],
                toCursor={"revision": params["changes"][-1]["revision"],
                          "sequence": params["changes"][-1]["sequence"]}), "replica_conflict"),
            (lambda params: params.update(changes=[]), "replica_conflict"),
            (lambda params: params["toCursor"].update(
                sequence=params["toCursor"]["sequence"] - 1), "stale_cursor"),
        ]
        for mutate, code in mutations:
            with self.assertRaises(HostError) as failure:
                self.apply_replica(replica_session, replica_workspace, replica_projection,
                                   page, reservation, mutate=mutate)
            self.assertEqual(failure.exception.code, code)
            store = self.host.database(replica_session)
            self.assertFalse(store.replica())
            self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM DXLOG")["n"], 0)

    def test_tuple_cursor_does_not_skip_two_changes_at_one_revision(self):
        store = self.host.database(self.session)
        revision = store.state(self.session)["revision"]
        identity = {"rawFields": {"callsign": "K1ABC"}, "country": CTY["K1ABC"], "deleted": False}
        for qso_id in (uid(), uid()):
            store.conn.execute(
                "INSERT INTO xlog_qso_audit(revision,operation_id,qso_id,kind,before_json,after_json,reason,"
                "before_identity_json,after_identity_json) VALUES(?,?,?,?,?,?,?,?,?)",
                (revision, uid(), qso_id, "commit", "null", "{}", "", None,
                 __import__("json").dumps(identity, sort_keys=True, separators=(",", ":"))),
            )
        store.conn.commit()
        first = self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=1)
        second = self.call("multi_changes", requestID=uid(), afterRevision=first["nextRevision"],
                           afterSequence=first["nextSequence"], limit=10)
        self.assertEqual(len(first["changes"]), 1)
        self.assertGreaterEqual(len(second["changes"]), 1)
        self.assertNotEqual(first["changes"][0]["sequence"], second["changes"][0]["sequence"])

    def test_nonempty_replica_stages_more_than_one_page_and_retries_after_restart(self):
        qso_ids = []
        for index in range(30):
            serial_request = uid()
            self.reserve(serial_request)
            qso_id = uid()
            qso_ids.append(qso_id)
            self.remote(action="commit", qsoID=qso_id,
                        timestamp=f"2026-10-22 03:40:{index:02d}", frequencyHz=14025000,
                        serialRequestID=serial_request,
                        fields={"callsign": "K1ABC", "other_2": str(300 + index)})

        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        replica_store = self.host.database(replica_session)
        master_store = self.host.database(self.session)
        for row in master_store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID"):
            restored = deepcopy(row)
            restored["ContestNR"] = replica_store.current_contest
            replica_store.log_contact(restored)
        for identity in master_store.exec_sql_mult(
                "SELECT id,raw_fields,country,deleted FROM xlog_qso_identity ORDER BY id"):
            replica_store.conn.execute("INSERT INTO xlog_qso_identity VALUES(?,?,?,?)",
                                       (identity["id"], identity["raw_fields"],
                                        identity["country"], identity["deleted"]))
        replica_store.conn.commit()
        original_rows = replica_store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID")
        original_serials = replica_store.exec_sql_mult(
            "SELECT draft_id,serial,operation_id,scope,qso_id FROM xlog_serial ORDER BY serial")

        first = self.call("multi_changes", requestID=uid(), afterRevision=0,
                          afterSequence=0, limit=25)
        self.assertEqual(len(first["changes"]), 25)
        self.assertTrue(first["hasMore"])
        next_reservation = self.reserve(uid())
        staged, first_params = self.apply_replica(
            replica_session, replica_workspace, replica_projection, first, next_reservation)
        self.assertEqual(staged["replicaCursor"],
                         {"revision": first["nextRevision"], "sequence": first["nextSequence"]})
        self.assertFalse(replica_store.replica())
        self.assertTrue(replica_store.replica_stage())
        self.assertEqual(replica_store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID"),
                         original_rows)
        self.assertEqual(replica_store.exec_sql_mult(
            "SELECT draft_id,serial,operation_id,scope,qso_id FROM xlog_serial ORDER BY serial"),
            original_serials)

        self.host.close(); self.host = Host(self.root)
        replayed = self.host.dispatch({"id": uid(), "method": "multi_replica_apply",
                                      "params": first_params})
        self.assertTrue(replayed["replayed"])
        self.assertEqual(replayed["replicaCursor"], staged["replicaCursor"])
        second = self.call("multi_changes", requestID=uid(),
                           afterRevision=staged["replicaCursor"]["revision"],
                           afterSequence=staged["replicaCursor"]["sequence"], limit=25)
        self.assertEqual(len(second["changes"]), 5)
        self.assertFalse(second["hasMore"])
        rebound, _ = self.apply_replica(replica_session, replica_workspace,
                                        replayed["projection"], second)
        rebound_store = self.host.database(replica_session)
        self.assertEqual(rebound["replicaCursor"],
                         {"revision": second["nextRevision"], "sequence": second["nextSequence"]})
        self.assertEqual(rebound_store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID"),
                         original_rows)
        self.assertEqual(rebound_store.exec_sql(
            "SELECT count(*) AS n FROM DXLOG")["n"], len(qso_ids))
        self.assertEqual(rebound_store.exec_sql(
            "SELECT count(*) AS n FROM xlog_qso_audit")["n"], len(qso_ids))
        self.assertEqual(rebound_store.exec_sql("SELECT count(*) AS n FROM xlog_serial")["n"], 1)
        self.assertEqual(rebound["projection"]["authoritySerialRequestID"],
                         next_reservation["requestID"])
        self.assertFalse(rebound_store.replica_stage())

        replacement_authority = deepcopy(first["authority"])
        replacement_authority.update(sessionID=uid(), workspaceGeneration=uid())
        replacement_first = deepcopy(first)
        replacement_first["authority"] = replacement_authority
        replacement_reservation = deepcopy(self.reserve(uid()))
        replacement_reservation["authority"] = replacement_authority
        staged_rebind, _ = self.apply_replica(
            replica_session, replica_workspace, rebound["projection"], replacement_first,
            replacement_reservation,
            mutate=lambda params: params.update(fromCursor={"revision": 0, "sequence": 0}))
        self.assertEqual(rebound_store.replica()["master_session_id"], self.session)
        self.assertEqual(rebound_store.replica_stage()["master_session_id"],
                         replacement_authority["sessionID"])
        self.assertEqual(rebound_store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID"),
                         original_rows)
        replacement_second = deepcopy(second)
        replacement_second["authority"] = replacement_authority
        rebound_again, _ = self.apply_replica(
            replica_session, replica_workspace, staged_rebind["projection"], replacement_second)
        self.assertEqual(rebound_store.replica()["master_session_id"],
                         replacement_authority["sessionID"])
        self.assertFalse(rebound_store.replica_stage())
        self.assertEqual(rebound_store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY ID"),
                         original_rows)
        self.assertEqual(rebound_again["projection"]["authoritySerialRequestID"],
                         replacement_reservation["requestID"])

    def test_replica_binding_rejects_divergent_log_and_stale_local_revision(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        changed = self.host.dispatch({"id": uid(), "method": "draft_apply", "params": {
            "sessionID": replica_session, "operationID": uid(),
            "expectedRevision": replica_projection["revision"], "draftID": replica_projection["draftID"],
            "fields": {"callsign": "K1ABC", "other_2": "303"}, "frequencyHz": 14025000,
        }})
        local_commit = self.host.dispatch({"id": uid(), "method": "qso_commit", "params": {
            "sessionID": replica_session, "operationID": uid(),
            "expectedRevision": changed["revision"], "draftID": changed["projection"]["draftID"],
        }})
        empty = self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        reservation = self.reserve(uid())
        with self.assertRaises(HostError) as failure:
            self.apply_replica(replica_session, replica_workspace, local_commit["projection"],
                               empty, reservation)
        self.assertEqual(failure.exception.code, "replica_history_conflict")

        clean_session, clean_workspace, clean_projection = self.create_replica_session()
        stale = deepcopy(clean_projection)
        self.host.dispatch({"id": uid(), "method": "focus", "params": {
            "sessionID": clean_session, "operationID": uid(),
            "expectedRevision": clean_projection["revision"], "draftID": clean_projection["draftID"],
            "field": "other_2",
        }})
        with self.assertRaises(HostError) as failure:
            self.apply_replica(clean_session, clean_workspace, stale, empty, reservation)
        self.assertEqual(failure.exception.code, "stale_revision")
        self.assertFalse(self.host.database(clean_session).replica())

    def test_empty_replica_page_does_not_skip_later_contact_and_contest_number_is_local(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        master_projection = self.host.dispatch({"id": uid(), "method": "projection",
                                                "params": {"sessionID": self.session}})["projection"]
        self.host.dispatch({"id": uid(), "method": "focus", "params": {
            "sessionID": self.session, "operationID": uid(),
            "expectedRevision": master_projection["revision"], "draftID": master_projection["draftID"],
            "field": "other_2",
        }})
        empty = self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        self.assertEqual(empty["changes"], [])
        self.assertEqual((empty["nextRevision"], empty["nextSequence"]), (0, 0))
        with self.assertRaises(HostError) as failure:
            self.apply_replica(replica_session, replica_workspace, replica_projection, empty)
        self.assertEqual(failure.exception.code, "serial_not_found")
        self.assertFalse(self.host.database(replica_session).replica())
        first_reservation = self.reserve(uid())
        bound, _ = self.apply_replica(replica_session, replica_workspace, replica_projection,
                                      empty, first_reservation)

        qso_id = uid()
        self.remote(action="commit", qsoID=qso_id, timestamp="2026-10-22 04:00:00",
                    frequencyHz=14025000, serialRequestID=first_reservation["requestID"],
                    fields={"callsign": "K1ABC", "other_2": "404"})
        later = self.call("multi_changes", requestID=uid(),
                          afterRevision=bound["replicaCursor"]["revision"],
                          afterSequence=bound["replicaCursor"]["sequence"], limit=100)
        self.assertEqual([change["qsoID"] for change in later["changes"]], [qso_id])
        later["changes"][0]["after"]["ContestNR"] = 77
        next_reservation = self.reserve(uid())
        replicated, _ = self.apply_replica(replica_session, replica_workspace, bound["projection"],
                                            later, next_reservation, authored_qso=qso_id)
        row = self.host.database(replica_session).exec_sql("SELECT ContestNR FROM DXLOG WHERE ID=?", (qso_id,))
        self.assertEqual(row["ContestNR"], self.host.database(replica_session).current_contest)
        self.assertEqual(replicated["replicaCursor"]["revision"], later["nextRevision"])

    def test_legacy_change_without_identity_is_rejected_without_advancing(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        serial_request = uid(); self.reserve(serial_request)
        qso_id = uid()
        committed = self.remote(action="commit", qsoID=qso_id, timestamp="2026-10-22 04:10:00",
                                frequencyHz=14025000, serialRequestID=serial_request,
                                fields={"callsign": "K1ABC", "other_2": "405"})
        self.host.database(self.session).conn.execute(
            "UPDATE xlog_qso_audit SET after_identity_json=NULL WHERE qso_id=? AND revision=?",
            (qso_id, committed["changeRevision"]))
        self.host.database(self.session).conn.commit()
        page = self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        with self.assertRaises(HostError) as failure:
            self.apply_replica(replica_session, replica_workspace, replica_projection,
                               page, self.reserve(uid()), authored_qso=qso_id)
        self.assertEqual(failure.exception.code, "replica_change_unsupported")
        self.assertFalse(self.host.database(replica_session).replica())
        self.assertEqual(self.host.database(replica_session).exec_sql(
            "SELECT count(*) AS n FROM DXLOG")["n"], 0)

    def test_replica_authority_rejects_receipt_replay_after_binding(self):
        replica_session, replica_workspace, replica_projection = self.create_replica_session()
        request_id = uid()
        request = {"id": uid(), "method": "multi_changes", "params": {
            "sessionID": replica_session, "workspaceGeneration": replica_workspace,
            "requestID": request_id, "afterRevision": 0, "afterSequence": 0, "limit": 100,
        }}
        self.host.dispatch(request)
        store = self.host.database(replica_session)
        store.conn.execute("INSERT INTO xlog_replica VALUES(1,?,?,?,?,?)",
                           (uid(), uid(), "0" * 64, 0, 0))
        store.conn.commit()
        with self.assertRaises(HostError) as failure:
            self.host.dispatch(request)
        self.assertEqual(failure.exception.code, "replica_read_only")

    def test_changes_rejects_null_legacy_json_cleanly(self):
        store = self.host.database(self.session)
        store.conn.execute(
            "INSERT INTO xlog_qso_audit(sequence,revision,operation_id,qso_id,kind,before_json,"
            "after_json,reason,before_identity_json,after_identity_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (1, 1, uid(), uid(), "commit", None, "{}", "legacy", None, None),
        )
        store.conn.commit()
        with self.assertRaises(HostError) as failure:
            self.call("multi_changes", requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        self.assertEqual(failure.exception.code, "replica_change_unsupported")


if __name__ == "__main__":
    unittest.main()
