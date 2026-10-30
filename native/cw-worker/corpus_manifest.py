"""Seal consented CW corpus inputs before evaluation; never grants qualification.

Development-only stdlib tool. Streams raw IQ hashes without loading captures into
memory, refuses calibration/held-out leakage and pins independent annotations.
It neither decodes nor emits spots, contacts a radio or changes application state.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_SHA256 = "0815647175998e86af78a6dc9a1a4901cb0e84933379b31badcb7bc53cd2eb9e"
NORMALIZATION = "trim_outer_whitespace_only_v1"

def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
        after = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("Corpus artifact changed while hashing")
    return result.hexdigest()

def document(path, limit):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > limit:
        raise ValueError("Corpus JSON must be a bounded regular file, not a symlink")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError("Duplicate corpus JSON field")
            result[key] = value
        return result
    def finite(value):
        result = float(value)
        if not math.isfinite(result): raise ValueError("Non-finite corpus JSON")
        return result
    def invalid(_): raise ValueError("Non-finite corpus JSON")
    with path.open("rb") as stream: data = stream.read(limit + 1)
    if len(data) > limit: raise ValueError("Corpus JSON grew beyond its bound")
    return json.loads(data, object_pairs_hook=unique, parse_float=finite, parse_constant=invalid), hashlib.sha256(data).hexdigest()

def text(value):
    if not isinstance(value, str) or not value.strip() or len(value.encode()) > 4096:
        raise ValueError("Missing or unbounded corpus provenance text")
    return value

def counter(value):
    if not isinstance(value, str) or len(value) > 20 or not value.isascii() or not value.isdecimal() or str(int(value)) != value or int(value) >= 2**64:
        raise ValueError("Sample count/origin must be canonical UInt64 text")
    return int(value)

def artifact(base, item, name):
    path = Path(text(item.get(name + "_path")))
    if not path.is_absolute(): path = base / path
    # Do not traverse a symlink at the artifact leaf or silently substitute a
    # different file. Resolved absolute paths and hashes are retained in seal.
    if path.is_symlink() or not path.is_file(): raise ValueError("Corpus artifact is missing or linked")
    expected = item.get(name + "_sha256")
    if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("Corpus artifact requires an exact lowercase SHA-256")
    actual = digest(path)
    if actual != expected: raise ValueError("Corpus artifact SHA-256 changed")
    return path.resolve(), actual

def validate(manifest_path):
    contract = ROOT / "docs/cw/QUALITY_CONTRACT.json"
    if digest(contract) != CONTRACT_SHA256: raise ValueError("Frozen quality contract changed")
    manifest_path = manifest_path.absolute()
    manifest, manifest_sha = document(manifest_path, 16 * 1024 * 1024)
    if not isinstance(manifest, dict) or type(manifest.get("schema_version")) is not int or manifest.get("schema_version") != 1 or manifest.get("contract_sha256") != CONTRACT_SHA256 or manifest.get("normalization") != NORMALIZATION:
        raise ValueError("Unsupported corpus schema, quality contract or normalization")
    recordings = manifest.get("recordings")
    if not isinstance(recordings, list) or not 1 <= len(recordings) <= 10000:
        raise ValueError("Corpus requires 1..10000 recording records")
    groups = {key: {} for key in ("recording_family_id", "capture_session_id", "operator_id")}
    ids, iq_hashes, rows = set(), set(), []
    for item in recordings:
        if not isinstance(item, dict): raise ValueError("Malformed recording record")
        identity = text(item.get("id"))
        if identity.strip().casefold() in ids: raise ValueError("Duplicate recording identity")
        ids.add(identity.strip().casefold())
        split = item.get("split")
        if split not in ("calibration", "held_out"): raise ValueError("Explicit calibration/held_out split required")
        for key, membership in groups.items():
            group = text(item.get(key)).strip().casefold()
            if group in membership and membership[group] != split:
                raise ValueError(f"Calibration/held-out leakage through {key}")
            membership[group] = split
        if item.get("kind") not in ("real_iq", "synthetic_iq") or item.get("provider") not in ("flex_dax_iq", "tci_iq", "synthetic"):
            raise ValueError("Explicit recording kind/provider required")
        if (item["kind"] == "synthetic_iq") != (item["provider"] == "synthetic"):
            raise ValueError("Synthetic and radio provenance cannot be interchanged")
        if item.get("sample_rate") != 96000 or type(item.get("sample_rate")) is not int or item.get("format") != "cf32_le_interleaved_iq":
            raise ValueError("This corpus profile requires actual 96-kHz interleaved float32 IQ")
        count, first = counter(item.get("complex_samples")), counter(item.get("first_sample"))
        if count == 0 or first + count >= 2**64: raise ValueError("Invalid recording sample range")
        permission = item.get("permission")
        if not isinstance(permission, dict) or permission.get("basis") not in ("operator_consent", "licence", "owned_synthetic"):
            raise ValueError("Capture requires explicit consent/licence provenance")
        text(permission.get("reference"))
        if item["kind"] == "real_iq" and permission["basis"] == "owned_synthetic":
            raise ValueError("Synthetic ownership cannot authorize a real recording")
        iq, iq_sha = artifact(manifest_path.parent, item, "iq")
        if iq.stat().st_size != count * 8: raise ValueError("IQ byte size does not match its sample count")
        if iq_sha in iq_hashes: raise ValueError("Duplicate IQ cannot become independent corpus exposure")
        iq_hashes.add(iq_sha)
        annotations, annotation_sha = artifact(manifest_path.parent, item, "annotations")
        truth, parsed_annotation_sha = document(annotations, 64 * 1024 * 1024)
        if parsed_annotation_sha != annotation_sha: raise ValueError("Annotations changed during validation")
        if not isinstance(truth, dict) or type(truth.get("schema_version")) is not int or truth.get("schema_version") != 1 or truth.get("recording_id") != identity or truth.get("independent_of_decoder") is not True:
            raise ValueError("Annotations require matching identity and independent decoder-free truth")
        annotator = text(truth.get("annotator_id"))
        if truth.get("truth_review") not in ("reviewed", "reviewed_with_uncertainty"):
            raise ValueError("Unreviewed/unknown truth cannot be silently accepted")
        rows.append({"id": identity, "kind": item["kind"], "split": split, "provider": item["provider"],
            **{key: item[key] for key in groups}, "sample_rate": 96000, "first_sample": str(first), "complex_samples": str(count),
            "iq_path": str(iq), "iq_sha256": iq_sha, "annotations_path": str(annotations), "annotations_sha256": annotation_sha,
            "annotator_id": annotator, "truth_review": truth["truth_review"], "permission": permission,
            "recorded_sample_seconds": count / 96000})
    if digest(manifest_path) != manifest_sha: raise ValueError("Manifest changed during validation")
    return {"schema_version": 1, "status": "sealed_inputs_not_scored_or_qualified", "tool_sha256": digest(Path(__file__)),
        "created_utc": datetime.now(timezone.utc).isoformat(), "contract_sha256": CONTRACT_SHA256,
        "manifest_path": str(manifest_path.resolve()), "manifest_sha256": manifest_sha,
        "normalization": NORMALIZATION, "recordings": rows,
        "limits": ["Does not validate annotation label schema or correctness", "Does not establish RF eligibility or frequency mapping",
            "Recorded sample seconds are not unique negative band-hours", "Does not prove native decoder/output execution or real-time stability",
            "Group identities and independent-truth claims require provenance review", "Reverify sealed hashes immediately before evaluation",
            "Does not enable production admission or quality policy"]}

def seal(manifest, output):
    result = validate(manifest)
    data = (json.dumps(result, indent=2) + "\n").encode()
    if len(data) > 16 * 1024 * 1024: raise ValueError("Corpus seal exceeds its JSON bound")
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    return result

def verify_seal(path):
    receipt, _ = document(path, 16 * 1024 * 1024)
    if not isinstance(receipt, dict) or receipt.get("status") != "sealed_inputs_not_scored_or_qualified" or receipt.get("tool_sha256") != digest(Path(__file__)):
        raise ValueError("Unsupported corpus seal or changed validation tool")
    manifest = Path(text(receipt.get("manifest_path")))
    if digest(manifest) != receipt.get("manifest_sha256"): raise ValueError("Sealed manifest changed")
    current = validate(manifest)
    for key in ("schema_version", "contract_sha256", "manifest_path", "manifest_sha256", "normalization", "recordings", "limits"):
        if current[key] != receipt.get(key): raise ValueError("Corpus seal no longer matches its inputs")
    return current

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    create = commands.add_parser("seal"); create.add_argument("manifest", type=Path); create.add_argument("output", type=Path)
    check = commands.add_parser("verify"); check.add_argument("receipt", type=Path)
    arguments = parser.parse_args()
    result = seal(arguments.manifest, arguments.output) if arguments.operation == "seal" else verify_seal(arguments.receipt)
    print(json.dumps({"status": result["status"], "operation": arguments.operation, "recordings": len(result["recordings"])}, indent=2))
