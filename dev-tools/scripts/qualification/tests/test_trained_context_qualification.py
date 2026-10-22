import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "run_trained_context_qualification.py"
spec = importlib.util.spec_from_file_location("trained_context_qualification", MODULE)
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class TrainedContextQualificationTests(unittest.TestCase):
    def test_fixed_heldout_labels_are_complete_and_distractors_do_not_add_relevant_duplicates(self):
        rows = list(qualification.rows(1000))
        self.assertEqual(len(rows), 1000)
        self.assertEqual(len({row["chunkIndex"] for row in rows}), 1000)
        for index, (_query, answer) in enumerate(qualification.TOPICS):
            self.assertEqual(sum(row["text"] == answer for row in rows), 5)
            expected = {f"artifact.fixture:row:{row['chunkIndex']}" for row in rows if row["text"] == answer}
            self.assertEqual(qualification.relevant_ids(index), expected)
        with self.assertRaises(ValueError): list(qualification.rows(999))
        with self.assertRaises(ValueError): qualification.relevant_ids(-1)

    def test_model_input_refuses_external_path_and_unknown_revision(self):
        for invalid in ["../outside/acquisition.json", "C:/outside/acquisition.json", ".local-codex/model-qualification/minilm-../acquisition.json"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                qualification.verified_model(invalid)
        with tempfile.TemporaryDirectory() as directory, patch.object(qualification, "ROOT", Path(directory)):
            model = Path(directory)/".local-codex/model-qualification"/("minilm-"+"a"*36)
            model.mkdir(parents=True)
            (model/"acquisition.json").write_text('{"model":"foreign/model","revision":"unknown","status":"verified"}')
            with self.assertRaisesRegex(ValueError,"identity"):
                qualification.verified_model(str((model/"acquisition.json").relative_to(directory)).replace("\\","/"))

    def test_memory_profile_cannot_be_claimed_without_actual_windows_enforcement(self):
        import windows_qualification_memory as memory
        with self.assertRaisesRegex(RuntimeError,"not enforced"):
            memory.memory_profile_evidence()
        with patch.object(memory.sys,"platform","unsupported"), self.assertRaisesRegex(RuntimeError,"unavailable"):
            memory.constrain_current_process()


if __name__ == "__main__": unittest.main()
