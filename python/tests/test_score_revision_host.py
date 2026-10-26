"""Organizer-verified arithmetic applies to new sessions; history stays pinned."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError, coordination_identity
from contest_host.upstream import pacc_multiplier_key


class ScoreRevisionHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.host = Host(self.root)
        self.seeds = json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def read(self, method, **params):
        return self.host.dispatch({"id": str(uuid.uuid4()), "method": method,
                                   "params": {"sessionID": self.session, **params}})

    def mutate(self, method, **params):
        response = self.read(method, operationID=str(uuid.uuid4()), expectedRevision=self.revision, **params)
        self.revision = response["revision"]
        return response

    def create(self, plugin, seed=None):
        seed = deepcopy(seed or self.seeds[plugin])
        self.session, self.revision = str(uuid.uuid4()), 0
        state = seed["state"]
        created = self.mutate("session_create", pluginID=plugin, workspaceGeneration=str(uuid.uuid4()),
                              station=state["station"], settings=state["settings"], reference=state["reference"],
                              frequencyHz=state["draft"]["frequencyHz"], mode=seed["mode"])
        return seed, created["projection"]

    def test_new_and_legacy_arithmetic_exports_and_restart_are_separate(self):
        for plugin, points, mults, new_total, old_total in (
                ("hadx", 5, 1, 5, 10), ("pacc", 1, 1, 1, 2), ("rsgb_iota", 15, 1, 15, 30)):
            with self.subTest(plugin=plugin):
                seed, projection = self.create(plugin)
                self.assertEqual(projection["ruleIdentity"]["version"], "26.10.26")
                self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp="2026-10-21 10:00:00",
                            fields=seed["fields"])
                score = self.read("score")["score"]
                self.assertEqual((score["points"], score["multipliers"], score["total"]), (points, mults, new_total))
                self.assertIn(f"CLAIMED-SCORE: {new_total}\r\n", self.read("export")["content"])
                store = self.host.database(self.session)
                state = store.state(self.session)
                corrected_identity = coordination_identity(state)
                # Model a pre-fix store exclusively inside this disposable root.
                state.pop("scoringRevision")
                store.conn.execute("UPDATE xlog_session SET state=? WHERE id=?", (json.dumps(state), self.session))
                store.conn.commit()
                self.assertNotEqual(coordination_identity(state), corrected_identity)
                self.host.close()
                self.host = Host(self.root)
                self.assertEqual(self.read("session_open")["projection"]["ruleIdentity"]["version"], "26.10.11")
                self.assertEqual(self.read("score")["score"]["total"], old_total)
                self.mutate("recalculate")
                self.assertEqual(self.read("score")["score"]["total"], old_total)
                self.assertIn(f"CLAIMED-SCORE: {old_total}\r\n", self.read("export")["content"])

    def test_pacc_dutch_country_call_area_band_and_mode_scope(self):
        seed = deepcopy(self.seeds["pacc"])
        countries = seed["state"]["reference"]["countries"]
        countries["PA0ABC"] = {"entity": "Netherlands", "continent": "EU", "cq": 14, "itu": 27, "primary_pfx": "PA"}
        for call in ("K2ABC", "K1ZZZ"):
            countries[call] = deepcopy(countries["K1ABC"])
        seed["state"]["station"] = {"Call": "PA0ABC", "GridSquare": "JO22"}
        seed["state"]["settings"].update(SentExchange="ZH", ModeCategory="MIXED")
        self.create("pacc", seed)
        for minute, call in enumerate(("K1ABC", "K2ABC", "K1ZZZ")):
            self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp=f"2026-10-21 10:0{minute}:00",
                        fields={"callsign": call, "other_2": "101"})
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (3, 2, 6))
        self.mutate("draft_apply", mode="SSB")
        self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp="2026-10-21 10:03:00",
                    fields={"callsign": "K1ABC", "other_2": "102"})
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (4, 3, 12))

    def test_pacc_reciprocal_zero_area_and_canadian_equivalents(self):
        for country, prefix, expected in (("LU", "LU0", "LU0"), ("UA9", "RA8", "UA8"),
                                           ("VE", "CG2", "VE2"), ("VE", "VE2", "VE2"),
                                           ("VE", "VO1", "VO1"), ("VE", "VY2", "VY2"),
                                           ("DL", "DL1", "DL"), ("", "", "")):
            self.assertEqual(pacc_multiplier_key({"CountryPrefix": country, "WPXPrefix": prefix}), expected)


if __name__ == "__main__":
    unittest.main()
