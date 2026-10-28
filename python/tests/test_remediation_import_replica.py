"""Historical imports through configured real authority/replica Hosts; no I/O."""
from copy import deepcopy
import json
import os
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import uuid
from contest_host.host import Host, HostError


def uid(): return str(uuid.uuid4())


class ImportedReplicaTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"XLOG_CONTEST_N1MM_UDP_ALLOWED": "0"})
        env.start(); self.addCleanup(env.stop)
        temporary = TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.roots = [Path(temporary.name).resolve() / name for name in ("master", "replica")]
        self.hosts = [Host(root) for root in self.roots]
        self.addCleanup(lambda: [host.close() for host in self.hosts])
        self.session, self.workspace = uid(), uid()
        self.config = json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())["cq_wpx_cw"]["state"]
        station = self.config["station"]["Call"]
        reference = {**self.config["reference"],
                     "countries": {station: self.config["reference"]["countries"][station]}}
        for host, master in zip(self.hosts, (True, False)):
            self.call(host, "session_create", sessionID=self.session, workspaceGeneration=self.workspace,
                operationID=uid(), expectedRevision=0, pluginID="cq_wpx_cw", station=self.config["station"],
                settings=self.config["settings"], reference=reference,
                frequencyHz=self.config["draft"]["frequencyHz"], mode="CW")
            setup = self.call(host, "setup_get", sessionID=self.session)["setup"]
            setup["network"].update(multiEnabled=True, multiMaster=master, stationName="MASTER" if master else "CLIENT")
            self.call(host, "setup_save", **self.params(host), setup=setup)
        self.cursor = {"revision": 0, "sequence": 0}
        self.sync(baseline=True)

    def call(self, host, method, **params):
        return host.dispatch({"id": uid(), "method": method, "params": deepcopy(params)})

    def params(self, host):
        return dict(sessionID=self.session, workspaceGeneration=self.workspace, operationID=uid(),
            expectedRevision=host.database(self.session).state(self.session)["revision"])

    def page(self):
        return self.call(self.hosts[0], "multi_changes", sessionID=self.session,
            workspaceGeneration=self.workspace, requestID=uid(), afterRevision=self.cursor["revision"],
            afterSequence=self.cursor["sequence"], limit=100)

    def sync(self, baseline=False):
        master, replica = self.hosts
        page = self.page()
        params = dict(**self.params(replica), authority=page["authority"], fromCursor=self.cursor,
            toCursor={"revision": page["nextRevision"], "sequence": page["nextSequence"]},
            historyComplete=not page["hasMore"], changes=page["changes"])
        if baseline:
            grant = self.call(master, "multi_serial_reserve", sessionID=self.session,
                workspaceGeneration=self.workspace, requestID=uid(), frequencyHz=14_025_000)
            params["nextReservation"] = {k: grant[k] for k in
                ("requestID", "scope", "serial", "sentExchange", "allocatedFieldID", "authority")}
        result = self.call(replica, "multi_replica_apply", **params)
        self.assertEqual(result["actions"], [])
        replay = self.call(replica, "multi_replica_apply", **params)
        self.assertTrue(replay["replayed"])
        self.cursor = params["toCursor"]
        return page

    def imported(self, call="K1ABC", serial=101, time="100000"):
        params = self.params(self.hosts[0])
        params.update(action="adif_import", record={"raw": {
            "CONTEST_ID": "CQ-WPX-CW", "STATION_CALLSIGN": self.config["station"]["Call"], "CALL": call,
            "QSO_DATE": "20261021", "TIME_ON": time, "FREQ": "14.025", "MODE": "CW",
            "RST_SENT": "599", "RST_RCVD": "579", "STX": str(serial), "SRX": "202", "OPERATOR": self.config["station"]["Call"]},
            "metadata": None, "sourceSHA256": "a" * 64},
            countries={call: self.config["reference"]["countries"]["K1ABC"]},
            referenceID=self.config["reference"]["id"])
        result = self.call(self.hosts[0], "strategy_apply", **params)
        self.assertEqual(result["actions"], [])
        self.assertTrue(self.call(self.hosts[0], "strategy_apply", **params)["replayed"])
        return result["waveResult"]["qsoID"]

    def test_new_import_catchup_replay_reopen_and_followup_changes(self):
        qso = self.imported()
        page = self.sync()
        self.assertEqual(page["changes"][0]["kind"], "commit")
        self.assertIsNotNone(page["changes"][0]["afterIdentity"])
        self.assert_same(qso)
        for host in self.hosts:
            events = self.call(host, "recorder_changes", sessionID=self.session, afterSequence=0, limit=200)["events"]
            self.assertTrue(events and all(event["local"] is False for event in events))
        self.followup(qso)

    def test_separate_enriched_import_pages_preserve_prior_scores_and_history(self):
        for host in self.hosts:
            self.assertEqual(set(host.database(self.session).state(self.session)["reference"]["countries"]),
                             {self.config["station"]["Call"]})
        first = self.imported("K9XYZ")
        self.sync(); self.assert_same(first)
        replica = self.hosts[1].database(self.session)
        first_identity = self.hosts[1].replica_identity(replica, first)
        retained_audit = replica.exec_sql_mult("SELECT * FROM xlog_qso_audit ORDER BY sequence")
        retained_receipts = replica.exec_sql_mult("SELECT * FROM xlog_operation ORDER BY operation_id")
        for index, root in enumerate(self.roots):
            self.hosts[index].close(); self.hosts[index] = Host(root)
        second = self.imported("K8XYZ", serial=102, time="100100")
        self.sync()
        self.assert_same(first); self.assert_same(second)
        for host in self.hosts:
            score = self.call(host, "projection", sessionID=self.session)["projection"]["score"]
            # Two different US prefixes, each worth 3 intercontinental 20m points.
            self.assertEqual((score["points"], score["multipliers"], score["total"]), (6, 2, 12))
        replica = self.hosts[1].database(self.session)
        self.assertEqual(replica.exec_sql_mult("SELECT * FROM xlog_qso_audit WHERE sequence<=? ORDER BY sequence",
                                              (retained_audit[-1]["sequence"],)), retained_audit)
        for receipt in retained_receipts:
            self.assertEqual(replica.exec_sql("SELECT * FROM xlog_operation WHERE operation_id=?",
                                             (receipt["operation_id"],)), receipt)
        self.assertEqual(self.hosts[1].replica_identity(replica, first), first_identity)
        for index, root in enumerate(self.roots):
            self.hosts[index].close(); self.hosts[index] = Host(root)
        self.correct(first)
        page = self.sync()  # Includes exact operation replay on the replica.
        self.assertEqual([change["kind"] for change in page["changes"]], ["correct"])
        self.assert_same(first); self.assert_same(second)
        for host in self.hosts:
            self.assertEqual(self.call(host, "projection", sessionID=self.session)["projection"]["score"]["total"], 12)

    def test_invalid_replica_country_rolls_back_rows_reference_and_receipts(self):
        first = self.imported("K9XYZ"); self.sync()
        second = self.imported("K8XYZ", serial=102, time="100100")
        page = self.page()
        page["changes"][0]["afterIdentity"]["country"] = {"entity": "incomplete"}
        replica = self.hosts[1]
        store = replica.database(self.session)
        before = tuple(store.conn.iterdump())
        with self.assertRaises(HostError):
            self.call(replica, "multi_replica_apply", **self.params(replica), authority=page["authority"],
                fromCursor=self.cursor, toCursor={"revision": page["nextRevision"], "sequence": page["nextSequence"]},
                historyComplete=True, changes=page["changes"])
        self.assertEqual(tuple(store.conn.iterdump()), before)
        self.sync(); self.assert_same(first); self.assert_same(second)

    def test_legacy_unchanged_import_survives_reopen_without_rewriting_audit(self):
        qso = self.imported(); store = self.hosts[0].database(self.session)
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=NULL WHERE kind='adif_import'"); store.conn.commit()
        self.hosts[0].close(); self.hosts[0] = Host(self.roots[0])
        self.sync(); self.assert_same(qso)
        self.followup(qso)

    def test_legacy_import_identity_is_reconstructed_before_later_correction_and_delete(self):
        qso = self.imported()
        master = self.hosts[0]; store = master.database(self.session)
        original = master.replica_identity(store, qso)
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=NULL WHERE kind='adif_import'")
        store.conn.commit()
        self.correct(qso)
        self.call(master, "qso_delete", **self.params(master), qsoID=qso, reason="fixture delete")
        retained = store.exec_sql_mult("SELECT * FROM xlog_qso_audit ORDER BY sequence")
        page = self.sync()
        self.assertEqual(page["changes"][0]["afterIdentity"], original)
        self.assertEqual(store.exec_sql_mult("SELECT * FROM xlog_qso_audit ORDER BY sequence"), retained,
                         "Compatibility projection rewrote authority history")
        self.assert_same(qso)

    def test_legacy_missing_identity_fails_closed_without_inventing_provenance(self):
        qso = self.imported(); store = self.hosts[0].database(self.session)
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=NULL WHERE kind='adif_import'")
        store.conn.execute("DELETE FROM xlog_qso_identity WHERE id=?", (qso,)); store.conn.commit()
        before = tuple(store.conn.iterdump())
        with self.assertRaises(HostError) as error: self.page()
        self.assertEqual(error.exception.code, "replica_change_unsupported")
        self.assertEqual(tuple(store.conn.iterdump()), before)

    def correct(self, qso):
        master = self.hosts[0]; identity = master.replica_identity(master.database(self.session), qso)
        fields = deepcopy(identity["rawFields"]); fields["receive"] = "578"
        self.call(master, "qso_correct", **self.params(master), qsoID=qso, fields=fields, reason="fixture correction")

    def followup(self, qso):
        for index, root in enumerate(self.roots):
            self.hosts[index].close(); self.hosts[index] = Host(root)
        self.assert_same(qso)
        self.correct(qso); self.sync(); self.assert_same(qso)
        self.call(self.hosts[0], "qso_delete", **self.params(self.hosts[0]), qsoID=qso, reason="fixture delete")
        self.sync(); self.assert_same(qso)

    def test_shared_serial_honors_import_floor_replay_reopen_and_commit(self):
        master = self.hosts[0]
        old = master.database(self.session).exec_sql("SELECT draft_id FROM xlog_serial WHERE serial=2")["draft_id"]
        self.imported()
        def reserve(request):
            return self.call(self.hosts[0], "multi_serial_reserve", sessionID=self.session,
                workspaceGeneration=self.workspace, requestID=request, frequencyHz=14_025_000)
        self.assertEqual(reserve(old)["serial"], 2, "Already issued exchanges must never be silently renumbered")
        request = uid(); grant = reserve(request)
        self.assertEqual(grant["serial"], 102)
        self.assertEqual(reserve(request)["serial"], 102)
        master.close(); self.hosts[0] = Host(self.roots[0]); master = self.hosts[0]
        self.assertEqual(reserve(request)["serial"], 102)
        result = self.call(master, "multi_contact_apply", sessionID=self.session, workspaceGeneration=self.workspace,
            requestID=uid(), action="commit", qsoID=uid(), timestamp="2026-10-22 12:00:00", frequencyHz=14_025_000,
            serialRequestID=request, fields={"callsign": "K1ABC", "other_2": "203"})
        self.assertEqual(result["actions"], [])
        events = self.call(master, "recorder_changes", sessionID=self.session, afterSequence=0, limit=200)["events"]
        self.assertTrue(events and all(event["local"] is False for event in events))
        self.assertEqual(reserve(uid())["serial"], 103)

    def test_concurrent_shared_serial_grants_exceed_historical_floor(self):
        self.imported()
        barrier = threading.Barrier(2); results = []; errors = []
        def reserve():
            peer = Host(self.roots[0])
            try:
                barrier.wait(timeout=5)
                results.append(self.call(peer, "multi_serial_reserve", sessionID=self.session,
                    workspaceGeneration=self.workspace, requestID=uid(), frequencyHz=14_025_000)["serial"])
            except Exception as error: errors.append(error)
            finally: peer.close()
        threads = [threading.Thread(target=reserve) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=10)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), [102, 103])

    def assert_same(self, qso):
        master, replica = self.hosts
        self.assertEqual(master.replica_identity(master.database(self.session), qso),
                         replica.replica_identity(replica.database(self.session), qso))
        def row(host):
            value = host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
            return {k: v for k, v in value.items() if k != "ContestNR"} if value else None
        self.assertEqual(row(master), row(replica))
