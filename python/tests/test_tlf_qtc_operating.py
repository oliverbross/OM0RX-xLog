"""Durable QTC desk metadata and literal output at the existing host owner."""
from copy import deepcopy
import unittest
from contest_host.host import Host, HostError
import test_wave5_qtc_host as fixtures
from test_host import uid


class QTCOperatingTests(unittest.TestCase):
    setUp = fixtures.QTCTests.setUp
    tearDown = fixtures.QTCTests.tearDown
    call = fixtures.QTCTests.call
    mutate = fixtures.QTCTests.mutate
    read = fixtures.QTCTests.read
    create_wae = fixtures.QTCTests.create_wae
    qtc = fixtures.QTCTests.qtc
    view = fixtures.QTCTests.view
    log = fixtures.QTCTests.log
    receive = fixtures.QTCTests.receive

    def test_incomplete_editor_and_observations_survive_all_accounting_writers(self):
        self.create_wae()
        workspace = {"rows": [{"time": "08", "callsign": "K", "serial": ""}], "selectedIndex": 0}
        self.qtc("qtc_workspace", workspace=workspace)
        self.qtc("qtc_observe", counterpart="K1ABC", status="later", note="After the run", observedUTC="2026-08-08T09:00:00Z")
        self.receive()
        for action, values in [("qtc_header", {"number": 2}), ("qtc_item", {"index": 0, "item": {"time": "0801", "callsign": "DL2ABC", "serial": "42"}}),
            ("qtc_repeat", {"index": 0, "fields": "time"}), ("qtc_cancel", {}), ("qtc_resume", {}), ("qtc_confirm", {"index": 0})]:
            self.qtc(action, batchID="receive-1", **values)
            current = self.view()["operating"]
            self.assertEqual(current["workspace"], workspace)
            self.assertEqual(current["observations"]["K1ABC"]["status"], "later")
        self.host.close(); self.host = Host(self.root)
        self.assertEqual(self.view()["operating"]["workspace"], workspace)
        self.assertEqual(self.view()["score"]["qtcPoints"], 1)

    def test_historical_payload_receipts_and_acknowledgement_stay_separate(self):
        self.create_wae(own="K1ABC")
        source = self.log("OM1ABC", "13")
        self.qtc("qtc_create", batchID="send-1", number=3, direction="send", counterpart="DL1ABC",
                 timestamp="2026-08-08 09:00:00", frequencyHz=14025000, items=[{"sourceQSOID": source}])
        self.mutate("draft_apply", fields={"callsign": "K9OTHER", "other_2": "777"})
        before = deepcopy(self.host.database(self.session).state(self.session)["draft"])
        params = {"sessionID": self.session, "workspaceGeneration": self.workspace, "expectedRevision": self.revision,
                  "operationID": uid(), "action": "qtc_output", "batchID": "send-1", "index": 0, "qtcField": "all"}
        sent = self.call("strategy_apply", params)
        action = sent["actions"][0]
        self.assertEqual(action["payload"], "0800 OM1ABC 13")
        self.assertEqual(action["cwSequence"]["segments"], [{"kind": "text", "text": "0800 OM1ABC 13"}])
        self.assertEqual(action["fields"], {})
        self.assertEqual(self.host.database(self.session).state(self.session)["draft"], before)
        self.assertEqual(self.view()["score"]["qtcPoints"], 0)
        self.call("output_claim", {"sessionID": self.session, "operationID": params["operationID"], "revision": sent["revision"]})
        self.assertEqual(self.view()["operating"]["attempts"][0]["state"], "submitted")
        replay = self.call("strategy_apply", params)
        self.assertTrue(replay["replayed"]); self.assertEqual(replay["actions"], [])
        with self.assertRaises(HostError):
            self.call("output_claim", {"sessionID": self.session, "operationID": params["operationID"], "revision": sent["revision"]})
        repeat = self.qtc("qtc_output", batchID="send-1", index=0, qtcField="serial")
        self.assertEqual(repeat["actions"][0]["payload"], "13")
        self.qtc("qtc_confirm", batchID="send-1", index=0)
        self.assertEqual(self.view()["score"]["qtcPoints"], 1)
        self.assertEqual(self.read("log")["total"], 1)

    def test_routes_receive_repeat_and_unknown_future_data(self):
        for plugin, kind in [("wae_cw", "function_key"), ("wae_ssb", "voice_keyer"), ("wae_rtty", "fldigi")]:
            self.create_wae(plugin)
            self.receive()
            result = self.qtc("qtc_output", batchID="receive-1", index=0, qtcField="time")
            self.assertEqual(result["actions"][0]["payload"], "AGN TIME")
            self.assertEqual(result["actions"][0]["kind"], kind)
            self.assertEqual(self.view()["score"]["qtcPoints"], 0)
        store = self.host.database(self.session)
        state = store.state(self.session)
        state["qtcOperating"] = {"schema": 99, "keep": "future"}
        store.save_state(state)
        store.conn.commit()
        with self.assertRaises((ValueError, HostError)):
            self.qtc("qtc_confirm", batchID="receive-1", index=0)
        self.assertEqual(store.state(self.session)["qtcOperating"], {"schema": 99, "keep": "future"})

    def test_opportunity_is_host_derived_and_qso_dupe_can_have_capacity(self):
        self.create_wae()
        self.log("K1ABC", "12")
        result = self.view(counterparts=["K1ABC", "DL1ABC", "UNKNOWN"])["opportunities"]
        self.assertTrue(result["K1ABC"]["opportunity"])
        self.assertEqual(result["K1ABC"]["remaining"], 10)
        self.assertEqual(result["UNKNOWN"]["eligibility"], "unknown")
        self.assertFalse(result["DL1ABC"]["opportunity"])
        self.qtc("qtc_observe", counterpart="K1ABC", status="unavailable")
        self.assertFalse(self.view(counterparts=["K1ABC"])["opportunities"]["K1ABC"]["opportunity"])

    def test_pending_edit_and_series_completion_do_not_invent_ack_or_output(self):
        self.create_wae(); self.receive()
        with self.assertRaises(HostError):
            self.qtc("qtc_complete", batchID="receive-1")
        self.qtc("qtc_workspace", workspace={"pendingEdit": {"batchID": "receive-1", "index": 0,
            "row": {"time": "0800", "callsign": "DL1ABC", "serial": "1"}}})
        with self.assertRaises(HostError):
            self.qtc("qtc_confirm", batchID="receive-1", index=0)
        self.qtc("qtc_workspace", workspace={"pendingEdit": None})
        self.qtc("qtc_confirm", batchID="receive-1", index=0)
        completed = self.qtc("qtc_complete", batchID="receive-1")
        self.assertEqual(completed["actions"], [])
        self.assertIn("receive-1", self.view()["operating"]["completedSeries"])
        self.assertEqual(self.view()["operating"]["attempts"], [])

    def test_native_output_binding_shapes_are_captured_without_reinterpretation(self):
        voice = {"schemaVersion": 1, "outputIntent": uid(), "target": {"provider": "direct_flex_lan",
            "selection_generation": 1, "selection_id": uid(), "worker_generation": 1, "connection_generation": 2,
            "control_revision": 3, "observation_revision": 4, "received_at_ms": 1000}}
        self.create_wae("wae_ssb"); self.receive()
        sent = self.qtc("qtc_output", batchID="receive-1", index=0, qtcField="time", voiceTarget=voice)
        self.assertEqual(sent["actions"][0]["qtc"]["voiceTarget"], voice)
        self.assertEqual(self.view()["operating"]["attempts"][-1]["voiceTarget"], voice)
        self.create_wae("wae_rtty"); self.receive()
        generation = uid()
        sent = self.qtc("qtc_output", batchID="receive-1", index=0, qtcField="time", bridgeGeneration=generation)
        self.assertEqual(sent["actions"][0]["qtc"]["bridgeGeneration"], generation)
        self.assertEqual(self.view()["operating"]["attempts"][-1]["bridgeGeneration"], generation)
