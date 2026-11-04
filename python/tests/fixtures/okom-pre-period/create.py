"""Run with PYTHONPATH pointing to archived 1.5.7 python and python/tests."""
import gzip
import hashlib
import inspect
import json
from pathlib import Path

from contest_host.host import Host
from test_okom_host import OKOMHostTests
from test_host import uid

SOURCE = "5016751a03f2adc6eea27def34ed4675e6bdc67a"


def main():
    case = OKOMHostTests()
    case.setUp()
    try:
        case.create()
        for timestamp in ["2026-11-14 11:59:59", "2026-11-14 12:00:00"]:
            case.mutate("qso_commit", qsoID=uid(), timestamp=timestamp, frequencyHz=14025000,
                        fields={"callsign": "OK1ABC", "other_2": "APA"})
        rows = case.read("log")["rows"]
        assert [row["Points"] for row in sorted(rows, key=lambda row: row["TS"])] == [3, 0]
        state = case.host.database(case.session).state(case.session)
        assert "okomCreditRevision" not in state
        case.host.close()
        raw = (case.root / case.session / "contest.sqlite").read_bytes()
        zipped = gzip.compress(raw, mtime=0)
        folder = Path(__file__).parent
        (folder / "contest.sqlite.gz").write_bytes(zipped)
        manifest = {"sourceCommit": SOURCE, "generatorHost": str(Path(inspect.getfile(Host)).resolve()),
                    "sessionID": case.session, "workspaceGeneration": case.workspace,
                    "revision": case.revision, "points": [3, 0],
                    "rawSHA256": hashlib.sha256(raw).hexdigest(), "gzipSHA256": hashlib.sha256(zipped).hexdigest()}
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps(manifest, indent=2))
    finally:
        case.tearDown()


if __name__ == "__main__":
    main()
