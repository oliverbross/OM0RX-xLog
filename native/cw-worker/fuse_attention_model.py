"""Unqualified, reproducible graph-fusion candidate for the pinned model only.

Keeps all learned tensors, native preprocessing, alphabet and input windows.
Uses the Attention contract in ONNX Runtime 1.24.3 ContribOperators.md. This is
a developer tool; its output is never selected by the production payload.
"""
import argparse
import collections
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess

from transform_model import ROOT, digest

TRANSFORMATION = {"method": "xlog.pinned_attention_fusion.v1", "blocks": 6,
    "domain": "com.microsoft", "operator": "Attention", "opset": 1,
    "num_heads": 6, "hidden_size": 192, "learned_tensors_unchanged": True}


def fuse(model):
    import numpy as np
    import onnx
    from onnx import helper, numpy_helper

    original = {w.name: w.SerializeToString() for w in model.graph.initializer}
    nodes = list(model.graph.node)
    producers = {output: node for node in nodes for output in node.output}
    weights = {w.name: w for w in model.graph.initializer}
    replacements = {}
    for block in range(6):
        prefix = f"encoder.{block}.self_attn."
        bias = prefix + "in_proj_bias"
        add, = [n for n in nodes if n.op_type == "Add" and bias in n.input]
        projection = producers[next(i for i in add.input if i != bias)]
        output, = [n for n in nodes if n.op_type == "Gemm" and prefix + "out_proj.weight" in n.input]
        if projection.op_type != "MatMul" or list(weights[projection.input[1]].dims) != [192, 576] or list(weights[bias].dims) != [576]:
            raise ValueError("Pinned QKV tensor contract changed")
        old = producers[output.input[0]]
        if old.op_type != "Reshape":
            raise ValueError("Pinned attention output contract changed")
        name = f"xlog_attention_{block}"
        replacements[old.name] = [
            helper.make_node("Transpose", [projection.input[0]], [name + "_input"], name=name + "_to_batch", perm=[1, 0, 2]),
            helper.make_node("Attention", [name + "_input", projection.input[1], bias], [name + "_output"],
                name=name, domain="com.microsoft", num_heads=6, unidirectional=0,
                scale=float(np.float32(np.float32(0.4204482138156891) ** 2))),
            helper.make_node("Transpose", [name + "_output"], [name + "_time"], name=name + "_to_time", perm=[1, 0, 2]),
            helper.make_node("Reshape", [name + "_time", "xlog_attention_flat_shape"], list(old.output), name=name + "_flatten")]
    expanded = [item for n in nodes for item in replacements.get(n.name, [n])]
    # Prune only nodes made unreachable by the six replacements. Preserve order.
    required = {o.name for o in model.graph.output}
    retained = []
    for node in reversed(expanded):
        if required.intersection(node.output):
            retained.append(node)
            required.update(i for i in node.input if i)
    retained.reverse()
    model.graph.ClearField("node")
    model.graph.node.extend(retained)
    model.graph.initializer.append(numpy_helper.from_array(np.array([-1, 192], dtype=np.int64), "xlog_attention_flat_shape"))
    if any(w.SerializeToString() != original[w.name] for w in model.graph.initializer if w.name in original):
        raise ValueError("Learned tensor changed")
    # Old inferred intermediate shapes describe nodes that no longer exist.
    model.graph.ClearField("value_info")
    if any(o.domain == "com.microsoft" for o in model.opset_import):
        raise ValueError("Unexpected pre-existing contrib domain")
    model.opset_import.append(helper.make_opsetid("com.microsoft", 1))
    onnx.checker.check_model(model)
    return model


def transform(output):
    import onnx
    versions = {name: importlib.metadata.version(name) for name in ("onnxruntime", "onnx", "numpy")}
    if versions != {"onnxruntime": "1.24.3", "onnx": "1.20.1", "numpy": "2.0.2"}:
        raise ValueError(f"Unpinned transformation environment: {versions}")
    upstream = ROOT / "vendor/deepcw-engine"
    original = json.loads((upstream / "manifest.json").read_text())
    if any(digest(upstream / name) != expected for name, expected in original["sha256"].items()):
        raise ValueError("Pinned model/metadata/licence changed")
    model = onnx.load(upstream / "model.onnx")
    old_nodes = len(model.graph.node)
    fused = fuse(model)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    target = output / "model.onnx"
    onnx.save(fused, target)
    for name in ("LICENSE", "model.onnx.json", "manifest.json"):
        shutil.copyfile(upstream / name, output / ("original-" + name))
    manifest = {"schema_version": 1, "status": "engineering_only_quality_unqualified",
        "source_model": {"sha256": original["sha256"]["model.onnx"], "upstream": original["upstream"], "commit": original["commit"]},
        "output": {"path": "model.onnx", "sha256": digest(target), "bytes": target.stat().st_size},
        "metadata_sha256": original["sha256"]["model.onnx.json"], "license": original["license"], "license_sha256": original["sha256"]["LICENSE"],
        "transformation": TRANSFORMATION, "tool_versions": versions,
        "transform_source_sha256": digest(Path(__file__)), "source_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
        "nodes_before": old_nodes, "nodes_after": len(fused.graph.node), "ops_after": dict(collections.Counter(n.op_type for n in fused.graph.node))}
    (output / "transformation.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    transform(parser.parse_args().output.resolve())
