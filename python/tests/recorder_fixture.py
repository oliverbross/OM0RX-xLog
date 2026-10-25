"""Native test bridge into the real Python host and source-pinned scoring plugin."""
import json
from test_recorder import RecorderAuditTests

fixture = RecorderAuditTests()
fixture.setUp()
try:
    qso = fixture.log()
    commit = fixture.changes()
    fixture.mutate("qso_correct", qsoID=qso, fields={"callsign":"DL1ABC"}, timestamp="2026-10-20 08:05:00", reason="Fixture")
    correction = fixture.changes()
    fixture.mutate("qso_delete", qsoID=qso, reason="Fixture")
    deletion = fixture.changes()
    print(json.dumps({"commit":commit,"correction":correction,"deletion":deletion}))
finally:
    fixture.tearDown()
