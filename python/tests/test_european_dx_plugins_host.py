"""Pinned Central European national-DX plugins through the Python host."""
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
    "hadx": "4a5d1d86471a8e4e41cf163aafa32539efc5bb57056c20efc298478024799812",
    "helvetia": "104e062b918a78f442f1b23bdb9e08963477a63364367389a8148d3180651c71",
    "pacc": "0e7e85adba1a463c1d8e22648378badda26b3dad651cd74f7044209faccabb1a",
    "spdx": "a36affddfe6b530ad552c9f193527a7ba15acbfa04b93446e1571ae014727125",
}


class EuropeanDxPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def state(self, plugin_id, sent="#"):
        root = Path(self.temporary.name).resolve() / plugin_id
        host = Host(root)
        session, workspace = uid(), uid()
        countries = deepcopy(fixtures.CTY)
        countries["SP1ABC"] = {"entity": "Poland", "continent": "EU", "cq": 15,
                                "itu": 28, "primary_pfx": "SP"}
        result = host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": workspace,
            "operationID": uid(), "expectedRevision": 0, "pluginID": plugin_id,
            "station": {"Call": "K1ABC", "GridSquare": "FN31"},
            "frequencyHz": 14025000,
            "settings": {"SentExchange": sent, "ModeCategory": "CW"},
            "reference": {"id": "cty-v1", "countries": countries},
        }})
        return host, session, result["revision"]

    def test_exact_sources_load_catalog_and_conditional_serial(self):
        for plugin_id, digest in HASHES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                host, session, _ = self.state(plugin_id)
                try:
                    projection = host.dispatch({"id": uid(), "method": "projection",
                                                "params": {"sessionID": session}})["projection"]
                    fields = {item["id"]: item for item in projection["fields"]}
                    self.assertEqual(projection["reservedSerial"], 1)
                    self.assertEqual(fields["other_1"]["value"], "001")
                    self.assertTrue(fields["other_1"]["readOnly"])
                finally:
                    host.close()

        host, _, _ = self.state("helvetia", "ZH")
        host.close()
        with self.assertRaisesRegex(HostError, "location code"):
            self.state("pacc", "BAD99")

    def test_scoring_persistence_duplicate_mode_and_export(self):
        host, session, revision = self.state("spdx")
        try:
            def mutate(method, **params):
                nonlocal revision
                result = host.dispatch({"id": uid(), "method": method, "params": {
                    "sessionID": session, "operationID": uid(),
                    "expectedRevision": revision, **params}})
                revision = result["revision"]
                return result

            mutate("qso_commit", qsoID=uid(), timestamp="2026-10-21 08:00:00",
                   fields={"callsign": "SP1ABC", "other_2": "A"})
            mutate("qso_commit", qsoID=uid(), timestamp="2026-10-21 08:01:00",
                   fields={"callsign": "SP1ABC", "other_2": "A"})
            log = host.dispatch({"id": uid(), "method": "log", "params": {"sessionID": session}})["rows"]
            self.assertEqual(sorted(row["Points"] for row in log), [0, 3])
            score = host.dispatch({"id": uid(), "method": "score", "params": {"sessionID": session}})["score"]
            self.assertGreater(score["total"], 0)
            export = host.dispatch({"id": uid(), "method": "export", "params": {"sessionID": session}})
            self.assertIn("CONTEST: SP-DX", export["content"])
        finally:
            host.close()

    def test_chronological_multiplier_callbacks_for_remaining_conditional_serial_families(self):
        for plugin_id, exchange in (("hadx", "001"), ("helvetia", "ZH"), ("pacc", "ZH")):
            with self.subTest(plugin=plugin_id):
                host, session, revision = self.state(plugin_id)
                try:
                    for minute, call in enumerate(("DL1ABC", "K1ABC", "DL1ABC", "OM1ABC")):
                        result = host.dispatch({"id": uid(), "method": "qso_commit", "params": {
                            "sessionID": session, "operationID": uid(), "expectedRevision": revision,
                            "qsoID": uid(), "timestamp": f"2026-10-21 08:{minute:02}:00",
                            "frequencyHz": 7025000 if minute == 3 else 14025000,
                            "fields": {"callsign": call, "other_2": exchange}}})
                        revision = result["revision"]
                    self.assertEqual(host.dispatch({"id": uid(), "method": "log", "params": {"sessionID": session}})["total"], 4)
                finally:
                    host.close()


if __name__ == "__main__":
    unittest.main()
