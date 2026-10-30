"""Verify unchanged tensors and bounded numerical parity of a fusion candidate.

This developer check is synthetic; it does not qualify RF or spot quality.
"""
import argparse
import importlib.metadata
import json
from pathlib import Path
import time

from transform_model import ROOT, digest
from quality_profile import model_binding

PROFILE = {"seed": 83100633, "frames": [334, 401, 467, 534, 601, 667],
    "batches": [1, 2], "kinds": ["silence", "random_log_features"],
    "max_abs": .001, "mean_abs": .0001, "argmax_equal": True}


def verify(candidate, manifest, output):
    import numpy as np
    import onnx
    import onnxruntime as ort

    versions = {name: importlib.metadata.version(name) for name in ("onnxruntime", "onnx", "numpy")}
    if versions != {"onnxruntime": "1.24.3", "onnx": "1.20.1", "numpy": "2.0.2"}:
        raise ValueError("Unpinned tensor validation environment")
    original = ROOT / "vendor/deepcw-engine/model.onnx"
    pinned = json.loads((ROOT / "docs/cw/QUALITY_CONTRACT.json").read_text())
    if digest(original) != pinned["model_sha256"]:
        raise ValueError("Original model hash changed")
    binding = model_binding(candidate, pinned, manifest)
    if binding["transformation"]["transformation"]["method"] != "xlog.pinned_attention_fusion.v1":
        raise ValueError("Not the bounded attention-fusion candidate")
    weights = [{w.name: w.SerializeToString() for w in onnx.load(p).graph.initializer} for p in (original, candidate)]
    if any(weights[1].get(k) != v for k, v in weights[0].items()):
        raise ValueError("Original tensor changed")
    # Write the exact profile before running any inference; never overwrite a receipt.
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    provenance = {"instrument": "pinned-attention-tensor-parity-v1", "synthetic_only": True,
        "profile": PROFILE, "tool_versions": versions, "source_sha256": digest(Path(__file__)),
        "original_sha256": digest(original), "model_binding": binding}
    (output / "profile.json").write_text(json.dumps(provenance, indent=2) + "\n")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    sessions = [ort.InferenceSession(str(p), options, providers=["CPUExecutionProvider"]) for p in (original, candidate)]
    rng = np.random.default_rng(PROFILE["seed"])
    rows = []
    started = time.monotonic()
    for frames in PROFILE["frames"]:
        for batch in PROFILE["batches"]:
            for kind in PROFILE["kinds"]:
                shape = (batch, 1, frames, 65)
                x = np.zeros(shape, dtype=np.float32) if kind == "silence" else rng.exponential(.6, shape).astype(np.float32)
                a, b = [s.run(None, {"spectrogram": x})[0] for s in sessions]
                if a.shape != b.shape:
                    raise ValueError("Tensor output shape changed")
                error = np.abs(a-b)
                rows.append({"frames": frames, "batch": batch, "kind": kind, "finite": bool(np.isfinite(b).all()),
                    "max_abs": float(error.max()), "mean_abs": float(error.mean()), "argmax_equal": bool(np.array_equal(a.argmax(-1), b.argmax(-1)))})
    passed = all(r["finite"] and r["max_abs"] <= PROFILE["max_abs"] and r["mean_abs"] <= PROFILE["mean_abs"] and r["argmax_equal"] for r in rows)
    result = {"provenance": provenance, "original_tensors_unchanged": True, "cases": rows,
        "elapsed_seconds": time.monotonic()-started, "pass": passed}
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"cases": len(rows), "max_abs": max(r["max_abs"] for r in rows),
        "mean_abs_max": max(r["mean_abs"] for r in rows), "argmax_equal": all(r["argmax_equal"] for r in rows), "pass": passed}))
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raise SystemExit(0 if verify(args.model.resolve(), args.manifest.resolve(), args.output.resolve()) else 1)
