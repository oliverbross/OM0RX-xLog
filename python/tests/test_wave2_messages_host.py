"""Message workbench through the real pinned Python host in disposable storage."""
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid
from unittest.mock import patch

from contest_host.host import Desk, Host, HostError


def uid():
    return str(uuid.uuid4())


class MessageHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name).resolve() / "disposable-messages"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.call("session_create", {"operationID": uid(), "pluginID": "cq_wpx_cw",
                  "station": {"Call": "OM0RX", "CQZone": "15", "GridSquare": "JN88"},
                  "frequencyHz": 14025000, "settings": {"SentExchange": "", "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL", "PowerCategory": "LOW"},
                  "reference": {"id": "disposable-cty", "countries": {"OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"}}}})
        setup = self.call("setup_get")["setup"]
        setup["preferences"].update({"keyESM": "Alt+Enter", "esmCQ": "F12", "useESM": True})
        self.mutate("setup_save", setup=setup)
        self.mutate("draft_apply", fields={"callsign": "K1ABC"})

    def tearDown(self):
        self.host.close()
        self.temp.cleanup()

    def call(self, method, params=None):
        result = self.host.dispatch({"id": uid(), "method": method, "params": {"sessionID": self.session,
            "workspaceGeneration": self.workspace, "expectedRevision": self.revision, **(params or {})}})
        if "revision" in result:
            self.revision = result["revision"]
        return result

    def mutate(self, method, **params):
        return self.call(method, {"operationID": uid(), **params})

    def imported(self, source="R|F1|CQ|CQ {MYCALL}\nS|F12|Thanks|{CALL} # {LOGIT}{WIPE}"):
        return self.call("contest_message_import", {"dialect": "not1mm", "source": source, "name": "WPX Weekend",
                    "scope": {"mode": "CW", "contest": "cq_wpx_cw", "operator": "OM0RX"}})

    def test_import_preview_save_activate_restart_are_no_output_and_preserve_entry(self):
        before = self.call("projection")["projection"]
        setup = self.call("setup_get")["setup"]
        count = self.call("log")["total"]
        imported = self.imported()
        self.assertTrue(imported["canSave"])
        self.assertEqual(self.call("contest_message_banks")["banks"], [])
        with patch.object(Desk, "process_function_key", side_effect=AssertionError("preview dispatched output")), \
             patch.object(Desk, "execute_macro_actions", side_effect=AssertionError("preview executed actions")):
            current = self.call("contest_message_preview", {"template": "{CALL} # {LOGIT}{WIPE}", "serial": before["reservedSerial"]})
            synthetic = self.call("contest_message_preview", {"template": "{CALL} #", "serial": before["reservedSerial"] + 1,
                "draft": {"id": "synthetic-next", "fields": {"callsign": "{#^<XML>"}}})
        self.assertEqual(current["text"], "K1ABC 1 ")
        self.assertEqual(synthetic["text"], "{#^<XML> 2")
        self.assertEqual(synthetic["binding"]["draftID"], "synthetic-next")
        self.assertEqual(synthetic["nextESM"]["draftID"], before["draftID"])
        self.assertTrue(current["noOutput"])
        self.assertTrue(all(not action["executed"] for action in current["actions"]))
        saved = self.mutate("contest_message_bank_save", bank=imported["bank"])
        self.assertEqual(saved["actions"], [])
        self.assertEqual(self.call("setup_get")["setup"], setup)
        bank = saved["waveResult"]["banks"][0]
        activated = self.mutate("contest_message_bank_activate", bankID=bank["id"])
        self.assertEqual(activated["actions"], [])
        self.assertEqual(activated["setup"]["preferences"], setup["preferences"])
        self.assertEqual(activated["setup"]["macros"], imported["bank"]["macros"])
        after = self.call("projection")["projection"]
        for key in ("draftID", "fields", "reservedSerial", "frequencyHz", "mode", "run"):
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(self.call("log")["total"], count)
        self.host.close()
        self.host = Host(self.root)
        reopened = self.call("contest_message_banks")
        self.assertEqual(reopened["activeBankID"], bank["id"])
        self.assertEqual(reopened["banks"][0]["original"], imported["bank"]["original"])
        self.assertEqual(self.call("setup_get")["setup"]["preferences"], setup["preferences"])

    def test_rejected_import_and_stale_preview_cannot_change_state(self):
        before = deepcopy(self.call("projection")["projection"])
        imported = self.imported("R|F1|Unsafe|{CAT1:FA123;}")
        self.assertFalse(imported["canSave"])
        with self.assertRaises(HostError) as error:
            self.mutate("contest_message_bank_save", bank=imported["bank"])
        self.assertEqual(error.exception.code, "invalid_request")
        self.assertEqual(self.call("contest_message_banks")["banks"], [])
        with self.assertRaises(HostError) as error:
            self.call("contest_message_preview", {"template": "{CALL}", "expectedRevision": self.revision - 1})
        self.assertEqual(error.exception.code, "stale_revision")
        after = self.call("projection")["projection"]
        self.assertEqual(after["fields"], before["fields"])
        self.assertEqual(after["reservedSerial"], before["reservedSerial"])
        self.assertEqual(self.call("log")["total"], 0)

    def test_new_session_bank_activation_without_setup_save_uses_canonical_defaults(self):
        # A real newly created session has no persisted setup override yet.
        self.session, self.revision = uid(), 0
        self.call("session_create", {"operationID": uid(), "pluginID": "cq_wpx_cw",
            "station": {"Call": "OM0RX", "CQZone": "15", "GridSquare": "JN88"},
            "frequencyHz": 14025000, "settings": {"SentExchange": "", "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL", "PowerCategory": "LOW"},
            "reference": {"id": "new-disposable-cty", "countries": {"OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"}}}})
        self.assertNotIn("setup", self.host.database(self.session).state(self.session))
        before = self.call("projection")["projection"]
        defaults = self.call("setup_get")["setup"]
        imported = self.imported()
        saved = self.mutate("contest_message_bank_save", bank=imported["bank"])
        self.assertNotIn("setup", self.host.database(self.session).state(self.session))
        operation = {"operationID": uid(), "bankID": saved["waveResult"]["banks"][0]["id"]}
        with patch.object(Desk, "process_function_key", side_effect=AssertionError("activation emitted output")):
            activated = self.call("contest_message_bank_activate", operation)
        self.assertEqual(activated["actions"], [])
        self.assertEqual(activated["setup"], {**defaults, "macros": imported["bank"]["macros"]})
        for name in ("draftID", "fields", "reservedSerial", "frequencyHz", "mode", "run"):
            self.assertEqual(activated["projection"][name], before[name], name)
        self.assertEqual(self.call("log")["total"], 0)
        self.host.close()
        self.host = Host(self.root)
        reopened = self.call("setup_get")["setup"]
        self.assertEqual(reopened, activated["setup"])
        replayed = self.call("contest_message_bank_activate", {**operation, "expectedRevision": saved["revision"]})
        self.assertTrue(replayed["replayed"])
        self.assertEqual(replayed["actions"], [])


if __name__ == "__main__":
    unittest.main()
