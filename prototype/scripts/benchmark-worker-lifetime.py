#!/usr/bin/env python3
"""Measure a real macOS worker on disposable data; never bind or launch a GUI.

Use a released worker for a baseline and the new exact-source worker for A/B.
All requests are correlated, sequential health reads after warm-up, so completed
request retention cannot be mistaken for in-flight admission or a log cache.
Optional generated 100k input is SQLite-backup copied, never opened for writes.
Raw VM diagnostics and launch coordinates stay in a private evidence directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import selectors
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--development-worker", action="store_true",
                        help="Wrap a raw worker in a test-only metadata/symlink fixture; no host app or package is produced")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cycles", type=int, default=10)
    parser.add_argument("--requests-per-cycle", type=int, default=2000)
    parser.add_argument("--max-growth-mib", type=float)
    args = parser.parse_args()
    assert sys.platform == "darwin", "Memory units/tools in this harness are macOS-specific"
    assert 2 <= args.cycles <= 100 and 100 <= args.requests_per_cycle <= 10000
    worker = args.worker.resolve(strict=True)
    assert worker.name == "xlog-prototype-worker" and not args.out.exists()
    root = Path(tempfile.mkdtemp(prefix="xlog-wave1-quality-worker-", dir="/private/tmp")).resolve()
    root.chmod(0o700)
    for name in ("native", "home", "diagnostics"):
        (root / name).mkdir(mode=0o700)
    marker = {"schema": 1, "id": str(uuid.uuid4()), "connectedLoopback": False}
    (root / ".xlog-offline-acceptance.json").write_text(json.dumps(marker))
    (root / ".xlog-offline-acceptance.json").chmod(0o600)
    (root / "native/operating-module.json").write_text(json.dumps({"version": 1, "selected": "normal_logging"}))
    (root / "native/operating-module.json").chmod(0o600)
    report = {"schema": 1, "workerSHA256": digest(worker), "platform": sys.platform,
              "workerKind": "development component" if args.development_worker else "released/package component",
              "scope": "Private offline worker, sequential health requests; no GUI/hardware; OS caches uncontrolled",
              "fixture": "empty", "requestsPerCycle": args.requests_per_cycle,
              "warmupRequests": 1000, "samples": [], "state": "running"}
    executable = worker
    if args.development_worker:
        # Same test-only bundle seam as worker-process.test.mjs. The original
        # worker is symlinked, never patched; this is not a distributable app.
        contents = root / "WorkerFixture/Contents"
        (contents / "MacOS").mkdir(parents=True)
        (contents / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "com.oliverbross.xlog.integration"}))
        executable = contents / "MacOS/xlog-prototype-worker"
        executable.symlink_to(worker)
    process = None
    selector = None

    def launch():
        nonlocal process, selector
        command = [str(executable), "--offline-contest-acceptance=" + str(root)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=(root / "diagnostics/worker.stderr").open("ab"), env={
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8",
                "CFFIXED_USER_HOME": str(root / "home"), "XLOG_OPERATING_MODULE": "normal_logging"})
        proof = subprocess.check_output(["/bin/ps", "-ww", "-p", str(process.pid),
                                         "-o", "pid=,ppid=,command="], text=True).strip().split(None, 2)
        assert process.poll() is None and proof == [str(process.pid), str(os.getpid()), " ".join(command)], "Launch identity unavailable"
        (root / "diagnostics/process-proof.json").write_text(json.dumps(proof))
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        buffer = bytearray()

        def request(method, params=None):
            nonlocal buffer
            identity = str(uuid.uuid4())
            frame = {"id": identity, "method": method, "params": params or {}, "operatingModule": "normal_logging"}
            started = time.monotonic()
            process.stdin.write(json.dumps(frame, separators=(",", ":")).encode() + b"\n")
            process.stdin.flush()
            while b"\n" not in buffer:
                assert process.poll() is None and time.monotonic() - started < 120, "Worker exited or request timed out"
                if selector.select(.5):
                    chunk = os.read(process.stdout.fileno(), 65536)
                    assert chunk, "Worker output closed"
                    buffer.extend(chunk)
            line, _, tail = buffer.partition(b"\n")
            buffer = bytearray(tail)
            reply = json.loads(line)
            assert reply.get("id") == identity and reply.get("ok") is True, "Unsuccessful/correlation-mismatched reply"
            return reply["result"]

        health = request("health")
        assert all(health.get(key) is False for key in ("station_io", "credentials_accessed", "live_cluster", "network_contact"))
        return request

    def close():
        nonlocal process, selector
        process.stdin.close()
        process.wait(timeout=30)
        assert process.returncode == 0, "Non-clean worker EOF retirement"
        selector.close()
        process = None

    def sample(cycle):
        # Adjacent samples, not simultaneous measurements; no shared-RSS total.
        time.sleep(.2)
        row = subprocess.check_output(["/bin/ps", "-p", str(process.pid), "-o", "rss=,%cpu=,time="], text=True).split()
        summary = subprocess.check_output(["/usr/bin/vmmap", "-summary", str(process.pid)], text=True, stderr=subprocess.STDOUT, timeout=30)
        (root / f"diagnostics/vmmap-{cycle:03d}.txt").write_text(summary)
        footprint = re.search(r"^Physical footprint:\s+([\d.]+)([KMGT])", summary, re.M)
        assert footprint, "Physical footprint unavailable; incomplete measurement"
        value = float(footprint[1]) * {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}[footprint[2]]
        report["samples"].append({"cycle": cycle, "completedMeasuredRequests": cycle * args.requests_per_cycle,
            "rssKiB": int(row[0]), "footprintBytesRounded": int(value), "cpuLifetimePercent": float(row[1]),
            "cpuTime": row[2], "settleSeconds": .2})

    try:
        request = launch()
        request("workspace_create", {"mode": "empty"})
        if args.fixture:
            close()
            fixture = args.fixture.resolve(strict=True)
            assert ".build" in fixture.parts, "Only a retained generated fixture is accepted"
            reader = sqlite3.connect(fixture.as_uri() + "?mode=ro", uri=True)
            assert reader.execute("SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL").fetchone()[0] == 100000
            assert reader.execute("SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL AND json_extract(record_json,'$.comment') LIKE 'Generated private fixture %'").fetchone()[0] == 100000
            target = root / "worker/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"
            writer = sqlite3.connect(target)
            reader.backup(writer)
            writer.close()
            reader.close()
            check = sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)
            assert check.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
            assert check.execute("SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL").fetchone()[0] == 100000
            check.close()
            report.update(fixture="generated-100k", fixtureSHA256=digest(target),
                          fixtureHashScope="Closed SQLite backup including committed source WAL", fixtureIntegrity="ok")
            request = launch()
        status = request("workspace_status")
        assert status["qso_count"] == (100000 if args.fixture else 0)
        for _ in range(1000):
            request("health")
        sample(0)
        for cycle in range(1, args.cycles + 1):
            started = time.monotonic()
            for _ in range(args.requests_per_cycle):
                request("health")
            elapsed = time.monotonic() - started
            sample(cycle)
            report["samples"][-1]["requestBatchSeconds"] = round(elapsed, 6)
        first, last = report["samples"][0], report["samples"][-1]
        report["growthBytes"] = last["footprintBytesRounded"] - first["footprintBytesRounded"]
        report["rssGrowthKiB"] = last["rssKiB"] - first["rssKiB"]
        close()
        report["cleanEOF"] = True
        if args.max_growth_mib is not None:
            report["maximumGrowthMiB"] = args.max_growth_mib
            assert report["growthBytes"] <= args.max_growth_mib * 1024**2, "Completed-request memory grows beyond budget"
        report["state"] = "passed"
    except BaseException as error:
        report.update(state="failed", error=f"{type(error).__name__}: {error}")
        raise
    finally:
        if process and process.poll() is None:
            process.stdin.close()
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                report["survivingWorkerPID"] = process.pid
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        (root / "diagnostics/result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"state": report["state"], "result": str(args.out), "privateEvidence": str(root),
                          "growthBytes": report.get("growthBytes")}))


if __name__ == "__main__":
    main()
