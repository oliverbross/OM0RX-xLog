"""Pinned ARI/DARC/EUDX/LZ/WAG plugins through the bounded host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "ari_dx": "aca1657269f715fc5d147aa9b5b884575fe63e5de36bc288d3660bb658320d0f",
    "darc_xmas": "a88a3bb7eaf765d6ce5039400d6a02db0ccb254cf3df76194604176adc295c4d",
    "eudx": "ae47db27143eebf8a0651ae023b3250058b81e14aa7e2d868a7777ace2975ae0",
    "lz-dx": "a3f3f6b73c0310d78cbdc42cb234b93990575e67257069c42bbe1ca068ac974b",
    "wag": "6435691dcf956c73111f6e66058d598a0fe9b0ef94b4cd38ded9a88f186c4276",
}


class CentralEuropeanPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, plugin_id, sent, station="K1ABC", frequency=14025000, mode="CW"):
        root = Path(self.temporary.name).resolve() / f"{plugin_id}-{uid()}"
        host = Host(root)
        session = uid()
        countries = deepcopy(fixtures.CTY)
        countries.update({
            "I1ABC": {"entity": "Italy", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "I"},
            "I1XYZ": {"entity": "Italy", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "I"},
            "LZ1ABC": {"entity": "Bulgaria", "continent": "EU", "cq": 20, "itu": 28, "primary_pfx": "LZ"},
            "DL1XYZ": {"entity": "Germany", "continent": "EU", "cq": 14, "itu": 28, "primary_pfx": "DL"},
        })
        result = host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": uid(), "operationID": uid(),
            "expectedRevision": 0, "pluginID": plugin_id,
            "station": {"Call": station, "GridSquare": "FN31"}, "frequencyHz": frequency,
            "mode": mode, "settings": {"SentExchange": sent, "ModeCategory": "MIXED"},
            "reference": {"id": "cty-v1", "countries": countries},
        }})
        return host, session, result["revision"]

    @staticmethod
    def mutate(host, session, revision, method, **params):
        result = host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": session, "operationID": uid(), "expectedRevision": revision, **params}})
        return result, result["revision"]

    def test_sources_catalog_projection_and_admission(self):
        cases = {
            "ari_dx": ("#", "001", 14025000),
            "darc_xmas": ("#", "001", 7025000),
            "eudx": ("28", "28", 14025000),
            "lz-dx": ("28", "28", 14025000),
            "wag": ("#", "001", 14025000),
        }
        for plugin_id, (sent, expected, frequency) in cases.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[plugin_id])
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                host, session, _ = self.create(plugin_id, sent, frequency=frequency)
                try:
                    projection = host.dispatch({"id": uid(), "method": "projection",
                                                "params": {"sessionID": session}})["projection"]
                    fields = {field["id"]: field for field in projection["fields"]}
                    self.assertEqual(fields["other_1"]["value"], expected)
                    self.assertEqual(projection["reservedSerial"], 1 if sent == "#" else None)
                finally:
                    host.close()
        with self.assertRaisesRegex(HostError, "does not support 20m"):
            self.create("darc_xmas", "#")
        with self.assertRaisesRegex(HostError, "ARI DX sent exchange"):
            self.create("ari_dx", "RM")

    def test_scoring_same_second_replay_exports_and_rtty_contract(self):
        cases = [
            ("ari_dx", "#", 14025000, "I1ABC", "RM", 10),
            ("darc_xmas", "#", 7025000, "DL1ABC", "A01", 1),
            ("eudx", "28", 14025000, "DL1ABC", "28", 5),
            ("lz-dx", "28", 14025000, "LZ1ABC", "SO", 10),
            ("wag", "#", 14025000, "DL1ABC", "A01", 3),
        ]
        for plugin_id, sent, frequency, call, received, expected_points in cases:
            with self.subTest(plugin=plugin_id):
                host, session, revision = self.create(plugin_id, sent, frequency=frequency)
                try:
                    qso = uid()
                    _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso,
                                              timestamp="2026-10-21 08:00:00",
                                              fields={"callsign": call, "other_2": received})
                    row = host.dispatch({"id": uid(), "method": "log",
                                         "params": {"sessionID": session}})["rows"][0]
                    self.assertEqual(row["Points"], expected_points)
                    exported = host.dispatch({"id": uid(), "method": "export",
                                              "params": {"sessionID": session}})["content"]
                    self.assertIn(call, exported)
                finally:
                    host.close()

        host, session, revision = self.create("darc_xmas", "#", frequency=7025000)
        try:
            for call in ("DL1ABC", "DL1XYZ"):
                _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                          timestamp="2026-10-21 09:00:00",
                                          fields={"callsign": call, "other_2": "A01"})
            rows = host.dispatch({"id": uid(), "method": "log", "params": {"sessionID": session}})["rows"]
            self.assertEqual(sum(row["IsMultiplier2"] for row in rows), 1)
        finally:
            host.close()

        host, session, revision = self.create("ari_dx", "#", mode="RTTY")
        try:
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 10:00:00",
                                      fields={"callsign": "I1ABC", "other_2": "RM"})
            exported = host.dispatch({"id": uid(), "method": "export",
                                      "params": {"sessionID": session}})["content"]
            self.assertIn(" RY ", exported)
        finally:
            host.close()

    def test_correction_preserves_historical_sent_exchange_and_run_metadata(self):
        host, session, revision = self.create("eudx", "28")
        root = host.root
        try:
            _, revision = self.mutate(host, session, revision, "run_state", run=True)
            qso = uid()
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=qso,
                                      timestamp="2026-10-21 11:00:00",
                                      fields={"callsign": "DL1ABC", "other_2": "28"})
            setup = host.dispatch({"id": uid(), "method": "setup_get",
                                   "params": {"sessionID": session}})["setup"]
            setup["settings"]["SentExchange"] = "EU01"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=qso,
                                      fields={"other_2": "EU02"}, reason="Correct region")
            row = host.dispatch({"id": uid(), "method": "log",
                                 "params": {"sessionID": session}})["rows"][0]
            self.assertEqual(str(row["SentNr"]), "28")
            self.assertEqual(row["NR"], "EU02")
            self.assertEqual(row["IsRunQSO"], 1)
            host.close()
            host = Host(root)
            reopened = host.dispatch({"id": uid(), "method": "log",
                                      "params": {"sessionID": session}})["rows"][0]
            self.assertEqual((str(reopened["SentNr"]), reopened["NR"], reopened["IsRunQSO"]),
                             ("28", "EU02", 1))
            _, revision = self.mutate(host, session, revision, "qso_delete", qsoID=qso,
                                      reason="Remove test contact")
            self.assertEqual(host.dispatch({"id": uid(), "method": "log",
                                            "params": {"sessionID": session}})["rows"], [])
        finally:
            host.close()

    def test_cw_and_phone_actions_stay_inside_host_output_contract(self):
        for mode, expected_type in (("CW", "function_key"), ("SSB", "voice_keyer")):
            with self.subTest(mode=mode):
                host, session, revision = self.create("ari_dx", "#", mode=mode)
                try:
                    result, _ = self.mutate(host, session, revision, "function_key", key="F1")
                    self.assertEqual(len(result["actions"]), 1)
                    self.assertEqual(result["actions"][0]["kind"], expected_type)
                    self.assertNotIn("audio", result["actions"][0])
                finally:
                    host.close()


if __name__ == "__main__":
    unittest.main()
