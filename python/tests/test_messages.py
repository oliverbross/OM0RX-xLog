from copy import deepcopy
import unittest
from unittest.mock import patch

from contest_host.messages import (apply_message_mutation, import_message_bank,
                                   message_projection, preview_message)


def scope(mode="CW"):
    return {"mode": mode, "contest": "cq_ww_cw", "operator": "OM0RX"}


def state():
    return {"pluginID": "cq_ww_cw", "operator": "OM0RX", "sessionID": "disposable-session",
            "station": {"Call": "OM0RX"}, "settings": {"SentExchange": "15"},
            "draft": {"id": "draft-current", "mode": "CW", "fields": {"callsign": "K1ABC", "sent": "599", "other_1": "05", "other_2": ""}},
            "setup": {"macros": [{"mode": "R", "key": "F1", "label": "Old", "template": "CQ"}],
                      "preferences": {"esmCQ": "F12", "keyESM": "Alt+Enter", "useESM": True}}}


class MessageTests(unittest.TestCase):
    def imported(self, source="R|F1|CQ|{MYCALL}\nS|F12|TU|{CALL} #", dialect="not1mm", mode="CW"):
        return import_message_bank({"dialect": dialect, "source": source, "name": "Contest messages", "scope": scope(mode)})

    def test_explicit_dialect_and_original_retention_with_both_banks(self):
        source = "R|F1|CQ|{MYCALL}\r\nS|F12|TU|{CALL} #\r\n"
        value = self.imported(source)
        self.assertTrue(value["canSave"])
        self.assertEqual(value["bank"]["original"], source)
        self.assertEqual(len(value["bank"]["macros"]), 24)
        self.assertEqual(value["bank"]["macros"][-1]["key"], "F12")
        with self.assertRaises(ValueError):
            import_message_bank({"source": source, "scope": scope()})
        self.assertFalse(self.imported(source, "n1mm")["canSave"])

    def test_n1mm_declared_translation_and_rejection(self):
        result = self.imported("# Run messages\nF1 CQ,CQ *\n# S&P messages\nF12 TU,! TU #", "n1mm")
        self.assertTrue(result["canSave"])
        self.assertEqual(result["bank"]["macros"][0]["template"], "CQ {MYCALL}")
        self.assertEqual(result["bank"]["macros"][-1]["template"], "{CALL} TU #")
        self.assertTrue(any(item["status"] == "translated" for item in result["report"]))
        self.assertFalse(self.imported("F1 CQ,CQ *", "n1mm")["canSave"])

    def test_voice_translation_reports_provider_difference(self):
        result = self.imported("R|F1|Voice|{VOICE1}", mode="SSB")
        self.assertEqual(result["bank"]["macros"][0]["template"], "[f1]")
        self.assertTrue(any("different providers" in row["message"] for row in result["report"]))
        preview = preview_message(state(), {"template": "[f1]", "mode": "SSB"})
        self.assertTrue(any("missing/unverified" in warning for warning in preview["rejections"]))
        self.assertTrue(any("manual logging remains available" in warning for warning in preview["warnings"]))

    def test_import_unsafe_families_unknown_and_recursion_rejected(self):
        for template in ("{SHELL:rm}", "RI:FA123;", "{CAT}", "{PYTHON}", "{F1}", "{UNDEFINED}",
                         "{{CALL}}", "[../secret]", "[C:\\secret.wav]", "$(whoami)", "^X", "<TX>"):
            with self.subTest(template=template):
                result = self.imported("R|F1|Unsafe|" + template)
                self.assertFalse(result["canSave"])
                self.assertIn(template, result["bank"]["original"])

    def test_hostile_heard_text_is_opaque_single_pass(self):
        current = state()
        hostile = "{MYCALL} # ^M <XML>& {LOGIT} [../x]"
        current["draft"]["fields"]["callsign"] = hostile
        before = deepcopy(current)
        with patch("contest_host.host.Desk.process_function_key", side_effect=AssertionError("output invoked")):
            result = preview_message(current, {"template": "{CALL} {MYCALL} #", "serial": 42})
        self.assertEqual(result["text"], hostile + " OM0RX 42")
        self.assertEqual(result["actions"], [])
        self.assertEqual(current, before)
        self.assertTrue(result["noOutput"])

    def test_log_ui_actions_only_described_and_conflict_rejected(self):
        current = state()
        before = deepcopy(current)
        result = preview_message(current, {"template": "{CALL}{LOGIT}{WIPE}"})
        self.assertEqual([item["kind"] for item in result["actions"]], ["log", "ui"])
        self.assertTrue(all(not item["executed"] for item in result["actions"]))
        self.assertEqual(current, before)
        self.assertTrue(preview_message(current, {"template": "{RUN}{SANDP}"})["rejections"])

    def test_preview_uses_existing_plugin_alias_and_configured_serial_semantics(self):
        self.assertEqual(preview_message(state(), {"template": "{HISCALL} {SNT} {SENTNR}", "serial": 99})["text"], "K1ABC 599 15")
        current = state()
        current["pluginID"] = "cq_wpx_cw"
        result = preview_message(current, {"template": "{EXCH} {SENTNR} #", "sentExchange": "NAME #", "serial": 99})
        self.assertEqual(result["text"], "NAME 99 99 99")

    def test_next_call_and_serial_binding_with_actual_current_esm_projection(self):
        projection = {"draftID": "draft-current", "functionKeys": [{"id": "F12", "highlighted": True}]}
        result = preview_message(state(), {"template": "{CALL} #", "draft": {"id": "draft-next", "fields": {"callsign": "W1NEXT"}}, "serial": 43}, projection)
        self.assertEqual(result["text"], "W1NEXT 43")
        self.assertEqual(result["binding"]["draftID"], "draft-next")
        self.assertEqual(result["nextESM"]["keys"], ["F12"])
        self.assertEqual(result["nextESM"]["draftID"], "draft-current")
        self.assertIn("does not simulate", result["nextESM"]["warning"])

    def test_save_is_distinct_from_activation_and_preserves_esm_keys(self):
        current = state()
        before = deepcopy(current["setup"])
        saved = apply_message_mutation(current, "message_bank_save", {"bank": self.imported()["bank"]})
        self.assertEqual(current["setup"], before)
        identity = saved["banks"][0]["id"]
        apply_message_mutation(current, "message_bank_activate", {"bankID": identity})
        self.assertEqual(current["setup"]["preferences"], before["preferences"])
        self.assertEqual(len(current["setup"]["macros"]), 24)
        self.assertEqual(message_projection(current)["activeBankID"], identity)
        replacement = self.imported()["bank"]
        replacement["macros"][0]["template"] = "NEW"
        apply_message_mutation(current, "message_bank_save", {"bank": replacement})
        self.assertNotEqual(current["setup"]["macros"][0]["template"], "NEW")

    def test_rejected_original_cannot_be_smuggled_with_forged_can_save(self):
        current = state()
        before = deepcopy(current)
        forged = self.imported("R|F1|Bad|{SHELL}")["bank"]
        forged["macros"][0]["template"] = "SAFE"
        with self.assertRaises(ValueError):
            apply_message_mutation(current, "message_bank_save", {"bank": forged, "canSave": True})
        self.assertEqual(current, before)

    def test_named_scope_and_activation_failure_leave_state_unchanged(self):
        current = state()
        bank = self.imported()["bank"]
        bank["scope"]["operator"] = "OTHER"
        with self.assertRaises(ValueError):
            apply_message_mutation(current, "message_bank_save", {"bank": bank})
        self.assertNotIn("messageWorkbench", current)
        with self.assertRaises(ValueError):
            apply_message_mutation(current, "message_bank_activate", {"bankID": "missing"})

    def test_activation_requires_host_defaults_when_no_setup_override_exists(self):
        current = state()
        defaults = current.pop("setup")
        saved = apply_message_mutation(current, "message_bank_save", {"bank": self.imported()["bank"]})
        bank_id = saved["banks"][0]["id"]
        before = deepcopy(current)
        with self.assertRaisesRegex(ValueError, "Canonical contest setup"):
            apply_message_mutation(current, "message_bank_activate", {"bankID": bank_id})
        self.assertEqual(current, before)
        apply_message_mutation(current, "message_bank_activate", {"bankID": bank_id}, setup_document=defaults)
        self.assertEqual(current["setup"]["preferences"], defaults["preferences"])
        self.assertEqual(defaults["macros"][0]["template"], "CQ")

    def test_bounds_and_unavailable_serial_are_explicit(self):
        with self.assertRaises(ValueError):
            self.imported("x" * 65537)
        oversized = self.imported("# comment\n" * 257)
        self.assertFalse(oversized["canSave"])
        self.assertLess(len(oversized["report"]), 260)
        for value in (0, -1, 1000000000, True, 1.5):
            with self.assertRaises(ValueError):
                preview_message(state(), {"template": "#", "serial": value})
        result = preview_message(state(), {"template": "#"})
        self.assertEqual(result["text"], "[serial unavailable]")
        self.assertTrue(result["warnings"])


if __name__ == "__main__":
    unittest.main()
