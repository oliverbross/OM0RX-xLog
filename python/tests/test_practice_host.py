"""Practice isolation through the actual Python/SQLite contest authority."""
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock
import uuid

from contest_host.host import Host, HostError


def uid():
    return str(uuid.uuid4())


class PracticeHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.host.n1mm_udp_allowed = True
        self.output = Mock()
        self.host.n1mm = self.output
        self.source, self.workspace = uid(), uid()
        self.call("session_create", sessionID=self.source, workspaceGeneration=self.workspace,
                  operationID=uid(), expectedRevision=0, pluginID="cq_wpx_cw", name="Real WPX",
                  station={"Call": "OM0RX", "GridSquare": "JN88"}, frequencyHz=14025000,
                  settings={"SentExchange": "#"}, reference={"id": "historical-reference", "countries": {
                      "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
                      "K1ABC": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"}}})
        setup = self.call("setup_get", sessionID=self.source)["setup"]
        setup["preferences"].update(rtcEnabled=True, rtcUsername="private-user", autoCQ=True, cwSpeed=31)
        setup["network"].update(n1mmEnabled=True, n1mmRadio=True, n1mmContact=True, n1mmScore=True,
                                n1mmHost="127.0.0.1", multiEnabled=False)
        self.mutate(self.source, "setup_save", setup=setup)
        self.mutate(self.source, "qso_commit", fields={"callsign": "K1ABC", "other_2": "123"},
                    qsoID=uid(), timestamp="2026-10-27 01:00:00")
        self.mutate(self.source, "draft_apply", fields={"callsign": "K2PART", "other_2": "456"})
        self.source_state = deepcopy(self.host.database(self.source).state(self.source))
        self.source_log = deepcopy(self.call("log", sessionID=self.source))
        self.source_serials = self.serials(self.source)
        self.output.reset_mock()

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, **params):
        return self.host.dispatch({"id": uid(), "method": method, "params": params})

    def mutate(self, session, method, **params):
        state = self.host.database(session).state(session)
        return self.call(method, sessionID=session, workspaceGeneration=self.workspace,
                         operationID=uid(), expectedRevision=state["revision"], **params)

    def serials(self, session):
        return self.host.database(session).exec_sql_mult("SELECT * FROM xlog_serial ORDER BY serial")

    def create_practice(self, **overrides):
        return self.call("session_create", **{"sessionID": uid(), "workspaceGeneration": self.workspace,
            "operationID": uid(), "expectedRevision": 0, "practiceSourceSessionID": self.source,
            "sourceRevision": self.source_state["revision"], **overrides})

    def assert_source_unchanged(self):
        self.assertEqual(self.host.database(self.source).state(self.source), self.source_state)
        self.assertEqual(self.call("log", sessionID=self.source), self.source_log)
        self.assertEqual(self.serials(self.source), self.source_serials)

    def test_practice_commit_reopen_isolated_serials_contacts_and_outputs(self):
        created = self.create_practice()
        projection = created["projection"]
        session = projection["sessionID"]
        self.assertNotEqual(session, self.source)
        self.assertNotEqual(projection["draftID"], self.source_state["draft"]["id"])
        self.assertEqual(projection["referenceID"], "historical-reference")
        copied_state = self.host.database(session).state(session)
        self.assertEqual(copied_state["reference"], self.source_state["reference"])
        self.assertEqual(copied_state["scoringRevision"], self.source_state["scoringRevision"])
        self.assertTrue(projection["practice"]["nativeOutputDisabled"])
        self.assertEqual(self.call("log", sessionID=session)["total"], 0)
        self.assertEqual(self.serials(session)[0]["serial"], 1)
        fields = {item["id"]: item["value"] for item in projection["fields"]}
        self.assertEqual(fields["callsign"], "")
        self.assertEqual(fields["other_1"], "001")
        setup = self.call("setup_get", sessionID=session)["setup"]
        self.assertFalse(setup["preferences"]["rtcEnabled"])
        self.assertNotIn("rtcUsername", setup["preferences"])
        self.assertEqual(setup["preferences"]["cwSpeed"], 31)
        setup["preferences"].update(rtcEnabled=True, autoCQ=True)
        setup["network"].update(n1mmEnabled=True, n1mmContact=True)
        self.mutate(session, "setup_save", setup=setup)
        self.assertFalse(self.call("setup_get", sessionID=session)["setup"]["network"]["n1mmEnabled"])
        self.assertEqual(self.mutate(session, "function_key", key="F1")["actions"], [])
        self.mutate(session, "qso_commit", fields={"callsign": "K1ABC", "other_2": "789"},
                    qsoID=uid(), timestamp="2026-10-27 02:00:00")
        self.assertEqual(self.call("log", sessionID=session)["rows"][0]["SentNr"], 1)
        self.assertEqual(self.call("log", sessionID=session)["total"], 1)
        self.assertEqual(self.output.mock_calls, [])
        self.assert_source_unchanged()
        self.host.close()
        self.host = Host(self.root)
        reopened = self.call("session_open", sessionID=session)["projection"]
        self.assertEqual(reopened["practice"], projection["practice"])
        self.assertEqual(self.call("log", sessionID=session)["total"], 1)
        self.assert_source_unchanged()
        for method in ("rtc_payload", "cw_context", "output_claim"):
            with self.subTest(method=method), self.assertRaises(HostError) as raised:
                self.call(method, sessionID=session, workspaceGeneration=self.workspace)
            self.assertEqual(raised.exception.code, "practice_output_disabled")

    def test_stale_or_same_identity_copy_rejected_without_source_mutation(self):
        for overrides in ({"sourceRevision": self.source_state["revision"] - 1}, {"workspaceGeneration": uid()},
                          {"sessionID": self.source}):
            with self.subTest(overrides=overrides), self.assertRaises(HostError):
                self.create_practice(**overrides)
            self.assert_source_unchanged()


if __name__ == "__main__":
    unittest.main()
