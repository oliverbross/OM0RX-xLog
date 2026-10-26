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
                ("hadx", 5, 1, 5, 10), ("pacc", 1, 1, 1, 2), ("rsgb_iota", 15, 1, 15, 30),
                ("es_open", 2, 0, 0, 2), ("cqws", 7, 1, 7, 21)):
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

    def test_ref_departments_domestic_countries_and_overseas_are_distinct(self):
        for plugin in ("ref_cw", "ref_ssb"):
            seed = deepcopy(self.seeds[plugin])
            countries = seed["state"]["reference"]["countries"]
            countries["F6REF"] = dict(entity="France", continent="EU", cq=14, itu=27, primary_pfx="F")
            countries["FY1ABC"] = dict(entity="French Guiana", continent="SA", cq=9, itu=12, primary_pfx="FY")
            seed["state"]["station"] = {"Call": "F6REF", "GridSquare": "JN18"}
            seed["state"]["settings"]["SentExchange"] = "75"
            self.create(plugin, seed)
            ids = []
            for minute, call, exchange in ((0, "F1AAA", "33"), (1, "K1ABC", "101"), (2, "FY1ABC", "FY")):
                qso = str(uuid.uuid4())
                ids.append(qso)
                self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-21 10:0{minute}:00",
                            fields={"callsign": call, "other_2": exchange})
            score = self.read("score")["score"]
            # 6 metropolitan + 2 non-French DX + 15 overseas French points;
            # department33, prefixFY and domestic-entrant countryK are 3 mults.
            self.assertEqual((score["points"], score["multipliers"], score["total"]), (23, 3, 69), plugin)
            self.mutate("qso_correct", qsoID=ids[0], fields={"other_2": "34"})
            self.assertEqual(self.read("score")["score"]["total"], 69)
            self.mutate("qso_delete", qsoID=ids[2])
            score = self.read("score")["score"]
            self.assertEqual((score["points"], score["multipliers"], score["total"]), (8, 2, 16), plugin)

    def test_es_open_region_zero_own_region_band_mode_and_entrant_eligibility(self):
        seed = deepcopy(self.seeds["es_open"])
        countries = seed["state"]["reference"]["countries"]
        for call in ("ES1AAA", "ES0AAA"):
            countries[call] = dict(entity="Estonia", continent="EU", cq=15, itu=29, primary_pfx="ES")
        countries["UA1AAA"] = dict(entity="European Russia", continent="EU", cq=16, itu=29, primary_pfx="UA")
        countries["EU1AAA"] = dict(entity="Belarus", continent="EU", cq=16, itu=29, primary_pfx="EU")
        seed["state"]["settings"]["ModeCategory"] = "MIXED"
        _, projection = self.create("es_open", seed)
        self.assertEqual(projection["supportedBands"], ["80m", "40m"])
        ids = []
        for minute, call in enumerate(("ES1AAA", "ES0AAA", "ES1AAA", "UA1AAA", "EU1AAA")):
            qso = str(uuid.uuid4())
            ids.append(qso)
            self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-21 10:0{minute}:00",
                        fields={"callsign": call, "other_2": "101"})
        score = self.read("score")["score"]
        # Own ES1 region and ES0 both count; duplicate/Russia/Belarus do not.
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (4, 2, 8))
        self.mutate("draft_apply", mode="SSB")
        self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp="2026-10-21 10:05:00",
                    fields={"callsign": "ES1AAA", "other_2": "102"})
        self.mutate("draft_apply", frequencyHz=3525000, mode="CW")
        self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp="2026-10-21 10:06:00",
                    fields={"callsign": "ES1AAA", "other_2": "103"})
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (7, 4, 28))
        with self.assertRaises(HostError):
            self.mutate("draft_apply", frequencyHz=14025000)
        self.mutate("qso_delete", qsoID=ids[1])
        self.assertEqual(self.read("score")["score"]["total"], 15)
        seed["state"]["station"] = {"Call": "K1ABC", "GridSquare": "FN31"}
        self.create("es_open", seed)
        for minute, call in enumerate(("DL1ABC", "ES0AAA")):
            self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp=f"2026-10-21 10:0{minute}:00",
                        fields={"callsign": call, "other_2": "101"})
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (2, 1, 2))

    def test_cqws_categories_country_scope_and_truthful_unknown_brazilian_units(self):
        seed = deepcopy(self.seeds["cqws"])
        countries = seed["state"]["reference"]["countries"]
        for call in ("K2AAA", "K3AAA", "K4AAA"):
            countries[call] = deepcopy(countries["K1ABC"])
        for call in ("PY1AAA", "PY2AAA"):
            countries[call] = dict(entity="Brazil", continent="SA", cq=11, itu=15, primary_pfx="PY")
        self.create("cqws", seed)
        ids = []
        for minute, (call, exchange) in enumerate((
                ("K1ABC", "FD"), ("DL1ABC", "YL"), ("K2AAA", "QRP"),
                ("K3AAA", "TEEN"), ("K4AAA", "ROOKIE"), ("PY1AAA", "SP"))):
            qso = str(uuid.uuid4())
            ids.append(qso)
            self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-21 10:0{minute}:00",
                        fields={"callsign": call, "other_2": exchange})
        score = self.read("score")["score"]
        rows = {row["Call"]: row for row in self.read("log")["rows"]}
        self.assertEqual({call: rows[call]["Points"] for call in
                          ("K1ABC", "DL1ABC", "K2AAA", "K3AAA", "K4AAA", "PY1AAA")},
                         {"K1ABC": 7, "DL1ABC": 3, "K2AAA": 3, "K3AAA": 7, "K4AAA": 7, "PY1AAA": 1})
        self.assertEqual((score["points"], score["countries"], score["exchangeBandMultipliers"], score["total"]),
                         (28, 3, 1, 112))
        self.assertTrue(score["scoringComplete"])
        unknown = str(uuid.uuid4())
        self.mutate("qso_commit", qsoID=unknown, timestamp="2026-10-21 10:06:00",
                    fields={"callsign": "PY2AAA", "other_2": "FD"})
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (35, 4, 140))
        self.assertFalse(score["scoringComplete"])
        self.assertIn("lower bound", score["scoringLimitations"][0])
        with self.assertRaises(HostError) as rejected:
            self.read("rtc_payload", workspaceGeneration=self.read("projection")["projection"]["workspaceGeneration"])
        self.assertEqual(rejected.exception.code, "scoring_incomplete")
        self.assertIn("SOAPBOX: Known score (partial):", self.read("export")["content"])
        self.host.close()
        self.host = Host(self.root)
        self.mutate("recalculate")
        self.assertEqual(self.read("score")["score"], score)
        self.mutate("qso_delete", qsoID=unknown)
        self.assertTrue(self.read("score")["score"]["scoringComplete"])
        self.assertNotIn("SOAPBOX: Known score (partial):", self.read("export")["content"])
        self.mutate("draft_apply", frequencyHz=14200000)
        for minute, call, exchange in ((7, "K1ABC", "FD"), (8, "PY1AAA", "SP")):
            self.mutate("qso_commit", qsoID=str(uuid.uuid4()), timestamp=f"2026-10-21 10:0{minute}:00",
                        fields={"callsign": call, "other_2": exchange})
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["countries"], score["exchangeBandMultipliers"], score["total"]),
                         (36, 3, 2, 180))
        self.mutate("qso_correct", qsoID=ids[3], fields={"other_2": "SP"})
        score = self.read("score")["score"]
        # A non-Brazilian station sending a UF-shaped exchange earns no UF.
        self.assertEqual((score["points"], score["countries"], score["exchangeBandMultipliers"], score["total"]),
                         (30, 3, 2, 150))


if __name__ == "__main__":
    unittest.main()
