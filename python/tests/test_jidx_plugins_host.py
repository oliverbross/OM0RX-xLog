"""Pinned JIDX CW/phone family through the original Python/SQLite host."""
from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
CTY = {
    **fixtures.CTY,
    "JA1ABC": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
    "JA2XYZ": {"entity": "Japan", "continent": "AS", "cq": 25, "itu": 45, "primary_pfx": "JA"},
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

        first = self.log("JA1ABC", "13", 0, 14025000)
        second = self.log("JA2XYZ", "27", 1, 3525000)
        third = self.log("JA1ABC", "13", 2, 28025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 5,
            "countries": 0,
            "zones": 0,
            "multipliers": 2,
            "total": 10,
        })
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["SentNr"], rows[first]["NR"], rows[first]["Points"]), (15, 13, 1))
        self.assertEqual(rows[second]["Points"], 2)
        self.assertEqual(rows[third]["Points"], 2)

        self.mutate("qso_correct", qsoID=second, fields={"other_2": "13"}, reason="Correct prefecture")
        self.assertEqual(self.read("score")["score"]["total"], 5)
        self.mutate("qso_delete", qsoID=third, reason="Remove duplicate-band check")
        self.assertEqual(self.read("score")["score"]["total"], 3)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 3)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 3 (2-3-1)\r\n", export)
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
