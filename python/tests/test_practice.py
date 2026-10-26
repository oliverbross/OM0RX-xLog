import unittest
from copy import deepcopy
from contest_host.practice import practice_creation, enforce_practice_setup, is_practice


class PracticePayloadTests(unittest.TestCase):
    def test_copy_retains_policy_but_excludes_live_authority(self):
        source = {"sessionID": "real", "revision": 42, "name": "WPX", "operator": "OM0RX", "pluginID": "cq_wpx_cw",
                  "station": {"Call": "OM0RX"}, "settings": {"SentExchange": "#"},
                  "reference": {"id": "historical-cty", "countries": {}}, "scoringRevision": None,
                  "draft": {"id": "real-draft", "frequencyHz": 14025000, "serial": 87},
                  "lease": {"id": "live"}, "contacts": [{"ID": "real-contact"}]}
        source["setup"] = {**{key: deepcopy(source[key]) for key in ("name", "operator", "pluginID", "station", "settings")},
                           "preferences": {"rtcEnabled": True, "autoCQ": True, "rtcUsername": "private", "cwSpeed": 28},
                           "network": {"n1mmEnabled": True, "multiEnabled": True}, "macros": [{"template": "{CALL}"}]}
        before = deepcopy(source)
        params, setup, metadata, scoring = practice_creation(source, {"sessionID": "new", "workspaceGeneration": "new-workspace", "operationID": "op", "expectedRevision": 0})
        self.assertEqual(source, before)
        self.assertEqual(params["reference"], source["reference"])
        self.assertIsNone(scoring)
        self.assertEqual(params["sessionID"], "new")
        self.assertTrue(metadata["nativeOutputDisabled"])
        self.assertTrue(metadata["publicPostingDisabled"])
        self.assertEqual(metadata["sourceRevision"], 42)
        self.assertFalse({"draft", "lease", "contacts", "serial"} & set(params))
        self.assertFalse(any(setup["network"].values()))
        self.assertEqual(setup["preferences"], {"cwSpeed": 28, "rtcEnabled": False, "autoCQ": False})
        params["reference"]["id"] = "changed"
        self.assertEqual(source["reference"]["id"], "historical-cty")

    def test_setup_cannot_reenable_practice_outputs(self):
        setup = {"name": "Renamed", "operator": "OM0RX", "pluginID": "cq_ww_cw", "station": {}, "settings": {},
                 "preferences": {"rtcEnabled": True, "autoCQ": True}, "network": {"n1mmEnabled": True}, "macros": []}
        self.assertFalse(is_practice({"setup": {"preferences": {"practice": True}}}))
        safe = enforce_practice_setup({"practice": {}}, setup)
        self.assertFalse(safe["preferences"]["rtcEnabled"])
        self.assertFalse(safe["network"]["n1mmEnabled"])
        self.assertIs(enforce_practice_setup({}, setup), setup)


if __name__ == "__main__":
    unittest.main()
