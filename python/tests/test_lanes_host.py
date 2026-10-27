"""W11 independent contexts over the real transactional host, with no radio IO."""
from copy import deepcopy
import json
import unittest

from contest_host.host import Desk, Host, HostError
from contest_host.lanes import augment_adif
import test_host as fixtures

binding_a = {"radioID": "radio1", "receiverID": "receiver-a", "vfo": "A", "sliceID": None, "generation": "connection-a"}
binding_b = {"radioID": "radio2", "receiverID": "receiver-b", "vfo": "A", "sliceID": None, "generation": 17}


class LaneHostTests(unittest.TestCase):
    setUp = fixtures.HostTests.setUp
    tearDown = fixtures.HostTests.tearDown
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read

    def configure(self, **values):
        result = self.mutate("contest_lanes_configure", workspaceGeneration=self.workspace, mode="SO2R",
                             bindings={"laneA": deepcopy(binding_a), "laneB": deepcopy(binding_b)}, **values)
        return result["projection"]

    def lanes(self):
        return {row["laneID"]: row for row in self.read("contest_draft_get")["projection"]["operatingLanes"]["lanes"]}

    def lane_mutation(self, method, lane_id, **values):
        lane = self.lanes()[lane_id]
        return self.mutate(method, laneID=lane_id, bindingVersion=lane["bindingVersion"], draftID=lane["draftID"],
                           workspaceGeneration=self.workspace, **values)

    def restart(self):
        self.host.close()
        self.host = Host(self.root)

    def serial_session(self):
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0
        created = {**deepcopy(self.create), "sessionID": self.session, "workspaceGeneration": self.workspace,
                   "operationID": fixtures.uid(), "pluginID": "cq_wpx_cw", "settings": {**self.create["settings"], "SentExchange": "#"}}
        self.call("session_create", created)

    def test_so1v_legacy_entry_and_projection_are_unchanged_until_configured(self):
        result = self.mutate("contest_draft_apply", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertNotIn("operatingLanes", result["projection"])
        self.assertNotIn("laneID", result)
        self.assertEqual(result["projection"]["fields"][0]["value"], "K1ABC")

    def test_two_independent_entries_run_focus_contexts_and_keyboard_selection_survive_restart(self):
        self.configure()
        self.lane_mutation("contest_draft_apply", "laneA", fields={"callsign": "K1ABC", "other_2": "5"})
        self.lane_mutation("contest_run_state", "laneA", run=True)
        self.lane_mutation("contest_focus", "laneA", field="other_2")
        self.lane_mutation("contest_lane_context", "laneA", cqContext={"rememberedCQFrequencyHz": 14025000}, esmContext={"armed": False})
        changed = self.lane_mutation("contest_draft_apply", "laneB", frequencyHz=7025000, fields={"callsign": "DL1ABC", "other_2": "14"})
        self.assertEqual(changed["projection"]["selectedLaneID"], "laneA")
        self.assertEqual(changed["projection"]["fields"][0]["value"], "K1ABC")
        self.assertEqual(changed["laneID"], "laneB")
        self.assertNotEqual(self.lanes()["laneA"]["draftID"], self.lanes()["laneB"]["draftID"])
        self.lane_mutation("contest_lane_select", "laneB")
        self.restart()
        reopened = self.read("contest_open")["projection"]
        self.assertEqual(reopened["selectedLaneID"], "laneB")
        self.assertEqual(reopened["fields"][0]["value"], "DL1ABC")
        rows = self.lanes()
        self.assertTrue(rows["laneA"]["run"])
        self.assertEqual(rows["laneA"]["focus"], "other_2")
        self.assertEqual(rows["laneA"]["cqContext"], {"rememberedCQFrequencyHz": 14025000})
        self.assertFalse(rows["laneB"]["run"])
        self.assertEqual(rows["laneB"]["frequencyHz"], 7025000)

    def test_interleaved_wpx_reservations_commit_and_lost_reply_keep_original_lane_and_serial(self):
        self.serial_session()
        initial = self.read("projection")["projection"]
        self.configure()
        rows = self.lanes()
        self.assertEqual(rows["laneA"]["reservedSerial"], initial["reservedSerial"])
        self.assertEqual(rows["laneB"]["reservedSerial"], initial["reservedSerial"] + 1)
        before_a = deepcopy(rows["laneA"])
        params = {"sessionID": self.session, "workspaceGeneration": self.workspace, "operationID": fixtures.uid(),
                  "expectedRevision": self.revision, "laneID": "laneB", "bindingVersion": rows["laneB"]["bindingVersion"],
                  "draftID": rows["laneB"]["draftID"], "qsoID": fixtures.uid(), "timestamp": "2026-10-28 01:00:00",
                  "fields": {"callsign": "K1ABC", "other_2": "123"}}
        first = self.call("contest_qso_commit", params)
        self.assertEqual({key: value for key, value in self.lanes()["laneA"].items() if key != "draftRevision"},
                         {key: value for key, value in before_a.items() if key != "draftRevision"})
        self.lane_mutation("contest_qso_commit", "laneA", qsoID=fixtures.uid(), timestamp="2026-10-28 01:00:01",
                           fields={"callsign": "DL1ABC", "other_2": "456"})
        self.restart()
        replay = self.call("contest_qso_commit", params)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["laneID"], "laneB")
        self.assertEqual(replay["projection"], first["projection"])
        logged = self.read("log")["rows"]
        sent = {row["Call"]: row["SentNr"] for row in logged}
        self.assertEqual(sent, {"K1ABC": initial["reservedSerial"] + 1, "DL1ABC": initial["reservedSerial"]})
        self.assertEqual(len(logged), 2)
        reservation = self.host.database(self.session).exec_sql("SELECT qso_id FROM xlog_serial WHERE draft_id=?", (params["draftID"],))
        self.assertEqual(reservation["qso_id"], params["qsoID"])

    def test_stale_binding_missing_lane_and_wrong_draft_fail_without_modifying_either_lane(self):
        self.configure()
        lane = self.lanes()["laneB"]
        common = {"sessionID": self.session, "workspaceGeneration": self.workspace, "expectedRevision": self.revision,
                  "laneID": "laneB", "bindingVersion": lane["bindingVersion"], "draftID": lane["draftID"], "fields": {"callsign": "DL1ABC"}}
        before = self.host.database(self.session).state(self.session)
        for bad, code in [({"laneID": None}, "lane_required"), ({"bindingVersion": 0}, "stale_binding"),
                          ({"draftID": self.lanes()["laneA"]["draftID"]}, "stale_draft"), ({"workspaceGeneration": fixtures.uid()}, "stale_context")]:
            with self.subTest(code=code), self.assertRaises(HostError) as error:
                self.call("contest_draft_apply", {**common, **bad, "operationID": fixtures.uid()})
            self.assertEqual(error.exception.code, code)
            self.assertEqual(self.host.database(self.session).state(self.session), before)

    def test_lane_notes_bind_only_to_their_original_draft_and_committed_contact(self):
        self.configure()
        for lane_id, body in [("laneA", "Caller A note"), ("laneB", "Caller B note")]:
            self.lane_mutation("contest_note_save", lane_id, noteID=fixtures.uid(), target={"draftID": self.lanes()[lane_id]["draftID"]}, text=body)
        self.lane_mutation("contest_qso_commit", "laneB", qsoID=fixtures.uid(), timestamp="2026-10-28 02:00:00", fields={"callsign": "DL1ABC", "other_2": "14"})
        self.restart()
        for lane_id, body in [("laneA", "Caller A note"), ("laneB", "Caller B note")]:
            lane = self.lanes()[lane_id]
            notes = self.read("contest_notes", workspaceGeneration=self.workspace, expectedRevision=self.revision,
                              laneID=lane_id, bindingVersion=lane["bindingVersion"])
            self.assertEqual([row["body"] for row in notes["rows"]], [body])
            self.assertEqual(bool(notes["rows"][0]["qso_id"]), lane_id == "laneB")

    def test_explicit_split_and_logging_lane_are_distinct_from_unverified_physical_binding(self):
        self.configure()
        self.lane_mutation("contest_qso_commit", "laneB", qsoID=fixtures.uid(), timestamp="2026-10-28 03:00:00",
                           fields={"callsign": "DL1ABC", "other_2": "14"}, frequencyHz=14025000, receiveFrequencyHz=14026000)
        row = self.read("log")["rows"][0]
        self.assertEqual((row["Freq"], row["QSXFreq"]), (14025, 14026))
        context = row["laneAttribution"]
        self.assertEqual(context["loggingLaneID"], "laneB")
        self.assertEqual(context["binding"], binding_b)
        self.assertEqual(context["bindingEvidence"], "operator_intent")
        self.assertEqual(context["physicalRadioEvidence"], "unverified")
        self.assertTrue(context["split"])
        self.assertEqual((context["transmitFrequencyHz"], context["receiveFrequencyHz"]), (14025000, 14026000))
        store = self.host.database(self.session)
        desk = Desk(store, store.state(self.session), self.host.commit)
        _, adif = self.host.export_artifact(desk, 512000, "adif")
        self.assertIn(b"<FREQ:6>14.025", adif)
        self.assertIn(b"<FREQ_RX:9>14.026000", adif)
        self.assertIn(b"<APP_XLOG_LOGGING_LANE:5>laneB", adif)
        cabrillo = self.read("export")["content"]
        self.assertEqual(next(line.split()[1] for line in cabrillo.splitlines() if line.startswith("QSO:")), "14025")

    def test_old_unattributed_contacts_remain_unknown(self):
        self.mutate("qso_commit", qsoID=fixtures.uid(), timestamp="2026-10-28 04:00:00", fields={"callsign": "K1ABC", "other_2": "5"})
        self.configure()
        self.assertIsNone(self.read("log")["rows"][0]["laneAttribution"])

    def test_split_correction_updates_frequency_facts_without_reassigning_logging_lane(self):
        self.configure()
        qso_id = fixtures.uid()
        self.lane_mutation("contest_qso_commit", "laneB", qsoID=qso_id, timestamp="2026-10-28 03:15:00",
                           fields={"callsign": "DL1ABC", "other_2": "14"})
        self.mutate("contest_qso_correct", qsoID=qso_id, frequencyHz=14027000, receiveFrequencyHz=14028000, reason="Explicit split correction")
        self.restart()
        row = self.read("log")["rows"][0]
        context = row["laneAttribution"]
        self.assertEqual(context["loggingLaneID"], "laneB")
        self.assertEqual(context["binding"], binding_b)
        self.assertEqual((context["transmitFrequencyHz"], context["receiveFrequencyHz"], context["splitEvidence"]),
                         (14027000, 14028000, "operator_correction"))
        store = self.host.database(self.session)
        _, adif = self.host.export_artifact(Desk(store, store.state(self.session), self.host.commit), 512000, "adif")
        self.assertIn(b"<FREQ_RX:9>14.028000", adif)

    def test_output_intents_bind_exact_lane_and_replay_never_reemits_them(self):
        self.configure()
        lane = self.lanes()["laneB"]
        result = self.lane_mutation("contest_function_key", "laneB", key="F1", fields={"callsign": "DL1ABC"})
        self.assertTrue(result["actions"])
        for action in result["actions"]:
            self.assertEqual((action["laneID"], action["bindingVersion"], action["laneBinding"]), ("laneB", lane["bindingVersion"], binding_b))
        replay = self.read("contest_operation_receipt", operationID=result["operationID"])
        self.assertEqual(replay["result"]["actions"], [])
        self.assertFalse(self.lanes()["laneA"]["run"])
        self.assertTrue(self.lanes()["laneB"]["run"])

    def test_so2v_and_mode_changes_preserve_hidden_lane_b_and_invalidate_old_bindings(self):
        self.configure()
        self.lane_mutation("contest_draft_apply", "laneB", fields={"callsign": "DL1ABC", "other_2": "14"})
        previous = self.lanes()["laneB"]
        bindings = {"laneA": deepcopy(binding_a), "laneB": {**binding_a, "receiverID": "receiver-b", "vfo": "B"}}
        self.mutate("contest_lanes_configure", workspaceGeneration=self.workspace, mode="SO2V", bindings=bindings)
        self.assertGreater(self.lanes()["laneB"]["bindingVersion"], previous["bindingVersion"])
        self.assertEqual(self.lanes()["laneB"]["draftID"], previous["draftID"])
        self.mutate("contest_lanes_configure", workspaceGeneration=self.workspace, mode="SO1V", bindings={"laneA": binding_a, "laneB": None})
        self.assertEqual(list(self.lanes()), ["laneA"])
        self.restart()
        self.mutate("contest_lanes_configure", workspaceGeneration=self.workspace, mode="SO2V", bindings=bindings)
        self.assertEqual(self.lanes()["laneB"]["fields"][0]["value"], "DL1ABC")
        self.assertEqual(self.lanes()["laneB"]["draftID"], previous["draftID"])
        with self.assertRaises(HostError) as error:
            self.read("contest_cw_context", workspaceGeneration=self.workspace, laneID="laneB", bindingVersion=previous["bindingVersion"])
        self.assertEqual(error.exception.code, "stale_binding")

    def test_distinct_connection_generations_cannot_disguise_identical_receiver_targets(self):
        before = self.host.database(self.session).state(self.session)
        with self.assertRaisesRegex(HostError, "distinct receiver"):
            self.mutate("contest_lanes_configure", workspaceGeneration=self.workspace, mode="SO2V",
                        bindings={"laneA": binding_a, "laneB": {**binding_a, "generation": "new-generation"}})
        self.assertEqual(self.host.database(self.session).state(self.session), before)

    def test_adif_metadata_never_shifts_past_literal_record_tags_or_fills_unknown_history(self):
        payload = b"<EOH>\r\n<CALL:5>K1ABC<COMMENT:12>Use <EOR> CQ<EOR>\r\n<CALL:6>DL1ABC<EOR>\r\n"
        rows = [{"ID": "unknown", "QSXFreq": 14025}, {"ID": "known", "QSXFreq": 7026}]
        def require(condition, message, code="invalid_request"):
            if not condition:
                raise HostError(code, message)
        output = augment_adif(payload, rows, {"known": {"loggingLaneID": "laneB", "receiveFrequencyHz": 7026000}}, require)
        self.assertIn(b"<COMMENT:12>Use <EOR> CQ<EOR>", output)
        self.assertEqual(output.count(b"APP_XLOG_LOGGING_LANE"), 1)
        self.assertIn(b"<CALL:6>DL1ABC<APP_XLOG_LOGGING_LANE:5>laneB\r\n<FREQ_RX:8>7.026000\r\n<EOR>", output)
        with self.assertRaisesRegex(HostError, "record count"):
            augment_adif(payload, rows[:1], {"known": {"loggingLaneID": "laneB"}}, require)

    def test_delayed_reconnect_context_cannot_cross_lanes_and_old_receipt_keeps_original_route(self):
        self.configure()
        first = self.lane_mutation("contest_function_key", "laneB", key="F1", fields={"callsign": "DL1ABC"})
        old = self.lanes()["laneB"]
        self.mutate("contest_lanes_configure", workspaceGeneration=self.workspace, mode="SO2R",
                    bindings={"laneA": binding_a, "laneB": {**binding_b, "generation": 18}})
        current = self.lanes()
        before = self.host.database(self.session).state(self.session)
        with self.assertRaises(HostError) as error:
            self.mutate("contest_draft_apply", workspaceGeneration=self.workspace, laneID="laneB", bindingVersion=old["bindingVersion"],
                        draftID=old["draftID"], fields={"callsign": "LATECALL"})
        self.assertEqual(error.exception.code, "stale_binding")
        self.assertEqual(self.host.database(self.session).state(self.session), before)
        self.restart()
        recovered = self.read("contest_operation_receipt", operationID=first["operationID"])["result"]
        self.assertEqual(recovered["actions"], [])
        recovered_b = next(row for row in recovered["projection"]["operatingLanes"]["lanes"] if row["laneID"] == "laneB")
        self.assertEqual(recovered_b["binding"], binding_b)
        context = self.read("contest_cw_context", workspaceGeneration=self.workspace, laneID="laneB", bindingVersion=current["laneB"]["bindingVersion"])
        self.assertEqual(context["laneContext"]["binding"]["generation"], 18)
        self.assertEqual(context["fields"]["callsign"], "DL1ABC")
        self.assertEqual(self.lanes()["laneA"]["fields"][0]["value"], "")
        self.assertEqual(self.read("projection")["projection"]["selectedLaneID"], "laneA")

    def test_received_exchange_correction_preserves_literal_sent_serials_and_both_live_reservations(self):
        self.serial_session()
        self.configure()
        first = self.lanes()
        a_serial, b_serial = first["laneA"]["reservedSerial"], first["laneB"]["reservedSerial"]
        qso_id = fixtures.uid()
        self.lane_mutation("contest_qso_commit", "laneB", qsoID=qso_id, timestamp="2026-10-28 05:00:00", fields={"callsign": "K1ABC", "other_2": "123"})
        live = self.lanes()
        self.mutate("contest_qso_correct", qsoID=qso_id, fields={"other_2": "456"}, reason="Received exchange correction only")
        self.restart()
        rows = self.lanes()
        self.assertEqual((rows["laneA"]["reservedSerial"], rows["laneB"]["reservedSerial"]),
                         (live["laneA"]["reservedSerial"], live["laneB"]["reservedSerial"]))
        self.assertEqual(rows["laneA"]["reservedSerial"], a_serial)
        contact = self.read("log")["rows"][0]
        self.assertEqual(contact["SentNr"], b_serial)
        self.assertEqual(contact["raw_fields"]["other_1"], str(b_serial).zfill(3))
        self.assertEqual(contact["NR"], 456)
        sent = self.lane_mutation("contest_function_key", "laneA", key="F2", fields={"callsign": "DL1ABC", "other_2": "789"})["actions"][0]
        self.assertEqual(sent["sentSerial"], str(a_serial).zfill(3))
        self.assertEqual(sent["fields"]["other_1"], str(a_serial).zfill(3))

    def test_sked_load_uses_captured_requested_lane_for_occupied_guard_and_preserves_other_entry(self):
        self.configure()
        self.lane_mutation("contest_draft_apply", "laneA", fields={"callsign": "K1ABC", "other_2": "5"})
        self.lane_mutation("contest_strategy_apply", "laneA", action="sked_add", itemID="lane-sked", callsign="DL1ABC", text="Return contact",
                           frequencyHz=7025000, mode="CW", dueUTC="2027-01-01T00:00:00Z", radioID="radio2")
        before_a = self.lanes()["laneA"]
        loaded = self.lane_mutation("contest_strategy_apply", "laneB", action="sked_load", itemID="lane-sked")
        self.assertEqual(loaded["projection"]["selectedLaneID"], "laneA")
        self.assertEqual(loaded["projection"]["fields"][0]["value"], "K1ABC")
        self.assertEqual(self.lanes()["laneB"]["fields"][0]["value"], "DL1ABC")
        self.assertEqual(self.lanes()["laneB"]["frequencyHz"], 7025000)
        self.assertEqual(self.lanes()["laneA"]["draftID"], before_a["draftID"])
        self.assertEqual(self.lanes()["laneA"]["fields"], before_a["fields"])
        self.assertEqual(loaded["actions"], [])
        for lane_id in ("laneA", "laneB"):
            before = self.host.database(self.session).state(self.session)
            with self.assertRaises(HostError) as error:
                self.lane_mutation("contest_strategy_apply", lane_id, action="sked_load", itemID="lane-sked")
            self.assertEqual(error.exception.code, "occupied_draft")
            self.assertEqual(self.host.database(self.session).state(self.session), before)
        sked = self.read("contest_strategy", workspaceGeneration=self.workspace, expectedRevision=self.revision)["skeds"][0]
        self.assertEqual(sked["status"], "active")


if __name__ == "__main__":
    unittest.main()
