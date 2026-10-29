"""Primary-prefix reconciliation through real paired Hosts and durable history."""
from copy import deepcopy
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import uuid

from contest_host.host import Host, HostError


def uid():
    return str(uuid.uuid4())


class ReferenceReplicaTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"XLOG_CONTEST_N1MM_UDP_ALLOWED": "0"})
        env.start(); self.addCleanup(env.stop)
        temporary = TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.roots = [Path(temporary.name).resolve() / name for name in ("master", "replica")]
        self.hosts = [Host(root) for root in self.roots]
        self.addCleanup(lambda: [host.close() for host in self.hosts])
        self.session, self.workspace = uid(), uid()
        self.country = {"entity": "Austria", "continent": "EU", "cq": 15,
                        "itu": 28, "primary_pfx": "*4U1V"}
        for host, master in zip(self.hosts, (True, False)):
            self.call(host, "session_create", sessionID=self.session, workspaceGeneration=self.workspace,
                operationID=uid(), expectedRevision=0, pluginID="cq_ww_ssb", mode="SSB",
                station={"Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"},
                settings={"SentExchange": "15", "ModeCategory": "SSB", "OperatorCategory": "SINGLE-OP",
                          "BandCategory": "ALL", "PowerCategory": "LOW"}, frequencyHz=14_250_000,
                reference={"id": "test-cty-v1", "countries": {
                    "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15,
                              "itu": 28, "primary_pfx": "OM"},
                    "OE8DDX": self.country}})
            setup = self.call(host, "setup_get", sessionID=self.session)["setup"]
            setup["network"].update(multiEnabled=True, multiMaster=master,
                                    stationName="MASTER" if master else "CLIENT")
            self.call(host, "setup_save", **self.params(host), setup=setup)
        self.cursor = {"revision": 0, "sequence": 0}
        self.sync()

    def call(self, host, method, **params):
        return host.dispatch({"id": uid(), "method": method, "params": deepcopy(params)})

    def params(self, host):
        return dict(sessionID=self.session, workspaceGeneration=self.workspace, operationID=uid(),
                    expectedRevision=host.database(self.session).state(self.session)["revision"])

    def page(self, request=None):
        return self.call(self.hosts[0], "multi_changes", sessionID=self.session,
            workspaceGeneration=self.workspace, requestID=request or uid(),
            afterRevision=self.cursor["revision"], afterSequence=self.cursor["sequence"], limit=100)

    def sync(self):
        page = self.page()
        replica = self.hosts[1]
        params = dict(**self.params(replica), authority=page["authority"], fromCursor=self.cursor,
            toCursor={"revision": page["nextRevision"], "sequence": page["nextSequence"]},
            historyComplete=not page["hasMore"], changes=page["changes"])
        before = tuple(replica.database(self.session).conn.iterdump())
        try:
            result = self.call(replica, "multi_replica_apply", **params)
        except HostError:
            self.assertEqual(tuple(replica.database(self.session).conn.iterdump()), before)
            raise
        self.assertEqual(result["actions"], [])
        self.assertTrue(self.call(replica, "multi_replica_apply", **params)["replayed"])
        self.cursor = params["toCursor"]
        return page

    def log(self, minute=0):
        qso = uid()
        self.call(self.hosts[0], "qso_commit", **self.params(self.hosts[0]), qsoID=qso,
                  timestamp=f"2026-10-20 08:{minute:02}:00", frequencyHz=14_250_000,
                  fields={"callsign": "OE8DDX", "other_2": "15"})
        return qso

    def repair(self, qso, prefix="OE"):
        self.call(self.hosts[0], "country_reconcile", **self.params(self.hosts[0]),
                  referenceID="test-cty-v1", repairs=[{"qsoID": qso, "callsign": "OE8DDX",
                  "country": {**self.country, "primary_pfx": prefix}}])

    def legacy(self, qso):
        # Disposable historical fixture only: reproduce the former bare-country
        # writer, then demand that publication never changes those audit bytes.
        store = self.hosts[0].database(self.session)
        for row in store.exec_sql_mult("SELECT * FROM xlog_qso_audit WHERE qso_id=? AND kind='reference_reconcile'", (qso,)):
            images = [json.loads(row[name]) for name in ("before_identity_json", "after_identity_json")]
            images = [image.get("country", image) for image in images]
            store.conn.execute("UPDATE xlog_qso_audit SET before_identity_json=?,after_identity_json=? WHERE sequence=?",
                               (*[json.dumps(image, sort_keys=True) for image in images], row["sequence"]))
        store.conn.commit()

    def correct(self, qso):
        host = self.hosts[0]
        fields = deepcopy(host.replica_identity(host.database(self.session), qso)["rawFields"])
        fields["receive"] = "58"
        self.call(host, "qso_correct", **self.params(host), qsoID=qso, fields=fields, reason="fixture correction")

    def reopen(self):
        for index, root in enumerate(self.roots):
            self.hosts[index].close(); self.hosts[index] = Host(root)

    def assert_same(self, *qsos):
        master, replica = self.hosts
        for qso in qsos:
            self.assertEqual(master.replica_identity(master.database(self.session), qso),
                             replica.replica_identity(replica.database(self.session), qso))
            rows = [host.database(self.session).exec_sql("SELECT * FROM DXLOG WHERE ID=?", (qso,))
                    for host in self.hosts]
            self.assertEqual(*[{key: value for key, value in row.items() if key != "ContestNR"}
                               if row else None for row in rows])
        scores = [self.call(host, "projection", sessionID=self.session)["projection"]["score"]
                  for host in self.hosts]
        self.assertEqual(scores[0], scores[1])

    def test_primary_prefix_repair_catchup_followup_replay_and_reopen(self):
        qso = self.log(); self.sync(); self.assert_same(qso)
        self.repair(qso)
        page = self.sync()  # Former real two-Host counterexample rejected its kind.
        self.assertEqual([change["kind"] for change in page["changes"]], ["correct"])
        self.assertEqual(set(page["changes"][0]["beforeIdentity"]), {"rawFields", "country", "deleted"})
        self.assertEqual(set(page["changes"][0]["afterIdentity"]), {"rawFields", "country", "deleted"})
        stored = self.hosts[0].database(self.session).exec_sql(
            "SELECT * FROM xlog_qso_audit WHERE qso_id=? ORDER BY sequence DESC LIMIT 1", (qso,))
        self.assertEqual(stored["kind"], "reference_reconcile")
        for side in ("before", "after"):
            self.assertEqual(set(json.loads(stored[f"{side}_identity_json"])), {"rawFields", "country", "deleted"})
        self.assert_same(qso)
        second = self.log(minute=1); self.sync(); self.assert_same(qso, second)
        self.correct(qso); self.sync(); self.assert_same(qso, second)
        self.call(self.hosts[0], "qso_delete", **self.params(self.hosts[0]), qsoID=qso, reason="fixture delete")
        self.sync(); self.reopen(); self.assert_same(qso, second)

    def test_historical_country_images_project_without_rewriting_audit_or_receipts(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso)
        self.correct(qso)
        self.call(self.hosts[0], "qso_delete", **self.params(self.hosts[0]), qsoID=qso, reason="fixture delete")
        self.reopen()
        store = self.hosts[0].database(self.session)
        audit = store.exec_sql_mult("SELECT * FROM xlog_qso_audit ORDER BY sequence")
        receipts = store.exec_sql_mult("SELECT * FROM xlog_operation ORDER BY operation_id")
        request = uid(); first = self.page(request)
        replay = self.page(request)
        self.assertTrue(replay["replayed"])
        self.assertEqual({key: value for key, value in replay.items() if key != "replayed"},
                         {key: value for key, value in first.items() if key != "replayed"})
        self.assertEqual(first["changes"][0]["beforeIdentity"]["country"]["primary_pfx"], "*4U1V")
        self.assertEqual(first["changes"][0]["afterIdentity"]["country"]["primary_pfx"], "OE")
        self.sync(); self.assert_same(qso)
        self.assertEqual(store.exec_sql_mult("SELECT * FROM xlog_qso_audit ORDER BY sequence"), audit)
        for receipt in receipts:
            self.assertEqual(store.exec_sql("SELECT * FROM xlog_operation WHERE operation_id=?", (receipt["operation_id"],)), receipt)
        self.reopen(); self.assert_same(qso)

    def test_historical_identity_can_use_following_before_image_but_not_current_row(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso); self.correct(qso)
        store = self.hosts[0].database(self.session)
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=NULL WHERE qso_id=? AND kind='commit'", (qso,))
        store.conn.commit()
        self.sync(); self.reopen(); self.assert_same(qso)

    def test_missing_historical_identity_requires_specific_recovery_and_rolls_back(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso)
        store = self.hosts[0].database(self.session)
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=NULL WHERE qso_id=? AND kind='commit'", (qso,))
        store.conn.commit()
        # Today's complete identity remains available. It is not historical proof.
        self.assertIsNotNone(self.hosts[0].replica_identity(store, qso))
        before = tuple(store.conn.iterdump())
        with self.assertRaises(HostError) as error:
            self.page()
        self.assertEqual(error.exception.code, "replica_change_unsupported")
        self.assertIn("reference reconciliation", str(error.exception).lower())
        self.assertIn("recovery", str(error.exception).lower())
        self.assertEqual(tuple(store.conn.iterdump()), before)

    def test_consecutive_historical_reconciliations_use_the_original_raw_fields(self):
        qso = self.log(); self.sync(); self.repair(qso)
        self.repair(qso, prefix="OE8"); self.legacy(qso)
        page = self.sync()
        self.assertEqual([change["kind"] for change in page["changes"]], ["correct", "correct"])
        self.assertEqual(page["changes"][0]["afterIdentity"], page["changes"][1]["beforeIdentity"])
        self.assert_same(qso)

    def assert_recovery_failure(self):
        store = self.hosts[0].database(self.session)
        before = tuple(store.conn.iterdump())
        with self.assertRaises(HostError) as error:
            self.page()
        self.assertEqual(error.exception.code, "replica_change_unsupported")
        self.assertIn("reference reconciliation", str(error.exception).lower())
        self.assertIn("recovery", str(error.exception).lower())
        self.assertEqual(tuple(store.conn.iterdump()), before)

    def test_nonprefix_historical_change_requires_recovery(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso)
        store = self.hosts[0].database(self.session)
        row = store.exec_sql("SELECT * FROM xlog_qso_audit WHERE kind='reference_reconcile'")
        after = json.loads(row["after_json"]); after["Rcv"] = "58"
        store.conn.execute("UPDATE xlog_qso_audit SET after_json=? WHERE sequence=?",
                           (json.dumps(after), row["sequence"]))
        store.conn.commit()
        self.assert_recovery_failure()

    def test_conflicting_historical_country_is_not_replaced_with_current_identity(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso)
        store = self.hosts[0].database(self.session)
        row = store.exec_sql("SELECT * FROM xlog_qso_audit WHERE kind='commit'")
        identity = json.loads(row["after_identity_json"])
        identity["country"]["primary_pfx"] = "UNSUPPORTED"
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=? WHERE sequence=?",
                           (json.dumps(identity), row["sequence"]))
        store.conn.commit()
        self.assert_recovery_failure()

    def test_deleted_historical_identity_cannot_be_bypassed_with_a_later_before_image(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso); self.correct(qso)
        store = self.hosts[0].database(self.session)
        row = store.exec_sql("SELECT * FROM xlog_qso_audit WHERE kind='commit'")
        identity = json.loads(row["after_identity_json"]); identity["deleted"] = True
        store.conn.execute("UPDATE xlog_qso_audit SET after_identity_json=? WHERE sequence=?",
                           (json.dumps(identity), row["sequence"]))
        store.conn.commit()
        self.assert_recovery_failure()

    def test_malformed_historical_json_has_a_specific_recovery_diagnostic(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso)
        store = self.hosts[0].database(self.session)
        store.conn.execute("UPDATE xlog_qso_audit SET before_identity_json='{' WHERE kind='reference_reconcile'")
        store.conn.commit()
        self.assert_recovery_failure()

    def test_previously_issued_legacy_page_is_immutable_and_fresh_page_uses_the_same_event(self):
        qso = self.log(); self.sync(); self.repair(qso); self.legacy(qso)
        request = uid(); page = self.page(request)
        # Construct an old-version issued-receipt fixture in private storage.
        # The implementation must never upgrade that stored contract in place.
        old = deepcopy(page)
        for change in old["changes"]:
            change["kind"] = "reference_reconcile"
            for side in ("beforeIdentity", "afterIdentity"):
                change[side] = change[side]["country"]
        store = self.hosts[0].database(self.session)
        store.conn.execute("UPDATE xlog_operation SET result=? WHERE operation_id=?", (json.dumps(old), request))
        store.conn.commit()
        receipt = store.exec_sql("SELECT * FROM xlog_operation WHERE operation_id=?", (request,))
        replay = self.page(request)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["changes"], old["changes"])
        self.assertEqual(store.exec_sql("SELECT * FROM xlog_operation WHERE operation_id=?", (request,)), receipt)
        fresh = self.sync()
        self.assertEqual([change["sequence"] for change in fresh["changes"]],
                         [change["sequence"] for change in old["changes"]])
        self.assertEqual([change["kind"] for change in fresh["changes"]], ["correct"])
        self.assert_same(qso)
        self.assertEqual(store.exec_sql("SELECT * FROM xlog_operation WHERE operation_id=?", (request,)), receipt)
