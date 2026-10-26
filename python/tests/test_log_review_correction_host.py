"""Review corrections use the audited host path with only a callsign delta."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError


class LogReviewCorrectionTests(unittest.TestCase):
    def test_callsign_only_correction_preserves_exchange_and_survives_restart(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            host = Host(root)
            session = str(uuid.uuid4())
            revision = 0

            def read(method, **params):
                return host.dispatch({"id": str(uuid.uuid4()), "method": method,
                                      "params": {"sessionID": session, **params}})

            def mutate(method, **params):
                nonlocal revision
                result = read(method, operationID=str(uuid.uuid4()), expectedRevision=revision, **params)
                revision = result["revision"]
                return result

            seed = deepcopy(json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())["cq_ww_ssb"])
            state = seed["state"]
            logged_call = seed["fields"]["callsign"]
            corrected_call = logged_call + "A"
            state["reference"]["countries"][corrected_call] = deepcopy(state["reference"]["countries"][logged_call])
            mutate("session_create", pluginID="cq_ww_ssb", workspaceGeneration=str(uuid.uuid4()),
                   station=state["station"], settings=state["settings"], reference=state["reference"],
                   frequencyHz=state["draft"]["frequencyHz"], mode=seed["mode"])
            qso_id = str(uuid.uuid4())
            mutate("qso_commit", qsoID=qso_id, timestamp="2026-10-25 00:26:20", fields=seed["fields"])
            mutate("qso_correct", qsoID=qso_id, fields={"Name": "OLEG", "QTH": "Moscow", "Comment": "Audio note"}, reason="Record contact notes")
            before = read("log")["rows"][0]
            snapshot_revision = revision
            mutate("qso_correct", qsoID=qso_id, fields={"callsign": corrected_call}, reason="Log Review callsign correction")
            after = read("log")["rows"][0]
            self.assertEqual(after["Call"], corrected_call)
            for field in ("ID", "TS", "Freq", "QSXFreq", "Mode", "SNT", "RCV", "NR", "SentNr", "Operator", "Power", "Name", "QTH", "Comment"):
                self.assertEqual(after.get(field), before.get(field), field)
            self.assertEqual(after["raw_fields"], {**before["raw_fields"], "callsign": corrected_call})
            with self.assertRaises(HostError):
                read("qso_correct", operationID=str(uuid.uuid4()), expectedRevision=snapshot_revision,
                     qsoID=qso_id, fields={"callsign": logged_call}, reason="Stale review")
            host.close()
            host = Host(root)
            try:
                self.assertEqual(read("log")["rows"][0]["Call"], corrected_call)
            finally:
                host.close()
