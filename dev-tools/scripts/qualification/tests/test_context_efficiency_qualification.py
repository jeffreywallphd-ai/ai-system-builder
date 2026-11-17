import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "run_context_efficiency_qualification.py"
spec = importlib.util.spec_from_file_location("context_qualification", MODULE)
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class ContextEfficiencyQualificationTests(unittest.TestCase):
    def test_exact_oracle_rejects_changed_identity_order_citation_and_nonfinite_score(self):
        baseline = {"answers": [[{"id": "one", "score": 0.5, "citation": {"sourceArtifactId": "fixture"}}]]}
        self.assertTrue(qualification.compare(baseline, baseline)["identities_order_citations_equal"])
        for change in [{"id": "foreign"}, {"citation": {"sourceArtifactId": "foreign"}}, {"score": float("nan")}, {"score": float("inf")}, {"score": True}, {"score": 0.6}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                qualification.compare(baseline, {"answers": [[{**baseline["answers"][0][0], **change}]]})

    def test_run_identity_cannot_select_an_external_output_location(self):
        for invalid in ["../outside", "C:/outside", "a" * 33, "g" * 32, ""]:
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                qualification.run_root(invalid)

    def test_memory_budget_requires_actual_positive_measurements(self):
        self.assertEqual(qualification.reduction(100, 60), 0.4)
        for invalid in [0, -1, True, float("nan"), float("inf"), None]:
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                qualification.reduction(invalid, 60)
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                qualification.reduction(100, invalid)

    def test_large_cohort_keeps_the_existing_package_member_ceiling(self):
        self.assertEqual(qualification.dimensions_for(10000), 384)
        self.assertEqual(qualification.dimensions_for(100000), 128)


if __name__ == "__main__":
    unittest.main()
