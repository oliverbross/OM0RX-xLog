"""One reproducible, unqualified MatMul-only dynamic-int8 engineering candidate.

Developer tools only. Keeps the original model, metadata and licence untouched;
does not alter the packaged payload, native admission or spot-quality policy.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def transform(output, *, all_matmuls=False):
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    versions = {name: importlib.metadata.version(name) for name in ("onnxruntime", "onnx", "numpy")}
    if versions != {"onnxruntime": "1.24.3", "onnx": "1.20.1", "numpy": "2.0.2"}:
        raise ValueError(f"Unpinned transformation environment: {versions}")
    upstream = ROOT / "vendor/deepcw-engine"
    original = json.loads((upstream / "manifest.json").read_text())
    if any(digest(upstream / name) != expected for name, expected in original["sha256"].items()):
        raise ValueError("Pinned original model/metadata/licence changed")
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    target = output / "model.onnx"
    quantize_dynamic(str(upstream / "model.onnx"), str(target), op_types_to_quantize=["MatMul"],
        per_channel=True, weight_type=QuantType.QInt8, extra_options={"MatMulConstBOnly": not all_matmuls})
    onnx.checker.check_model(str(target))
    for name in ("LICENSE", "model.onnx.json", "manifest.json"):
        shutil.copyfile(upstream / name, output / ("original-" + name))
    manifest = {"schema_version": 1, "status": "engineering_only_quality_unqualified",
        "source_model": {"sha256": original["sha256"]["model.onnx"], "upstream": original["upstream"], "commit": original["commit"]},
        "output": {"path": "model.onnx", "sha256": digest(target), "bytes": target.stat().st_size},
        "metadata_sha256": original["sha256"]["model.onnx.json"], "license": original["license"], "license_sha256": original["sha256"]["LICENSE"],
        "transformation": {"method": "onnxruntime.quantization.quantize_dynamic", "op_types": ["MatMul"],
            "per_channel": True, "weight_type": "QInt8", "extra_options": {"MatMulConstBOnly": not all_matmuls}},
        "tool_versions": versions, "transform_source_sha256": digest(Path(__file__)),
        "quantizer_source_sha256": digest(Path(quantize_dynamic.__code__.co_filename)),
        "source_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()}
    (output / "transformation.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--all-matmuls", action="store_true", help="Also quantize dynamic attention MatMuls; separate unqualified candidate")
    args = parser.parse_args()
    transform(args.output.resolve(), all_matmuls=args.all_matmuls)
