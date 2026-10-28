"""Real Host regressions for the 28 October review; disposable storage only."""
import base64
import hashlib
import json
from copy import deepcopy
import unittest
from contest_host.host import HostError
import test_wave5_adif_host as import_tests
from test_review_adif_enrichment import fields

Helpers = import_tests.HistoricalImportTests


class ReviewImportTests(unittest.TestCase):
    setUp = Helpers.setUp
    tearDown = Helpers.tearDown
    call = Helpers.call
    mutate = Helpers.mutate
    read = Helpers.read
    create_plugin = Helpers.create_plugin
    source = Helpers.source
    preview = Helpers.preview
    apply = Helpers.apply

    def test_string_serials_match_our_export_contract_and_reimport_once(self):
        config = self.create_plugin("cq_wpx_cw")
        source = self.source("cq_wpx_cw", config["station"], SRX_STRING="0202")
        del source["raw"]["STX"]
        del source["raw"]["SRX"]
        store = self.host.database(self.session)
        draft = deepcopy(store.state(self.session)["draft"])
        reserved = store.exec_sql_mult("SELECT * FROM xlog_serial")
        self.assertEqual(self.preview(source)["status"], "ready")
        self.apply(source)
        row = self.read("log")["rows"][0]
        self.assertEqual((int(row["SentNr"]), int(row["NR"])), (101, 202))
        self.assertEqual(store.state(self.session)["draft"], draft)
        self.assertEqual(store.exec_sql_mult("SELECT * FROM xlog_serial"), reserved)
        self.assertEqual(store.state(self.session)["historicalSerialFloor"], 101)
        self.assertEqual(self.preview(source)["status"], "already-imported")
        self.apply(source)
        self.assertEqual(self.read("log")["total"], 1)

    def test_explicit_invalid_serial_is_not_replaced_by_text_fallback(self):
        config = self.create_plugin("cq_wpx_cw")
        source = self.source("cq_wpx_cw", config["station"], STX="", STX_STRING="101")
        with self.assertRaises(HostError):
            self.preview(source)
        self.assertEqual(self.read("log")["total"], 0)

    def test_original_naqp_sent_exchange_reaches_cabrillo(self):
        config = self.create_plugin("naqp_cw")
        source = self.source("naqp_cw", config["station"], NAME="ALICE", STATE="MA", STX_STRING="BOB SK")
        before = deepcopy(self.host.database(self.session).state(self.session))
        self.apply(source)
        row = self.read("log")["rows"][0]
        self.assertEqual(row["SentNr"], "BOB SK")
        after = self.host.database(self.session).state(self.session)
        self.assertEqual(after["settings"], before["settings"])
        self.assertEqual(after["draft"], before["draft"])
        prepared = self.read("export_prepare", format="cabrillo")
        response = self.read("export_read", workspaceGeneration=self.workspace,
                             exportID=prepared["artifactID"], offset=0, length=prepared["byteLength"])
        payload = base64.b64decode(response["dataBase64"]).decode()
        qso = next(line for line in payload.splitlines() if line.startswith("QSO:"))
        self.assertIn("BOB", qso)
        self.assertIn("SK", qso)
        self.assertIn("ALICE", qso)

    def exported(self):
        prepared = self.read("export_prepare", format="adif")
        payload = self.export_bytes(prepared)
        self.assertEqual(len(payload), prepared["byteLength"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), prepared["sha256"])
        return prepared, payload, fields(payload.decode().split("<EOH>")[-1])

    def export_bytes(self, prepared):
        response = self.read("export_read", workspaceGeneration=self.workspace,
                             exportID=prepared["artifactID"], offset=0, length=prepared["byteLength"])
        return base64.b64decode(response["dataBase64"])

    def test_all_admitted_serial_definitions_export_and_import_their_own_bytes(self):
        for plugin in ("cq_wpx_cw", "cq_wpx_ssb", "cq_wpx_rtty", "darc_vhf", "nac_vhf", "ta_vhf_uhf_contest"):
            with self.subTest(plugin=plugin):
                config = self.create_plugin(plugin)
                mode = "SSB" if plugin.endswith("ssb") else "RTTY" if plugin.endswith("rtty") else "CW"
                source = self.source(plugin, config["station"], MODE=mode, SRX_STRING="0202",
                                     MY_GRIDSQUARE="JN88XX", GRIDSQUARE="JO60AA")
                del source["raw"]["STX"], source["raw"]["SRX"]
                before = deepcopy(self.host.database(self.session).state(self.session)["draft"])
                serials = self.host.database(self.session).exec_sql_mult("SELECT * FROM xlog_serial")
                self.apply(source)
                _, payload, raw = self.exported()
                self.assertEqual(self.host.database(self.session).state(self.session)["draft"], before)
                self.assertEqual(self.host.database(self.session).exec_sql_mult("SELECT * FROM xlog_serial"), serials)
                original = self.read("log")["rows"][0]
                self.create_plugin(plugin)
                imported = {"raw": raw, "metadata": None, "sourceSHA256": hashlib.sha256(payload).hexdigest()}
                self.assertEqual(self.preview(imported)["status"], "ready")
                self.apply(imported)
                row = self.read("log")["rows"][0]
                self.assertEqual((row["ID"], row["SentNr"], row["NR"], row["Mode"]),
                                 (original["ID"], original["SentNr"], original["NR"], original["Mode"]))
                self.apply(imported)
                self.assertEqual(self.read("log")["total"], 1)

    def check_corrections(self, qso, packet):
        store = self.host.database(self.session)
        draft = deepcopy(store.state(self.session)["draft"])
        prepared, original, _ = self.exported()
        self.mutate("qso_correct", qsoID=qso, operator="NEWOP", receiveFrequencyHz=14050000, reason="Disposable correction")
        _, _, corrected = self.exported()
        self.assertEqual(corrected["OPERATOR"], "NEWOP")
        if "FREQ_RX" in packet:
            self.assertEqual(float(corrected["FREQ_RX"]), 14.05)
        self.assertEqual(json.loads(corrected["APP_XLOG_EXTERNAL_ADIF"]), packet)
        self.assertEqual(corrected["MODE"], packet["MODE"])
        self.assertEqual(corrected.get("STX"), packet.get("STX"))
        self.assertEqual(self.export_bytes(prepared), original)
        self.mutate("qso_correct", qsoID=qso, receiveFrequencyHz=0, reason="Disposable RX clear")
        _, _, cleared = self.exported()
        self.assertNotIn("FREQ_RX", cleared)
        self.assertEqual(json.loads(cleared["APP_XLOG_EXTERNAL_ADIF"]), packet)
        self.assertEqual(store.state(self.session)["draft"], draft)
        before = tuple(store.conn.iterdump())
        with self.assertRaisesRegex(HostError, "Operator is required"):
            self.mutate("qso_correct", qsoID=qso, operator="", reason="Explicit invalid clear")
        self.assertEqual(tuple(store.conn.iterdump()), before)

    def test_historical_import_then_actual_contact_correction_and_prepared_bytes(self):
        config = self.create_plugin("cq_wpx_cw")
        source = self.source("cq_wpx_cw", config["station"], OPERATOR="OLDOP", FREQ_RX="14.026")
        self.apply(source)
        self.check_corrections(self.read("log")["rows"][0]["ID"], source["raw"])

    def test_original_digital_completion_then_contact_correction_and_prepared_bytes(self):
        self.create_plugin("cq_wpx_rtty")
        packet = {"CALL": "K1ABC", "MODE": "RTTY", "SUBMODE": "RTTY", "FREQ": "14.080000",
                  "QSO_DATE": "20261021", "TIME_ON": "081500", "RST_SENT": "599", "RST_RCVD": "579",
                  "STX": "101", "SRX": "202", "OPERATOR": "OLDOP"}
        # Current digital admission does not accept RX packets; preserve that
        # boundary rather than silently widening the supported engine envelope.
        with self.assertRaisesRegex(HostError, "unsupported"):
            self.mutate("digital_ingest", workspaceGeneration=self.workspace, semanticIdentity="8" * 64,
                        packet={**packet, "FREQ_RX": "14.026"})
        result = self.mutate("digital_ingest", workspaceGeneration=self.workspace, semanticIdentity="7" * 64, packet=packet)
        self.check_corrections(result["qsoID"], packet)


if __name__ == "__main__":
    unittest.main()
