"""Pinned JIDX CW/phone family through the original Python/SQLite host."""
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from xml.etree import ElementTree

from contest_host.host import Desk, Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures
import test_legacy_import as legacy_fixtures
import sqlite3


uid = fixtures.uid
CTY = {
    **fixtures.CTY,
    "JA1ABC": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JA2XYZ": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JA3ABC": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JA3ABC/MM": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JD1ABC": {"entity": "Ogasawara", "continent": "AS", "cq": 27, "itu": 45, "primary_pfx": "JD/o"},
    "K2ABC": deepcopy(fixtures.CTY["K1ABC"]),
    "K1ABC/MM": deepcopy(fixtures.CTY["K1ABC"]),
}
HASHES = {
    "jidx_cw": "457e6ba45da31a90c06fc9508dee8d1dccf053b0676083c2472082dd61c18e53",
    "jidx_ph": "20b3e8d7154d51c264817a5755d753c2be4bce9896a64d10cb63478837e06860",
}


class JIDXHostCase:
    plugin_id = ""
    plugin_name = ""
    mode = ""
    report = ""
    cabrillo_name = ""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.call("session_create", {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": self.plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88"},
            "frequencyHz": 14025000,
            "settings": {
                "SentExchange": "15",
                "ModeCategory": self.mode,
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)},
        })

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

    def log(self, call, received, minute, frequency):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-21 09:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": received},
        )
        return qso

    def rtc_score(self):
        store = self.host.database(self.session)
        desk = Desk(store, store.state(self.session), self.host.commit)
        xml = ElementTree.fromstring(desk.contest.online_score_xml(desk))
        return int(xml.findtext("score")), {item.attrib["type"]: int(item.text)
                                            for item in xml.findall("breakdown/mult")}

    def assert_rejected_atomically(self, method, **params):
        store = self.host.database(self.session)
        state, rows = deepcopy(store.state(self.session)), deepcopy(store.fetch_all_contacts_asc())
        counts = {table: store.exec_sql(f"SELECT count(*) AS n FROM {table}")["n"]
                  for table in ("xlog_qso_audit", "xlog_qso_identity", "xlog_operation")}
        with self.assertRaisesRegex(HostError, "JIDX.*1 to"):
            self.mutate(method, **params)
        self.assertEqual(store.state(self.session), state)
        self.assertEqual(store.fetch_all_contacts_asc(), rows)
        self.assertEqual({table: store.exec_sql(f"SELECT count(*) AS n FROM {table}")["n"]
                          for table in counts}, counts)

    def test_original_source_surface_scoring_rebuild_restart_and_export(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["mode"], projection["supportedModes"]),
            (self.plugin_name, self.mode, [self.mode]),
        )
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), (self.report, self.report))
        self.assertEqual(
            (fields["other_1"]["label"], fields["other_1"]["value"], fields["other_2"]["label"]),
            ("SentNR", "15", "RcvNR"),
        )
        self.assertIsNone(projection["reservedSerial"])
        self.assertEqual(projection["score"]["multiplierSummaryLabels"], ["0 prefecture/band multipliers"])
        self.assertEqual(projection["score"]["prefectures"], 0)

        first = self.log("JA1ABC", "13", 0, 14025000)
        second = self.log("JA2XYZ", "27", 1, 3525000)
        third = self.log("JA1ABC", "13", 2, 28025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 5,
            "countries": 0,
            "zones": 0,
            "prefectures": 3,
            "multipliers": 3,
            "multiplierSummaryLabels": ["3 prefecture/band multipliers"],
            "total": 15,
        })
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["SentNr"], rows[first]["NR"], rows[first]["Points"]), (15, 13, 1))
        self.assertEqual(rows[second]["Points"], 2)
        self.assertEqual(rows[third]["Points"], 2)

        self.mutate("qso_correct", qsoID=second, fields={"other_2": "13"}, reason="Correct prefecture")
        self.assertEqual(self.read("score")["score"]["total"], 15)
        self.mutate("qso_delete", qsoID=third, reason="Remove duplicate-band check")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 6 (2-3-2)\r\n", export)
        self.assertEqual(len([line for line in export.splitlines() if line.startswith("QSO:")]), 2)
        self.assertTrue(any(
            self.mode.replace("SSB", "PH") in line.split()
            and all(token in line.split() for token in ("JA1ABC", "15", "13"))
            for line in export.splitlines() if line.startswith("QSO:")
        ))

    def test_numeric_exchange_validation_and_original_esm_commit(self):
        for fields in (
            {"callsign": "JA1ABC", "other_2": ""},
            {"callsign": "JA1ABC", "other_2": "TOKYO"},
            {"callsign": "JA1ABC", "other_1": "DX", "other_2": "13"},
        ):
            with self.subTest(fields=fields), self.assertRaisesRegex(HostError, "JIDX sent and received"):
                self.mutate("qso_commit", fields=fields)

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "JA1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "13"})
        expected_call_actions = ["F2", "F3"] if self.mode == "CW" else []
        expected_exchange_actions = ["F4"] if self.mode == "CW" else []
        self.assertEqual([action["key"] for action in call["actions"]], expected_call_actions)
        self.assertEqual([action["key"] for action in exchange["actions"]], expected_exchange_actions)
        self.assertEqual(self.read("log")["total"], 1)

    def create_station(self, call):
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.mutate("session_create", workspaceGeneration=self.workspace, pluginID=self.plugin_id,
                    station={"Call": call, "GridSquare": "PM95"}, frequencyHz=14025000,
                    mode=self.mode, settings={"SentExchange": "13", "ModeCategory": self.mode,
                    "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL", "PowerCategory": "LOW"},
                    reference={"id": "jidx-2026-test", "countries": deepcopy(CTY)})

    def test_foreign_prefectures_are_per_band_and_ineligible_or_duplicate_rows_give_no_mult(self):
        first = self.log("JA1ABC", "13", 0, 14025000)
        repeated = self.log("JA2XYZ", "13", 1, 14025000)
        corrected = self.log("JA3ABC", "27", 2, 14025000)
        other_band = self.log("JA1ABC", "13", 3, 28025000)
        ineligible = self.log("DL1ABC", "14", 4, 14025000)
        duplicate = self.log("JA1ABC", "13", 5, 14025000)
        island = self.log("JD1ABC", "48", 6, 14025000)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual([rows[qso]["IsMultiplier1"] for qso in
                          (first, repeated, corrected, other_band, ineligible, duplicate, island)],
                         [1, 0, 1, 1, 0, 0, 1])
        self.assertEqual([rows[qso]["Points"] for qso in (ineligible, duplicate)], [0, 0])
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (6, 4, 24))
        self.assertEqual((score["countries"], score["zones"], score["prefectures"]), (0, 0, 4))
        self.assertEqual(score["multiplierSummaryLabels"], ["4 prefecture/band multipliers"])
        self.assertEqual(self.rtc_score(), (24, {"prefecture": 4}))
        self.mutate("qso_correct", qsoID=corrected, fields={"other_2": "13"})
        self.assertEqual(self.read("score")["score"]["total"], 18)
        self.mutate("qso_delete", qsoID=corrected)
        self.assertEqual(self.read("score")["score"]["total"], 15)
        self.host.close()
        self.host = Host(self.root)
        self.mutate("recalculate")
        self.assertEqual(self.read("score")["score"]["total"], 15)
        self.assertIn("CLAIMED-SCORE: 15 (6-5-3)\r\n", self.read("export")["content"])

    def test_japanese_country_and_received_zone_per_band_with_maritime_zone_only(self):
        self.create_station("JA1ABC")
        empty = self.read("score")["score"]
        self.assertEqual((empty["countries"], empty["zones"], empty["prefectures"]), (0, 0, 0))
        self.assertEqual(empty["multiplierSummaryLabels"], ["0 country/band multipliers", "0 CQ zone/band multipliers"])
        first = self.log("K1ABC", "05", 0, 14025000)
        repeated = self.log("K2ABC", "05", 1, 14025000)
        corrected = self.log("DL1ABC", "14", 2, 14025000)
        other_band = self.log("K1ABC", "05", 3, 28025000)
        same_zone_mm = self.log("K1ABC/MM", "05", 4, 14025000)
        domestic = self.log("JA2XYZ", "27", 5, 14025000)
        island = self.log("JD1ABC", "48", 6, 14025000)
        new_zone_mm = self.log("JA3ABC/MM", "16", 7, 14025000)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual([(rows[qso]["IsMultiplier1"], rows[qso]["IsMultiplier2"]) for qso in
                          (first, repeated, corrected, other_band, same_zone_mm, domestic, island, new_zone_mm)],
                         [(1, 1), (0, 0), (1, 1), (1, 1), (0, 0), (0, 0), (0, 0), (1, 0)])
        score = self.read("score")["score"]
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (7, 7, 49))
        self.assertEqual((score["countries"], score["zones"], score["prefectures"]), (3, 4, 0))
        self.assertEqual(score["multiplierSummaryLabels"], ["3 country/band multipliers", "4 CQ zone/band multipliers"])
        self.assertEqual(self.rtc_score(), (49, {"country": 3, "zone": 4}))
        self.mutate("qso_correct", qsoID=corrected, fields={"other_2": "05"})
        self.assertEqual(self.read("score")["score"]["total"], 42)
        self.mutate("qso_delete", qsoID=other_band)
        self.assertEqual(self.read("score")["score"]["total"], 20)
        self.host.close()
        self.host = Host(self.root)
        self.mutate("recalculate")
        self.assertEqual(self.read("score")["score"]["total"], 20)
        self.assertIn("CLAIMED-SCORE: 20 (7-5-4)\r\n", self.read("export")["content"])
        self.create_station("K1ABC/MM")
        self.log("JA1ABC", "13", 0, 14025000)
        self.log("DL1ABC", "14", 1, 14025000)
        self.assertEqual(self.read("score")["score"]["total"], 1)

    def test_unmarked_history_keeps_global_numbers_and_original_points_after_restart(self):
        store = self.host.database(self.session)
        state = store.state(self.session)
        self.assertEqual(state.pop("scoringRevision"), "26.10.26")
        store.conn.execute("UPDATE xlog_session SET state=? WHERE id=?", (json.dumps(state), self.session))
        store.conn.commit()
        self.host.close()
        self.host = Host(self.root)
        first = self.log("JA1ABC", "13", 0, 14025000)
        other_band = self.log("JA1ABC", "13", 1, 28025000)
        self.log("DL1ABC", "14", 2, 14025000)
        self.mutate("recalculate")
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.assertNotIn("multiplierSummaryLabels", self.read("score")["score"])
        self.assertNotIn("prefectures", self.read("score")["score"])
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual([rows[qso]["IsMultiplier1"] for qso in (first, other_band)], [1, 0])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.assertEqual(self.read("projection")["projection"]["ruleIdentity"]["version"], "26.10.11")
        self.assertIn("CLAIMED-SCORE: 8 (3-4-2)\r\n", self.read("export")["content"])

    def test_revised_exchange_role_boundaries_reject_commit_correction_and_setup_atomically(self):
        for station, contact, upper, invalid in (("JA1ABC", "K1ABC", "40", "50"),
                ("OM0RX", "JA1ABC", "50", "51"),
                ("JA1ABC", "JA3ABC/MM", "40", "50"),
                ("K1ABC/MM", "JA1ABC", "50", "51")):
            with self.subTest(station=station, contact=contact):
                self.create_station(station)
                qso = self.log(contact, upper, 0, 14025000)
                self.assert_rejected_atomically("qso_commit", qsoID=uid(), timestamp="2026-10-21 09:01:00",
                                               fields={"callsign": contact, "other_2": invalid})
                self.assert_rejected_atomically("qso_correct", qsoID=qso, fields={"other_2": invalid})
                sent_upper = "50" if station == "JA1ABC" else "40"
                sent_invalid = str(int(sent_upper) + 1)
                self.assert_rejected_atomically("qso_commit", qsoID=uid(), timestamp="2026-10-21 09:02:00",
                                               fields={"callsign": contact, "other_1": sent_invalid, "other_2": upper})
                self.assert_rejected_atomically("qso_correct", qsoID=qso, fields={"other_1": sent_invalid})
                setup = self.read("setup_get")["setup"]
                setup["settings"]["SentExchange"] = sent_invalid
                self.assert_rejected_atomically("setup_save", setup=setup)
                setup["settings"]["SentExchange"] = sent_upper
                self.mutate("setup_save", setup=setup)
                state = self.host.database(self.session).state(self.session)
                creation = {"pluginID": self.plugin_id, "workspaceGeneration": uid(),
                            "station": state["station"], "reference": state["reference"],
                            "frequencyHz": 14025000, "settings": {**state["settings"], "SentExchange": sent_invalid}}
                with self.assertRaisesRegex(HostError, "JIDX.*1 to"):
                    self.host.new_state(uid(), creation)
                historical = self.host.new_state(uid(), creation, scoring_revision=None)
                self.assertIsNone(historical["scoringRevision"])

    def test_legacy_import_and_unrelated_setup_keep_historical_zone_50_policy(self):
        fixture = legacy_fixtures.LegacyImportTests()
        fixture.setUp()
        try:
            with sqlite3.connect(fixture.source) as connection:
                connection.execute("UPDATE ContestInstance SET ContestName=?,ModeCategory=?,SentExchange='50'",
                                   (self.cabrillo_name, self.mode))
                connection.execute("UPDATE DXLOG SET ContestName=?,Mode=?", (self.cabrillo_name, self.mode))
            preview = fixture.preview()
            params = fixture.import_params(preview)
            params.update(pluginID=self.plugin_id, settings={"SentExchange": "50", "ModeCategory": self.mode})
            imported = fixture.call("legacy_import", params)
            session = imported["sessionID"]
            store = fixture.host.database(session)
            self.assertIsNone(store.state(session)["scoringRevision"])
            before = deepcopy(store.fetch_all_contacts_asc())
            setup = fixture.call("setup_get", {"sessionID": session})["setup"]
            setup["name"] = "Historical JIDX unchanged"
            fixture.call("setup_save", {"sessionID": session, "expectedRevision": imported["revision"],
                                       "operationID": uid(), "setup": setup})
            self.assertEqual(store.state(session)["settings"]["SentExchange"], "50")
            self.assertIsNone(store.state(session)["scoringRevision"])
            self.assertEqual(store.fetch_all_contacts_asc(), before)
        finally:
            fixture.tearDown()


