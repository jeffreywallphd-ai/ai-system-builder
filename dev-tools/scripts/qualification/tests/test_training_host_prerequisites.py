from pathlib import Path
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "visual-composer/training-host-prerequisites.py"
SPEC = importlib.util.spec_from_file_location("fixed_training_prerequisites", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
ACQUISITION = ".local-codex/model-qualification/qwen-01234567-89ab-cdef-0123-456789abcdef/acquisition.json"


class TrainingPrerequisiteTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="training-prereq-")
        self.root = Path(self.temporary.name).resolve()
        self.assertTrue(self.root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
        self.files = {name: f"synthetic-not-a-real-model:{name}".encode() for name in ["config.json", "generation_config.json", "tokenizer_config.json", "tokenizer.json", "vocab.json", "merges.txt", "LICENSE", "model.safetensors"]}
        self.hashes = {name: hashlib.sha256(value).hexdigest() for name, value in self.files.items()}
        self.source = self.root / MODULE.SOURCE_RELATIVE
        self.source.parent.mkdir(parents=True)
        self.source.write_text(f"MODEL={MODEL!r}\nREVISION={REVISION!r}\nMODEL_FILES={self.hashes!r}\nraise RuntimeError('This source must never execute.')\n", encoding="utf-8")
        self.manifest = self.root / ACQUISITION
        self.manifest.parent.mkdir(parents=True)
        for name, value in self.files.items():
            (self.manifest.parent / name).write_bytes(value)
        self.data = {"model": MODEL, "revision": REVISION, "status": "verified", "files": [{"name": name, "sha256": digest} for name, digest in self.hashes.items()]}
        self.write_manifest()

    def tearDown(self):
        # Only this exact newly allocated unit fixture is owned by this test.
        self.assertTrue(self.root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
        self.assertEqual(self.root.resolve(), self.root)
        self.assertFalse(self.root.is_symlink())
        self.temporary.cleanup()

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.data), encoding="utf-8")

    def test_reads_only_literal_canonical_pins_without_importing_accuracy_or_model_code(self):
        fixed = MODULE.fixed_model(self.root)
        self.assertEqual(fixed["MODEL_FILES"], self.hashes)
        result = MODULE.verify_model(self.root, ACQUISITION)
        self.assertEqual(result["modelId"], MODEL)
        self.assertEqual(result["revision"], REVISION)
        self.assertEqual(result["modelFiles"], 8)
        self.assertEqual(result["modelBytes"], sum(map(len, self.files.values())))
        self.assertEqual(result["modelRelativeDirectory"], str(Path(ACQUISITION).parent).replace("\\", "/"))

    def test_fixed_real_repository_pins_are_reused_and_no_runner_is_imported(self):
        fixed = MODULE.fixed_model(MODULE.ROOT)
        self.assertEqual((fixed["MODEL"], fixed["REVISION"]), (MODEL, REVISION))
        self.assertEqual(fixed["MODEL_FILES"]["model.safetensors"], "fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe")
        self.assertNotIn("run_installed_generation_qualification", sys.modules)

    def test_refuses_arbitrary_paths_profiles_metadata_and_duplicate_members(self):
        for relative in [None, "", "../private", "/private/acquisition.json", ACQUISITION.replace("qwen-", "qwen15-"), ACQUISITION.replace("/", "\\"), ACQUISITION.replace("acquisition.json", "other.json")]:
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                MODULE.verify_model(self.root, relative)
        original = json.loads(json.dumps(self.data))
        for mutate in [lambda d: d.update(status="downloaded"), lambda d: d.update(model="other/provider"), lambda d: d.update(revision="b" * 40), lambda d: d["files"].pop(), lambda d: d["files"].__setitem__(0, d["files"][1]), lambda d: d["files"][0].update(name=[]), lambda d: d["files"][0].update(sha256="0" * 64)]:
            self.data = json.loads(json.dumps(original)); mutate(self.data); self.write_manifest()
            with self.assertRaises(ValueError):
                MODULE.verify_model(self.root, ACQUISITION)

    def test_refuses_changed_missing_extra_oversized_and_linked_input_bytes(self):
        file = self.manifest.parent / "config.json"
        file.write_bytes(b"changed")
        with self.assertRaises(ValueError): MODULE.verify_model(self.root, ACQUISITION)
        file.write_bytes(self.files["config.json"])
        extra = self.manifest.parent / "model.bin"; extra.write_bytes(b"never load pickle")
        with self.assertRaises(ValueError): MODULE.verify_model(self.root, ACQUISITION)
        extra.unlink()
        with self.assertRaises(ValueError): MODULE.digest_regular(self.root, file.relative_to(self.root).as_posix(), 1)
        link = self.root / "owned-unit-link.json"; os.link(file, link)
        with self.assertRaises(ValueError): MODULE.verify_model(self.root, ACQUISITION)
        link.unlink(); file.unlink()
        with self.assertRaises(ValueError): MODULE.verify_model(self.root, ACQUISITION)

    def test_rejects_executable_expressions_or_duplicate_profile_constants_without_evaluation(self):
        self.source.write_text(f"MODEL={MODEL!r}\nREVISION={REVISION!r}\nMODEL_FILES=__import__('os').environ\n", encoding="utf-8")
        with self.assertRaises(ValueError): MODULE.fixed_model(self.root)
        self.source.write_text(f"MODEL={MODEL!r}\nMODEL={MODEL!r}\nREVISION={REVISION!r}\nMODEL_FILES={self.hashes!r}\n", encoding="utf-8")
        with self.assertRaises(ValueError): MODULE.fixed_model(self.root)

    def test_input_admission_cannot_claim_launch_or_accuracy_authority(self):
        executable = self.root / MODULE.PYTHON_RELATIVE
        executable.parent.mkdir(parents=True); executable.write_bytes(b"synthetic unit interpreter; never launched")
        with patch.object(sys, "executable", str(executable)), patch.object(sys, "version_info", (3, 12, 0)):
            result = MODULE.inspect(self.root, ACQUISITION)
        self.assertEqual(result["status"], "verified-inputs-only")
        self.assertFalse(result["launchAuthorized"])
        self.assertFalse(result["accuracyExecuted"])
        with self.assertRaises(ValueError): MODULE.inspect(self.root, ACQUISITION)

    def test_directory_limit_is_lazy_closes_iterator_and_stops_before_tenth_name_or_weight_read(self):
        names = list(self.files) + ["acquisition.json"]
        facts = {"next": 0, "names": 0, "closed": False}
        class Entry:
            def __init__(self, index): self.index = index
            @property
            def name(self):
                facts["names"] += 1
                if self.index >= 9: raise AssertionError("The over-limit name must not be consumed.")
                return names[self.index]
        class Scan:
            def __enter__(self): return self
            def __exit__(self, *args): facts["closed"] = True
            def __iter__(self): return self
            def __next__(self):
                facts["next"] += 1
                if facts["next"] > 10: raise AssertionError("The iterator must not be drained.")
                return Entry(facts["next"] - 1)
        def scan(target):
            self.assertEqual(target, self.manifest.parent)
            return Scan()
        with patch.object(MODULE.os, "scandir", scan), patch.object(Path, "iterdir", side_effect=AssertionError("Eager directory enumeration is prohibited.")), patch.object(MODULE, "digest_regular") as digest:
            with self.assertRaises(ValueError): MODULE.verify_model(self.root, ACQUISITION)
            digest.assert_not_called()
        self.assertEqual(facts, {"next": 10, "names": 9, "closed": True})


if __name__ == "__main__":
    unittest.main()
