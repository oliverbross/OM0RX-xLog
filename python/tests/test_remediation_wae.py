"""Pinned DARC Japanese-area oracle and explicit legacy scoring adoption."""
from copy import deepcopy
import unittest
from contest_host.host import Host, HostError, coordination_identity
from contest_host import wae
import test_host as fixtures


class WAEAreaTests(unittest.TestCase):
    setUp = fixtures.HostTests.setUp
    tearDown = fixtures.HostTests.tearDown
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read

    def create_wae(self, plugin):
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0
        config = deepcopy(self.create)
        config.update(sessionID=self.session, workspaceGeneration=self.workspace, operationID=fixtures.uid(),
                      pluginID=plugin, mode=plugin[4:].upper())
        config["settings"]["SentExchange"] = "#"
        for call in ["JR4AAA", "7K4ABC", "7M4XYZ", "7K4ABC/9"]:
            config["reference"]["countries"][call] = {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"}
        return self.call("session_create", config)

    def populate(self):
        ids = []
        for minute, call in enumerate(["JR4AAA", "7K4ABC", "7M4XYZ"]):
            qso = fixtures.uid(); ids.append(qso)
            self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-08-08 08:{minute:02}:00",
                        fields={"callsign": call, "other_2": str(minute + 1)})
        return ids

    def test_all_wae_modes_share_numerical_area_and_export_correct_claim(self):
        for plugin in ["wae_cw", "wae_ssb", "wae_rtty"]:
            with self.subTest(plugin=plugin):
                self.create_wae(plugin); ids = self.populate()
                score = self.read("projection")["projection"]["score"]
                self.assertTrue(score["scoringComplete"])
                self.assertEqual((score["points"], score["multipliers"], score["total"]), (3, 2, 6))
                self.assertIn("CLAIMED-SCORE: 6", self.read("export")["content"])
                self.mutate("qso_correct", qsoID=ids[1], fields={"callsign": "7K4ABC/9"})
                self.assertEqual(self.read("projection")["projection"]["score"]["total"], 12)
                self.mutate("qso_correct", qsoID=ids[1], fields={"callsign": "7K4ABC"})
                self.host.close(); self.host = Host(self.root)
                self.assertEqual(self.read("projection")["projection"]["score"]["total"], 6)

    def test_legacy_score_is_retained_incomplete_until_explicit_recalculate(self):
        self.create_wae("wae_cw"); self.populate()
        store = self.host.database(self.session); state = store.state(self.session)
        state["definitionVersion"] = "1.0.0"; store.save_state(state); store.conn.commit()
        prior_digest = coordination_identity(state)
        contacts = store.exec_sql_mult("SELECT ID,Call,TS FROM DXLOG ORDER BY ID")
        draft = deepcopy(state["draft"])
        self.host.close(); self.host = Host(self.root)
        score = self.read("projection")["projection"]["score"]
        self.assertEqual(score["total"], 12)
        self.assertFalse(score["scoringComplete"])
        self.assertIn("Recalculate", score["scoringLimitation"])
        self.assertEqual(self.host.database(self.session).state(self.session)["definitionVersion"], "1.0.0")
        with self.assertRaises(HostError): self.read("export")
        self.assertGreater(self.read("export_prepare", format="adif")["byteLength"], 0)
        params = {"sessionID": self.session, "operationID": fixtures.uid(), "expectedRevision": self.revision}
        updated = self.call("recalculate", params)
        self.assertTrue(self.call("recalculate", params)["replayed"])
        score = updated["projection"]["score"]
        self.assertEqual(score["total"], 6); self.assertTrue(score["scoringComplete"])
        store = self.host.database(self.session); state = store.state(self.session)
        self.assertEqual(state["definitionVersion"], wae.DEFINITION_VERSION)
        self.assertNotEqual(coordination_identity(state), prior_digest, "Old scoring peers must not silently share authority")
        self.assertEqual(store.exec_sql_mult("SELECT ID,Call,TS FROM DXLOG ORDER BY ID"), contacts)
        self.assertEqual(state["draft"], draft)

    def test_national_prefix_digit_is_not_portable_area(self):
        state = {"reference": {"countries": {}}, "definitionVersion": wae.DEFINITION_VERSION}
        for call, expected in [("7K4ABC", "JA4"), ("7M4XYZ", "JA4"), ("7L1ABC", "JA1"), ("8J3ABC", "JA3"), ("JR4AAA", "JA4"), ("7K4ABC/9", "JA9")]:
            with self.subTest(call=call):
                self.assertEqual(wae.multiplier(state, {"Call": call, "CountryPrefix": "JA"}), expected)
