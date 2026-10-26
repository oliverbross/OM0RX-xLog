"""Qualify every registered plugin using the existing disposable host fixtures.

This supplements (and runs) the family assertions; captured scores are evidence,
not independent sponsor-rule oracles. No production data-root argument exists.
"""
import argparse
import base64
from collections import defaultdict
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "python"), str(ROOT / "python/tests")]
from contest_host.host import Desk, Host, HostError
from contest_host.plugins import PLUGIN_REGISTRY
from contest_host.upstream import VENDOR, load_plugin
sys.path.insert(0, str(ROOT / "python/tests/fixtures"))
from all_contests_scores import EXPECTED


def expected_progression(plugin):
    """Independent arithmetic for the fixed same-band/exchange lifecycle.

    The second contact repeats the call; the third changes only its suffix,
    preserving country, prefix, zone, section, locator and received exchange.
    Unique-call multipliers and the two additive bonuses need explicit cases.
    """
    points, multipliers, total = EXPECTED[plugin]
    second, third = (points, multipliers, total), (2 * points, multipliers, 2 * total)
    if plugin in {"randomgram", "qso_party_rst", "qso_party_sn"}:
        # Type-4 contracts deliberately score repeated calls.
        second, third = (2 * points, multipliers, 2 * total), (3 * points, multipliers, 3 * total)
    if plugin in {"weekly_rtty", "icwc_mst", "cwt", "cwo"}:
        third = (2 * points, 2 * multipliers, 4 * total)
    if plugin == "ok1wc":
        # OK1WC counts the last callsign letter on each band, so this suffix
        # change deliberately supplies a second multiplier.
        third = (2, 2, 4)
    if plugin == "es_manual_key":
        # The entrant's three-period seniority bonus is added once, not per QSO.
        third = (50, 0, 65)
    if plugin == "nac_vhf":
        # First grid earns 500 bonus points; same-grid third contact adds distance.
        third = (1386, 1, 1386)
    return second, third
EXPORT_CONTACTS = json.loads((ROOT / "python/tests/fixtures/all_contests_exports.json").read_text())


def uid():
    return str(uuid.uuid4())


def assert_equal(actual, expected):
    assert actual == expected, (actual, expected)


def collect_seeds():
    """Reuse successful family cases, including their exact configured inputs."""
    seeds, evidence = {}, defaultdict(set)
    pending = []
    original = Host.commit

    class Result(unittest.TextTestResult):
        def startTest(self, test):
            pending.clear()
            self.current_test = test.id()
            super().startTest(test)

        def addSuccess(self, test):
            for plugin, seed in pending:
                seeds.setdefault(plugin, seed)
                evidence[plugin].add(test.id())
            super().addSuccess(test)

    def capture(host, desk, *args, **kwargs):
        state, fields = deepcopy(desk.state), desk.values()
        empty = not desk.database.fetch_all_contacts_asc()
        original(host, desk, *args, **kwargs)
        plugin = state["pluginID"]
        pending.append((plugin, {
                "state": state, "fields": fields, "mode": desk.radio_state["mode"],
                "firstRow": deepcopy(desk.database.fetch_all_contacts_asc()[0]),
                "fixture": runner_result.current_test,
            })) if empty else None

    loader = unittest.TestLoader()
    suite = unittest.TestSuite(loader.discover(str(ROOT / "python/tests"), pattern=pattern)
                               for pattern in ("test_*_host.py", "test_host.py"))
    runner_result = None

    class Runner(unittest.TextTestRunner):
        def _makeResult(self):
            nonlocal runner_result
            runner_result = super()._makeResult()
            return runner_result

    with patch.object(Host, "commit", capture):
        result = Runner(verbosity=1, resultclass=Result).run(suite)
    return seeds, evidence, result


def adif_records(content):
    records = []
    for record in re.split(r"<eor>", re.split(r"<eoh>", content, flags=re.I)[-1], flags=re.I):
        fields = {}
        for match in re.finditer(r"<([a-z0-9_]+):(\d+)(?::[^>]*)?>", record, re.I):
            fields[match[1].upper()] = record[match.end():match.end() + int(match[2])]
        if fields:
            records.append(fields)
    return records