class JIDXCWHostTests(JIDXHostCase, unittest.TestCase):
    plugin_id = "jidx_cw"
    plugin_name = "JIDX CW"
    mode = "CW"
    report = "599"
    cabrillo_name = "JIDX-CW"


class JIDXPhoneHostTests(JIDXHostCase, unittest.TestCase):
    plugin_id = "jidx_ph"
    plugin_name = "JIDX PH"
    mode = "SSB"
    report = "59"
    cabrillo_name = "JIDX-SSB"


class JIDXRelocationTests(unittest.TestCase):
    def test_both_pinned_modules_load_after_python_tree_relocation(self):
        with TemporaryDirectory() as directory:
            relocated = Path(directory) / "python"
            source = Path(__file__).resolve().parents[1]
            shutil.copytree(source / "contest_host", relocated / "contest_host")
            shutil.copytree(source / "vendor", relocated / "vendor")
            environment = {**os.environ, "PYTHONPATH": str(relocated)}
            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "from contest_host.upstream import load_plugin; "
                        "print(load_plugin('jidx_cw').name); "
                        "print(load_plugin('jidx_ph').name)"
                    ),
                ],
                check=True,
                capture_output=True,
                text=True,
                cwd=directory,
                env=environment,
            )
            self.assertEqual(completed.stdout.splitlines(), ["JIDX CW", "JIDX PH"])


if __name__ == "__main__":
    unittest.main()
