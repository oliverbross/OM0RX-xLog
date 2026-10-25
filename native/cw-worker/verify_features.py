"""Independent NumPy feature oracle for the pinned public engine contract."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import numpy as np

worker = str(Path(sys.argv[1]).resolve())
root = Path(__file__).resolve().parents[2]
metadata = json.loads((root / "vendor/deepcw-engine/model.onnx.json").read_text())
rng = np.random.default_rng(20261026)
cases = dict(silence=np.zeros(19200, dtype=np.float32),
             random=rng.normal(0, 0.2, 22713).astype(np.float32),
             impulse=np.eye(1, 16000, dtype=np.float32)[0])
with tempfile.TemporaryDirectory(prefix="xlog-cw-features-") as folder:
    folder = Path(folder)
    for name, audio in cases.items():
        source, target = folder / "audio.f32", folder / "features.f32"
        audio.astype("<f4").tofile(source)
        subprocess.run([worker, "--features", str(source), str(target)], check=True)
        window = np.hanning(257)[:-1].astype(np.float32)
        padded = np.pad(audio, (128, 128), mode="reflect")
        frames = 1 + len(audio) // 48
        reference = np.empty((frames, 65), np.float32)
        for i in range(frames):
            spectrum = np.fft.rfft(padded[i*48:i*48+256] * window)
            reference[i] = np.log1p(np.abs(spectrum[32:97]).astype(np.float32))
        actual = np.fromfile(target, dtype="<f4").reshape(reference.shape)
        np.testing.assert_allclose(actual, reference, atol=2e-6, rtol=2e-6)
        print(name, reference.shape, "max absolute error", float(np.max(np.abs(actual-reference))))
