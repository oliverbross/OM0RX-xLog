"""Subprocess/ABI failure tests, never opens a radio or network listener."""
import json
from pathlib import Path
import struct
import subprocess
import sys

worker, model, fixtures = map(lambda p: str(Path(p).resolve()), sys.argv[1:])
audio = (Path(fixtures) / "cq-30.f32").read_bytes()
token = bytes(range(16))
body = struct.pack("<HH16sQQQII", 1, 2, token, 17, 4, 3200, 3200, len(audio)//4) + audio
frame = b"XCW1" + struct.pack("<I", len(body)) + body
p = subprocess.run([worker, model], input=frame, capture_output=True, timeout=20)
assert p.returncode == 0, p.stderr
events = [json.loads(line) for line in p.stdout.splitlines()]
assert events[0]["type"] == "ready"
assert len(events) == 2 and events[1]["text"].strip() == "CQ OM0RX", events
assert events[1]["stream_token"] == token.hex() and events[1]["epoch"] == "17"
assert events[1]["sequence"] == "4" and events[1]["first_sample"] == "3200"
assert all(int(t["first_sample"]) >= 3200 for t in events[1]["tokens"])
print("valid native frame: CQ OM0RX with original token/epoch/sequence/sample identity")
bad_inputs = dict(magic=b"NOPE"+frame[4:], truncated_header=frame[:7],
                  oversize=b"XCW1"+struct.pack("<I", 2**32-1), truncated_payload=frame[:-1],
                  version=frame[:8]+struct.pack("<H",2)+frame[10:],
                  count=frame[:56]+struct.pack("<I",32001)+frame[60:])
for name, data in bad_inputs.items():
    p = subprocess.run([worker, model], input=data, capture_output=True, timeout=20)
    assert p.returncode != 0, name
    assert all(json.loads(line)["type"] == "ready" for line in p.stdout.splitlines()), name
    assert len(p.stderr) < 512, name
    print(name, "rejected; no decode event")
