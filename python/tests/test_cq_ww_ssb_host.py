"""Original source-pinned CQ WW SSB plugin through the production host."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from contest_host.host import Desk, Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class CQWWSSBHostTests(unittest.TestCase):
    source_hash = "9ec3762986761232042389f0334b4887271772d18025f3dd0fdc820782105b3b"

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": "cq_ww_ssb",
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"},
            "frequencyHz": 14250000,
            "settings": {
                "SentExchange": "15",
                "ModeCategory": "SSB",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": {
                **deepcopy(fixtures.CTY),
                "OM0A": {"entity": "Slovak Republic", "continent": "EU", "cq": 15,
                         "itu": 28, "primary_pfx": "OM"},
                "LZ9W": {"entity": "Bulgaria", "continent": "EU", "cq": 20,
                          "itu": 28, "primary_pfx": "LZ"},
                "ED5D": {"entity": "Spain", "continent": "EU", "cq": 14,
                          "itu": 37, "primary_pfx": "EA"},
                "OE8DDX": {"entity": "Austria", "continent": "EU", "cq": 15,
                            "itu": 28, "primary_pfx": "*4U1V"},
            }},
        }
        self.call("session_create", self.create)

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def mutate(self, method, **kwargs):
        return self.call(method, {
            "sessionID": self.session,
            "operationID": uid(),
            "expectedRevision": self.revision,
            **kwargs,
        })

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def assert_voice(self, action, key, payload, macro_mode):
        self.assertEqual((action["kind"], action["signal"], action["mode"]),
                         ("voice_keyer", "phone", "SSB"))
        self.assertEqual((action["key"], action["payload"]), (key, payload))
        self.assertEqual(action["payloadUTF8Bytes"], len(payload.encode("utf-8")))
        self.assertEqual(action["payloadSHA256"], sha256(payload.encode("utf-8")).hexdigest())
        source = action["sourceMacro"]
        self.assertEqual((source["origin"], source["path"], source["revision"],
                          source["mode"], source["key"]),
                         ("pinned_not1mm", "not1mm/data/cwmacros.txt",
                          "7c8b499225a73f7f8f792246881bd7aefc05452f", macro_mode, key))
        encoded = json.dumps(source, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        self.assertEqual(action["sourceMacroSHA256"], sha256(encoded).hexdigest())
        self.assertNotEqual(action["kind"], "function_key")
        self.assertNotIn("cw", action)
        self.assertNotIn("audio", action)
        self.assertNotIn("ptt", action)

    def log(self, call="K1ABC", zone="5", minute=0, frequency=14250000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 08:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": zone},
        )
        return qso

    def test_original_source_catalog_layout_reports_and_zone_validation(self):
        source = VENDOR / "not1mm/plugins/cq_ww_ssb.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin("cq_ww_ssb").__file__, str(source))
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == "cq_ww_ssb")
        self.assertEqual((item["name"], item["modes"], item["sentExchangeHint"]),
                         ("CQ WW SSB", ["SSB"], "CQ Zone No."))
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["mode"], view["supportedModes"]), ("SSB", ["SSB"]))
        self.assertEqual(view["columns"], [
            "YYYY-MM-DD HH:MM:SS", "Call", "Freq", "Snt", "Rcv",
            "M1", "ZN", "M2", "PFX", "PTS",
        ])
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), ("59", "59"))
        self.assertEqual((fields["other_1"]["value"], fields["other_1"]["visible"]), ("15", False))
        self.assertEqual((fields["other_2"]["label"], view["nextField"]), ("CQ Zone", "other_2"))
        for zone in ("", "0", "41", " 5"):
            with self.subTest(zone=zone), self.assertRaisesRegex(HostError, "CQ zone must be 1 to 40"):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": zone})
        setup = self.read("setup_get")["setup"]
        setup["station"]["CQZone"] = "41"
        with self.assertRaisesRegex(HostError, "Station CQ zone must be 1 to 40"):
            self.mutate("setup_save", setup=setup)
        setup["station"]["CQZone"] = "15"
        setup["settings"].update(SentExchange="41", ModeCategory="CW")
        with self.assertRaisesRegex(HostError, "requires SSB"):
            self.mutate("setup_save", setup=setup)

    def test_callsign_reference_prefills_received_zone_and_operator_can_override_it(self):
        resolved = self.mutate("draft_apply", fields={"callsign": "OM0A", "other_2": ""})["projection"]
        resolved_fields = {field["id"]: field["value"] for field in resolved["fields"]}
        self.assertEqual(resolved_fields["other_2"], "15")

        overridden = self.mutate("draft_apply", fields={"other_2": "14"})["projection"]
        overridden_fields = {field["id"]: field["value"] for field in overridden["fields"]}
        self.assertEqual(overridden_fields["other_2"], "14")

        changed_call = self.mutate("draft_apply", fields={"callsign": "LZ9W", "other_2": "14"})["projection"]
        changed_fields = {field["id"]: field["value"] for field in changed_call["fields"]}
        self.assertEqual(changed_fields["other_2"], "20")

    def test_pinned_reference_disagreement_does_not_hide_an_authoritative_band_dupe(self):
        self.log("ED5D", "14", frequency=7145000)
        changed = self.mutate(
            "draft_apply", frequencyHz=7097200,
            fields={"callsign": "ED5D", "other_2": "14"},
            referenceID="test-cty-v1",
            countries={"ED5D": {"entity": "Resolver changed Spain", "continent": "EU", "cq": 14,
                                  "itu": 37, "primary_pfx": "EA"}},
        )["projection"]
        self.assertTrue(changed["dupe"])
        self.assertEqual(changed["callContext"]["country"], "Spain")
        preview = self.read(
            "spot_points_preview", workspaceGeneration=self.workspace, expectedRevision=self.revision,
            referenceID="test-cty-v1",
            countries={"ED5D": {"entity": "Another resolver value", "continent": "EU", "cq": 14,
                                  "itu": 37, "primary_pfx": "EA"}},
            spots=[{"spotID": "ed5d", "callsign": "ED5D", "frequencyHz": 7097200, "mode": "SSB"}],
        )
        self.assertTrue(preview["spots"][0]["dupe"])

    def test_same_endpoint_primary_prefix_correction_repairs_future_contacts(self):
        corrected = {"OE8DDX": {"entity": "AUSTRIA", "continent": "EU", "cq": 15,
                                 "itu": 28, "primary_pfx": "OE"}}
        self.mutate("draft_apply", fields={"callsign": "OE8DDX", "other_2": "15"},
                    referenceID="test-cty-v1", countries=corrected)
        self.log("OE8DDX", "15", frequency=7110000)
        row = self.read("log", offset=0, limit=1)["rows"][0]
        self.assertEqual(row["CountryPrefix"], "OE")

    def test_same_endpoint_country_reconcile_repairs_existing_scoring_identity(self):
        qso = self.log("OE8DDX", "15", frequency=7110000)
        self.assertEqual(self.read("log", offset=0, limit=1)["rows"][0]["CountryPrefix"], "*4U1V")
        retained = self.log("K1ABC", "5", minute=1, frequency=7112000)
        corrected = {"entity": "AUSTRIA", "continent": "EU", "cq": 15,
                     "itu": 28, "primary_pfx": "OE"}
        repaired = self.mutate(
            "country_reconcile", workspaceGeneration=self.workspace, referenceID="test-cty-v1",
            repairs=[{"qsoID": qso, "callsign": "OE8DDX", "country": corrected},
                     {"qsoID": retained, "callsign": "K1ABC",
                      "country": {"entity": "GERMANY", "continent": "EU", "cq": 14,
                                  "itu": 28, "primary_pfx": "DL"}}],
        )
        self.assertEqual(repaired["revision"], 4)
        row = self.read("log", offset=0, limit=2)["rows"][1]
        self.assertEqual(row["CountryPrefix"], "OE")
        matrices = self.read("score")["matrices"]
        self.assertEqual({item["value"] for item in matrices["countries"]}, {"K", "OE"})
        store = self.host.database(self.session)
        identity = store.exec_sql("SELECT country FROM xlog_qso_identity WHERE id=?", (qso,))
        self.assertEqual(json.loads(identity["country"])["primary_pfx"], "OE")
        retained_identity = store.exec_sql("SELECT country FROM xlog_qso_identity WHERE id=?", (retained,))
        self.assertEqual(json.loads(retained_identity["country"])["primary_pfx"], "K")
        audit = store.exec_sql(
            "SELECT kind,reason FROM xlog_qso_audit WHERE qso_id=? ORDER BY sequence DESC LIMIT 1", (qso,))
        self.assertEqual((audit["kind"], audit["reason"]),
                         ("reference_reconcile", "Bundled CTY primary-prefix correction"))

    def test_observed_vfo_change_clears_departed_call_and_loads_nearby_spot(self):
        setup = self.read("setup_get")["setup"]
        setup["preferences"]["clearOnVFOChange"] = False
        self.mutate("setup_save", setup=setup)
        self.mutate("draft_apply", fields={"callsign": "OM0A", "other_2": "15"})

        tuned = self.mutate(
            "draft_apply", frequencyHz=7125000, observedVFOChange=True,
            observedSpotCallsign="LZ9W", fields={"callsign": "OM0A", "other_2": "15"},
        )["projection"]
        tuned_fields = {field["id"]: field["value"] for field in tuned["fields"]}
        self.assertEqual((tuned_fields["callsign"], tuned_fields["other_2"]), ("LZ9W", "20"))

        departed = self.mutate(
            "draft_apply", frequencyHz=7127000, observedVFOChange=True,
            fields={"callsign": "LZ9W", "other_2": "20"},
        )["projection"]
        departed_fields = {field["id"]: field["value"] for field in departed["fields"]}
        self.assertEqual((departed_fields["callsign"], departed_fields["other_2"]), ("", ""))

    def test_original_scoring_country_zone_multipliers_and_band_dupes(self):
        self.log()
        self.log("DL1ABC", "14", 1)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 2, "points": 4, "countries": 2, "zones": 2,
            "multipliers": 4, "total": 16,
        })
        self.log(minute=2)
        self.assertEqual(self.read("score")["score"]["points"], 4)
        self.log(minute=3, frequency=7125000)
        score = self.read("score")
        self.assertEqual(score["score"], {
            "qsos": 4, "points": 7, "countries": 3, "zones": 3,
            "multipliers": 6, "total": 42,
        })
        self.assertEqual(len(score["matrices"]["countries"]), 3)
        self.assertEqual(len(score["matrices"]["zones"]), 3)
        rows = list(reversed(self.read("log")["rows"]))
        self.assertEqual([(row["Call"], row["Band"], row["IsMultiplier1"], row["IsMultiplier2"], row["is_dupe"]) for row in rows], [
            ("K1ABC", 14, 1, 1, 0), ("DL1ABC", 14, 1, 1, 0),
            ("K1ABC", 14, 0, 0, 1), ("K1ABC", 7, 1, 1, 0),
        ])
        partial = self.read("check_partial", query="K1ABC")["rows"]
        self.assertEqual([(row["Band"], row["is_dupe"]) for row in partial], [
            (14, 0), (14, 1), (7, 0),
        ])

    def test_cq_ww_multiplier_slots_are_zone_then_country_for_asymmetric_contacts(self):
        first = self.log("OM1ABC", "15")
        zone_only = self.log("OM0RX", "14", minute=1)
        statistics = self.read("score")["statistics"]["rows"][0]
        self.assertEqual((statistics["countries"], statistics["zones"]), (1, 2))
        country_only = self.log("DL1ABC", "14", minute=2)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual([(rows[qso]["IsMultiplier1"], rows[qso]["IsMultiplier2"])
                          for qso in (first, zone_only, country_only)], [
            (1, 1), (1, 0), (0, 1),
        ])

    def test_single_band_score_filters_points_multipliers_and_statistics_but_exports_all_qsos(self):
        setup = self.read("setup_get")["setup"]
        setup["settings"].update(BandCategory="40M", AssistedCategory="ASSISTED",
                                 TransmitterCategory="ONE")
        self.mutate("setup_save", setup=setup)
        on_band = self.log(frequency=7125000)
        off_band = self.log("DL1ABC", "14", minute=1, frequency=14250000)

        scored = self.read("score")
        self.assertEqual(scored["score"], {
            "qsos": 1, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(scored["matrices"], {
            "countries": [{"value": "K", "band": 7.0, "qsos": 1}],
            "zones": [{"value": 5, "band": 7.0, "qsos": 1}],
        })
        self.assertEqual(scored["statistics"]["total"]["qsos"], 1)

        self.mutate("qso_correct", qsoID=off_band, frequencyHz=7126000,
                    fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Move to 40m")
        self.assertEqual(self.read("score")["score"]["total"], 16)
        self.mutate("qso_correct", qsoID=off_band, frequencyHz=14250000,
                    fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Restore 20m")

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        export = self.read("export")["content"]
        self.assertIn("CATEGORY-BAND: 40M\r\n", export)
        self.assertIn("CATEGORY-OPERATOR: SINGLE-OP\r\n", export)
        self.assertIn("CATEGORY-ASSISTED: ASSISTED\r\n", export)
        self.assertIn("CATEGORY-POWER: LOW\r\n", export)
        self.assertIn("CATEGORY-MODE: SSB\r\n", export)
        self.assertIn("CATEGORY-TRANSMITTER: ONE\r\n", export)
        self.assertIn("CLAIMED-SCORE: 6\r\n", export)
        self.assertEqual(sum(line.startswith("QSO:") for line in export.splitlines()), 2)

    def test_spot_points_preview_is_scoped_read_only_and_uses_original_cq_ww_points(self):
        before = self.read("projection")["projection"]
        preview = self.read("spot_points_preview", workspaceGeneration=self.workspace,
                            expectedRevision=self.revision, spots=[
            {"spotID": "same-country", "callsign": "OM1ABC", "frequencyHz": 7125000, "mode": "SSB"},
            {"spotID": "same-continent", "callsign": "DL1ABC", "frequencyHz": 7126000, "mode": "SSB"},
            {"spotID": "different-continent", "callsign": "K1ABC", "frequencyHz": 7127000, "mode": "SSB"},
            {"spotID": "unresolved", "callsign": "XX1TEST", "frequencyHz": 7128000, "mode": "SSB"},
        ])
        self.assertEqual(preview, {
            "sessionID": self.session, "workspaceGeneration": self.workspace, "revision": self.revision,
            "spots": [
                {"spotID": "same-country", "points": 0, "dupe": False, "multiplierCount": 2,
                 "countryMultiplier": True, "zoneMultiplier": True, "reason": None},
                {"spotID": "same-continent", "points": 1, "dupe": False, "multiplierCount": 2,
                 "countryMultiplier": True, "zoneMultiplier": True, "reason": None},
                {"spotID": "different-continent", "points": 3, "dupe": False, "multiplierCount": 2,
                 "countryMultiplier": True, "zoneMultiplier": True, "reason": None},
                {"spotID": "unresolved", "points": None, "dupe": None, "multiplierCount": None,
                 "countryMultiplier": None, "zoneMultiplier": None, "reason": "unresolved_callsign"},
            ],
        })
        injected = self.read("spot_points_preview", workspaceGeneration=self.workspace,
                             expectedRevision=self.revision, referenceID="test-cty-v1",
                             countries={"XX1TEST": deepcopy(fixtures.CTY["K1ABC"])}, spots=[
            {"spotID": "native-reference", "callsign": "XX1TEST", "frequencyHz": 7128000, "mode": "SSB"},
        ])
        self.assertEqual(injected["spots"], [
            {"spotID": "native-reference", "points": 3, "dupe": False, "multiplierCount": 2,
             "countryMultiplier": True, "zoneMultiplier": True, "reason": None},
        ])
        self.assertIsNone(self.read("spot_points_preview", workspaceGeneration=self.workspace,
                                   expectedRevision=self.revision, spots=[
            {"spotID": "still-unresolved", "callsign": "XX1TEST", "frequencyHz": 7128000, "mode": "SSB"},
        ])["spots"][0]["points"])
        after = self.read("projection")["projection"]
        self.assertEqual((after["revision"], after["draftID"], after["fields"]),
                         (before["revision"], before["draftID"], before["fields"]))
        with self.assertRaisesRegex(HostError, "workspace changed"):
            self.read("spot_points_preview", workspaceGeneration=uid(), expectedRevision=self.revision, spots=[])
        with self.assertRaisesRegex(HostError, "Contest changed"):
            self.read("spot_points_preview", workspaceGeneration=self.workspace,
                      expectedRevision=self.revision + 1, spots=[])

    def test_spot_preview_reports_authoritative_dupes_and_needed_multipliers(self):
        self.log("K1ABC", "5", frequency=7125000)
        countries = {
            "K2XYZ": {**deepcopy(fixtures.CTY["K1ABC"]), "cq": 4},
            "K3XYZ": deepcopy(fixtures.CTY["K1ABC"]),
        }
        preview = self.read("spot_points_preview", workspaceGeneration=self.workspace,
                            expectedRevision=self.revision, referenceID="test-cty-v1", countries=countries, spots=[
            {"spotID": "dupe", "callsign": "K1ABC", "frequencyHz": 7125000, "mode": "SSB"},
            {"spotID": "qso-only", "callsign": "K3XYZ", "frequencyHz": 7126000, "mode": "SSB"},
            {"spotID": "single-mult", "callsign": "K2XYZ", "frequencyHz": 7127000, "mode": "SSB"},
            {"spotID": "double-mult", "callsign": "OM1ABC", "frequencyHz": 7128000, "mode": "SSB"},
        ])
        self.assertEqual([(row["spotID"], row["dupe"], row["multiplierCount"],
                           row["countryMultiplier"], row["zoneMultiplier"]) for row in preview["spots"]], [
            ("dupe", True, 0, False, False), ("qso-only", False, 0, False, False),
            ("single-mult", False, 1, False, True), ("double-mult", False, 2, True, True),
        ])

    def test_spot_preview_country_reads_are_isolated_and_next_revision_rechecks_dupes(self):
        store = self.host.database(self.session)
        before = store.state(self.session)
        original_lookup = Desk.cty_lookup
        lookup_count = 0

        def mutating_lookup(desk, call):
            nonlocal lookup_count
            result = original_lookup(desk, call)
            if result:
                country = next(iter(result.values()))
                self.assertNotIn("preview_only", country)
                country["preview_only"] = True
                lookup_count += 1
            return result

        spots = [{"spotID": str(index), "callsign": "K1ABC", "frequencyHz": 7125000, "mode": "SSB"}
                 for index in range(8)]
        with patch.object(Desk, "cty_lookup", mutating_lookup):
            preview = self.read("spot_points_preview", workspaceGeneration=self.workspace,
                                expectedRevision=self.revision, spots=spots)
        self.assertGreater(lookup_count, len(spots))
        self.assertTrue(all(not row["dupe"] and row["multiplierCount"] == 2 for row in preview["spots"]))
        self.assertEqual(store.state(self.session), before)
        self.assertEqual(self.read("log")["total"], 0)
        self.log("K1ABC", "5", frequency=7125000)
        updated = self.read("spot_points_preview", workspaceGeneration=self.workspace,
                            expectedRevision=self.revision, spots=spots)
        self.assertTrue(all(row["dupe"] and row["multiplierCount"] == 0 for row in updated["spots"]))

    def test_multiplier_lookup_index_repairs_existing_store_without_changing_scores(self):
        self.log("K1ABC", "5", frequency=7125000)
        self.log("K1ABC", "4", minute=1, frequency=7125000)
        self.log("DL1ABC", "14", minute=2, frequency=7125000)
        store = self.host.database(self.session)
        store.conn.execute("DROP INDEX xlog_dxlog_contest_call_band")
        store.conn.commit()
        before = self.read("score")
        self.host.close()
        self.host = Host(self.root)
        after = self.read("score")
        self.assertEqual(after, before)
        store = self.host.database(self.session)
        plan = store.exec_sql_mult("EXPLAIN QUERY PLAN SELECT 1 FROM DXLOG AS prior "
                                  "WHERE ContestNR=? AND Call=? AND Band=? AND rowid<?", (1, "K1ABC", 7, 3))
        self.assertTrue(any("xlog_dxlog_contest_call_band" in row["detail"] for row in plan))
        self.assertEqual(self.read("log")["total"], 3)

    def test_unresolved_contacts_do_not_create_cq_ww_multipliers(self):
        self.log("XX1TEST", "10")
        unresolved = self.read("score")
        self.assertEqual(unresolved["score"], {
            "qsos": 1, "points": 0, "countries": 0, "zones": 0,
            "multipliers": 0, "total": 0,
        })
        self.assertEqual(unresolved["matrices"], {"countries": [], "zones": []})

        self.log("K1ABC", "5", minute=1)
        resolved = self.read("score")
        self.assertEqual(resolved["score"], {
            "qsos": 2, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(resolved["matrices"]["countries"], [
            {"value": "K", "band": 14.0, "qsos": 1},
        ])
        self.assertEqual(resolved["matrices"]["zones"], [
            {"value": 5, "band": 14.0, "qsos": 1},
        ])

    def test_zone_mismatch_and_history_conflict_warn_without_rewriting_received_exchange(self):
        self.log("K1ABC", "5")
        changed = self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "9"})
        # The first new callsign gets its canonical prefill; an explicit operator
        # edit on that same call is retained and only produces advisory warnings.
        changed = self.mutate("draft_apply", fields={"other_2": "9"})
        projection = changed["projection"]
        self.assertEqual(next(field["value"] for field in projection["fields"] if field["id"] == "other_2"), "9")
        self.assertEqual({warning["kind"] for warning in projection["exchangeWarnings"]}, {"mismatch", "conflict"})
        self.assertTrue(all(warning["fieldID"] == "other_2" for warning in projection["exchangeWarnings"]))
        committed = self.log("K1ABC", "9", minute=1)
        revision = self.revision
        rows = self.read("log")["rows"]
        row = next(row for row in rows if row["ID"] == committed)
        self.assertEqual(row["ZN"], 9)
        self.assertEqual(row["raw_fields"]["other_2"], "9")
        self.assertEqual({warning["kind"] for warning in row["exchangeWarnings"]}, {"mismatch", "conflict"})
        partial = self.read("check_partial", query="K1ABC")["rows"]
        self.assertEqual(next(item for item in partial if item["ID"] == committed)["exchangeWarnings"], row["exchangeWarnings"])
        self.assertEqual(self.revision, revision)

    def test_valid_same_country_zero_point_qso_keeps_both_multipliers(self):
        self.log("OM1ABC", "15")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 1, "points": 0, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 0,
        })
        self.assertEqual(self.read("log")["rows"][0]["is_dupe"], 0)

    def test_same_band_duplicate_cannot_add_a_mistyped_zone_multiplier(self):
        first = self.log("K1ABC", "5", minute=1)
        duplicate = self.log("K1ABC", "4", minute=0)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual([(rows[qso]["IsMultiplier1"], rows[qso]["IsMultiplier2"])
                          for qso in (first, duplicate)], [(1, 1), (0, 0)])
        score = self.read("score")
        self.assertEqual(score["score"], {
            "qsos": 2, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(score["matrices"]["zones"], [
            {"value": 5, "band": 14.0, "qsos": 1},
        ])

        self.mutate("qso_correct", qsoID=duplicate,
                    fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Correct duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 16)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual([(rows[qso]["IsMultiplier1"], rows[qso]["IsMultiplier2"])
                          for qso in (first, duplicate)], [(1, 1), (1, 1)])
        self.mutate("qso_correct", qsoID=duplicate,
                    fields={"callsign": "K1ABC", "other_2": "4"}, reason="Restore duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.mutate("qso_delete", qsoID=first, reason="Promote retained duplicate")
        promoted = self.read("score")
        self.assertEqual(promoted["score"], {
            "qsos": 1, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(promoted["matrices"]["zones"], [
            {"value": 4, "band": 14.0, "qsos": 1},
        ])
        self.assertEqual((self.read("log")["rows"][0]["IsMultiplier1"],
                          self.read("log")["rows"][0]["IsMultiplier2"]), (1, 1))

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        self.assertEqual((self.read("log")["rows"][0]["IsMultiplier1"],
                          self.read("log")["rows"][0]["IsMultiplier2"]), (1, 1))
        export = self.read("export")["content"]
        self.assertIn("CLAIMED-SCORE: 6\r\n", export)
        self.assertEqual(sum(line.startswith("QSO:") for line in export.splitlines()), 1)

    def test_unresolved_correction_transitions_rebuild_delete_restart_and_export(self):
        unresolved = self.log("XX1TEST", "10")
        self.mutate("qso_correct", qsoID=unresolved,
                    fields={"callsign": "K1ABC", "other_2": "5"}, reason="Resolve call")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.mutate("qso_correct", qsoID=unresolved,
                    fields={"callsign": "XX1TEST", "other_2": "10"}, reason="Restore unresolved call")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 1, "points": 0, "countries": 0, "zones": 0,
            "multipliers": 0, "total": 0,
        })

        own_country = self.log("OM1ABC", "15", minute=1)
        self.log("K1ABC", "5", minute=2)
        self.assertEqual(self.read("score")["score"]["total"], 12)
        self.mutate("qso_delete", qsoID=own_country, reason="Audit deletion")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 2, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        export = self.read("export")["content"]
        self.assertIn("CLAIMED-SCORE: 6\r\n", export)
        self.assertEqual(sum(line.startswith("QSO:") for line in export.splitlines()), 2)

    def test_ssb_function_keys_emit_bounded_source_evidenced_voice_intents(self):
        expected = {
            "F1": "cq test OM0RX OM0RX test", "F2": "K1ABC", "F3": "59 15", "F4": None,
            "F5": "OM0RX", "F6": "?", "F7": "rr", "F8": "73", "F9": "agn",
            "F10": "cl?", "F11": "NR?", "F12": "tu",
        }
        first = None
        for key, payload in ((key, payload) for key, payload in expected.items() if key != "F1"):
            result = self.mutate("function_key", key=key, fields={"callsign": "K1ABC"})
            if payload is None:
                self.assertEqual(result["actions"], [])
                continue
            self.assert_voice(result["actions"][0], key, payload, "S")
            first = first or result["actions"][0]
        self.assertEqual(first["sourceMacro"]["template"],
                         "{CALL}")
        self.assertEqual(self.mutate("function_key", key="F4")["actions"], [])
        cq = self.mutate("function_key", key="F1", fields={"callsign": "K1ABC"})
        self.assert_voice(cq["actions"][0], "F1", "cq test OM0RX OM0RX test", "R")
        self.assertTrue(cq["projection"]["run"])
        expected.update(F4="tu OM0RX qrz", F6="15", F7="?", F8="rr", F10="cl?", F11="NR?",
                        F12="K1ABC rr tu")
        for key, payload in expected.items():
            run = self.mutate("function_key", key=key, fields={"callsign": "K1ABC"})
            self.assert_voice(run["actions"][0], key, payload, "R")

    def test_ssb_run_and_s_and_p_esm_emit_voice_intents_and_commit(self):
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")
        sandp_call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        self.assert_voice(sandp_call["actions"][0], "F5", "OM0RX", "S")
        sandp_exchange = self.mutate("esm", field="other_2", fields={"other_2": "5"})
        self.assert_voice(sandp_exchange["actions"][0], "F3", "59 15", "S")
        self.assertEqual(sandp_exchange["actions"][0]["fields"]["callsign"], "K1ABC")
        self.assertEqual(self.read("log")["total"], 1)
        self.mutate("run_state", run=True)
        run_cq = self.mutate("esm", field="callsign")
        self.assert_voice(run_cq["actions"][0], "F1", "cq test OM0RX OM0RX test", "R")
        run_call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        self.assertEqual([action["key"] for action in run_call["actions"]], ["F2", "F3"])
        self.assert_voice(run_call["actions"][0], "F2", "DL1ABC", "R")
        self.assert_voice(run_call["actions"][1], "F3", "59 15", "R")
        run_exchange = self.mutate("esm", field="other_2", fields={"other_2": "14"})
        self.assert_voice(run_exchange["actions"][0], "F4", "tu OM0RX qrz", "R")
        self.assertEqual(self.read("log")["total"], 2)

    def test_ssb_voice_claim_is_revision_fenced_at_most_once_and_never_replayed(self):
        result = self.mutate("function_key", key="F2", fields={"callsign": "K1ABC"})
        action = result["actions"][0]
        self.assert_voice(action, "F2", "K1ABC", "S")
        claimed = self.read("output_claim", operationID=result["operationID"], revision=result["revision"])
        self.assertEqual(claimed["actions"], [action])
        with self.assertRaises(HostError) as consumed:
            self.read("output_claim", operationID=result["operationID"], revision=result["revision"])
        self.assertEqual(consumed.exception.code, "output_consumed")
        self.assertEqual(self.read("receipt", operationID=result["operationID"])["result"]["actions"], [])

        stale = self.mutate("function_key", key="F1")
        self.mutate("draft_apply", fields={"callsign": "DL1ABC"})
        with self.assertRaises(HostError) as error:
            self.read("output_claim", operationID=stale["operationID"], revision=stale["revision"])
        self.assertEqual(error.exception.code, "stale_revision")

    def test_ssb_saved_macro_evidence_and_expansion_bound_are_atomic(self):
        setup = self.read("setup_get")["setup"]
        setup["macros"] = [{"mode": "S", "key": "F2", "label": "Their call",
                            "template": "voice {CALL}"}]
        self.mutate("setup_save", setup=setup)
        result = self.mutate("function_key", key="F2", fields={"callsign": "K1ABC"})
        action = result["actions"][0]
        self.assertEqual(action["payload"], "voice K1ABC")
        self.assertEqual((action["sourceMacro"]["origin"], action["sourceMacro"]["path"],
                          action["sourceMacro"]["template"]),
                         ("session_setup", None, "voice {CALL}"))

        setup = self.read("setup_get")["setup"]
        setup["macros"] = [{"mode": "S", "key": "F2", "label": "Bounded",
                            "template": "{CALL}" * 170}]
        self.mutate("setup_save", setup=setup)
        revision = self.revision
        operation = uid()
        with self.assertRaisesRegex(HostError, "Text exceeds field bound"):
            self.call("function_key", {"sessionID": self.session, "operationID": operation,
                                       "expectedRevision": revision, "key": "F2",
                                       "fields": {"callsign": "K" * 32}})
        self.assertEqual(self.read("projection")["projection"]["revision"], revision)
        self.assertFalse(self.read("receipt", operationID=operation)["found"])

    def test_voice_memory_tokens_use_ordered_xlog_wav_slots_and_reject_voice11_atomically(self):
        original = self.read("setup_get")["setup"]
        setup = deepcopy(original)
        setup["macros"] = [{"mode": "S", "key": "F6", "label": "xLog WAV slots",
                            "template": "{VOICE1} cq {VOICE10}"}]
        saved = self.mutate("setup_save", setup=setup)
        effective = next(item for item in saved["effectiveMacros"]
                         if item["mode"] == "S" and item["key"] == "F6")
        self.assertEqual(effective["template"], "[f1] cq [f10]")
        action = self.mutate("function_key", key="F6")["actions"][0]
        self.assertEqual((action["payload"], action["sourceMacro"]["template"]),
                         ("[f1] cq [f10]", "[f1] cq [f10]"))
        self.assertNotIn("radio", action)
        self.assertNotIn("voiceMemory", action)

        before_invalid = self.read("setup_get")["setup"]
        invalid = deepcopy(before_invalid)
        invalid["macros"] = [{"mode": "S", "key": "F6", "label": "Unsupported",
                              "template": "{VOICE11}"}]
        with self.assertRaisesRegex(RuntimeError, "unsupported token"):
            self.mutate("setup_save", setup=invalid)
        self.assertEqual(self.read("setup_get")["setup"], before_invalid)

    def test_non_rtty_newline_macro_is_rejected_atomically(self):
        original = self.read("setup_get")["setup"]
        invalid = deepcopy(original)
        invalid["macros"] = [{"mode": "S", "key": "F6", "label": "Wrong owner",
                              "template": "cq^M{CALL}"}]
        with self.assertRaisesRegex(RuntimeError, "only through the original RTTY/fldigi output owner"):
            self.mutate("setup_save", setup=invalid)
        self.assertEqual(self.read("setup_get")["setup"], original)

    def test_ssb_other_fields_remain_opaque_macro_values(self):
        setup = self.read("setup_get")["setup"]
        setup["macros"] = [{"mode": "S", "key": "F6", "label": "Opaque fields",
                            "template": "{OTHER1}|{OTHER2}"}]
        self.mutate("setup_save", setup=setup)
        store = self.host.database(self.session)
        desk = Desk(store, store.state(self.session), self.host.commit)
        desk.other_1.setText("A#B")
        desk.other_2.setText("A^MB")
        desk.process_function_key(desk.F6)
        action = desk.actions[0]
        self.assertEqual(action["payload"], "A#B|A^MB")

    def test_ssb_voice_intents_do_not_change_scoring_or_export(self):
        before = (self.read("score")["score"], self.read("export")["content"])
        result = self.mutate("function_key", key="F1")
        self.assert_voice(result["actions"][0], "F1", "cq test OM0RX OM0RX test", "R")
        self.assertTrue(result["projection"]["run"])
        after = (self.read("score")["score"], self.read("export")["content"])
        self.assertEqual(after, before)

    def test_correction_delete_restart_and_cabrillo_ph_output(self):
        self.mutate("draft_apply", fields={"sent": "57", "receive": "58"})
        first = self.log(frequency=7125000)
        second = self.log(minute=1)
        self.mutate("qso_correct", qsoID=first,
                    fields={"callsign": "DL1ABC", "other_2": "14"},
                    receiveFrequencyHz=7126500, power="100", reason="Correct call")
        corrected = next(row for row in self.read("log_page")["rows"] if row["ID"] == first)
        self.assertEqual(corrected["NR"], 14)
        self.assertEqual(corrected["ZN"], 14)
        self.assertEqual(corrected["Band"], 7)
        self.assertEqual(corrected["QSXFreq"], 7126.5)
        self.assertEqual(corrected["Power"], "100")
        self.assertEqual(self.read("score")["score"]["total"], 16)
        self.mutate("qso_delete", qsoID=second, reason="Remove duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 2)
        corrected = self.read("log_page")["rows"][0]
        self.assertEqual(corrected["QSXFreq"], 7126.5)
        self.assertEqual(corrected["Power"], "100")
        export = self.read("export")["content"]
        self.assertIn("CONTEST: CQ-WW-SSB\r\n", export)
        self.assertIn("CATEGORY-MODE: SSB\r\n", export)
        self.assertIn("CLAIMED-SCORE: 2\r\n", export)
        lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1:3], ["7125", "PH"])
        self.assertEqual(lines[0][5:], ["OM0RX", "57", "15", "DL1ABC", "58", "14"])
        self.assertNotIn("CW", lines[0])


if __name__ == "__main__":
    unittest.main()
