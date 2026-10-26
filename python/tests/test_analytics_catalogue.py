"""Disposable catalogue inventory and prefix/full-owner score equivalence."""
from collections import Counter
from copy import deepcopy
import json
import hashlib
import csv
import re
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, Desk, BAND_LABELS
from contest_host.plugins import PLUGIN_REGISTRY
from contest_host.multipliers import (project, needed_views, validate_multiplier_universe, _country_domain, dimensions,
    COUNTRY_UNIVERSE_REFERENCE, COUNTRY_UNIVERSE_CSV_SHA256, COUNTRY_UNIVERSE_ENTRIES_SHA256,
    NAQP_LOCATIONS, ARRL_STATE_PROVINCE_CODES, ARRL_SECTIONS)
from contest_host.upstream import load_plugin
from unittest.mock import patch

FIXTURES = json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())
ROOT = Path(__file__).resolve().parents[2]


def bundled_universe():
    raw = (ROOT / "Sources/XLogCore/Resources/cty.csv").read_bytes()
    entries = [{"value": row[0].strip().upper(), "label": row[1].strip(), "continent": row[3].strip().upper()}
               for row in csv.reader(raw.decode().splitlines())]
    return {"schema": 1, "referenceID": COUNTRY_UNIVERSE_REFERENCE, "source": "bundled-cty-primary-prefixes",
            "sourceSHA256": hashlib.sha256(raw).hexdigest(), "entriesSHA256": COUNTRY_UNIVERSE_ENTRIES_SHA256,
            "entries": entries}


def uid():
    return str(uuid.uuid4())


class AnalyticsCatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="xlog-analytics-catalogue-")
        self.host = Host(Path(self.temporary.name).resolve())

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def read(self, method, **params):
        return self.host.dispatch({"id": uid(), "method": method, "params": {"sessionID": self.session, **params}})

    def mutate(self, method, **params):
        value = self.read(method, operationID=uid(), expectedRevision=self.revision, **params)
        self.revision = value["revision"]
        return value

    def create(self, plugin, legacy=False, station_call=None, sent_exchange=None, countries=None, mode_category=None, universe=False, reference_id=None):
        self.session, self.generation, self.revision = uid(), uid(), 0
        fixture = FIXTURES[plugin]
        source = deepcopy(fixture["state"])
        if station_call: source["station"]["Call"] = station_call
        if sent_exchange is not None: source["settings"]["SentExchange"] = sent_exchange
        if countries: source["reference"]["countries"].update(countries)
        if mode_category: source["settings"]["ModeCategory"] = mode_category
        if reference_id is not None: source["reference"]["id"] = reference_id
        if universe:
            source["reference"]["id"] = COUNTRY_UNIVERSE_REFERENCE
            source["reference"]["multiplierUniverse"] = bundled_universe()
        self.mutate("session_create", workspaceGeneration=self.generation, pluginID=plugin,
                    station=source["station"], settings=source["settings"], reference=source["reference"],
                    frequencyHz=source["draft"]["frequencyHz"], mode=fixture["mode"])
        if legacy:
            store = self.host.database(self.session)
            state = store.state(self.session)
            state.pop("scoringRevision", None)
            store.save_state(state)
            store.conn.commit()
        return fixture

    def log(self, fields, timestamp="2026-10-21 10:00:00", **extra):
        projection = self.read("projection")["projection"]
        values = deepcopy(fields)
        allocated = projection.get("allocatedSerialFieldID")
        if projection.get("reservedSerial") is not None and allocated:
            values[allocated] = next(field["value"] for field in projection["fields"] if field["id"] == allocated)
        identity = uid()
        self.mutate("qso_commit", qsoID=identity, timestamp=timestamp, fields=values, **extra)
        return identity

    def snapshot(self):
        store = self.host.database(self.session)
        before = deepcopy(store.state(self.session)), store.conn.total_changes
        meta = self.read("analytics", workspaceGeneration=self.generation, action="prepare")
        rows = self.read("analytics", workspaceGeneration=self.generation, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500)["rows"]
        self.assertEqual((store.state(self.session), store.conn.total_changes), before)
        self.assertFalse(store.conn.in_transaction)
        self.read("analytics", workspaceGeneration=self.generation, action="release", snapshotID=meta["snapshotID"])
        return meta, rows

    def distinct_fields(self, fixture):
        original = fixture["firstRow"]["Call"]
        stem, slash, suffix = original.partition("/")
        other = stem[:-1] + ("D" if stem[-1] != "D" else "E") + (slash + suffix if slash else "")
        fields = {key: value.replace(original, other) for key, value in fixture["fields"].items()}
        fields["callsign"] = other
        country = fixture["state"]["reference"]["countries"].get(original)
        extra = {"countries": {other: country}, "referenceID": self.host.database(self.session).state(self.session)["reference"]["id"]} if country else {}
        return fields, extra

    def assert_prefix_equivalence(self, meta, rows):
        if meta["scoreHistory"]["status"] != "PASS":
            return
        store = self.host.database(self.session)
        actual = {row["id"]: row["claimedScore"] for row in rows}
        source = store.exec_sql_mult("SELECT rowid AS source_order,* FROM DXLOG ORDER BY TS,rowid")
        kept = []
        for row in source:
            kept.append(row["ID"])
            store.conn.execute("SAVEPOINT analytics_prefix")
            store.atomic = True
            try:
                store.conn.execute("DELETE FROM DXLOG WHERE ID NOT IN (" + ",".join("?" for _ in kept) + ")", kept)
                desk = Desk(store, deepcopy(store.state(self.session)), self.host.commit)
                Host.rebuild(desk)
                self.assertAlmostEqual(actual[row["ID"]], desk.score()["total"], msg=f"{meta['pluginID']} prefix {len(kept)} / {meta['scoreHistory']['model']}")
            finally:
                store.conn.execute("ROLLBACK TO analytics_prefix")
                store.conn.execute("RELEASE analytics_prefix")
                store.atomic = False

    def test_every_registered_definition_has_explicit_capabilities_and_read_only_snapshot(self):
        self.assertEqual(set(FIXTURES), set(PLUGIN_REGISTRY))
        inventory = {}
        for plugin in PLUGIN_REGISTRY:
            with self.subTest(plugin=plugin):
                fixture = self.create(plugin, universe=True)
                self.log(fixture["fields"])
                meta, rows = self.snapshot()
                self.assertEqual(len(rows), 1)
                self.assert_prefix_equivalence(meta, rows)
                self.log(fixture["fields"], "2026-10-21 10:01:00")
                fields, extra = self.distinct_fields(fixture)
                current_band = self.read("projection")["projection"]["band"]
                alternate = next((value for value, label in BAND_LABELS.items() if label in PLUGIN_REGISTRY[plugin].bands and value != current_band), current_band)
                self.log(fields, "2026-10-21 10:02:00", frequencyHz=int(alternate * 1e6), **extra)
                meta, rows = self.snapshot()
                features = meta["analyticsCapabilities"]
                self.assertEqual(set(features), {"multiplierAcquisition", "scoreHistory", "neededUniverse", "candidateNeeded"})
                for item in features.values():
                    self.assertIn(item["status"], {"PASS", "FAIL", "UNVERIFIED", "NOT APPLICABLE"})
                    self.assertTrue(item["reason"])
                if meta["scoreHistory"]["status"] == "PASS":
                    self.assertAlmostEqual(rows[-1]["claimedScore"], meta["score"]["total"])
                self.assert_prefix_equivalence(meta, rows)
                inventory[plugin] = {"pluginID": plugin, "fixture": fixture["fixture"], "features": features,
                    "scoreHistory": meta["scoreHistory"], "score": meta["score"],
                    "neededDimensions": [{key: value for key, value in view.items() if key != "rows"} for view in meta["neededViews"]]}
        self.assertEqual(set(inventory), set(PLUGIN_REGISTRY))
        for feature in ("multiplierAcquisition", "scoreHistory", "neededUniverse", "candidateNeeded"):
            print("ANALYTICS", feature, dict(Counter(item["features"][feature]["status"] for item in inventory.values())))
            print("ANALYTICS_UNVERIFIED", feature, ",".join(plugin for plugin, value in inventory.items() if value["features"][feature]["status"] == "UNVERIFIED"))
        if output := os.environ.get("XLOG_ANALYTICS_INVENTORY"):
            root = Path(__file__).resolve().parents[2]
            sources = [root / "python/contest_host/analytics.py", root / "python/contest_host/multipliers.py", Path(__file__)]
            Path(output).write_text(json.dumps({"source": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
                "sourceFilesSHA256": {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},
                "catalogueCount": len(inventory), "referenceContext": "Catalogue fixtures pin the complete bundled primary-prefix coordinate. Matching old sessions may use verified ephemeral native context without persistence; foreign references or present incompatible coordinates retain unavailable country universes.",
                "scope": "Disposable initial, repeated and distinct-call/alternate-band fixtures; every reported history prefix compared with full host rebuild. Conditional/tie/correction tests are separate named cases.",
                "plugins": list(inventory.values())}, separators=(",", ":")) + "\n")

    def test_complete_country_coordinate_validation_persistence_and_no_backfill(self):
        coordinate = bundled_universe()
        def require(condition, message, code):
            if not condition: raise ValueError(code + ": " + message)
        validated = validate_multiplier_universe(coordinate, COUNTRY_UNIVERSE_REFERENCE, require)
        self.assertEqual(len(validated["entries"]), 346)
        self.assertEqual(coordinate["sourceSHA256"], COUNTRY_UNIVERSE_CSV_SHA256)
        self.assertIn("*IT9", {item["value"] for item in validated["entries"]})
        for change in ("subset", "duplicate", "label", "continent", "prefix", "csv-digest", "entry-digest", "version"):
            with self.subTest(change=change):
                broken = deepcopy(coordinate)
                if change == "subset": broken["entries"].pop()
                elif change == "duplicate": broken["entries"][-1] = broken["entries"][0]
                elif change in {"label", "continent", "prefix"}:
                    broken["entries"][0]["value" if change == "prefix" else change] = "K" if change == "prefix" else "AS" if change == "continent" else "Drifted label"
                else: broken[{"csv-digest": "sourceSHA256", "entry-digest": "entriesSHA256", "version": "referenceID"}[change]] = "drifted"
                with self.assertRaisesRegex(ValueError, "invalid_reference_universe"):
                    validate_multiplier_universe(broken, COUNTRY_UNIVERSE_REFERENCE, require)
        fixture = self.create("cq_ww_cw", universe=True)
        self.log(fixture["fields"])
        meta, _ = self.snapshot()
        country = next(view for view in meta["neededViews"] if view["id"] == "country")
        self.assertEqual((country["status"], country["universeSize"], country["universeComplete"]), ("PASS", 346, True))
        self.assertEqual(country["universeReference"]["entriesSHA256"], COUNTRY_UNIVERSE_ENTRIES_SHA256)
        session = self.session
        self.host.close()
        self.host = Host(Path(self.temporary.name).resolve())
        self.read("session_open")
        self.assertEqual(self.host.database(session).state(session)["reference"]["multiplierUniverse"], validated)
        self.assertEqual(self.snapshot()[0]["multiplierUniverseReference"]["entriesSHA256"], COUNTRY_UNIVERSE_ENTRIES_SHA256)
        fixture = self.create("cq_ww_cw")
        self.log(fixture["fields"])
        self.read("session_open")
        self.assertNotIn("multiplierUniverse", self.host.database(self.session).state(self.session)["reference"])
        missing = next(view for view in self.snapshot()[0]["neededViews"] if view["id"] == "country")
        self.assertEqual(missing["status"], "UNVERIFIED")
        self.assertIsNone(missing["universeSize"])

    def test_verified_ephemeral_reference_is_read_only_and_uses_base_log_identity(self):
        fixture = self.create("cq_ww_cw", reference_id=COUNTRY_UNIVERSE_REFERENCE)
        self.log(fixture["fields"])
        fields, extra = self.distinct_fields(fixture)
        self.log(fields, "2026-10-21 10:01:00", **extra)
        base, _ = self.snapshot()
        store = self.host.database(self.session)
        queries = ("SELECT * FROM xlog_session", "SELECT * FROM DXLOG", "SELECT * FROM xlog_qso_audit",
                   "SELECT * FROM xlog_qso_identity", "SELECT * FROM xlog_operation")
        before = [store.exec_sql_mult(query) for query in queries]
        changes = store.conn.total_changes
        meta = self.read("analytics", workspaceGeneration=self.generation, action="prepare", multiplierUniverse=bundled_universe())
        self.assertEqual(meta["identity"], base["identity"])
        self.assertEqual(meta["multiplierUniverseReference"]["coordinateSource"], "verified-request")
        country = next(view for view in meta["neededViews"] if view["id"] == "country")
        self.assertEqual((country["status"], country["universeSize"]), ("PASS", 346))
        page = self.read("analytics", workspaceGeneration=self.generation, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500)
        self.assertEqual(len(page["rows"]), 2)
        self.assertTrue(self.read("analytics", workspaceGeneration=self.generation, action="check", snapshotID=meta["snapshotID"])["current"])
        self.assertEqual([store.exec_sql_mult(query) for query in queries], before)
        self.assertEqual(store.conn.total_changes, changes)
        self.assertFalse(store.conn.in_transaction)
        self.log(fixture["fields"], "2026-10-21 10:02:00")
        self.assertFalse(self.read("analytics", workspaceGeneration=self.generation, action="check", snapshotID=meta["snapshotID"])["current"])
        self.assertEqual(self.read("analytics", workspaceGeneration=self.generation, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500), page)
        self.read("analytics", workspaceGeneration=self.generation, action="release", snapshotID=meta["snapshotID"])
        self.assertNotIn("multiplierUniverse", store.state(self.session)["reference"])

    def test_ephemeral_context_cannot_override_an_incompatible_or_foreign_session(self):
        for stored in (False, True):
            fixture = self.create("cq_ww_cw", universe=stored)
            self.log(fixture["fields"])
            store = self.host.database(self.session)
            if stored:
                state = store.state(self.session)
                state["reference"]["multiplierUniverse"]["entries"][0]["label"] = "Older mapping"
                store.save_state(state); store.conn.commit()
            before = deepcopy(store.state(self.session)), store.conn.total_changes
            meta = self.read("analytics", workspaceGeneration=self.generation, action="prepare", multiplierUniverse=bundled_universe())
            country = next(view for view in meta["neededViews"] if view["id"] == "country")
            self.assertEqual(country["status"], "UNVERIFIED")
            if stored:
                self.assertEqual(meta["multiplierUniverseReference"]["coordinateSource"], "session")
                self.assertFalse(meta["multiplierUniverseReference"]["compatible"])
            self.read("analytics", workspaceGeneration=self.generation, action="release", snapshotID=meta["snapshotID"])
            self.assertEqual((store.state(self.session), store.conn.total_changes), before)
        for invalid in (None, {}, {**bundled_universe(), "entries": bundled_universe()["entries"][:-1]},
                        {**bundled_universe(), "sourceSHA256": "drifted"}):
            with self.subTest(invalid=type(invalid).__name__):
                with self.assertRaises(Exception):
                    self.read("analytics", workspaceGeneration=self.generation, action="prepare", multiplierUniverse=invalid)
        meta = self.read("analytics", workspaceGeneration=self.generation, action="prepare")
        with self.assertRaises(Exception):
            self.read("analytics", workspaceGeneration=self.generation, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500, multiplierUniverse=bundled_universe())
        self.read("analytics", workspaceGeneration=self.generation, action="release", snapshotID=meta["snapshotID"])

    def test_country_domains_follow_pinned_entrant_and_exchange_predicates(self):
        cases = [("cq_ww_cw", None, {"K", "VE", "*IT9"}, set()),
                 ("arrl_dx_cw", "K1ABC", {"DL", "JA"}, {"K", "VE"}),
                 ("ari_dx", None, {"DL", "K"}, {"I", "IS"}),
                 ("hadx", None, {"DL", "K"}, {"HA"}),
                 ("ukeidx", None, {"DL", "K"}, {"EI", "G", "GW"}),
                 ("jidx_cw", "JA1ABC", {"K", "*IT9"}, {"JA", "JD/O", "JD/M"}),
                 ("pacc", "PA0TST", {"K1", "K2", "UA0", "VE3", "VO1", "VY2", "DL"}, {"PA", "K"}),
                 ("rdxc", None, {"R", "K"}, {"UA", "UA9"})]
        for plugin, own, present, absent in cases:
            with self.subTest(plugin=plugin, station=own):
                countries = deepcopy(FIXTURES[plugin]["state"]["reference"]["countries"])
                if own:
                    prefix = "JA" if own.startswith("JA") else "PA" if own.startswith("PA") else "K"
                    countries[own] = {"entity": prefix, "continent": "AS" if prefix == "JA" else "NA" if prefix == "K" else "EU", "cq": 25 if prefix == "JA" else 5 if prefix == "K" else 14, "itu": 45 if prefix == "JA" else 8 if prefix == "K" else 27, "primary_pfx": prefix}
                self.create(plugin, station_call=own, sent_exchange="13" if plugin == "jidx_cw" else "ZH" if own == "PA0TST" else None, countries=countries, universe=True)
                state = self.host.database(self.session).state(self.session)
                definition = next(d for d in dimensions(state) if d.field in {"CountryPrefix", "@jidx-country", "@pacc", "@russianCountry"})
                domain, reason = _country_domain(definition, state, state["reference"]["multiplierUniverse"])
                self.assertTrue(reason)
                self.assertTrue(present <= set(domain))
                self.assertTrue(absent.isdisjoint(domain))
        self.create("arrl_rtty_ru", universe=True)
        state = self.host.database(self.session).state(self.session)
        country = next(d for d in dimensions(state) if d.id == "country")
        self.assertEqual(_country_domain(country, state, state["reference"]["multiplierUniverse"]), ((), None))

    def test_incompatible_optional_universe_never_gates_core_logging_or_setup(self):
        for drift in ("session-reference", "future-bundle", "old-mapping"):
            with self.subTest(drift=drift):
                fixture = self.create("cq_ww_cw", universe=True)
                self.log(fixture["fields"])
                store = self.host.database(self.session)
                before = store.fetch_all_contacts_asc()
                state = store.state(self.session)
                if drift == "session-reference": state["reference"]["id"] = "future-reference-v2"
                elif drift == "future-bundle": state["reference"]["multiplierUniverse"]["referenceID"] = "future-bundle-v2"
                else: state["reference"]["multiplierUniverse"]["entries"][0]["label"] = "Older label"
                retained = deepcopy(state["reference"]["multiplierUniverse"])
                store.save_state(state); store.conn.commit()
                self.read("session_open")
                meta, _ = self.snapshot()
                self.assertFalse(meta["multiplierUniverseReference"]["compatible"])
                self.assertEqual(next(view for view in meta["neededViews"] if view["id"] == "country")["status"], "UNVERIFIED")
                setup = self.read("setup_get")["setup"]
                self.mutate("setup_save", setup={**setup, "name": "Disposable unchanged scoring"})
                self.assertEqual(store.fetch_all_contacts_asc(), before)
                fields, extra = self.distinct_fields(fixture)
                self.log(fields, "2026-10-21 10:01:00", **extra)
                self.read("session_open")
                self.assertEqual(store.state(self.session)["reference"]["multiplierUniverse"], retained)
                self.assertEqual(store.fetch_all_contacts_asc()[0], before[0])

    def test_reused_finite_location_data_has_exact_existing_source_parity(self):
        naqp = json.loads((ROOT / "Tests/XContestCoreTests/SourceFixtures/naqp-2026-authority.json").read_text())
        self.assertEqual(NAQP_LOCATIONS, set(naqp["statesAndDC"]) | set(naqp["canadianProvinces"]) | set(naqp["otherNorthAmericanPrefixes"]))
        swift = (ROOT / "Sources/XContestCore/ARRLRTTYRoundupRule.swift").read_text()
        regions = []
        for name in ("arrlRTTYUSLocations", "arrlRTTYCanadaLocations"):
            regions += re.findall(r'"([A-Z]+)"', re.search(name + r': Set<String> = \[(.*?)\]', swift, re.S)[1])
        self.assertEqual(ARRL_STATE_PROVINCE_CODES, set(regions))
        cabrillo = (ROOT / "Sources/XContestCore/Cabrillo.swift").read_text()
        sections = {"AK", "PR", "VI", "PAC"}
        for name in ("arrlUSSectionAbbreviations", "arrlCanadaSectionAbbreviations"):
            sections.update(re.findall(r'"([A-Z]+)"', re.search(name + r': Set<String> = \[(.*?)\]', cabrillo, re.S)[1]))
        self.assertEqual(ARRL_SECTIONS, sections)
        for plugin in ("naqp_cw", "naqp_ssb", "naqp_rtty", "arrl_rtty_ru", "helvetia", "arrl_field_day", "winter_field_day", "arrl_ss_cw", "arrl_ss_phone", "arrl_160m", "ok1wc"):
            with self.subTest(plugin=plugin):
                fixture = self.create(plugin)
                self.log(fixture["fields"])
                meta, _ = self.snapshot()
                bounded = next(view for view in meta["neededViews"] if view["id"] in {"spc", "region", "bandMode", "section", "letter"})
                self.assertEqual(bounded["status"], "PASS", bounded)
                self.assertTrue(bounded["universeComplete"])
                self.assertGreater(bounded["universeSize"], 0)
                if plugin == "arrl_160m":
                    self.assertEqual(bounded["universeSize"], len(ARRL_SECTIONS) + 40)
                    self.assertIn("14", bounded["rows"][0]["worked"])
        fixture = self.create("naqp_cw")
        self.log({**fixture["fields"], "other_2": "NF"})
        before = self.read("log_page")["rows"][0]
        meta, _ = self.snapshot()
        self.assertEqual(meta["neededViews"][0]["status"], "UNVERIFIED")
        self.assertEqual(self.read("log_page")["rows"][0], before)

    def test_arrl_160_territory_entrant_country_and_same_exchange_growth(self):
        for own, prefix, sent in (("KL7TST", "KL", "AK"), ("KH6TST", "KH6", "PAC")):
            with self.subTest(station=own):
                countries = {own: {"entity": "Alaska" if prefix == "KL" else "Hawaii", "continent": "NA" if prefix == "KL" else "OC",
                    "cq": 1 if prefix == "KL" else 31, "itu": 1 if prefix == "KL" else 61, "primary_pfx": prefix}}
                fixture = self.create("arrl_160m", station_call=own, sent_exchange=sent, countries=countries, universe=True)
                for index, call in enumerate(("DL1ABC", "OM1ABC", "DL1ABC")):
                    self.log({**fixture["fields"], "callsign": call, "other_2": "14"}, f"2026-10-21 10:0{index}:00")
                    meta, rows = self.snapshot()
                    self.assertEqual(meta["analyticsCapabilities"]["multiplierAcquisition"]["status"], "PASS")
                    self.assertEqual(meta["scoreHistory"]["status"], "PASS")
                    self.assert_prefix_equivalence(meta, rows)
                self.assertEqual(meta["score"]["multipliers"], 3)  # DL + OM countries and one whole Exchange1 string.
                views = {view["id"]: view for view in meta["neededViews"]}
                self.assertEqual((views["country"]["status"], views["country"]["universeSize"]), ("PASS", 346))
                self.assertEqual(views["country"]["rows"][0]["worked"], ["DL", "OM"])
                self.assertEqual(views["section"]["rows"][0]["worked"], ["14"])
                self.assertEqual(views["section"]["universeScope"], "published-sections-and-numeric-CQ-zone-tokens")

    def test_tied_backdated_duplicate_correction_deletion_and_revision_branches(self):
        for plugin in ("cq_ww_ssb", "cq_wpx_cw", "jidx_cw", "jidx_ph", "hadx", "pacc", "es_open", "nac_vhf", "trans_tasman", "rsgb_commonwealth_beru"):
            for legacy in (False, True) if plugin in {"jidx_cw", "jidx_ph", "hadx", "pacc", "es_open"} else (False,):
                with self.subTest(plugin=plugin, legacy=legacy):
                    fixture = self.create(plugin, legacy)
                    first = self.log(fixture["fields"], "2026-10-21 10:10:00")
                    fields, extra = self.distinct_fields(fixture)
                    self.log(fields, "2026-10-21 10:10:00", **extra)
                    self.log(fixture["fields"], "2026-10-21 10:00:00")
                    for action in (None, "qso_correct", "qso_delete"):
                        if action:
                            self.mutate(action, qsoID=first, reason="Synthetic analytics equivalence",
                                        **({"fields": {"receive": "57" if fixture["mode"] == "SSB" else "579"}} if action == "qso_correct" else {}))
                        meta, rows = self.snapshot()
                        self.assert_prefix_equivalence(meta, rows)

    def test_finite_universes_and_incomplete_cqws(self):
        fixture = self.create("jidx_cw")
        self.log(fixture["fields"])
        meta, _ = self.snapshot()
        view = next(view for view in meta["neededViews"] if view["id"] == "prefecture")
        self.assertEqual(view["status"], "PASS")
        band = self.read("projection")["projection"]["supportedBands"]
        self.assertEqual({row["scope"] for row in view["rows"]}, set(band))
        self.assertTrue(all(len(row["worked"]) + len(row["needed"]) == 50 for row in view["rows"]))
        fixture = self.create("cqws")
        self.log(fixture["fields"])
        # An unestablished Brazil UF is a partial lower bound, not score growth.
        store = self.host.database(self.session)
        store.conn.execute("UPDATE DXLOG SET CountryPrefix='PY',Exchange1='SCOUT'")
        store.conn.commit()
        meta, rows = self.snapshot()
        self.assertFalse(meta["score"]["scoringComplete"])
        self.assertEqual(meta["scoreHistory"]["status"], "UNVERIFIED")
        self.assertTrue(all(row["claimedScore"] is None for row in rows))
        self.assertTrue(all(view["status"] == "UNVERIFIED" and not view["rows"] for view in meta["neededViews"]))

    def test_japanese_jidx_received_zones_maritime_and_legacy_scope(self):
        from test_jidx_plugins_host import CTY
        for plugin in ("jidx_cw", "jidx_ph"):
            with self.subTest(plugin=plugin):
                self.create(plugin, station_call="JA1ABC", sent_exchange="13", countries=deepcopy(CTY))
                first = self.log({"callsign": "K1ABC", "other_2": "5"})
                self.log({"callsign": "K2ABC", "other_2": "5"}, "2026-10-21 10:01:00")
                self.log({"callsign": "K2ABC", "other_2": "4"}, "2026-10-21 10:02:00")
                maritime = self.log({"callsign": "JA3ABC/MM", "other_2": "27"}, "2026-10-21 10:03:00")
                self.log({"callsign": "JA2XYZ", "other_2": "13"}, "2026-10-21 10:04:00")
                meta, rows = self.snapshot()
                self.assertEqual((meta["score"]["points"], meta["score"]["countries"], meta["score"]["zones"], meta["score"]["total"]), (3, 1, 2, 9))
                mm = next(row for row in rows if row["id"] == maritime)
                self.assertEqual(mm["zone"], "27")  # The CTY lookup says zone25; received NR is authoritative.
                self.assertEqual(len(mm["creditedKeys"]), 1)
                self.assertTrue(mm["creditedKeys"][0].startswith("CQ zones 27"))
                self.assertEqual(meta["scoreHistory"]["status"], "PASS")
                self.assert_prefix_equivalence(meta, rows)
                self.mutate("qso_correct", qsoID=first, fields={"other_2": "4"}, reason="Synthetic received zone")
                corrected, copied = self.snapshot()
                self.assertEqual(corrected["score"]["zones"], 3)
                self.assertEqual(next(row for row in copied if row["id"] == first)["zone"], "4")
                self.assert_prefix_equivalence(corrected, copied)
                self.mutate("qso_delete", qsoID=first, reason="Synthetic zone deletion")
                self.assert_prefix_equivalence(*self.snapshot())
                self.create(plugin, legacy=True, station_call="JA1ABC", sent_exchange="13", countries=deepcopy(CTY))
                self.log({"callsign": "K1ABC", "other_2": "5"})
                self.log({"callsign": "K2ABC", "other_2": "5"}, "2026-10-21 10:01:00", frequencyHz=7025000)
                legacy, copied = self.snapshot()
                self.assertEqual(legacy["score"]["multipliers"], 1)
                self.assertTrue(all(" · Contest" in key for row in copied for key in row["creditedKeys"]))
                self.assert_prefix_equivalence(legacy, copied)

    def test_dutch_pacc_call_areas_modes_correction_and_legacy_arithmetic(self):
        from test_host import CTY
        countries = {"PA0TST": {"entity": "Netherlands", "continent": "EU", "cq": 14, "itu": 27, "primary_pfx": "PA"},
                     "K2ABC": deepcopy(CTY["K1ABC"]), "K3ABC": deepcopy(CTY["K1ABC"]),
                     "K2ABD": deepcopy(CTY["K1ABC"]), "DL2ABC": deepcopy(CTY["DL1ABC"])}
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                self.create("pacc", legacy, station_call="PA0TST", sent_exchange="ZH", countries=countries, mode_category="MIXED")
                for index, call in enumerate(("K1ABC", "K2ABC", "K3ABC")):
                    identity = self.log({"callsign": call, "other_2": str(100 + index)}, f"2026-10-21 10:0{index}:00")
                meta, rows = self.snapshot()
                self.assertEqual((meta["score"]["points"], meta["score"]["multipliers"], meta["score"]["total"]), (3, 1, 6) if legacy else (3, 3, 9))
                self.assert_prefix_equivalence(meta, rows)
                if legacy: continue
                dl = self.log({"callsign": "DL1ABC", "other_2": "103"}, "2026-10-21 10:03:00")
                self.log({"callsign": "DL2ABC", "other_2": "104"}, "2026-10-21 10:04:00", frequencyHz=7025000)
                self.log({"callsign": "K1ABC", "other_2": "105"}, "2026-10-21 10:05:00", mode="SSB")
                meta, rows = self.snapshot()
                self.assertEqual(meta["score"]["total"], 36)
                self.assertEqual(len({key for row in rows for key in row["creditedKeys"]}), 6)
                self.assert_prefix_equivalence(meta, rows)
                self.mutate("qso_correct", qsoID=identity, fields={"callsign": "K2ABD"}, reason="Synthetic call-area correction")
                corrected, rows = self.snapshot()
                self.assertEqual(corrected["score"]["total"], 30)
                self.assert_prefix_equivalence(corrected, rows)
                self.mutate("qso_delete", qsoID=dl, reason="Synthetic country-band deletion")
                deleted, rows = self.snapshot()
                self.assertEqual(deleted["score"]["total"], 20)
                self.assert_prefix_equivalence(deleted, rows)

    def test_cqp_literal_cap_and_compound_needed_fallback(self):
        fixture = self.create("ca_qso_party")
        plugin = load_plugin("ca_qso_party")
        codes = sorted(plugin.CA_COUNTIES | plugin.CA_MULTS)
        source_country = fixture["state"]["reference"]["countries"][fixture["firstRow"]["Call"]]
        for index, code in enumerate(codes[:59]):
            call = f"K{index}SYN"
            self.log({**fixture["fields"], "callsign": call, "other_1": code},
                     f"2026-10-21 10:{index:02d}:00", countries={call: source_country}, referenceID=fixture["state"]["reference"]["id"])
            if index == 57:
                capped, rows = self.snapshot()
                self.assertEqual(capped["score"]["multipliers"], 58)
                self.assertEqual(capped["scoreHistory"]["status"], "PASS")
                self.assertEqual(capped["scoreHistory"]["identityCap"], 58)
                view = capped["neededViews"][0]
                self.assertEqual(view["universeSize"], len(load_plugin("ca_qso_party").CA_MULTS | load_plugin("ca_qso_party").CA_COUNTIES))
                self.assertFalse(view["universeComplete"])
                self.assertEqual(view["remainingCreditSlots"], 0)
                self.assertTrue(all(not row["needed"] for row in view["rows"]))
        beyond, rows = self.snapshot()
        self.assertEqual(beyond["score"]["multipliers"], 58)
        self.assertEqual(beyond["analyticsCapabilities"]["multiplierAcquisition"]["status"], "UNVERIFIED")
        self.assertEqual(beyond["scoreHistory"]["status"], "UNVERIFIED")
        self.assertTrue(all(not row["creditedKeys"] for row in rows))
        fixture = self.create("ca_qso_party")
        self.log({**fixture["fields"], "other_1": "ALAM/SCLA"})
        compound, copied = self.snapshot()
        self.assertEqual(compound["score"]["multipliers"], 1)
        self.assertEqual(compound["neededViews"][0]["status"], "UNVERIFIED")
        self.assertEqual(compound["neededViews"][0]["rows"], [])

    def test_lookup_cache_is_not_a_country_universe_and_needed_is_bounded_without_truncation(self):
        fixture = self.create("cq_ww_ssb")
        self.log(fixture["fields"])
        meta = self.read("analytics", workspaceGeneration=self.generation, action="prepare")
        store = self.host.database(self.session)
        state = store.state(self.session)
        before = state["reference"]["countries"][fixture["firstRow"]["Call"]]
        state["reference"]["countries"]["K9SYN"] = {**before, "primary_pfx": "TEST"}
        store.save_state(state); store.conn.commit()
        self.assertTrue(self.read("analytics", workspaceGeneration=self.generation, action="check", snapshotID=meta["snapshotID"])["current"])
        rows = store.exec_sql_mult("SELECT rowid AS source_order,* FROM DXLOG")
        score = self.read("score")["score"]
        views, _, _ = project(rows, state, score, BAND_LABELS)
        needed = needed_views(rows, state, views, BAND_LABELS)
        self.assertEqual(next(view for view in needed if view["id"] == "country")["status"], "UNVERIFIED")
        from contest_host.multipliers import Dimension
        domain = ("K", *(f"P{index:04d}" + "A" * 100 for index in range(1500)))
        with patch("contest_host.multipliers.dimensions", return_value=(Dimension("country", "Test domain", "CountryPrefix", "band", universe=domain),)):
            needed = needed_views(rows, state, views, BAND_LABELS)
        country = next(view for view in needed if view["id"] == "country")
        self.assertEqual(country["status"], "UNVERIFIED")
        self.assertIn("512 KiB", country["reason"])
        self.assertEqual(country["universeSize"], len(domain))
        self.assertEqual(country["rows"], [])
        self.assertLess(len(json.dumps(needed).encode()), 512 * 1024)
