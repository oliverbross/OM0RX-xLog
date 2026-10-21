"""Pinned ARI 40/80, EA RTTY, OK1WC and SSA MT plugins through the bounded host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.plugins import RTTY_MODES
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "ari_40_80": "55f1ebfc1953a7d6fa65a3dec38adcb2e83e328921ffb07b51c83811f1afb192",
    "ea_rtty": "464596fc9b95101b2fe7960974753f7805566f8a1805a3ce55e99d3d409cb564",
    "ok1wc": "77d0c2e2dc72d43d56433d01b55222cc57b4215a67a7eecc910fa3d91b6a44ea",
    "ssa_mt_cw": "24edb651b2a74d327ca820be9d6fb12db9b35d27914c8d5ba88a6da1858dfa36",
    "ssa_mt_ssb": "cb05d6f0e99f49d9e134ef1e749436d97b2a162e337de9ab64fceddf9e4168ca",
}
CASES = {
    "ari_40_80": {"sent": "RM", "mode": "CW", "call": "DL1ABC", "received": "TO",
                    "corrected": "MI", "points": 3, "score": 3, "sent_nr": "RM"},
    "ea_rtty": {"sent": "#", "mode": "RTTY", "call": "EA1ABC", "received": "M",
                "corrected": "TO", "points": 3, "score": 6, "sent_nr": 1},
    "ok1wc": {"sent": "#", "mode": "CW", "call": "DL1ABC", "received": "001",
              "corrected": "002", "exported": "2", "points": 1, "score": 1, "sent_nr": 1},
    "ssa_mt_cw": {"sent": "JP75XX", "mode": "CW", "call": "SM1ABC", "received": "JP75AA",
                  "received_serial": "001", "corrected": "JP75BB", "points": 2, "score": 2,
                  "sent_nr": 1},
    "ssa_mt_ssb": {"sent": "JP75XX", "mode": "SSB", "call": "SM1ABC", "received": "JP75AA",
                   "received_serial": "001", "corrected": "JP75BB", "points": 2, "score": 2,
                   "sent_nr": 1},
}


class EuropeanHFPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, plugin_id, sent_exchange=None, station_call="OM0RX", mode=None):
        case = CASES[plugin_id]
        root = Path(self.temporary.name).resolve() / f"{plugin_id}-{uid()}"
        host = Host(root)
        session = uid()
        countries = deepcopy(fixtures.CTY)
        countries.update({
            "EA1ABC": {"entity": "Spain", "continent": "EU", "cq": 14, "itu": 37,
                       "primary_pfx": "EA"},
            "EA2ABC": {"entity": "Spain", "continent": "EU", "cq": 14, "itu": 37,
                       "primary_pfx": "EA"},
            "SM1ABC": {"entity": "Sweden", "continent": "EU", "cq": 14, "itu": 18,
                       "primary_pfx": "SM"},
        })
        result = host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": uid(), "operationID": uid(),
            "expectedRevision": 0, "pluginID": plugin_id,
            "station": {"Call": station_call, "GridSquare": "JN88XX"},
            "frequencyHz": 7025000, "mode": mode or case["mode"],
            "settings": {"SentExchange": case["sent"] if sent_exchange is None else sent_exchange,
                         "ModeCategory": mode or case["mode"],
                         "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL",
                         "PowerCategory": "LOW"},
            "reference": {"id": "european-hf-cty-v1", "countries": countries},
        }})
        return host, root, session, result["revision"]

    @staticmethod
    def mutate(host, session, revision, method, **params):
        result = host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": session, "operationID": uid(), "expectedRevision": revision, **params}})
        return result, result["revision"]

    @staticmethod
    def read(host, session, method):
        return host.dispatch({"id": uid(), "method": method, "params": {"sessionID": session}})

    @staticmethod
    def exchange_fields(case, corrected=False):
        fields = {"callsign": case["call"], "other_2": case["corrected"] if corrected else case["received"]}
        if "received_serial" in case:
            fields["other_1"] = "002" if corrected else case["received_serial"]
        return fields

    def test_exact_sources_catalog_create_and_draft_contracts(self):
        expected = {
            "ari_40_80": ("ARI 40 80", ["CW", "SSB"], None),
            "ea_rtty": ("EA RTTY", list(RTTY_MODES), 1),
            "ok1wc": ("OK1WC Memorial Contest (MWC)", ["CW"], 1),
            "ssa_mt_cw": ("SSA MT CW", ["CW"], 1),
            "ssa_mt_ssb": ("SSA MT SSB", ["SSB"], 1),
        }
        for plugin_id, case in CASES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[plugin_id])
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                host, _, session, revision = self.create(plugin_id)
                try:
                    projection = self.read(host, session, "projection")["projection"]
                    name, modes, serial = expected[plugin_id]
                    self.assertEqual((projection["pluginName"], projection["supportedModes"],
                                      projection["reservedSerial"]), (name, modes, serial))
                    self.assertEqual(projection["allocatedSerialFieldID"],
                                     None if plugin_id in {"ari_40_80", "ssa_mt_cw", "ssa_mt_ssb"}
                                     else "other_1")
                    fields = {item["id"]: item for item in projection["fields"]}
                    self.assertEqual(fields["other_1"]["readOnly"],
                                     serial is not None and plugin_id not in {"ssa_mt_cw", "ssa_mt_ssb"})
                    result, revision = self.mutate(
                        host, session, revision, "draft_apply",
                        fields=self.exchange_fields(case))
                    values = {item["id"]: item["value"] for item in result["projection"]["fields"]}
                    self.assertEqual((values["callsign"], values["other_2"]),
                                     (case["call"], case["received"]))
                finally:
                    host.close()

    def test_commit_score_correction_restart_export_and_historical_sent_exchange(self):
        for plugin_id, case in CASES.items():
            with self.subTest(plugin=plugin_id):
                host, root, session, revision = self.create(plugin_id)
                qso = uid()
                try:
                    _, revision = self.mutate(
                        host, session, revision, "qso_commit", qsoID=qso,
                        timestamp="2026-10-21 15:00:00",
                        fields=self.exchange_fields(case))
                    row = self.read(host, session, "log")["rows"][0]
                    self.assertEqual((row["Points"], row["SentNr"]),
                                     (case["points"], case["sent_nr"]))
                    self.assertEqual(self.read(host, session, "score")["score"]["total"], case["score"])

                    if plugin_id == "ari_40_80":
                        setup = self.read(host, session, "setup_get")["setup"]
                        setup["settings"]["SentExchange"] = "MI"
                        _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
                    elif plugin_id in {"ssa_mt_cw", "ssa_mt_ssb"}:
                        setup = self.read(host, session, "setup_get")["setup"]
                        setup["settings"]["SentExchange"] = "JP76XX"
                        _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
                    _, revision = self.mutate(
                        host, session, revision, "qso_correct", qsoID=qso,
                        fields={key: value for key, value in self.exchange_fields(case, corrected=True).items()
                                if key != "callsign"}, reason="Correct received exchange")
                    corrected = self.read(host, session, "log")["rows"][0]
                    self.assertEqual(corrected["SentNr"], case["sent_nr"])
                    if plugin_id in {"ssa_mt_cw", "ssa_mt_ssb"}:
                        self.assertEqual((corrected["NR"], corrected["GridSquare"]), (2, "JP75XX"))
                finally:
                    host.close()

                host = Host(root)
                try:
                    self.assertEqual(self.read(host, session, "score")["score"]["total"], case["score"])
                    export = self.read(host, session, "export")["content"]
                    self.assertIn(f"CONTEST: {load_plugin(plugin_id).cabrillo_name}\r\n", export)
                    self.assertEqual(len([line for line in export.splitlines()
                                          if line.startswith("QSO:")]), 1)
                    self.assertIn(case.get("exported", case["corrected"]), export)
                finally:
                    host.close()

    def test_admission_rejects_wrong_bands_modes_and_exchange_shapes(self):
        host, _, session, revision = self.create("ari_40_80")
        try:
            with self.assertRaisesRegex(HostError, "does not support 20m"):
                self.mutate(host, session, revision, "draft_apply", frequencyHz=14025000, fields={})
        finally:
            host.close()
        with self.assertRaisesRegex(HostError, "6-character locator"):
            self.create("ssa_mt_cw", "JN88")

    def test_ok1wc_same_second_suffix_multiplier_is_stable(self):
        host, _, session, revision = self.create("ok1wc")
        try:
            for call, received in (("DL1ABC", "001"), ("K1ABC", "002")):
                _, revision = self.mutate(
                    host, session, revision, "qso_commit", qsoID=uid(),
                    timestamp="2026-10-21 16:00:00",
                    fields={"callsign": call, "other_2": received})
            score = self.read(host, session, "score")["score"]
            self.assertEqual((score["points"], score["multipliers"], score["total"]), (2, 1, 2))
            self.assertEqual(sum(row["IsMultiplier1"] for row in self.read(host, session, "log")["rows"]), 1)
        finally:
            host.close()

    def test_ssa_mt_function_key_and_esm_send_serial_and_station_locator(self):
        for plugin_id in ("ssa_mt_cw", "ssa_mt_ssb"):
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    result, revision = self.mutate(
                        host, session, revision, "function_key", key="F3")
                    direct = next(action for action in result["actions"] if action["key"] == "F3")
                    self.assertEqual((direct["sentSerial"], direct["sentExchange"]),
                                     ("1", "JP75XX"))
                    if plugin_id == "ssa_mt_cw":
                        self.assertEqual(direct["template"], "{RST} {SENTNR} {EXCHANGE}")
                    else:
                        self.assertEqual(direct["payload"], "59 1 JP75XX")

                    _, revision = self.mutate(host, session, revision, "run_state", run=True)
                    result, revision = self.mutate(
                        host, session, revision, "esm", field="callsign",
                        fields={"callsign": "SM1ABC"})
                    esm = next(action for action in result["actions"] if action["key"] == "F3")
                    self.assertEqual((esm["sentSerial"], esm["sentExchange"]),
                                     ("1", "JP75XX"))
                    if plugin_id == "ssa_mt_cw":
                        self.assertEqual(esm["template"], "{RST} {SENTNR} {EXCHANGE}")
                    else:
                        self.assertEqual(esm["payload"], "59 1 JP75XX")
                finally:
                    host.close()

    def test_ea_rtty_setup_refreshes_draft_without_rewriting_history(self):
        transitions = (("M", "TO", "EA1ABC"), ("#", "M", "OM0RX"))
        for original, replacement, station_call in transitions:
            with self.subTest(original=original, replacement=replacement):
                host, _, session, revision = self.create(
                    "ea_rtty", original, station_call=station_call)
                try:
                    projection = self.read(host, session, "projection")["projection"]
                    fields = {item["id"]: item for item in projection["fields"]}
                    expected_sent = original if original != "#" else "001"
                    self.assertEqual(fields["other_1"]["value"], expected_sent)

                    _, revision = self.mutate(
                        host, session, revision, "qso_commit", qsoID=uid(),
                        timestamp="2026-10-21 17:00:00",
                        fields={"callsign": "EA2ABC", "other_2": "TO"})
                    historical = self.read(host, session, "log")["rows"][0]["SentNr"]

                    setup = self.read(host, session, "setup_get")["setup"]
                    setup["settings"]["SentExchange"] = replacement
                    setup["station"]["Call"] = "EA1ABC"
                    result, revision = self.mutate(
                        host, session, revision, "setup_save", setup=setup)
                    fields = {item["id"]: item for item in result["projection"]["fields"]}
                    self.assertEqual(fields["other_1"]["value"], replacement)
                    self.assertIsNone(result["projection"]["reservedSerial"])
                    self.assertEqual(self.read(host, session, "log")["rows"][0]["SentNr"], historical)
                finally:
                    host.close()

    def test_ea_rtty_digital_aliases_export_as_ry_without_changing_live_mode(self):
        for mode in RTTY_MODES:
            with self.subTest(mode=mode):
                host, _, session, revision = self.create("ea_rtty", mode=mode)
                try:
                    _, revision = self.mutate(
                        host, session, revision, "qso_commit", qsoID=uid(),
                        timestamp="2026-10-21 18:00:00",
                        fields={"callsign": "EA1ABC", "other_2": "M"})
                    self.assertEqual(self.read(host, session, "projection")["projection"]["mode"], mode)
                    self.assertEqual(self.read(host, session, "log")["rows"][0]["Mode"], mode)
                    qso_line = next(line for line in self.read(host, session, "export")["content"].splitlines()
                                    if line.startswith("QSO:"))
                    self.assertEqual(qso_line.split()[2], "RY")
                finally:
                    host.close()


if __name__ == "__main__":
    unittest.main()
