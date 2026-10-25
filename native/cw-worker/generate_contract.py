"""Build-time compiler of the pinned model metadata; no Python runtime dependency."""
import hashlib
import json
import pathlib
import sys

root, output = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((root / "manifest.json").read_text())
for name, expected in manifest["sha256"].items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Model resource failed integrity validation: {name}")
m = json.loads((root / "model.onnx.json").read_text())
expected = dict(sample_rate=3200, fft_length=256, hop_length=48,
                spectrogram_min_freq_hz=400.0, spectrogram_max_freq_hz=1200.0,
                spectrogram_frequency_bins=65, normalization="log1p", blank_index=41,
                num_classes=42, channel_count=1, onnx_input_dtype="float32", onnx_output_dtype="float32",
                onnx_input_layout=["batch", "channel", "time", "frequency"],
                onnx_output_layout=["batch", "time", "class"])
if any(m.get(k) != v for k, v in expected.items()) or len(m["chars"]) != m["blank_index"]:
    raise SystemExit("Unsupported model feature contract; qualify a new adapter before updating")
output.write_text("// Generated from hash-verified metadata. Do not edit.\n#pragma once\n"
                  "namespace cw::model {\n" +
                  "\n".join(f"inline constexpr int {k} = {m[k]};" for k in
                            ["sample_rate", "fft_length", "hop_length", "spectrogram_frequency_bins", "blank_index", "num_classes"]) +
                  "\n" + "\n".join(f"inline constexpr const char* {k} = {json.dumps(m[k])};" for k in
                                    ["onnx_input_name", "onnx_output_name"]) +
                  f"\ninline constexpr const char* alphabet = {json.dumps(''.join(m['chars']))};\n" +
                  "}\n")
