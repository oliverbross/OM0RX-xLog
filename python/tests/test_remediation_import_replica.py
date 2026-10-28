"""Historical imports through configured real authority/replica Hosts; no I/O."""
from copy import deepcopy
import json
import os
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
        for host, master in zip(self.hosts, (True, False)):
            self.call(host, "session_create", sessionID=self.session, workspaceGeneration=self.workspace,
                operationID=uid(), expectedRevision=0, pluginID="cq_wpx_cw", station=self.config["station"],
                settings=self.config["settings"], reference=self.config["reference"],
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

    def imported(self):
        params = self.params(self.hosts[0])
        params.update(action="adif_import", record={"raw": {
            "CONTEST_ID": "CQ-WPX-CW", "STATION_CALLSIGN": self.config["station"]["Call"], "CALL": "K1ABC",
            "QSO_DATE": "20261021", "TIME_ON": "100000", "FREQ": "14.025", "MODE": "CW",
            "RST_SENT": "599", "RST_RCVD": "579", "STX": "101", "SRX": "202", "OPERATOR": self.config["station"]["Call"]},
            "metadata": None, "sourceSHA256": "a" * 64})
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
        self.followup(qso)

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

    def assert_same(self, qso):
        master, replica = self.hosts
        self.assertEqual(master.replica_identity(master.database(self.session), qso),
                         replica.replica_identity(replica.database(self.session), qso))
        def row(host):
            value = host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
            return {k: v for k, v in value.items() if k != "ContestNR"} if value else None
        self.assertEqual(row(master), row(replica))
