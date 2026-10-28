"""Real Host regressions for the 28 October review; disposable storage only."""
import base64
from copy import deepcopy
import unittest
from contest_host.host import HostError
from test_wave5_adif_host import HistoricalImportTests as Helpers


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


if __name__ == "__main__":
    unittest.main()
