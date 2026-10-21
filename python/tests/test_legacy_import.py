from copy import deepcopy
from contextlib import closing
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError


def uid():
    return str(uuid.uuid4())


CTY = {
    "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
    "K1ABC": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
    "K1ABD": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
}


class LegacyImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "legacy.sqlite"
        with closing(sqlite3.connect(self.source)) as connection:
            connection.executescript("""
                CREATE TABLE ContestInstance(ContestID INTEGER PRIMARY KEY,ContestName TEXT,StartDate TEXT,
                    OperatorCategory TEXT,BandCategory TEXT,PowerCategory TEXT,ModeCategory TEXT,
                    OverlayCategory TEXT,ClaimedScore INTEGER,Operators TEXT,Soapbox TEXT,SentExchange TEXT,
                    ContestNR INTEGER,SubType TEXT,StationCategory TEXT,AssistedCategory TEXT,
                    TransmitterCategory TEXT,TimeCategory TEXT);
                CREATE TABLE Station(Call TEXT,GridSquare TEXT,CQZone INTEGER);
                CREATE TABLE DXLOG(TS TEXT NOT NULL,Call TEXT NOT NULL,Freq REAL,Mode TEXT,ContestName TEXT,
                    SNT TEXT,RCV TEXT,CountryPrefix TEXT,StationPrefix TEXT,ZN INTEGER,SentNr INTEGER,
                    Points INTEGER,IsMultiplier1 INTEGER,IsMultiplier2 INTEGER,Band REAL,WPXPrefix TEXT,
                    Exchange1 TEXT,ContestNR INTEGER,isMultiplier3 INTEGER,MiscText TEXT,IsRunQSO INTEGER,
                    Run1Run2 INTEGER,Operator TEXT,ID TEXT,CLAIMEDQSO INTEGER,PluginPrivate TEXT,
                    PRIMARY KEY(TS,Call));
                INSERT INTO ContestInstance VALUES(1,'CQ-WW-CW','2026-10-18','SINGLE-OP','ALL','LOW','CW',
                    'N/A',123,'OM0RX','legacy note','15',7,'','FIXED','NON-ASSISTED','ONE','24-HOURS');
                INSERT INTO Station VALUES('OM0RX','JN88',NULL);
                INSERT INTO DXLOG VALUES('2026-10-18 01:02:03','K1ABC',14025.0,'CW','CQ-WW-CW','599','599',
                    'K','OM0RX',5,1,3,1,1,14.0,'K1','05',7,0,'plugin text',1,1,'OM0RX','legacy-id',1,'raw-only');
                INSERT INTO DXLOG VALUES('2026-10-18 01:03:04','DL1ABC',7025.0,'CW','CQ-WW-CW','599','599',
                    'DL','OM0RX',14,2,1,1,1,7.0,'DL1','14',7,0,'second',0,1,'OM0RX','legacy-id-2',1,'raw-two');
            """)
        self.host = Host(self.root / "host")

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        return self.host.dispatch({"id": uid(), "method": method, "params": params})

    def preview(self):
        return self.call("legacy_preview", {"sourcePath": str(self.source), "sourceContestNR": 7})

    def import_params(self, preview, operation=None):
        return {"sessionID": "11111111-1111-4111-8111-111111111111",
                "workspaceGeneration": uid(), "operationID": operation or uid(), "expectedRevision": 0,
                "pluginID": "cq_ww_cw", "station": {"Call": "OM0RX", "GridSquare": "JN88"},
                "frequencyHz": 14025000, "settings": {"SentExchange": "15", "ModeCategory": "CW"},
                "reference": {"id": "test-cty", "countries": deepcopy(CTY)},
                "sourcePath": str(self.source), "sourceIdentity": preview["source"]["identity"],
                "sourceDigest": preview["source"]["digest"], "sourceContestNR": 7}

    def test_preview_and_import_preserve_plugin_fields_and_provenance(self):
        preview = self.preview()
        self.assertEqual(preview["contest"]["rowCount"], 2)
        self.assertEqual(preview["contest"]["frequencyHz"], 14025000)
        self.assertEqual(preview["contest"]["pluginCandidates"], ["cq_ww_cw"])
        self.assertNotIn("CQZone", preview["station"])
        params = self.import_params(preview)
        params["station"] = preview["station"]
        params["settings"] = preview["contest"]["settings"]
        result = self.call("legacy_import", params)
        self.assertEqual(result["legacyImport"]["importedRows"], 2)
        log = self.call("log", {"sessionID": result["sessionID"]})
        raw = log["rows"][1]["legacyProvenance"]["rawFields"]
        self.assertEqual((raw["ID"], raw["ContestNR"], raw["PluginPrivate"]),
                         ("legacy-id", 7, "raw-only"))
        self.assertEqual(log["rows"][1]["raw_fields"],
                         {"callsign": "K1ABC", "sent": "599", "receive": "599",
                          "other_1": "1", "other_2": "05"})
        self.assertEqual((log["rows"][1]["Points"], log["rows"][1]["IsMultiplier1"]), (3, 1))
        store = self.host.database(result["sessionID"])
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_legacy_row_receipt")["n"], 2)

    def test_imported_edit_reads_full_legacy_row_and_keeps_original_provenance(self):
        preview = self.preview()
        result = self.call("legacy_import", self.import_params(preview))
        imported = self.call("log", {"sessionID": result["sessionID"]})["rows"][1]
        original = deepcopy(imported["legacyProvenance"]["rawFields"])
        corrected = self.call("qso_correct", {
            "sessionID": result["sessionID"], "operationID": uid(),
            "expectedRevision": result["revision"], "qsoID": imported["ID"],
            "fields": {"callsign": "K1ABD"}, "reason": "Correct legacy call",
        })
        row = self.call("log", {"sessionID": result["sessionID"],
                                "expectedRevision": corrected["revision"]})["rows"][1]
        self.assertEqual(row["legacyProvenance"]["rawFields"], original)
        self.assertEqual((row["Call"], row["SNT"], row["RCV"], row["SentNr"], row["MiscText"]),
                         ("K1ABD", "599", "599", 1, "plugin text"))

    def test_exact_retry_replays_without_duplicate_rows(self):
        preview = self.preview()
        params = self.import_params(preview)
        first = self.call("legacy_import", params)
        self.host.close()
        self.host = Host(self.root / "host")
        replay = self.call("legacy_import", params)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["revision"], first["revision"])
        self.assertEqual(self.call("log", {"sessionID": first["sessionID"]})["total"], 2)

        reconciled_params = {**params, "operationID": uid()}
        reconciled = self.call("legacy_import", reconciled_params)
        self.assertEqual((reconciled["legacyImport"]["importedRows"],
                          reconciled["legacyImport"]["reconciledRows"]), (0, 2))
        self.assertEqual(self.call("log", {"sessionID": first["sessionID"]})["total"], 2)

    def test_imported_delete_keeps_receipt_and_does_not_break_change_path(self):
        preview = self.preview()
        result = self.call("legacy_import", self.import_params(preview))
        imported = self.call("log", {"sessionID": result["sessionID"]})["rows"][0]
        deleted = self.call("qso_delete", {
            "sessionID": result["sessionID"], "operationID": uid(),
            "expectedRevision": result["revision"], "qsoID": imported["ID"],
            "reason": "Remove imported test row",
        })
        self.assertEqual(self.call("log", {"sessionID": result["sessionID"],
                                           "expectedRevision": deleted["revision"]})["total"], 1)
        store = self.host.database(result["sessionID"])
        self.assertEqual(store.exec_sql(
            "SELECT count(*) AS n FROM xlog_legacy_row_receipt WHERE target_qso_id=?", (imported["ID"],)
        )["n"], 1)

    def test_import_reports_source_change_and_plugin_conflict(self):
        preview = self.preview()
        with closing(sqlite3.connect(self.source)) as connection:
            connection.execute("UPDATE DXLOG SET PluginPrivate='changed' WHERE Call='K1ABC'")
            connection.commit()
        with self.assertRaises(HostError) as changed:
            self.call("legacy_import", self.import_params(preview))
        self.assertEqual(changed.exception.code, "source_changed")
        fresh = self.preview()
        params = self.import_params(fresh)
        params["pluginID"] = "cq_ww_ssb"
        params["settings"]["ModeCategory"] = "SSB"
        with self.assertRaises(HostError) as conflict:
            self.call("legacy_import", params)
        self.assertEqual(conflict.exception.code, "source_plugin_conflict")

    def test_completed_import_rejects_changed_source_on_reconciliation(self):
        preview = self.preview()
        params = self.import_params(preview)
        result = self.call("legacy_import", params)
        with closing(sqlite3.connect(self.source)) as connection:
            connection.execute("UPDATE DXLOG SET PluginPrivate='later' WHERE Call='K1ABC'")
            connection.commit()
        fresh = self.preview()
        retry = {**params, "operationID": uid(), "expectedRevision": result["revision"],
                 "sourceDigest": fresh["source"]["digest"]}
        with self.assertRaises(HostError) as conflict:
            self.call("legacy_import", retry)
        self.assertEqual(conflict.exception.code, "source_conflict")

    def test_preview_reports_non_json_legacy_cells_as_source_schema(self):
        with closing(sqlite3.connect(self.source)) as connection:
            connection.execute("UPDATE DXLOG SET PluginPrivate=? WHERE Call='K1ABC'",
                               (sqlite3.Binary(b'not-json'),))
            connection.commit()
        with self.assertRaises(HostError) as blob:
            self.preview()
        self.assertEqual(blob.exception.code, "source_schema")

        with closing(sqlite3.connect(self.source)) as connection:
            connection.execute("UPDATE DXLOG SET PluginPrivate='text',Freq=? WHERE Call='K1ABC'",
                               (float("inf"),))
            connection.commit()
        with self.assertRaises(HostError) as nonfinite:
            self.preview()
        self.assertEqual(nonfinite.exception.code, "source_schema")


if __name__ == "__main__":
    unittest.main()
