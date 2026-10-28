"""Real paired Hosts: strategy may plan locally but cannot fork log authority."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError


def uid():
    return str(uuid.uuid4())


class ReplicaStrategyAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        root = Path(self.temporary.name).resolve()
        self.master, self.replica = Host(root / "master"), Host(root / "replica")
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(self.master.close)
        self.addCleanup(self.replica.close)

    def call(self, host, method, **params):
        return host.dispatch({"id": uid(), "method": method, "params": params})

    def pair(self, plugin):
        fixture = json.loads((Path(__file__).parent / "fixtures/all_contests_lifecycle.json").read_text())[plugin]
        config = fixture["state"]
        self.session, self.workspace = uid(), uid()
        create = dict(sessionID=self.session, workspaceGeneration=self.workspace, operationID=uid(),
                      expectedRevision=0, pluginID=plugin, station=config["station"], settings=config["settings"],
                      reference=config["reference"], frequencyHz=config["draft"]["frequencyHz"], mode=fixture["mode"])
        primary = self.call(self.master, "session_create", **create)
        self.call(self.replica, "session_create", **{**create, "operationID": uid()})
        # This valid local receipt predates binding and must remain replayable.
        local = self.params(action="sked_add", itemID="local", callsign="K1ABC", text="Local plan",
                            dueUTC="2026-10-29T10:00:00Z", frequencyHz=14025000, mode="CW", radioID=None)
        self.call(self.replica, "strategy_apply", **local)
        fields = deepcopy(fixture["fields"])
        projection = primary["projection"]
        allocated = projection.get("allocatedSerialFieldID")
        if allocated:
            fields.pop(allocated, None)
        self.call(self.master, "qso_commit", sessionID=self.session, operationID=uid(),
                  expectedRevision=primary["revision"], qsoID=uid(), timestamp="2026-10-21 09:00:00",
                  fields=fields, frequencyHz=config["draft"]["frequencyHz"])
        changes = self.call(self.master, "multi_changes", sessionID=self.session,
                            workspaceGeneration=self.workspace, requestID=uid(), afterRevision=0, afterSequence=0, limit=100)
        reservation = self.call(self.master, "multi_serial_reserve", sessionID=self.session,
                                workspaceGeneration=self.workspace, requestID=uid(), frequencyHz=config["draft"]["frequencyHz"])
        self.call(self.replica, "multi_replica_apply", **self.params(
            authority=changes["authority"], fromCursor={"revision": 0, "sequence": 0},
            toCursor={"revision": changes["nextRevision"], "sequence": changes["nextSequence"]},
            historyComplete=True, changes=changes["changes"], nextReservation={key: deepcopy(reservation[key]) for key in
                ("requestID", "scope", "serial", "sentExchange", "allocatedFieldID", "authority")}))
        self.assertTrue(self.replica.database(self.session).replica())
        return config, local

    def params(self, **values):
        state = self.replica.database(self.session).state(self.session)
        return dict(sessionID=self.session, workspaceGeneration=self.workspace, operationID=uid(),
                    expectedRevision=state["revision"], **values)

    def snapshot(self, host):
        # All durable tables, including revisions, serials, QTC/sites, audit and receipts.
        return tuple(host.database(self.session).conn.iterdump())

    def rejected_unchanged(self, **values):
        before, master = self.snapshot(self.replica), self.snapshot(self.master)
        with self.assertRaises(HostError) as error:
            self.call(self.replica, "strategy_apply", **self.params(**values))
        self.assertEqual(error.exception.code, "replica_read_only")
        self.assertEqual(self.snapshot(self.replica), before)
        self.assertEqual(self.snapshot(self.master), master)

    def test_historical_import_cannot_write_replica_contacts_or_receipts(self):
        config, local = self.pair("cq_wpx_cw")
        self.rejected_unchanged(action="adif_import", record={"raw": {
            "CONTEST_ID": "CQ-WPX-CW", "STATION_CALLSIGN": config["station"]["Call"], "CALL": "K1ABC",
            "QSO_DATE": "20261021", "TIME_ON": "100000", "FREQ": "14.025", "MODE": "CW",
            "RST_SENT": "599", "RST_RCVD": "579", "STX": "101", "SRX": "202"},
            "metadata": None, "sourceSHA256": "a" * 64})
        replay = self.call(self.replica, "strategy_apply", **local)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["waveResult"]["skeds"][0]["text"], "Local plan")
        changed = {**local, "text": "different payload"}
        with self.assertRaises(HostError) as error:
            self.call(self.replica, "strategy_apply", **changed)
        self.assertEqual(error.exception.code, "payload_conflict")
        self.call(self.replica, "operating_plan_save", **self.params(plan={"ruleProfileID": "", "note": "Local only"}))
        self.call(self.replica, "strategy_apply", **self.params(action="sked_dismiss", itemID="local"))
        store = self.replica.database(self.session)
        draft = deepcopy(store.state(self.session)["draft"])
        preferences = self.call(self.replica, "setup_get", sessionID=self.session)["setup"]["preferences"]
        bank = self.call(self.replica, "message_import", sessionID=self.session,
                         workspaceGeneration=self.workspace, expectedRevision=store.state(self.session)["revision"],
                         dialect="not1mm", source="R|F1|CQ|CQ {MYCALL}", name="Local messages",
                         scope={"mode": "CW", "contest": "cq_wpx_cw", "operator": "OM0RX"})["bank"]
        saved = self.call(self.replica, "message_bank_save", **self.params(bank=bank))
        activated = self.call(self.replica, "message_bank_activate", **self.params(bankID=saved["waveResult"]["banks"][0]["id"]))
        self.assertEqual(activated["actions"], [])
        self.assertEqual(activated["setup"]["preferences"], preferences)
        self.assertEqual(store.state(self.session)["draft"], draft)

    def test_qtc_family_cannot_fork_replica_accounting(self):
        self.pair("wae_cw")
        for action in ("qtc_create", "qtc_confirm", "qtc_repeat", "qtc_cancel", "qtc_resume", "qtc_item", "qtc_header"):
            with self.subTest(action=action):
                self.rejected_unchanged(action=action, batchID="receive-1", number=1, direction="receive", counterpart="K1ABC",
                    timestamp="2026-08-08 09:00:00", frequencyHz=14025000,
                    items=[{"time": "0800", "callsign": "DL1ABC", "serial": "12"}], index=0)

    def test_site_semantics_blocked_but_beacon_observations_remain_local(self):
        self.pair("darc_vhf")
        self.rejected_unchanged(action="site_activate", siteID="new-site", locator="JO60AA", atUTC="2026-10-21T10:00:00Z")
        self.rejected_unchanged(action="transverter_save", mapping={})
        result = self.call(self.replica, "strategy_apply", **self.params(action="beacon_add", beacon={
            "id": "observed", "callsign": "OK1ABC", "locator": "JO60AA", "frequencyHz": 144050000,
            "source": "Disposable operator note", "observedUTC": "2026-10-21T10:00:00Z"}))
        self.assertEqual(result["actions"], [])
        self.assertEqual(result["waveResult"]["beacons"][0]["callsign"], "OK1ABC")
