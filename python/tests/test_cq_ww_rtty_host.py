"""Original source-pinned CQ WW RTTY plugin through the production host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class CQWWRTTYHostTests(unittest.TestCase):
    source_hash = "38f63367317c92850ae112ba51931a8db477467a18baca5d7d242ef36f66deb5"

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
            "pluginID": "cq_ww_rtty",
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "ARRLSection": "DX"},
            "frequencyHz": 14080000,
            "settings": {
                "SentExchange": "15",
                "ModeCategory": "RTTY",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
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

    def log(self, call="K1ABC", zone="5", state="CT", minute=0, frequency=14080000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 08:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_1": zone, "other_2": state},
        )
        return qso

    def test_original_bytes_catalog_defaults_fields_modes_and_setup_validation(self):
        source = VENDOR / "not1mm/plugins/cq_ww_rtty.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin("cq_ww_rtty").__file__, str(source))
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == "cq_ww_rtty")
        self.assertEqual(item["name"], "CQ WW RTTY")
        self.assertEqual(item["modes"][0], "RTTY")
        self.assertIn("USB-D", item["modes"])
        self.assertEqual(item["sentExchangeHint"], "CQ Zone + (state/VE area)")
        self.assertTrue(item["digitalLoggingSupported"])

        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["mode"], view["nextField"]), ("RTTY", "other_1"))
        self.assertEqual(view["matrixTrackers"], ["countries", "zones", "states"])
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), ("599", "599"))
        self.assertEqual((fields["other_1"]["label"], fields["other_1"]["value"], fields["other_1"]["visible"]),
                         ("CQ Zone", "", True))
        self.assertEqual((fields["other_2"]["label"], fields["other_2"]["value"], fields["other_2"]["visible"]),
                         ("State/Prov", "", True))
        self.assertEqual(len(view["functionKeys"]), 12)

        setup = self.read("setup_get")["setup"]
        for exchange in ("", "0", "41", "15 C T", "15 12"):
            invalid = deepcopy(setup)
            invalid["settings"]["SentExchange"] = exchange
            with self.subTest(exchange=exchange), self.assertRaisesRegex(HostError, "CQ WW RTTY sent exchange"):
                self.mutate("setup_save", setup=invalid)
        invalid = deepcopy(setup)
        invalid["settings"]["ModeCategory"] = "CW"
        with self.assertRaisesRegex(HostError, "supported RTTY submode"):
            self.mutate("setup_save", setup=invalid)
        setup["settings"].update(SentExchange="15 DX", ModeCategory="USB-D")
        saved = self.mutate("setup_save", setup=setup)["projection"]
        self.assertEqual((saved["mode"], {field["id"]: field["value"] for field in saved["fields"]}["other_1"]),
                         ("USB-D", ""))

    def test_exchange_validation_run_and_sandp_esm_commit_with_fldigi_output(self):
        for zone in ("", "0", "41", " 5"):
            with self.subTest(zone=zone), self.assertRaisesRegex(HostError, "CQ zone must be 1 to 40"):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_1": zone, "other_2": "CT"})
        with self.assertRaisesRegex(HostError, "state/VE area is required"):
            self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_1": "5", "other_2": ""})
        self.assertEqual(self.mutate("function_key", key="F1")["actions"][0]["kind"], "fldigi")
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")

        sandp_call = self.mutate("esm", field="callsign",
                                 fields={"callsign": "K1ABC", "other_1": "5", "other_2": "CT"})
        self.assertTrue(all(action["kind"] == "fldigi" for action in sandp_call["actions"]))
        sandp_exchange = self.mutate("esm", field="other_2",
                                     fields={"callsign": "K1ABC", "other_1": "5", "other_2": "CT"})
        self.assertTrue(all(action["kind"] == "fldigi" for action in sandp_exchange["actions"]))
        self.assertEqual(self.read("log")["total"], 1)

        self.mutate("run_state", run=True)
        run_call = self.mutate("esm", field="callsign",
                               fields={"callsign": "DL1ABC", "other_1": "14", "other_2": "DX"})
        self.assertTrue(all(action["kind"] == "fldigi" for action in run_call["actions"]))
        run_exchange = self.mutate("esm", field="other_1",
                                   fields={"callsign": "DL1ABC", "other_1": "14", "other_2": "DX"})
        self.assertTrue(all(action["kind"] == "fldigi" for action in run_exchange["actions"]))
        self.assertEqual(self.read("log")["total"], 2)

    def test_rtty_macro_expands_caret_m_only_as_fldigi_newline(self):
        setup = self.read("setup_get")["setup"]
        setup["macros"] = [{"mode": "S", "key": "F6", "label": "Two lines",
                            "template": "{OTHER1}|{OTHER2}^M{CALL}"}]
        saved = self.mutate("setup_save", setup=setup)
        effective = next(item for item in saved["effectiveMacros"]
                         if item["mode"] == "S" and item["key"] == "F6")
        self.assertEqual(effective["template"], "{OTHER1}|{OTHER2}^M{CALL}")
        action = self.mutate("function_key", key="F6",
                             fields={"callsign": "K1ABC", "other_1": "A#B",
                                     "other_2": "A^MB"})["actions"][0]
        self.assertEqual((action["kind"], action["signal"], action["payload"]),
                         ("fldigi", "digital", "A#B|A^MB\nK1ABC"))
        self.assertEqual(action["payloadUTF8Bytes"], len("A#B|A^MB\nK1ABC".encode("utf-8")))

    def test_points_country_zone_state_multipliers_and_band_dupes(self):
        self.log()
        self.log("DL1ABC", "14", "DX", 1)
        self.log("K1ABC", "4", "MA", 2)
        self.log("K1ABC", "5", "MA", 3, 7080000)
        score = self.read("score")
        self.assertEqual(score["score"], {
            "qsos": 4, "points": 8, "countries": 3, "zones": 3, "states": 2,
            "multipliers": 8, "total": 64,
        })
        self.assertEqual(len(score["matrices"]["countries"]), 3)
        self.assertEqual(len(score["matrices"]["zones"]), 3)
        self.assertEqual(score["matrices"]["states"], [
            {"value": "CT", "band": 14.0, "qsos": 1},
            {"value": "MA", "band": 7.0, "qsos": 1},
        ])

    def test_correction_delete_restart_and_cabrillo_rtty_submode_output(self):
        first = self.log("K1ABC", "5", "CT", 1, 7080000)
        duplicate = self.log("K1ABC", "4", "MA", 0, 7080000)
        self.assertEqual(self.read("score")["score"]["total"], 9)
        self.mutate("qso_correct", qsoID=duplicate,
                    fields={"callsign": "DL1ABC", "other_1": "14", "other_2": "DX"},
                    reason="Correct duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 25)
        self.mutate("qso_delete", qsoID=duplicate, reason="Remove corrected QSO")
        self.assertEqual(self.read("score")["score"]["total"], 9)

        setup = self.read("setup_get")["setup"]
        setup["settings"].update(SentExchange="15 DX", ModeCategory="USB-D")
        self.mutate("setup_save", setup=setup)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 9)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: CQ-WW-RTTY\r\n", export)
        self.assertIn("CATEGORY-MODE: USB-D\r\n", export)
        self.assertIn("CLAIMED-SCORE: 9\r\n", export)
        lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1:3], ["7080", "RY"])
        self.assertEqual(lines[0][5:], ["OM0RX", "599", "15", "DX", "K1ABC", "599", "05", "CT"])

    def test_received_correction_preserves_historical_sent_exchange_after_setup_change(self):
        qso = self.log("K1ABC", "5", "CT", 0)
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "14 MA"
        self.mutate("setup_save", setup=setup)

        self.mutate("qso_correct", qsoID=qso, fields={"other_1": "4", "other_2": "MA"},
                    reason="Correct received exchange")
        row = self.read("log")["rows"][0]
        self.assertEqual((row["SentNr"], row["ZN"], row["Exchange1"]), ("15 DX", 4, "MA"))

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        line = next(line.split() for line in export.splitlines() if line.startswith("QSO:"))
        self.assertEqual(line[5:], ["OM0RX", "599", "15", "DX", "K1ABC", "599", "04", "MA"])

    def test_external_completion_preserves_occupied_entry_and_raw_sent_evidence(self):
        self.mutate("draft_apply",fields={"callsign":"DL1TEST","sent":"599","receive":"599","other_1":"14","other_2":"DX"})
        before=self.read("projection")["projection"]
        packet={"CALL":"K1ABC","MODE":"RTTY","FREQ":"14.080000","QSO_DATE":"20261027","TIME_ON":"081500","RST_SENT":"579","RST_RCVD":"589","CQZ":"5","STATE":"CT","STX":"41","APP_XLOG_EXTERNAL_INSTANCE":"wsjtx/127.0.0.1:54321/Engine-A"}
        result=self.mutate("digital_ingest",workspaceGeneration=self.workspace,semanticIdentity="2"*64,packet=packet)
        after=result["projection"]
        self.assertEqual(after["draftID"],before["draftID"])
        self.assertEqual(after["fields"],before["fields"])
        row=self.read("log")["rows"][0]
        self.assertEqual((row["SNT"],row["RCV"]),("579","589"))
        stored=self.host.database(self.session).exec_sql("SELECT packet FROM xlog_digital_event WHERE qso_id=?",(result["qsoID"],))
        import json
        self.assertEqual(json.loads(stored["packet"]),packet)
        prepared=self.read("export_prepare",format="adif")
        chunk=self.read("export_read",exportID=prepared["artifactID"],workspaceGeneration=self.workspace,offset=0,length=prepared["byteLength"])
        import base64
        exported=base64.b64decode(chunk["dataBase64"]).decode("utf-8")
        self.assertIn("<STX:2>41",exported)
        self.assertIn("APP_XLOG_EXTERNAL_INSTANCE",exported)
        self.assertEqual(exported.upper().count("<MODE:"),1)
        # A genuine later contest duplicate has a different external event ID.
        later={**packet,"TIME_ON":"081600"}
        self.mutate("digital_ingest",workspaceGeneration=self.workspace,semanticIdentity="3"*64,packet=later)
        self.assertEqual(self.read("log")["total"],2)

    def test_received_token_cannot_overwrite_occupied_or_retired_fields(self):
        projection=self.read("projection")["projection"]
        self.mutate("digital_select",workspaceGeneration=self.workspace,draftID=projection["draftID"],fieldID="callsign",value="K1ABC",source="fldigi/instance/snapshot")
        with self.assertRaises(HostError):self.mutate("digital_select",workspaceGeneration=self.workspace,draftID=projection["draftID"],fieldID="callsign",value="W1AW",source="other")
        with self.assertRaises(HostError):self.mutate("digital_select",workspaceGeneration=self.workspace,draftID=uid(),fieldID="other_2",value="CT",source="other")

    def test_original_digital_handler_commits_once_and_semantic_duplicate_replays(self):
        semantic = "1" * 64
        packet = {"CALL": "K1ABC", "MODE": "RTTY", "FREQ": "14.080000",
                  "QSO_DATE": "20261020", "TIME_ON": "081500", "RST_SENT": "599",
                  "RST_RCVD": "599", "CQZ": "5", "STATE": "CT"}
        first = self.mutate("digital_ingest", workspaceGeneration=self.workspace,
                            semanticIdentity=semantic, packet=packet)
        self.assertFalse(first["digitalDuplicate"])
        self.assertEqual(self.read("log")["total"], 1)

        duplicate = self.mutate("digital_ingest", workspaceGeneration=self.workspace,
                                semanticIdentity=semantic, packet=packet)
        self.assertTrue(duplicate["digitalDuplicate"])
        self.assertEqual(duplicate["qsoID"], first["qsoID"])
        self.assertEqual(self.read("log")["total"], 1)

        self.host.close()
        self.host = Host(self.root)
        reopened = self.mutate("digital_ingest", workspaceGeneration=self.workspace,
                               semanticIdentity=semantic, packet=packet)
        self.assertTrue(reopened["digitalDuplicate"])
        self.assertEqual(self.read("log")["total"], 1)


if __name__ == "__main__":
    unittest.main()
