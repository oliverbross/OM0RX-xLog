"""Independent arithmetic and real host/export coverage for official OK/OM CW 2026."""
from copy import deepcopy
import base64
import gzip
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host import okom
from contest_host.plugins import PLUGIN_REGISTRY
from contest_host.upstream import adapt_cw_template
import test_host as fixtures

CTY = {**deepcopy(fixtures.CTY),
       "OK1ABC": {"entity": "Czech Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OK"},
       "F1ABC": {"entity": "France", "continent": "EU", "cq": 14, "itu": 27, "primary_pfx": "F"},
       "R1ABC": {"entity": "European Russia", "continent": "EU", "cq": 16, "itu": 29, "primary_pfx": "UA"},
       "EU1ABC": {"entity": "Belarus", "continent": "EU", "cq": 16, "itu": 29, "primary_pfx": "EU"},
       "OM0RX/DL": {"entity": "Germany", "continent": "EU", "cq": 14, "itu": 28, "primary_pfx": "DL"}}


class OKOMHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0

    def tearDown(self):
        self.host.close()
        self.temp.cleanup()

    def call(self, method, **params):
        result = self.host.dispatch({"id": fixtures.uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = result["revision"]
        return result

    def create(self, call="OM0RX", prefix="OM", exchange="PRE"):
        return self.call("session_create", sessionID=self.session, workspaceGeneration=self.workspace,
            operationID=fixtures.uid(), expectedRevision=0, pluginID=okom.PLUGIN_ID,
            station={"Call": call, "OperatingCountryPrefix": prefix, "Country": "Mailing country ignored", "GridSquare": "JN88"},
            frequencyHz=14025000, settings={"SentExchange": exchange, "ModeCategory": "CW", "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL", "PowerCategory": "LOW"}, reference={"id": "okom-test-cty-v1", "countries": deepcopy(CTY)})

    def mutate(self, method, **params):
        return self.call(method, sessionID=self.session, operationID=fixtures.uid(), expectedRevision=self.revision, **params)

    def read(self, method, **params):
        return self.call(method, sessionID=self.session, **params)

    def log(self, call, exchange, minute, frequency=14025000):
        qso = fixtures.uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-11-14 12:{minute:02}:30", frequencyHz=frequency,
                    fields={"callsign": call, "other_2": exchange})
        return qso

    def test_rule_snapshot_and_complete_country_validated_district_reference(self):
        root = Path(__file__).resolve().parents[2]
        raw = gzip.decompress((root / "docs/contesting/sources/okom-cw-2026-20261104.html.gz").read_bytes())
        self.assertEqual((len(raw), sha256(raw).hexdigest()), (44125, okom.RULE_SHA256))
        self.assertIn(b"CW CONTEST", raw)
        self.assertEqual({key: len(values) for key, values in okom.DISTRICTS.items()}, {"OK": 86, "OM": 79})
        self.assertEqual(json.loads((root / "docs/contesting/OKOM_CW_2026_RULE_REFERENCE.json").read_text()), okom.REFERENCE)
        self.assertNotEqual(PLUGIN_REGISTRY[okom.PLUGIN_ID].name, PLUGIN_REGISTRY["ok1wc"].name)

    def test_score_labels_follow_the_existing_renderer_list_contract(self):
        self.create()
        self.log("OM1ABC", "BAA", 0)
        score = self.read("score")["score"]
        self.assertEqual(score["multiplierSummaryLabels"], ["1 DXCC / WAE countries", "1 OK / OM districts"])
        self.assertEqual(score["scoringLimitations"], [])

    def test_domestic_arithmetic_duplicates_multiband_correction_restart_and_exports(self):
        self.create()
        rows = [self.log("OM1ABC", " baa ", 0), self.log("OK1ABC", "APA", 1),
                self.log("DL1ABC", "001", 2), self.log("K1ABC", "002", 3), self.log("K1ABC/MM", "003", 4)]
        score = self.read("score")["score"]
        # Independently: 2+3+3+5+5 = 18 points; four countries + two districts = 6.
        self.assertEqual((score["points"], score["countries"], score["districts"], score["total"]), (18, 4, 2, 108))
        duplicate = self.log("OM1ABC", "BAA", 5)
        log = self.read("log")["rows"]
        self.assertEqual(next(row for row in log if row["ID"] == duplicate)["Points"], 0)
        self.assertEqual(self.read("score")["score"]["total"], 108)
        self.log("OM1ABC", "BAA", 6, 7025000)
        # New band: +2 points, +country and district => 20*8.
        self.assertEqual(self.read("score")["score"]["total"], 160)
        self.mutate("qso_correct", qsoID=rows[1], fields={"other_2": "APB"}, reason="Correct district")
        self.mutate("qso_delete", qsoID=rows[2], reason="Remove wrong contact")
        self.assertEqual(self.read("score")["score"]["total"], 119)  # 17 * 7
        before = self.read("score")["score"]
        self.mutate("recalculate")
        self.assertEqual(self.read("score")["score"], before)
        self.host.close(); self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"], before)
        exported = self.read("export")["content"]
        self.assertIn("CONTEST: OK-OM-DX\r\n", exported)
        self.assertIn("CLAIMED-SCORE: 119\r\n", exported)
        first = next(line for line in exported.splitlines() if line.startswith("QSO:") and "OM1ABC" in line)
        self.assertEqual(first.split(), ["QSO:", "14025", "CW", "2026-11-14", "1200", "OM0RX", "599", "PRE", "OM1ABC", "599", "BAA"])
        prepared = self.read("export_prepare", format="adif", expectedRevision=self.revision)
        chunk = self.read("export_read", exportID=prepared["artifactID"], workspaceGeneration=self.workspace,
                          offset=0, length=prepared["byteLength"])
        raw_adif = base64.b64decode(chunk["dataBase64"])
        self.assertEqual(sha256(raw_adif).hexdigest(), prepared["sha256"])
        adif = raw_adif.decode()
        self.assertIn("<CONTEST_ID:8>OK-OM-DX", adif)
        self.assertIn("<MODE:2>CW", adif)
        self.assertIn('"SentNr":"PRE"', adif)
        self.assertIn('"other_2":" baa "', adif)
        self.assertTrue(all(row["SentNr"] == "PRE" for row in self.read("log")["rows"]))

    def test_dx_arithmetic_serial_authority_and_portable_operating_location(self):
        self.create("OM0RX/DL", "DL", "#")
        view = self.read("projection")["projection"]
        self.assertEqual(view["reservedSerial"], 1)
        for index, (call, exchange) in enumerate([("OM1ABC", "BAA"), ("OK1ABC", "APA"), ("DL1ABC", "1"),
                                                  ("K1ABC", "2"), ("F1ABC", "3"), ("K1ABC/MM", "4")]):
            self.log(call, exchange, index)
        score = self.read("score")["score"]
        # DX: 10+10+1+5+3+5 = 34; five countries + two districts => 238.
        self.assertEqual((score["points"], score["multipliers"], score["total"]), (34, 7, 238))
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 7)
        self.assertEqual({int(row["SentNr"]) for row in self.read("log")["rows"]}, set(range(1, 7)))
        export = self.read("export")["content"]
        first = next(line for line in export.splitlines() if line.startswith("QSO:"))
        self.assertEqual(first.split()[5:8], ["OM0RX/DL", "599", "001"])
        self.assertIn("CLAIMED-SCORE: 238", export)

    def test_setup_rejects_missing_false_country_or_mismatched_district(self):
        for call, area, exchange in [("OM0RX", "", "PRE"), ("OM0RX", "DL", "#"), ("OM0RX", "OM", "APA"),
                                     ("DL1ABC", "DL", "PRE"), ("OK1ABC", "OK", "PRE")]:
            with self.subTest(call=call, area=area, exchange=exchange), self.assertRaises(HostError):
                self.create(call, area, exchange)
        self.create("OK1ABC", "OK", "apa")
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], None)

    def test_invalid_received_district_serial_band_and_annulled_countries(self):
        self.create()
        for call, exchange in [("OK1ABC", "ZZZ"), ("OK1ABC", "PRE"), ("OM1ABC", "APA"), ("DL1ABC", "0"), ("DL1ABC", "BAD")]:
            with self.subTest(call=call, exchange=exchange), self.assertRaises(HostError):
                self.log(call, exchange, 0)
        with self.assertRaises(HostError): self.log("K1ABC", "1", 0, 10125000)
        self.log("R1ABC", "1", 0); self.log("EU1ABC", "2", 1)
        self.assertEqual(self.read("score")["score"]["total"], 0)
        self.assertEqual(self.read("log")["total"], 2)

    def test_actual_esm_handles_district_and_logs_once_without_extra_serial(self):
        self.create()
        self.mutate("run_state", run=True)
        actions = self.mutate("esm", field="callsign", fields={"callsign": "OK1ABC"})["actions"]
        self.assertEqual([item["key"] for item in actions], ["F2", "F3"])
        self.assertEqual(actions[1]["sentSerial"], "PRE")
        result = self.mutate("esm", field="other_2", fields={"other_2": "APA"})
        self.assertEqual([item["key"] for item in result["actions"]], ["F4"])
        self.assertEqual(self.read("log")["total"], 1)

    def test_invalid_first_contact_does_not_consume_later_valid_credit(self):
        self.create()
        first = self.log("OM1ABC", "BAA", 0)
        # Representative retained imported/pre-repair row: an invalid exchange
        # remains in the log rather than being silently deleted or normalized.
        store = self.host.database(self.session)
        store.conn.execute("UPDATE DXLOG SET NR='ZZZ',Points=0 WHERE ID=?", (first,))
        store.conn.commit()
        second = self.log("OM1ABC", "BAA", 1)
        self.mutate("recalculate")
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["Points"], rows[second]["Points"]), (0, 2))
        self.assertEqual((rows[first]["NR"], self.read("score")["score"]["total"]), ("ZZZ", 4))

    def test_setup_changes_preserve_sent_snapshots_and_unknown_definition_never_adopts(self):
        self.create()
        qso = self.log("OK1ABC", "APA", 0)
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "BAR"
        self.mutate("setup_save", setup=setup)
        self.mutate("qso_correct", qsoID=qso, fields={"other_2": "APB"}, reason="Repair received district only")
        row = self.read("log")["rows"][0]
        self.assertEqual(row["SentNr"], "PRE")
        self.assertEqual(json.loads(row["MiscText"])["ruleSHA256"], okom.RULE_SHA256)
        self.assertIn("PRE", next(line for line in self.read("export")["content"].splitlines() if line.startswith("QSO:")))
        store = self.host.database(self.session)
        saved = store.state(self.session)
        saved["definitionVersion"] = "999.0.0"
        with self.assertRaises(HostError): self.host.verify_engine(saved)

    def test_macro_adapter_preserves_only_bounded_typed_cw_speed_directives(self):
        self.assertEqual(adapt_cw_template("cq_ww_cw", "{WPM:20}{CALL}{WPM:BASE}"), "{WPM:20}{CALL}{WPM:BASE}")
        for template in ("{WPM:4}", "{WPM:100}", "{WPM:0005}", "{WPM:20;TX}", "{WPM:base}"):
            with self.subTest(template=template), self.assertRaises(RuntimeError):
                adapt_cw_template("cq_ww_cw", template)
        with self.assertRaises(RuntimeError): adapt_cw_template("wae_ssb", "{WPM:20}CQ")

    def test_multiplier_analytics_and_historical_duplicate_flags_share_host_credit(self):
        self.create()
        self.log("OM1ABC", "BAA", 0); self.log("OM1ABC", "BAA", 1); self.log("OK1ABC", "APA", 2)
        meta = self.read("analytics", workspaceGeneration=self.workspace, action="prepare")
        self.assertTrue(meta["multiplierAdapter"])
        self.assertEqual(meta["scoreHistory"]["status"], "PASS")
        page = self.read("analytics", workspaceGeneration=self.workspace, action="page", snapshotID=meta["snapshotID"], offset=0, limit=500)
        self.assertEqual([row["hostDupe"] for row in page["rows"]], [False, True, False])
        district = next(view for view in meta["neededViews"] if view["id"] == "district")
        self.assertEqual(district["universeReference"]["sourceSHA256"], okom.RULE_SHA256)


if __name__ == "__main__":
    unittest.main()
