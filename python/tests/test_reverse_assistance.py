"""W03 actual plugin/read-store evidence, using disposable contest sessions."""
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import uuid

from contest_host.host import Host, HostError
from contest_host.store import CALLHISTORY_COLUMNS


def uid():
    return str(uuid.uuid4())


class ReverseAssistanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.host = Host(Path(self.temp.name).resolve() / "host")
        self.create("naqp_cw")

    def tearDown(self):
        self.host.close()
        self.temp.cleanup()

    def create(self, plugin, frequency=14_025_000, sent="OLIVER SK"):
        self.session, self.workspace = uid(), uid()
        self.host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": self.session, "workspaceGeneration": self.workspace, "operationID": uid(),
            "expectedRevision": 0, "pluginID": plugin,
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"},
            "frequencyHz": frequency, "settings": {"SentExchange": sent, "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL", "PowerCategory": "LOW"},
            "reference": {"id": "test-v1", "countries": {"OM0RX": {
                "entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"}}}}})
        self.store = self.host.database(self.session)

    def params(self, **values):
        state = self.store.state(self.session)
        return {"sessionID": self.session, "workspaceGeneration": self.workspace,
                "expectedRevision": state["revision"], "draftID": state["draft"]["id"], "requestID": uid(),
                "query": "", "offset": 0, "limit": 50, **values}

    def read(self, method="assistance_reverse", params=None, **values):
        if method == "assistance_reverse":
            values = {"fieldID": "call", "source": "history", "matchMode": "prefix", **values}
        return self.host.dispatch({"id": uid(), "method": f"contest_{method}", "params": params or self.params(**values)})

    def history(self, records):
        rows = [{**dict.fromkeys(CALLHISTORY_COLUMNS, ""), **record} for record in records]
        generation = uid()
        self.store.begin()
        self.store.begin_callhistory_stage(generation, "a" * 64, len(rows))
        self.store.append_callhistory_stage(generation, "a" * 64, 0, rows)
        self.store.activate_callhistory_stage(generation, "a" * 64, len(rows))
        self.store.finish(True)
        return generation

    def seed(self, call, **values):
        row = {**self.store.get_empty(), "ID": uid(), "Call": call, "Band": 14, "Mode": "CW",
               "TS": "2026-10-27 08:00:00", "ContestNR": self.store.current_contest, **values}
        self.store.log_contact(row)
        self.store.conn.commit()

    def test_naqp_stable_roles_source_generation_and_literal_match_modes(self):
        generation = self.history([{"Call": "K1ABC", "Name": "BOB", "State": "MA", "LastUpdateNote": "2026-01-01"},
                                   {"Call": "K2ABC", "Name": "BOBBY", "State": "MN"},
                                   {"Call": "K3ABC", "Name": "ROBOB", "State": "CA"}])
        result = self.read(query="bo", fieldID="name")
        self.assertEqual([row["callsign"] for row in result["rows"]], ["K1ABC", "K2ABC"])
        self.assertEqual(result["dataset"]["generation"], generation)
        self.assertEqual(result["rows"][0]["sourceDate"], "2026-01-01")
        self.assertEqual(result["rows"][0]["comparedFields"][2]["value"], "MA")
        self.assertEqual(len(self.read(query="BOB", fieldID="name", matchMode="contains")["rows"]), 3)
        self.assertEqual(self.read(query="MA", fieldID="state")["rows"][0]["callsign"], "K1ABC")
        self.assertEqual(self.read(query="B%", fieldID="name")["rows"], [])
        self.seed("K9ABC", Name="BOB", Sect="TX")
        logged = self.read(query="TX", fieldID="state", source="log")
        self.assertEqual(logged["rows"][0]["callsign"], "K9ABC")
        self.assertEqual(logged["rows"][0]["sourceDate"], "2026-10-27 08:00:00")

    def test_vhf_locator_is_declared_and_serial_explained(self):
        self.create("arrl_vhf_jan", frequency=50_100_000, sent="JN88")
        self.history([{"Call": "K1ABC", "Loc1": "FN31"}])
        self.assertEqual(self.read(query="FN", fieldID="locator")["rows"][0]["callsign"], "K1ABC")
        self.seed("K9ABC", NR="FN42", Band=50)
        self.assertEqual(self.read(query="FN4", fieldID="locator", source="log")["rows"][0]["callsign"], "K9ABC")
        self.create("cq_wpx_cw", sent="#")
        result = self.read(query="123", fieldID="serial")
        self.assertIn("not stable identities", result["unsupportedReason"])
        self.assertEqual(result["fields"], [{"id": "call", "label": "Partial call"}])

    def test_revision_draft_workspace_fences_and_boundaries(self):
        params = self.params(fieldID="name", source="history", matchMode="prefix", query="BO")
        for key, value in [("expectedRevision", 99), ("draftID", uid()), ("workspaceGeneration", uid())]:
            with self.subTest(key=key), self.assertRaises(HostError) as raised:
                self.read(params={**params, key: value})
            self.assertEqual(raised.exception.code, "stale_context")
        for bad in [{"query": "X" * 65}, {"limit": 101}, {"offset": -1}, {"extra": True}]:
            with self.subTest(bad=bad), self.assertRaises(HostError):
                self.read(params={**params, **bad})
        self.assertIn("two characters", self.read(query="B", fieldID="name")["unsupportedReason"])

    def test_whole_log_paging_filter_and_actual_entry_scope_without_writes(self):
        for number in range(75):
            self.seed(f"K1A{number:02}")
        before = self.store.conn.total_changes
        first = self.read("assistance_dupesheet")
        self.assertEqual((first["totalCalls"], len(first["rows"]), first["nextOffset"]), (75, 50, 50))
        self.assertTrue(all(row["isDupe"] for row in first["rows"]))
        self.assertEqual(len(self.read("assistance_dupesheet", offset=50)["rows"]), 25)
        self.assertEqual(self.read("assistance_dupesheet", query="A74")["rows"][0]["callsign"], "K1A74")
        self.assertEqual(self.store.conn.total_changes, before)
        state = self.store.state(self.session)
        state["draft"]["frequencyHz"] = 7_025_000
        self.store.conn.execute("UPDATE xlog_session SET state=? WHERE id=?", (__import__("json").dumps(state), self.session))
        self.store.conn.commit()
        self.assertFalse(self.read("assistance_dupesheet", query="A74")["rows"][0]["isDupe"])
        self.seed("K1A74", Band=7, TS="2026-10-27 08:00:01")
        self.assertTrue(self.read("assistance_dupesheet", query="A74")["rows"][0]["isDupe"])
        self.store.conn.execute("DELETE FROM DXLOG WHERE Call='K1A74'")
        self.store.conn.commit()
        self.assertEqual(self.read("assistance_dupesheet", query="A74")["totalCalls"], 0)

    def test_specific_plugin_grid_and_timed_repeat_authority(self):
        self.create("cq_ww_vhf", frequency=50_100_000, sent="JN88")
        self.seed("K1ABC", Band=50, SentNr="JN88", NR="FN31")
        self.assertTrue(self.read("assistance_dupesheet")["rows"][0]["isDupe"])
        state = self.store.state(self.session)
        state["roverLocation"] = "JN99"
        self.store.conn.execute("UPDATE xlog_session SET state=? WHERE id=?", (__import__("json").dumps(state), self.session))
        self.store.conn.commit()
        self.assertFalse(self.read("assistance_dupesheet")["rows"][0]["isDupe"])
        self.create("trans_tasman", frequency=7_025_000, sent="#")
        self.seed("VK1ABC", Band=7, TS="2026-10-27 09:59:59")
        class Clock(datetime):
            stamp = datetime(2026, 10, 27, 9, 59, 59, tzinfo=UTC)
            @classmethod
            def now(cls, tz=None):
                return cls.stamp
        with patch("contest_host.assistance.datetime", Clock):
            self.assertTrue(self.read("assistance_dupesheet")["rows"][0]["isDupe"])
            Clock.stamp += timedelta(seconds=1)
            self.assertFalse(self.read("assistance_dupesheet")["rows"][0]["isDupe"])


if __name__ == "__main__":
    unittest.main()
