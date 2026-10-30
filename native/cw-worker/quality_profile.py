"""Original synthetic clean-copy evaluation through the actual native mono ABI.

This profile measures CER, never RF spot precision or streaming commit latency.
No radio, QSO, lookup, listener or live destination is opened. Model/runtime stay
pinned; waveform labels come from the independent existing fixture generator.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
SEED = 83100630
SPEEDS = (15, 20, 25, 30, 35)
AMPLITUDES = (0.03, 0.2, 0.6)
CASES_PER_CONDITION = 10
RATE = 3200
NORMALIZATION = "Strip outer ASCII spaces only; retain internal repetitions, spaces, punctuation and slash characters."

def edit_distance(reference, observed):
    previous = list(range(len(observed) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(observed, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def generate():
    source = ROOT / "Tests/fixtures/cw/generate.py"
    spec = importlib.util.spec_from_file_location("cw_original_fixtures", source)
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    rng = random.Random(SEED)
    used, records, frames = set(), [], bytearray()
    for wpm in SPEEDS:
        for amplitude in AMPLITUDES:
            for index in range(CASES_PER_CONDITION):
                # Duration eligibility is fixed before evaluation: complete
                # messages must fit the native 10-second mono window.
                for _ in range(1000):
                    letters = lambda n: "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(n))
                    call = letters(1 + index % 2) + str(rng.randrange(10)) + letters(3)
                    text = call + ("/P" if index % 3 == 0 else "")
                    if index % 5 == 4: text = "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?.,/") for _ in range(7))
                    envelope, labels = fixtures.keying(text, wpm=wpm)
                    if text not in used and len(envelope) <= 32000: break
                else: raise RuntimeError("Cannot generate the predeclared bounded profile")
                used.add(text)
                envelope.extend([0.0] * (32000 - len(envelope)))
                audio = [amplitude * key * math.sin(2 * math.pi * 800 * n / RATE) for n, key in enumerate(envelope)]
                payload = struct.pack("<32000f", *audio)
                sequence = len(records)
                token = sequence.to_bytes(16, "little")
                body = struct.pack("<HH16sQQQII", 1, 2, token, 17, sequence, 0, RATE, 32000) + payload
                frames.extend(b"XCW1" + struct.pack("<I", len(body)) + body)
                records.append({"sequence": sequence, "stream_token": token.hex(), "text": text, "wpm": wpm,
                    "amplitude": amplitude, "sample_sha256": hashlib.sha256(payload).hexdigest(), "labels": labels})
    return records, frames, digest(source)

def run(worker, model, output):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    contract = ROOT / "docs/cw/QUALITY_CONTRACT.json"
    pinned = json.loads(contract.read_text())
    if digest(model) != pinned["model_sha256"]: raise ValueError("Model is outside the frozen contract")
    records, frames, generator_sha = generate()
    provenance = {"instrument": "synthetic-clean-native-mono-v1", "synthetic_only": True, "seed": SEED,
        "profile_frozen_before_execution": {"wpm": SPEEDS, "amplitudes": AMPLITUDES,
            "cases_per_condition": CASES_PER_CONDITION, "sample_rate": RATE, "window_seconds": 10,
            "carrier_hz": 800, "key_shape": "existing original rectangular fixture envelope", "normalization": NORMALIZATION,
            "message_eligibility": "complete generated sequence fits 10 seconds, including original half-second lead and one-second tail",
            "cer_max": pinned["quality"]["clean_character_error_rate_max"]},
        "contract_sha256": digest(contract), "generator_sha256": generator_sha, "runner_sha256": digest(Path(__file__)),
        "model_sha256": digest(model), "worker_sha256": digest(worker),
        "source_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
        "native_input_hashes": {str(p.relative_to(ROOT)): digest(p) for p in sorted((ROOT / "native/cw-worker").glob("*")) if p.suffix in (".cpp", ".h")}}
    (output / "corpus.json").write_text(json.dumps({"provenance": provenance, "cases": records}, indent=2) + "\n")
    started = time.monotonic()
    process = subprocess.run([str(worker), str(model)], input=frames, capture_output=True, timeout=180,
        env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
    (output / "stderr.txt").write_bytes(process.stderr)
    if process.returncode != 0 or len(process.stderr) > 8192 or len(process.stdout) > (len(records) + 1) * 131073:
        raise RuntimeError(f"Native process failed or exceeded output bounds: {process.returncode}")
    lines = process.stdout.splitlines()
    if any(len(line) > 131072 for line in lines): raise RuntimeError("Native line exceeded its wire bound")
    events = [json.loads(line) for line in lines]
    ready = events.pop(0)
    if ready.get("type") != "ready" or ready.get("runtime_version") != pinned["onnx_runtime"]: raise RuntimeError("Wrong native Ready/runtime")
    if len(events) != len(records): raise RuntimeError("Missing or duplicate native inference results")
    groups, outcomes = {}, []
    for reference, event in zip(records, events):
        if event.get("sequence") != str(reference["sequence"]) or event.get("stream_token") != reference["stream_token"] or event.get("epoch") != "17":
            raise RuntimeError("Native result crossed its original window identity")
        observed = event["text"].strip(" ")
        errors = edit_distance(reference["text"], observed)
        row = {"sequence": reference["sequence"], "expected": reference["text"], "observed": observed,
            "wpm": reference["wpm"], "amplitude": reference["amplitude"], "errors": errors, "reference_characters": len(reference["text"])}
        outcomes.append(row)
        key = f'{reference["wpm"]}wpm/{reference["amplitude"]}'
        group = groups.setdefault(key, {"cases": 0, "reference_characters": 0, "errors": 0, "exact_sequences": 0})
        group["cases"] += 1; group["reference_characters"] += len(reference["text"]); group["errors"] += errors; group["exact_sequences"] += errors == 0
    for group in groups.values(): group["cer"] = group["errors"] / group["reference_characters"]
    total_errors = sum(row["errors"] for row in outcomes); characters = sum(row["reference_characters"] for row in outcomes)
    report = {"provenance": provenance, "native_ready": ready, "cases": len(records), "reference_characters": characters,
        "errors": total_errors, "cer": total_errors / characters, "groups": groups, "elapsed_seconds": time.monotonic() - started,
        "clean_profile_pass": all(group["cer"] <= pinned["quality"]["clean_character_error_rate_max"] for group in groups.values()),
        "rf_spot_precision": None, "rf_eligible_recall": None, "negative_band_hours": None, "committed_text_latency": None,
        "outcomes": outcomes}
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in ("outcomes", "provenance")}, indent=2))
    return report["clean_profile_pass"]

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worker", type=Path); parser.add_argument("model", type=Path); parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raise SystemExit(0 if run(args.worker.resolve(), args.model.resolve(), args.output.resolve()) else 1)
