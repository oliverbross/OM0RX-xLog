"""Actual child-process binary IQ replay, with no radio or spot destinations."""
import json
from pathlib import Path
import struct
import subprocess
import sys

worker, model, fixtures = map(lambda p: str(Path(p).resolve()), sys.argv[1:])
token = bytes(range(16))

def frame(kind, payload=b"", *, identity=token, epoch=7, sequence=0, first=0, rate=96000, count=0):
    body = struct.pack("<HH16sQQQII", 1, kind, identity, epoch, sequence, first, rate, count) + payload
    return b"XCW1" + struct.pack("<I", len(body)) + body

def run(data):
    result = subprocess.run([worker, model], input=data, capture_output=True, timeout=30)
    assert len(result.stdout) <= 1024 * 1024 and len(result.stderr) <= 4096
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert events and events[0]["type"] == "ready", events
    assert events[0]["runtime_version"] == "1.24.3", "Qualification uses the pinned official runtime"
    return result, events

opened = frame(1, struct.pack("<ddI", -39000, 39000, 1))  # replay flag
source = Path(fixtures) / "two-stations-96k.cf32"
assert source.stat().st_size <= 64 * 1024 * 1024
wire = bytearray(opened)
first, sequence = 0, 0
with source.open("rb") as stream:
    while True:
        iq = stream.read(8192 * 8)
        if not iq:
            break
        assert len(iq) % 8 == 0
        count = len(iq) // 8
        wire.extend(frame(5, iq, count=count, first=first, sequence=sequence))
        first += count
        sequence += 1
wire.extend(frame(7, sequence=99))
result, events = run(wire)
assert result.returncode == 0, result.stderr
copies = [e for e in events if e["type"] == "decode"]
assert copies, events
assert any("OM0RX" in e["text"] and abs(e["offset_hz"] - 6200) < 15 for e in copies), copies
assert any("DL1ABC" in e["text"] and abs(e["offset_hz"] + 4100) < 15 for e in copies), copies
for event in copies:
    assert event["replay"] is True and event["epoch"] == "7" and event["stream_token"] == token.hex()
    assert event["track_id"] and event["track_revision"].isdigit()
    assert int(event["first_sample"]) < int(event["end_sample"])
    assert len(event["tokens"]) <= 667
status = next(e for e in events if e["type"] == "status")
assert status["request_sequence"] == "99" and status["sources"] == 1
assert status["tracks"] <= 16 and status["pending"] <= 16 and status["in_flight"] <= 2
print("native binary IQ: two independent calls, signed offsets, replay/epoch/track identity, bounded pool")

iq = struct.pack("<ffff", 0.2, -0.1, 0.3, -0.2)
for name, bad in dict(epoch=frame(5, iq, epoch=8, count=2),
                      rate=frame(5, iq, rate=48000, count=2),
                      gap=frame(5, iq, sequence=1, count=2),
                      nonfinite=frame(5, struct.pack("<ff", float("nan"), 0), count=1)).items():
    result, events = run(opened + bad)
    assert result.returncode == 0, result.stderr
    assert any(e["type"] == "fault" and e["state"] == "discontinuity" for e in events), name
    assert not any(e["type"] == "decode" for e in events), name
    print(name, "retires source without stale decode")
result, events = run(frame(5, iq, count=2))
assert result.returncode != 0 and not any(e["type"] == "decode" for e in events)
print("IQ before StreamOpen rejected")
