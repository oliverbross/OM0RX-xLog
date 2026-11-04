"""Durable QTC desk metadata and literal output at the existing host owner."""
from copy import deepcopy
from datetime import datetime, UTC
import unittest
from unittest.mock import patch
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

    def test_in_period_attempt_uses_its_own_band_and_prepared_evidence_with_legacy_unknown(self):
        self.create_wae()
        setup = self.read("setup_get")["setup"]
        setup["settings"].update(StartDate="2026-08-08 00:00:00", OperatorCategory="MULTI-OP", TransmitterCategory="ONE")
        self.mutate("setup_save", setup=setup)
        self.mutate("operating_plan_save", workspaceGeneration=self.workspace,
                    plan={"ruleProfileID": "wae-2026-multi-one", "note": ""})
        with patch("contest_host.wae.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 8, 8, 9, 0, tzinfo=UTC)
            self.receive()
        original = deepcopy(self.view()["batches"][0])
        self.mutate("draft_apply", frequencyHz=7025000)
        with patch("contest_host.qtc_operating.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 8, 8, 9, 5, tzinfo=UTC)
            prepared = self.qtc("qtc_output", batchID="receive-1", index=0, qtcField="time")
        self.assertEqual(prepared["actions"][0]["payload"], "AGN TIME")
        params = {"workspaceGeneration": self.workspace, "expectedRevision": self.revision, "now": "2026-08-08T09:06:00Z"}
        info = self.read("operating_info", **params)
        self.assertEqual(info["bandDwell"]["clocks"][0]["eligibleUTC"], "2026-08-08T09:15:00Z")
        event = info["bandDwell"]["events"][-1]
        self.assertEqual((event["toBand"], event["status"], event["activityEvidence"]), ("40M", "early-band-change", "prepared"))
        self.assertEqual(info["transmissionEvidence"], "unknown")
        self.assertEqual(self.view()["batches"][0], original)
        store = self.host.database(self.session)
        state = store.state(self.session)
        state["qtcOperating"]["attempts"][0].pop("frequencyHz")
        state["qtcOperating"]["attempts"][0].pop("frequencyBasis")
        store.save_state(state); store.conn.commit()
        legacy = self.read("operating_info", **params)
        self.assertEqual(legacy["bandDwell"]["clocks"][0]["eligibleUTC"], "2026-08-08T09:10:00Z")
        self.assertFalse(legacy["bandDwell"]["complete"])
        self.assertEqual(legacy["bandDwell"]["events"][-1]["frequencyBasis"], "legacy-frequency-unknown")
        with patch("contest_host.wae.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 8, 8, 9, 7, tzinfo=UTC)
            self.qtc("qtc_confirm", batchID="receive-1", index=0)
        activity = self.view()["operating"]["activities"][-1]
        self.assertEqual((activity["frequencyHz"], activity["frequencyBasis"]), (7025000, "captured-entry-frequency"))

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

    def test_rtty_receive_without_sources_and_european_send_share_the_same_ten_item_quota(self):
        self.create_wae("wae_rtty", own="K1ABC")
        before = deepcopy(self.host.database(self.session).state(self.session))
        row = self.view(counterparts=["DL1ABC"])["opportunities"]["DL1ABC"]
        self.assertEqual(row["availableSources"], 0)
        self.assertFalse(row["capabilities"]["send"]["opportunity"])
        self.assertTrue(row["capabilities"]["receive"]["opportunity"])
        self.assertTrue(row["opportunity"])
        self.assertEqual(self.host.database(self.session).state(self.session), before)
        self.qtc("qtc_create", batchID="rtty-receive", number=1, direction="receive", counterpart="DL1ABC",
            timestamp="2026-11-14 09:00:00", frequencyHz=14025000,
            items=[{"time": f"08{i:02d}", "callsign": f"OM{i}ABC", "serial": str(i+1)} for i in range(10)])
        row = self.view(counterparts=["DL1ABC"])["opportunities"]["DL1ABC"]
        self.assertEqual(row["remaining"], 0)
        self.assertFalse(row["opportunity"])
        self.assertFalse(any(item["opportunity"] for item in row["capabilities"].values()))
        self.create_wae("wae_rtty")
        self.log("DL1ABC", "13")
        row = self.view(counterparts=["K1ABC"])["opportunities"]["K1ABC"]
        self.assertEqual(row["capabilities"]["send"]["availableSources"], 1)
        self.assertTrue(row["capabilities"]["send"]["opportunity"])
        self.assertTrue(row["capabilities"]["receive"]["opportunity"])

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

    def test_saved_correction_clears_matching_editor_atomically_and_stale_autosave_cannot_restore_it(self):
        self.create_wae(); self.receive()
        edit_id = uid()
        corrected = {"time": "0801", "callsign": "DL2ABC", "serial": "42"}
        workspace = {"counterpart": "K1ABC", "selectedBatchID": "receive-1", "selectedIndex": 0,
                     "pendingEdit": {"editID": edit_id, "batchID": "receive-1", "index": 0, "row": corrected}}
        self.qtc("qtc_workspace", workspace=workspace)
        self.qtc("qtc_item", batchID="receive-1", index=0, item=corrected, editID=edit_id)
        saved = self.view()["operating"]["workspace"]
        self.assertEqual(saved, {**workspace, "pendingEdit": None})
        self.qtc("qtc_confirm", batchID="receive-1", index=0)
        self.qtc("qtc_workspace", workspace=workspace)  # queued older autosave
        self.host.close(); self.host = Host(self.root)
        self.assertIsNone(self.view()["operating"]["workspace"]["pendingEdit"])
        self.assertEqual(self.view()["batches"][0]["items"][0]["status"], "confirmed")
        self.assertEqual(self.view()["operating"]["workspace"]["counterpart"], "K1ABC")

    def test_legacy_matching_editor_clearance_and_genuinely_unsaved_correction_guard(self):
        self.create_wae(); self.receive()
        corrected = {"time": "0801", "callsign": "DL2ABC", "serial": "42"}
        legacy = {"pendingEdit": {"batchID": "receive-1", "index": 0, "row": corrected}}
        self.qtc("qtc_workspace", workspace=legacy)
        self.qtc("qtc_item", batchID="receive-1", index=0, item=corrected)
        self.qtc("qtc_workspace", workspace=legacy)
        self.assertIsNone(self.view()["operating"]["workspace"]["pendingEdit"])
        unsaved = {"pendingEdit": {"editID": uid(), "batchID": "receive-1", "index": 0,
                                  "row": {**corrected, "serial": "99"}}}
        self.qtc("qtc_workspace", workspace=unsaved)
        with self.assertRaisesRegex(HostError, "Save or explicitly discard"):
            self.qtc("qtc_confirm", batchID="receive-1", index=0)
        self.qtc("qtc_item", batchID="receive-1", index=0, item=corrected, editID=uid())
        self.assertEqual(self.view()["operating"]["workspace"], unsaved)

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
