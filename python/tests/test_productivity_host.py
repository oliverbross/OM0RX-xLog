"""Wave 1 complete-log, delayed-note and submission boundaries on real Host/SQLite."""
from copy import deepcopy
from datetime import datetime, timedelta
import base64
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError


class ProductivityHostTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name).resolve()
        self.host = Host(self.root)
        self.session, self.generation = str(uuid.uuid4()), str(uuid.uuid4())
        self.revision = 0
        self.fixture = deepcopy(json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())["cq_wpx_cw"])
        state = self.fixture["state"]
        self.mutate("session_create", pluginID="cq_wpx_cw", workspaceGeneration=self.generation,
                    station=state["station"], settings=state["settings"], reference=state["reference"],
                    frequencyHz=state["draft"]["frequencyHz"], mode=self.fixture["mode"])

    def tearDown(self):
        self.host.close()
        self.directory.cleanup()

    def read(self, method, **params):
        return self.host.dispatch({"id": str(uuid.uuid4()), "method": method, "params": {"sessionID": self.session, **params}})

    def mutate(self, method, **params):
        result = self.read(method, operationID=str(uuid.uuid4()), expectedRevision=self.revision, **params)
        self.revision = result["revision"]
        return result

    def commit(self, index=1):
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field["value"] for field in projection["fields"]}
        fields.update(self.fixture["fields"])
        fields["other_1"] = str(projection["reservedSerial"]).zfill(3)
        fields["callsign"] = f"K{index}ABC"
        fields["other_2"] = str(index)
        qso_id = str(uuid.uuid4())
        timestamp = (datetime(2026, 10, 24) + timedelta(seconds=index)).strftime("%Y-%m-%d %H:%M:%S")
        self.mutate("qso_commit", qsoID=qso_id, timestamp=timestamp, fields=fields)
        return qso_id

    def test_whole_log_numeric_sort_filter_focus_and_revision_fences(self):
        identities = [self.commit(index) for index in range(1, 122)]
        page = self.read("log_page", sort="receivedSerial", direction="ascending", offset=95, limit=10, expectedRevision=self.revision)
        self.assertEqual(page["total"], 121)
        self.assertEqual([int(row["NR"]) for row in page["rows"]], list(range(96, 106)))
        focused = self.read("log_page", sort="receivedSerial", direction="ascending", focusQsoID=identities[100], limit=10)
        self.assertEqual(focused["offset"], 100)
        self.assertEqual(focused["rows"][0]["ID"], identities[100])
        filtered = self.read("log_page", query="K12", limit=100)
        self.assertEqual({row["Call"] for row in filtered["rows"]}, {"K12ABC", "K120ABC", "K121ABC"})
        for params in ({"sort": "Call; DROP TABLE DXLOG"}, {"direction": "sideways"}, {"expectedRevision": self.revision-1}):
            with self.assertRaises(HostError):
                self.read("log_page", **params)

    def test_delayed_note_follows_original_draft_and_replays_once(self):
        draft = self.read("projection")["projection"]["draftID"]
        first = self.commit(1)
        second = self.commit(2)
        note_id, operation_id = str(uuid.uuid4()), str(uuid.uuid4())
        params = dict(operationID=operation_id, expectedRevision=self.revision, workspaceGeneration=self.generation,
                      noteID=note_id, target={"draftID": draft}, text="Heard uncertain suffix; review later.")
        saved = self.read("note_save", **params)
        self.revision = saved["revision"]
        self.assertTrue(self.read("note_save", **params)["replayed"])
        rows = self.read("notes", workspaceGeneration=self.generation, expectedRevision=self.revision)["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["qso_id"], first)
        self.assertNotEqual(rows[0]["qso_id"], second)
        self.assertEqual(self.read("log_page")["total"], 2)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("notes", workspaceGeneration=self.generation, expectedRevision=self.revision)["rows"][0]["id"], note_id)

    def test_submission_preflight_exact_bytes_survive_later_edit(self):
        self.commit(1)
        before = self.read("projection")["projection"]
        review = self.read("submission_preflight", workspaceGeneration=self.generation, expectedRevision=self.revision, format="cabrillo")
        prepared = self.read("export_prepare", expectedRevision=self.revision, format="cabrillo")
        chunk = self.read("export_read", exportID=prepared["artifactID"], workspaceGeneration=self.generation,
                          offset=0, length=prepared["byteLength"])
        payload = base64.b64decode(chunk["dataBase64"])
        self.assertEqual(review["manifest"]["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(review["manifest"]["submissionStatus"], "not-submitted")
        self.assertEqual(self.read("projection")["projection"], before)
        self.commit(2)
        with self.assertRaises(HostError):
            self.read("export_prepare", expectedRevision=review["revision"], format="cabrillo")
        original = self.read("export_read", exportID=prepared["artifactID"], workspaceGeneration=self.generation,
                             offset=0, length=prepared["byteLength"])
        self.assertEqual(chunk["dataBase64"], original["dataBase64"])
        newer = self.read("submission_preflight", workspaceGeneration=self.generation, expectedRevision=self.revision, format="cabrillo")
        self.assertNotEqual(newer["manifest"]["sha256"], review["manifest"]["sha256"])

    def test_external_nonserial_contact_cannot_claim_operator_draft_note(self):
        self.session, self.generation, self.revision = str(uuid.uuid4()), str(uuid.uuid4()), 0
        fixture = deepcopy(json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())["cq_ww_ssb"])
        state = fixture["state"]
        projection = self.mutate("session_create", pluginID="cq_ww_ssb", workspaceGeneration=self.generation,
                                 station=state["station"], settings=state["settings"], reference=state["reference"],
                                 frequencyHz=state["draft"]["frequencyHz"], mode=fixture["mode"])["projection"]
        self.mutate("note_save", workspaceGeneration=self.generation, noteID=str(uuid.uuid4()),
                    target={"draftID": projection["draftID"]}, text="Local entry observation")
        remote_id = str(uuid.uuid4())
        remote = self.read("multi_contact_apply", requestID=str(uuid.uuid4()), workspaceGeneration=self.generation,
                           action="commit", qsoID=remote_id, timestamp="2026-10-24 00:00:01",
                           frequencyHz=projection["frequencyHz"], operator=state["station"]["Call"], fields=fixture["fields"])
        self.revision = remote["revision"]
        notes = self.read("notes", workspaceGeneration=self.generation, expectedRevision=self.revision)["rows"]
        self.assertIsNone(notes[0]["qso_id"])
        local_id = str(uuid.uuid4())
        self.mutate("qso_commit", qsoID=local_id, timestamp="2026-10-24 00:00:02",
                    fields={**fixture["fields"], "callsign": "K99ABC"})
        notes = self.read("notes", workspaceGeneration=self.generation, expectedRevision=self.revision)["rows"]
        self.assertEqual(notes[0]["qso_id"], local_id)
