import unittest
import json
from pathlib import Path
import tempfile
from quality_profile import edit_distance, digest, model_binding

class QualityScoringTests(unittest.TestCase):
    def test_counts_insertions_deletions_substitutions_and_repetitions(self):
        for reference, observed, errors in [("AB AB", "AB AB", 0), ("AB AB", "AB", 3),
            ("K1A/P", "K1AP", 1), ("Q7ZX", "Q7YX", 1), ("CQ", "CQ CQ", 3), ("", "CQ", 2)]:
            self.assertEqual(edit_distance(reference, observed), errors)

    def test_never_normalizes_a_wrong_call_or_slash_into_a_match(self):
        self.assertGreater(edit_distance("Z9ABC/P", "Z9ABC"), 0)
        self.assertGreater(edit_distance("K1ABC K1ABC", "K1ABC"), 0)

    def test_candidate_must_bind_exact_model_original_and_transformation(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.onnx"
            model.write_bytes(b"engineering candidate")
            path = Path(directory) / "transformation.json"
            pinned = {"model_sha256": "original"}
            manifest = {"status": "engineering_only_quality_unqualified", "source_model": {"sha256": "original"},
                "output": {"sha256": digest(model)}, "transformation": {
                    "method": "onnxruntime.quantization.quantize_dynamic", "op_types": ["MatMul"],
                    "per_channel": True, "weight_type": "QInt8", "extra_options": {"MatMulConstBOnly": True}}}
            for value in (True, False):
                manifest["transformation"]["extra_options"]["MatMulConstBOnly"] = value
                path.write_text(json.dumps(manifest))
                self.assertEqual(model_binding(model, pinned, path)["kind"], "transformed_engineering_candidate_unqualified")
            manifest["transformation"]["extra_options"]["MatMulConstBOnly"] = 0
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError): model_binding(model, pinned, path)
            manifest["transformation"]["extra_options"]["MatMulConstBOnly"] = True
            manifest["output"]["sha256"] = "wrong-model"
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError): model_binding(model, pinned, path)
            with self.assertRaises(ValueError): model_binding(model, pinned, None)

    def test_attention_candidate_requires_exact_fusion_contract(self):
        from fuse_attention_model import TRANSFORMATION
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.onnx"
            model.write_bytes(b"fused engineering candidate")
            path = Path(directory) / "transformation.json"
            manifest = {"status": "engineering_only_quality_unqualified", "source_model": {"sha256": "original"},
                "output": {"sha256": digest(model)}, "transformation": dict(TRANSFORMATION)}
            path.write_text(json.dumps(manifest))
            self.assertEqual(model_binding(model, {"model_sha256": "original"}, path)["kind"], "transformed_engineering_candidate_unqualified")
            for key, value in (("num_heads", 8), ("learned_tensors_unchanged", 1), ("blocks", 5)):
                manifest["transformation"] = dict(TRANSFORMATION, **{key: value})
                path.write_text(json.dumps(manifest))
                with self.assertRaises(ValueError): model_binding(model, {"model_sha256": "original"}, path)

if __name__ == "__main__": unittest.main()
