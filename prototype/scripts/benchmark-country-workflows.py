#!/usr/bin/env python3
"""C01/C02 changed-path diagnostic on the retained QLog generated 100k fixture.

Use the final signed canonical candidate. Exact process/private-root identity is
verified before requests. This establishes worker behavior, not GUI/RF behavior.
"""
import argparse
import hashlib
import json
import os
import plistlib
from pathlib import Path
import selectors
import sqlite3
import statistics
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    worker, fixture = args.worker.resolve(strict=True), args.fixture.resolve(strict=True)
    assert worker.name == "xlog-prototype-worker" and worker.parent.name == "MacOS" and worker.parent.parent.name == "Contents"
    app = worker.parent.parent.parent
    info = plistlib.loads((worker.parent.parent / "Info.plist").read_bytes())
    assert info.get("CFBundleIdentifier") == "com.oliverbross.xlog.integration"
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], check=True, capture_output=True)
    assert ".build" in fixture.parts and not args.out.exists()
    original = sqlite3.connect(fixture.as_uri() + "?mode=ro", uri=True)
    assert original.execute("SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL").fetchone()[0] == 100000
    assert original.execute("SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL AND json_extract(record_json,'$.comment') LIKE 'Generated private fixture %'").fetchone()[0] == 100000
    root = Path(tempfile.mkdtemp(prefix="xlog-wave1-country-benchmark-", dir="/private/tmp")).resolve()
    root.chmod(0o700)
    (root / "native").mkdir(mode=0o700)
    (root / "home").mkdir(mode=0o700)
    marker = {"schema": 1, "id": str(uuid.uuid4()), "connectedLoopback": False}
    (root / ".xlog-offline-acceptance.json").write_text(json.dumps(marker))
    (root / ".xlog-offline-acceptance.json").chmod(0o600)
    (root / "native/operating-module.json").write_text(json.dumps({"version": 1, "selected": "normal_logging"}))
    (root / "native/operating-module.json").chmod(0o600)
    report = {"schema": 1, "root": str(root), "fixture": str(fixture), "worker": str(worker),
              "workerSHA256": hashlib.sha256(worker.read_bytes()).hexdigest(),
              "version": info.get("CFBundleShortVersionString"),
              "scope": "Signed candidate worker, generated QLog fixture; process-cold/OS-cache-unspecified, no GUI/station/hardware", "timingsMs": {}, "processProofs": []}
    process = None

    def launch():
        nonlocal process
        command = [str(worker), "--offline-contest-acceptance=" + str(root)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=(root / "worker.stderr.log").open("ab"),
                                   env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8",
                                        "CFFIXED_USER_HOME": str(root / "home"), "XLOG_OPERATING_MODULE": "normal_logging"})
        proof = None
        for _ in range(100):
            assert process.poll() is None, "isolated worker exited before process proof"
            rows = subprocess.check_output(["/bin/ps", "-ww", "-p", str(process.pid), "-o", "pid=,ppid=,command="], text=True).splitlines()
            proof = next((row.split(None, 2) for row in rows if len(row.split(None, 2)) == 3 and
                          row.split(None, 2) == [str(process.pid), str(os.getpid()), " ".join(command)]), None)
            if proof:
                break
            time.sleep(.025)
        assert proof, "exact worker/private-root identity unavailable"
        report["processProofs"].append(proof)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        buffer = bytearray()

        def send(method, params=None):
            identity = str(uuid.uuid4())
            process.stdin.write(json.dumps({"id": identity, "method": method, "params": params or {}, "operatingModule": "normal_logging"}).encode() + b"\n")
            process.stdin.flush()
            return identity, time.perf_counter()

        def receive():
            nonlocal buffer
            deadline = time.monotonic() + 180
            while b"\n" not in buffer:
                assert time.monotonic() < deadline and process.poll() is None, "worker response missing"
                if selector.select(.5):
                    chunk = os.read(process.stdout.fileno(), 65536)
                    assert chunk
                    buffer.extend(chunk)
            line, _, tail = buffer.partition(b"\n")
            buffer = bytearray(tail)
            response = json.loads(line)
            assert response.get("ok") is True, response
            return response

        def request(method, params=None):
            identity, started = send(method, params)
            response = receive()
            assert response["id"] == identity
            return response["result"], round((time.perf_counter() - started) * 1000, 3)

        return request, send, receive, selector, proof

    def close(selector):
        nonlocal process
        process.stdin.close()
        process.wait(timeout=15)
        assert process.returncode == 0
        selector.close()
        process = None

    try:
        request, _, _, selector, proof = launch()
        health, _ = request("health")
        assert all(health.get(key) is False for key in ["station_io", "credentials_accessed", "live_cluster", "network_contact"])
        request("workspace_create", {"mode": "empty"})
        close(selector)
        target = root / "worker/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"
        assert target.is_file()
        writer = sqlite3.connect(target)
        original.backup(writer)
        writer.close()
        original.close()
        request, send, receive, selector, proof = launch()
        report["processProof"] = proof
        status, report["timingsMs"]["open"] = request("workspace_status")
        assert status["qso_count"] == 100000
        page, report["timingsMs"]["firstPage"] = request("logbook_list", {"limit": 20})
        assert page["total"] == 100000
        _, report["timingsMs"]["warmPage"] = request("logbook_list", {"limit": 20})
        facts, report["timingsMs"]["coldCountrySnapshotAndLookup"] = request("logbook_country_facts", {"call": "OM0RX/EA8", "at": "2020-01-01T12:00:00Z"})
        assert facts["facts"]["country"]["adif"] == 29
        report["referenceRevision"] = facts["facts"]["referenceRevision"]
        warm = []
        for call, entity in [("OM0RX/EA8", 29), ("EA8/OM0RX/P", 29), ("MM/LY3X/P", 279), ("LU1ZZZ/F", 100)] * 10:
            facts, elapsed = request("logbook_country_facts", {"call": call, "at": "2020-01-01T12:00:00Z"})
            assert facts["facts"]["country"]["adif"] == entity
            assert facts["facts"]["referenceRevision"] == report["referenceRevision"]
            warm.append(elapsed)
        report["warmLookupMs"] = {"count": len(warm), "median": statistics.median(warm), "maximum": max(warm)}
        scan_id, scan_start = send("logbook_country_review", {"generation": status["generation"], "limit": 20, "offset": 0})
        health_id, health_start = send("health")
        order = []
        for _ in range(2):
            response = receive()
            order.append(response["id"])
            if response["id"] == scan_id:
                report["timingsMs"]["complete100kCountryReview"] = round((time.perf_counter() - scan_start) * 1000, 3)
                scan = response["result"]["page"]
                assert scan["comparedCount"] == 100000 and len(scan["rows"]) <= 20
                report["review"] = {key: scan[key] for key in ["comparedCount", "affectedCount", "unresolvedCount", "referenceRevision"]}
            else:
                assert response["id"] == health_id
                report["timingsMs"]["healthDuringCountryReview"] = round((time.perf_counter() - health_start) * 1000, 3)
        report["healthRepliedBeforeScan"] = order[0] == health_id
        close(selector)
        report["state"] = "passed"
    except BaseException as error:
        report.update(state="failed", error=f"{type(error).__name__}: {error}", workerExitCode=process.poll() if process else None)
        raise
    finally:
        if process and process.poll() is None:
            process.stdin.close()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                report["survivingWorkerPID"] = process.pid
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))


if __name__ == "__main__":
    main()