def qualify(plugin, seed):
    state, fields = seed["state"], deepcopy(seed["fields"])
    checks, details = {}, {}
    with TemporaryDirectory(prefix="xlog-all-contests-") as temporary:
        root = Path(temporary).resolve()
        host, session, revision = Host(root), uid(), 0

        def read(method, **params):
            return host.dispatch({"id": uid(), "method": method,
                                  "params": {"sessionID": session, **params}})

        def mutate(method, **params):
            nonlocal revision
            response = read(method, operationID=uid(), expectedRevision=revision, **params)
            revision = response["revision"]
            return response

        def check(name, function):
            try:
                function()
                checks[name] = {"status": "PASS"}
            except Exception as error:
                checks[name] = {"status": "FAIL", "reason": f"{type(error).__name__}: {error}"}

        try:
            response = mutate("session_create", workspaceGeneration=uid(), pluginID=plugin,
                              station=state["station"], settings=state["settings"],
                              reference=state["reference"],
                              frequencyHz=state["draft"]["frequencyHz"],
                              mode=seed["mode"])
            initial = response["projection"]
            # Use the new session's allocation rather than replaying a fixture's
            # serial after prior wipes/reservations.
            allocated = initial.get("allocatedSerialFieldID")
            if initial.get("reservedSerial") is not None and allocated:
                fields[allocated] = next(row["value"] for row in initial["fields"] if row["id"] == allocated)
            def contracts():
                assert initial["pluginID"] == plugin
                assert initial["supportedBands"] == list(PLUGIN_REGISTRY[plugin].bands)
                assert initial["supportedModes"] == list(PLUGIN_REGISTRY[plugin].modes)
                ids = {row["id"] for row in initial["fields"]}
                assert ids == {"callsign", "sent", "receive", "other_1", "other_2"}
                assert set(initial["tabNext"]) <= ids and set(initial["tabNext"].values()) <= ids
                assert initial["columns"] and all(initial["columns"])
            check("setupAndDescriptors", contracts)
            draft = mutate("draft_apply", fields=fields)["projection"]
            first = uid()
            mutate("qso_commit", qsoID=first, timestamp="2026-10-21 10:00:00")
            row = next(row for row in read("log")["rows"] if row["ID"] == first)
            def stored():
                assert row["raw_fields"] == {item["id"]: item["value"] for item in draft["fields"]}
                assert row["Call"] == seed["firstRow"]["Call"], "Plugin-parsed callsign changed"
                assert row["TS"] == "2026-10-21 10:00:00"
            check("entryAndStoredFields", stored)
            details.update(station=state["station"], settings=state["settings"],
                           fields=fields, firstContact=row, score=read("score")["score"],
                           dupeType=load_plugin(plugin).dupe_type,
                           mode=initial["mode"], band=initial["band"],
                           entryFields=initial["fields"], logColumns=initial["columns"],
                           duplicateScope=initial["dupeExplanation"],
                           multiplierViewStatus=initial.get("multiplierViewStatus"),
                           entryPolicy=initial.get("entryPolicy"))
            def expected_score():
                actual = details["score"]
                assert (actual["points"], actual["multipliers"], actual["total"]) == EXPECTED[plugin], actual
            check("expectedPointsMultipliersScore", expected_score)

            # An invalid call is universally required, even in free-text utilities.
            def invalid():
                mutate("draft_apply", fields={"callsign": "?"})
                before = read("projection")["projection"]
                try:
                    mutate("qso_commit", qsoID=uid(), timestamp="2026-10-21 10:01:00")
                except HostError:
                    assert read("log")["total"] == 1
                    assert read("projection")["projection"]["fields"] == before["fields"]
                else:
                    raise AssertionError("Invalid required call committed")
            check("invalidInputAtomicity", invalid)
            if plugin in {"dxpedition", "general_logging", "randomgram", "arrl_ss_cw", "arrl_ss_phone"}:
                checks["invalidExchangeAtomicity"] = {"status": "NOT APPLICABLE",
                    "reason": "Pinned contract permits incomplete/free-text exchanges; required callsign rejection tested"}
            else:
                def invalid_exchange():
                    invalid_value = "" if plugin in {"arrl_dx_cw", "arrl_dx_ssb", "cwt", "k1usn_sst"} else "?"
                    invalid_fields = {item["id"]: invalid_value for item in initial["fields"]
                                      if item["id"] in {"other_1", "other_2"} and item["visible"]
                                      and item["enabled"] and not item["readOnly"]}
                    mutate("draft_apply", fields={k: v for k, v in fields.items() if k != allocated})
                    # Allow normal call-change CTY/history prefill first, then
                    # enter the malformed exchange for the same call explicitly.
                    mutate("draft_apply", fields=invalid_fields)
                    before = read("projection")["projection"]
                    try:
                        mutate("qso_commit", qsoID=uid(), timestamp="2026-10-21 10:01:00")
                    except HostError:
                        assert read("log")["total"] == 1
                        assert read("projection")["projection"]["fields"] == before["fields"]
                    else:
                        raise AssertionError("Malformed required exchange committed")
                check("invalidExchangeAtomicity", invalid_exchange)
            repeated = {key: value for key, value in fields.items() if key != allocated}
            with patch("contest_host.host.now", return_value="2026-10-21 10:02:00"):
                repeated_projection = mutate("draft_apply", fields=repeated)["projection"]
            check("duplicateClassification", lambda: assert_equal(repeated_projection["dupe"], load_plugin(plugin).dupe_type != 4))
            second = uid()
            second_projection = mutate("qso_commit", qsoID=second, timestamp="2026-10-21 10:02:00")["projection"]
            def repeated_contact():
                rows = read("log")["rows"]
                assert len(rows) == 2
                duplicate = next(item for item in rows if item["ID"] == second)
                expected = expected_progression(plugin)[0]
                actual = read("score")["score"]
                assert actual["qsos"] == (1 if plugin == "trans_tasman" else 2)
                assert (actual["points"], actual["multipliers"], actual["total"]) == expected, actual
                assert (duplicate["Points"] or 0) == (EXPECTED[plugin][0] if load_plugin(plugin).dupe_type == 4 else 0), duplicate
            check("repeatContact", repeated_contact)
            checks["repeatContact"]["score"] = read("score")["score"]
            third = uid()
            original_call = row["Call"]
            # A distinct call with the same authoritative geography and heard
            # exchange tests repeated multipliers independently of a dupe QSO.
            stem, separator, suffix = original_call.partition("/")
            new_call = stem[:-1] + ("D" if stem[-1] != "D" else "E") + (separator + suffix if separator else "")
            new_fields = {key: value.replace(original_call, new_call) for key, value in repeated.items()}
            new_fields["callsign"] = new_call
            countries = state["reference"]["countries"]
            country = countries.get(original_call)
            extra = {"countries": {new_call: country}, "referenceID": state["reference"]["id"]} if country else {}
            third_projection = mutate("qso_commit", qsoID=third, timestamp="2026-10-21 10:03:00", fields=new_fields, **extra)["projection"]
            third_row = next(item for item in read("log")["rows"] if item["ID"] == third)
            def repeated_multiplier():
                expected_points = EXPECTED[plugin][0] - (500 if plugin == "nac_vhf" else 0)
                assert (third_row["Points"] or 0) == expected_points, third_row
                actual = read("score")["score"]
                assert actual["qsos"] == (2 if plugin == "trans_tasman" else 3)
                assert (actual["points"], actual["multipliers"], actual["total"]) == expected_progression(plugin)[1], actual
                expected_flags = (1, 0, 0) if plugin in {"weekly_rtty", "cwt", "cwo", "ok1wc"} else (0, 1, 0) if plugin == "rsgb_commonwealth_beru" else (0, 0, 0)
                assert tuple(third_row[key] for key in ("IsMultiplier1", "IsMultiplier2", "isMultiplier3")) == expected_flags, third_row
                details["thirdContactScore"] = actual
            check("distinctCallRepeatedExchange", repeated_multiplier)
            def serial_progression():
                serial = initial["reservedSerial"]
                for index, projection in enumerate((repeated_projection, second_projection, third_projection), 1):
                    expected = serial + index if serial is not None else None
                    assert projection["reservedSerial"] == expected, (index, projection["reservedSerial"], expected)
                if serial is not None and allocated:
                    assert third_row["raw_fields"][allocated] != row["raw_fields"][allocated]
            check("serialProgression", serial_progression)
            def analytics():
                params = {"workspaceGeneration": initial["workspaceGeneration"]}
                snapshot = read("analytics", action="prepare", **params)
                assert snapshot["total"] == 3
                page = read("analytics", action="page", snapshotID=snapshot["snapshotID"], offset=0, limit=500, **params)
                assert len(page["rows"]) == 3
                assert {item["call"] for item in page["rows"]} == {row["Call"], new_call}
                details["analyticsCapabilities"] = snapshot
                read("analytics", action="release", snapshotID=snapshot["snapshotID"], **params)
            check("basicAnalytics", analytics)

            def exports():
                payloads = {}
                for format in PLUGIN_REGISTRY[plugin].export_formats:
                    prepared = read("export_prepare", format=format)
                    chunk = read("export_read", exportID=prepared["artifactID"],
                                 workspaceGeneration=prepared["workspaceGeneration"],
                                 offset=0, length=prepared["byteLength"])
                    payload = base64.b64decode(chunk["dataBase64"])
                    assert len(payload) == prepared["byteLength"]
                    content = payload.decode("utf-8")
                    assert row["Call"] in content.upper()
                    if format == "adif":
                        records = adif_records(content)
                        assert len(records) == 3, records
                        assert records[0]["CALL"] == row["Call"]
                        assert records[0]["QSO_DATE"] == "20261021"
                        assert records[0]["TIME_ON"].startswith("1000")
                        assert abs(float(records[0]["FREQ"]) * 1000 - row["Freq"]) < 0.01
                        assert records[0]["STATION_CALLSIGN"] == state["station"]["Call"]
                        assert records[0]["MODE"] == ("SSB" if row["Mode"] in {"USB", "LSB"} else "CW" if row["Mode"] in {"CW-R", "CWR"} else row["Mode"])
                        assert records[0]["APP_XLOG_QSO_ID"] == first
                        assert records[0]["APP_XLOG_PLUGIN"] == plugin
                        assert json.loads(records[0]["APP_XLOG_ENTRY_FIELDS"]) == row["raw_fields"]
                        exchange = json.loads(records[0]["APP_XLOG_EXCHANGE_FIELDS"])
                        assert all(row[key] == value for key, value in exchange.items())
                        if "RST_SENT" in records[0]:
                            assert records[0]["RST_SENT"] == row["SNT"]
                        if "RST_RCVD" in records[0]:
                            assert records[0]["RST_RCVD"] == row["RCV"]
                    elif format == "cabrillo":
                        qsos = [line for line in content.splitlines() if line.startswith("QSO:")]
                        # Reviewed per-plugin contact layout: frequency, mode,
                        # timestamp, station and every transmitted/heard component.
                        assert qsos[0].rstrip() == EXPORT_CONTACTS[plugin][format], qsos[0]
                        tokens = qsos[0].split()
                        assert tokens[2] in {"CW", "PH", "FM", "RY", "DG"}, tokens
                        if row["Freq"] < 30000:
                            assert abs(float(tokens[1]) - row["Freq"]) <= 1, tokens
                        expansion = len(str(state["settings"]["SentExchange"]).split()[-1].split("/")) if plugin == "ca_qso_party" else 1
                        assert len(qsos) == 3 * expansion, qsos
                        assert "CONTEST: " + load_plugin(plugin).cabrillo_name in content
                        assert "CALLSIGN: " + state["station"]["Call"] in content
                        assert all("2026-10-21" in line for line in qsos)
                        assert sum(row["Call"] in line for line in qsos) == 2 * expansion
                        assert sum(new_call in line for line in qsos) == expansion
                    elif format == "edi":
                        assert "[QSORecords;3]" in content and "261021;1000;" in content
                        contact = next(line.rstrip() for line in content.splitlines() if line.startswith("261021;1000;"))
                        assert contact == EXPORT_CONTACTS[plugin][format], contact
                    payloads[format] = {"sha256": hashlib.sha256(payload).hexdigest(), "content": content}
                    read("export_release", exportID=prepared["artifactID"],
                         workspaceGeneration=prepared["workspaceGeneration"])
                details["exports"] = payloads
            check("exportContents", exports)

            def correction():
                # Preserve all exchange columns on an unrelated RST correction.
                if plugin in {"ca_qso_party", "qso_party_sn"}:
                    corrected = "109"  # receive is a received serial in this layout
                else:
                    corrected = "57" if initial["mode"] == "SSB" else "579"
                mutate("qso_correct", qsoID=first, fields={"receive": corrected}, reason="Disposable qualification")
                after = next(item for item in read("log")["rows"] if item["ID"] == first)
                assert after["ID"] == row["ID"] and after["TS"] == row["TS"]
                assert after["SentNr"] == row["SentNr"], (after["SentNr"], row["SentNr"])
                assert after["raw_fields"]["receive"] == corrected
            check("correction", correction)
            def deletion():
                mutate("qso_delete", qsoID=first, reason="Promote the retained duplicate")
                mutate("qso_delete", qsoID=third, reason="Remove the distinct-call fixture")
                assert [item["ID"] for item in read("log")["rows"]] == [second]
                actual = read("score")["score"]
                assert actual["qsos"] == 1
                assert (actual["points"], actual["multipliers"], actual["total"]) == EXPECTED[plugin], actual
            check("deletion", deletion)
            before_log = read("log")["rows"]
            before_score = read("score")["score"]
            before_projection = read("projection")["projection"]
            host.close()
            host = Host(root)
            def persistence():
                read("session_open")
                assert read("log")["rows"] == before_log
                assert read("score")["score"] == before_score
                assert read("projection")["projection"]["reservedSerial"] == before_projection["reservedSerial"]
            check("persistenceAndSerial", persistence)
        except Exception as error:
            checks["lifecycle"] = {"status": "FAIL", "reason": f"{type(error).__name__}: {error}"}
        finally:
            host.close()
    return {"pluginID": plugin, "fixture": seed["fixture"], "checks": checks, **details}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixture-cache", type=Path,
                        help="Reuse successful fixture inputs for focused development; omit for the final gate")
    parser.add_argument("--plugin", action="append", choices=list(PLUGIN_REGISTRY))
    parser.add_argument("--family-tests", action="store_true", help="Also run all existing host family regressions")
    options = parser.parse_args()
    # Existing crash-recovery tests launch child interpreters; sys.path alone
    # cannot make the source host importable in those separate processes.
    os.environ["PYTHONPATH"] = os.pathsep.join((str(ROOT / "python"), str(ROOT / "python/tests")))
    cache_path = ROOT / ".build/all-contests-fixture-inputs.json"
    if options.fixture_cache:
        cached = json.loads(options.fixture_cache.read_text())
        seeds, evidence = cached["seeds"], cached["evidence"]
        tests_run, tests_passed = cached["testsRun"], cached["testsPassed"]
    elif options.family_tests:
        _, evidence, result = collect_seeds()
        seeds = json.loads((ROOT / "python/tests/fixtures/all_contests_lifecycle.json").read_text())
        tests_run, tests_passed = result.testsRun, result.wasSuccessful()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"seeds": seeds, "evidence": {k: sorted(v) for k, v in evidence.items()},
                                          "testsRun": tests_run, "testsPassed": tests_passed}))
    else:
        seeds = json.loads((ROOT / "python/tests/fixtures/all_contests_lifecycle.json").read_text())
        evidence = {key: [seed["fixture"]] for key, seed in seeds.items()}
        tests_run, tests_passed = 0, None
    if set(seeds) != set(PLUGIN_REGISTRY) or set(EXPECTED) != set(PLUGIN_REGISTRY) or set(EXPORT_CONTACTS) != set(PLUGIN_REGISTRY):
        raise AssertionError("Registry, lifecycle fixtures and explicit score expectations differ")
    with TemporaryDirectory(prefix="xlog-catalogue-") as temporary:
        host = Host(Path(temporary).resolve())
        try:
            catalog = host.dispatch({"id": uid(), "method": "catalog", "params": {}})
            assert {item["id"] for item in catalog["plugins"]} == set(seeds)
        finally:
            host.close()
    rows = []
    for plugin in options.plugin or PLUGIN_REGISTRY:
        row = qualify(plugin, seeds[plugin]) if plugin in seeds else {
            "pluginID": plugin, "checks": {"lifecycle": {"status": "UNVERIFIED", "reason": "No successful existing first-contact fixture"}}}
        row["familyTests"] = sorted(evidence[plugin])
        row["catalogue"] = next(item for item in catalog["plugins"] if item["id"] == plugin)
        rows.append(row)
        failures = {name: item for name, item in row["checks"].items() if item["status"] not in {"PASS", "NOT APPLICABLE"}}
        print(plugin, json.dumps(failures) if failures else "PASS", flush=True)
    report = {"source": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "sourceFilesSHA256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                                     for path in [ROOT / "python/contest_host" / name for name in
                                                  ("host.py", "upstream.py", "plugins.py", "store.py", "__main__.py")]
                                     + [ROOT / "python/tests/fixtures/all_contests_lifecycle.json",
                                        ROOT / "python/tests/fixtures/all_contests_exports.json",
                                        ROOT / "python/tests/fixtures/all_contests_scores.py", Path(__file__)]},
              "runtime": sys.version, "engine": "not1mm-python", "catalogueCount": len(PLUGIN_REGISTRY),
              "fixtureCache": str(options.fixture_cache) if options.fixture_cache else None,
              "familyTestsRun": tests_run, "familyTestsPassed": tests_passed, "plugins": rows}
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, indent=2) + "\n")
    return 0 if tests_passed is not False and all(
        check["status"] in {"PASS", "NOT APPLICABLE"} for row in rows for check in row["checks"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
