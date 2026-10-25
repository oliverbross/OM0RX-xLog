"""Recorder consumes committed not1mm-python audits; the existing log owns writes."""
from copy import deepcopy
import unittest
import test_cq_ww_ssb_host as fixture


class RecorderAuditTests(unittest.TestCase):
    setUp = fixture.CQWWSSBHostTests.setUp
    tearDown = fixture.CQWWSSBHostTests.tearDown
    call = fixture.CQWWSSBHostTests.call
    mutate = fixture.CQWWSSBHostTests.mutate
    read = fixture.CQWWSSBHostTests.read
    log = fixture.CQWWSSBHostTests.log

    def changes(self, after=0, limit=200):
        return self.read("recorder_changes", afterSequence=after, limit=limit)

    def test_commit_retry_invalid_commit_and_read_only_pages(self):
        self.assertEqual(self.changes()["events"], [])
        with self.assertRaises(Exception):
            self.mutate("qso_commit", qsoID=fixture.uid())
        self.assertEqual(self.changes()["events"], [])
        qso = self.log()
        store = self.host.database(self.session)
        state = deepcopy(store.state(self.session))
        operations = store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"]
        page = self.changes(limit=1)
        event = page["events"][0]
        self.assertEqual((page["engine"], page["sessionID"], event["qsoID"], event["local"]),
                         ("not1mm-python", self.session, qso, True))
        receipt = self.read("operation_receipt", operationID=event["operationID"])
        self.assertIsNotNone(receipt)
        self.assertEqual(self.changes(limit=1), page)
        self.assertEqual(store.state(self.session), state)
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"], operations)
        self.assertFalse(store.conn.in_transaction)
        self.assertEqual(self.changes(event["sequence"])["events"], [])

    def test_correction_delete_pagination_preserve_original_images(self):
        qso = self.log()
        original = self.changes()["events"][0]
        self.mutate("qso_correct", qsoID=qso, fields={"callsign":"DL1ABC"}, timestamp="2026-10-20 08:05:00", reason="Fixture")
        self.mutate("qso_delete", qsoID=qso, reason="Fixture delete")
        events = self.changes()["events"]
        self.assertEqual([e["kind"] for e in events], ["commit", "correct", "delete"])
        self.assertEqual(events[0], original)
        self.assertEqual(events[1]["before"]["Call"], "K1ABC")
        self.assertEqual(events[1]["after"]["Call"], "DL1ABC")
        self.assertIsNone(events[2]["after"])
        first = self.changes(limit=1)
        self.assertTrue(first["hasMore"])
        self.assertEqual(self.changes(first["afterSequence"], 1)["events"], [events[1]])

    def test_untrusted_parameters_are_bounded_and_do_not_change_log(self):
        for kwargs in ({"afterSequence":False,"limit":1},{"afterSequence":-1,"limit":1},
                       {"afterSequence":0,"limit":201},{"afterSequence":0,"limit":1,"path":"/etc/passwd"},
                       {"afterSequence":0,"limit":1,"sql":"DELETE FROM DXLOG"}):
            with self.assertRaises(Exception):
                self.read("recorder_changes", **kwargs)
        self.assertEqual(self.read("log")["total"], 0)


if __name__ == "__main__":
    unittest.main()
