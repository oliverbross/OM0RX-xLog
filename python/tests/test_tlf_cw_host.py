"""TLF CW admission and compiler vectors at the real plugin/transaction boundary."""
from copy import deepcopy
import unittest
from contest_host.host import HostError
from contest_host.cw_sequence import compile_sequence, sequence_text
from contest_host.cw_operations import corrected_component
import test_wave2_messages_host as fixtures
from test_wave2_messages_host import uid


class TLFCWHostTests(unittest.TestCase):
    setUp = fixtures.MessageHostTests.setUp
    tearDown = fixtures.MessageHostTests.tearDown
    call = fixtures.MessageHostTests.call
    mutate = fixtures.MessageHostTests.mutate

    def test_compiled_preview_equals_actual_key_with_raw_serial_preserved(self):
        setup = self.call("setup_get")["setup"]
        template = "{CALL} {WPM:32}{RST} {SENTNR}{WPM:20} TU{WPM:BASE}"
        setup["macros"] = [{"mode": "R", "key": "F2", "label": "Call", "template": template}]
        setup["preferences"].update(cwSerialOne="A", cwSerialNine="N", cwSerialZero="T")
        self.mutate("setup_save", setup=setup)
        self.mutate("run_state", run=True)
        before = self.call("projection")["projection"]
        preview = self.call("contest_message_preview", {"template": template, "serial": before["reservedSerial"]})
        sent = self.mutate("function_key", key="F2")
        self.assertEqual(sent["actions"][0]["cwSequence"], preview["cwSequence"])
        self.assertEqual(preview["text"], "K1ABC 5NN TTA TU")
        self.assertEqual(before["reservedSerial"], sent["projection"]["reservedSerial"])
        self.assertEqual(self.call("log")["total"], 0)

    def early(self, method, stream, call, **extra):
        draft = self.call("projection")["projection"]["draftID"]
        return self.mutate(method, streamID=stream, draftID=draft, fields={"callsign": call},
                           earlyStartEnabled=True, inputOrigin="typing", threshold=3, **extra)

    def test_real_host_revisions_stream_and_esm_send_call_exchange_once(self):
        self.mutate("run_state", run=True)
        serial = self.call("projection")["projection"]["reservedSerial"]
        stream = uid()
        start = self.early("early_cw_start", stream, "OM0")
        append = self.early("early_cw_append", stream, "OM0R")
        finish = self.early("early_cw_finish", stream, "OM0RX")
        self.assertEqual(start["earlyCW"]["streamID"], finish["earlyCW"]["streamID"])
        self.assertLess(start["revision"], append["revision"])
        self.assertEqual(finish["earlyCW"]["revision"], finish["revision"])
        self.assertEqual(self.call("cw_context")["earlyCW"], finish["earlyCW"])
        self.call("output_claim", {"operationID": finish["operationID"], "revision": finish["revision"]})
        self.call("cw_outcome", {"outputOperationID": finish["operationID"], "outcome": "accepted",
                                "acceptanceLevel": "native_queue", "providerID": "winkeyer", "generation": 1})
        result = self.mutate("esm", field="callsign")
        text = " ".join(sequence_text(a["cwSequence"]) for a in result["actions"])
        self.assertNotIn("OM0RX", text)
        self.assertIn("5NN", text)
        self.assertEqual(result["projection"]["reservedSerial"], serial)
        self.assertEqual(self.call("log")["total"], 0)

    def test_disabled_paste_edit_and_unrelated_revision_fail_closed(self):
        self.mutate("run_state", run=True)
        before = deepcopy(self.call("projection")["projection"])
        draft = before["draftID"]
        for origin, enabled in [("paste", True), ("typing", False)]:
            with self.assertRaises(HostError):
                self.mutate("early_cw_start", streamID=uid(), draftID=draft, fields={"callsign": "OM0"},
                            earlyStartEnabled=enabled, inputOrigin=origin)
        stream = uid()
        self.early("early_cw_start", stream, "OM0")
        with self.assertRaises(HostError):
            self.early("early_cw_append", stream, "OM1")
        self.mutate("draft_apply", fields={"callsign": "OM0RX"})
        with self.assertRaises(HostError):
            self.early("early_cw_append", stream, "OM0RX")
        self.assertEqual(self.call("log")["total"], 0)

    def test_previous_serial_is_captured_and_shared_by_preview_and_dispatch(self):
        self.mutate("qso_commit", qsoID=uid(), fields={"callsign": "K1ABC", "other_2": "7"})
        setup = self.call("setup_get")["setup"]
        setup["macros"] = [{"mode": "R", "key": "F2", "label": "Previous", "template": "NR {PREVNR}"}]
        self.mutate("setup_save", setup=setup)
        self.mutate("run_state", run=True)
        preview = self.call("contest_message_preview", {"template": "NR {PREVNR}"})
        sent = self.mutate("function_key", key="F2")
        self.assertEqual(preview["text"], "NR TT1")
        self.assertEqual(sent["actions"][0]["previousSerial"], "1")
        self.assertEqual(sent["actions"][0]["cwSequence"], preview["cwSequence"])

    def test_partial_correction_requires_complete_provider_evidence(self):
        self.mutate("run_state", run=True)
        initial = self.mutate("esm", field="callsign")
        self.call("output_claim", {"operationID": initial["operationID"], "revision": initial["revision"]})
        self.call("cw_outcome", {"outputOperationID": initial["operationID"], "outcome": "accepted",
                                "acceptanceLevel": "provider_accepted", "acceptedCall": "K1ABC", "providerID": "flex", "generation": "a"})
        result = self.mutate("esm", field="other_2", fields={"callsign": "K1ABD", "other_2": "3"}, correctionPolicy="partial",
                             cwProviderContext={"providerID": "flex", "generation": "a"})
        self.assertEqual(sequence_text(result["actions"][0]["cwSequence"]), "ABD")
        self.assertTrue(result["actions"][0]["partialCorrection"])
        self.assertEqual(self.call("log")["rows"][0]["Call"], "K1ABD")

    def test_late_accepted_reply_cannot_replace_uncertain_stop(self):
        self.mutate("run_state", run=True)
        initial = self.mutate("esm", field="callsign")
        self.call("output_claim", {"operationID": initial["operationID"], "revision": initial["revision"]})
        common = {"outputOperationID": initial["operationID"], "acceptanceLevel": "provider_accepted",
                  "acceptedCall": "K1ABC", "providerID": "flex", "generation": "a"}
        self.call("cw_outcome", {**common, "outcome": "uncertain"})
        late = self.call("cw_outcome", {**common, "outcome": "accepted"})
        self.assertFalse(late["recorded"])
        result = self.mutate("esm", field="other_2", fields={"callsign": "K1ABD", "other_2": "3"}, correctionPolicy="partial",
                             cwProviderContext={"providerID": "flex", "generation": "a"})
        self.assertEqual(sequence_text(result["actions"][0]["cwSequence"]), "K1ABD")


class SequenceVectors(unittest.TestCase):
    def test_bounds_restore_and_opaque_contact_text(self):
        for token in ("{WPM:0}", "{WPM:4}", "{WPM:100}", "{WPM:-2}"):
            with self.assertRaises(ValueError):
                compile_sequence(token, {})
        sequence = compile_sequence("{WPM:30}{CALL}", {"CALL": "{WPM:99}"})
        self.assertEqual(sequence["segments"], [{"kind": "speed", "wpm": 30}, {"kind": "text", "text": "{WPM:99}"}, {"kind": "restore"}])
        self.assertEqual(sequence_text(compile_sequence("++ --", {})), "++ --")

    def test_component_vectors_conservative_portable_and_multiple_changes(self):
        for before, after, expected in [("OM0RX", "OM0RY", "RY"), ("OM0RX", "OM1RX", "OM1"),
            ("OK0RX", "OM0RX", "OM0"), ("OM0RX/P", "OM0RY/P", "OM0RY/P"),
            ("OM0RX", "OK1RY", "OK1RY"), ("OM0RX", "OM0RX", "OM0RX")]:
            self.assertEqual(corrected_component(before, after), expected)
