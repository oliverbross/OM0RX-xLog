import unittest
from quality_profile import edit_distance

class QualityScoringTests(unittest.TestCase):
    def test_counts_insertions_deletions_substitutions_and_repetitions(self):
        for reference, observed, errors in [("AB AB", "AB AB", 0), ("AB AB", "AB", 3),
            ("K1A/P", "K1AP", 1), ("Q7ZX", "Q7YX", 1), ("CQ", "CQ CQ", 3), ("", "CQ", 2)]:
            self.assertEqual(edit_distance(reference, observed), errors)

    def test_never_normalizes_a_wrong_call_or_slash_into_a_match(self):
        self.assertGreater(edit_distance("Z9ABC/P", "Z9ABC"), 0)
        self.assertGreater(edit_distance("K1ABC K1ABC", "K1ABC"), 0)

if __name__ == "__main__": unittest.main()
