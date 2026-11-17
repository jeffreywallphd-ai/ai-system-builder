from pathlib import Path
import hashlib
import importlib.util
import json
import os
import subprocess
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


TINY_ACQUISITION = ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json"


class GeneratedTrainingInputTests(unittest.TestCase):
    """Only newly allocated fake input bytes. No Torch or model execution."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tiny-training-input-")
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)
        relative = SCRIPT.relative_to(MODULE.ROOT)
        target = self.root / relative
        target.parent.mkdir(parents=True)
        target.write_bytes(SCRIPT.read_bytes())
        self.environment = {key: "1" for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE", "PIP_NO_INDEX")}
        self.environment["PYTHON_RUNTIME_QUALIFICATION_SCENARIO"] = "training-model-host"

    def fake_generator(self, directory):
        self.assertFalse(any(name in sys.modules for name in ("torch", "transformers", "tokenizers")))
        for name in MODULE.TINY_FILES:
            value = b"inert unit fixture, not executable or real weights"
            if name == "config.json":
                value = json.dumps({**MODULE.TINY_CONFIGURATION, "model_type": "qwen2", "architectures": ["Qwen2ForCausalLM"]}).encode()
            if name == "tokenizer_config.json":
                value = b'{"tokenizer_class":"PreTrainedTokenizerFast"}'
            (directory / name).write_bytes(value)

    def create(self):
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", self.fake_generator):
            return MODULE.create_tiny(self.root, TINY_ACQUISITION)

    def rewrite(self, mutate):
        manifest = self.root / TINY_ACQUISITION
        value = json.loads(manifest.read_bytes()); mutate(value)
        raw = json.dumps(value).encode(); manifest.write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def test_fresh_input_has_distinct_local_identity_hash_and_no_launch_or_accuracy_authority(self):
        result = self.create()
        self.assertEqual((result["modelId"], result["provider"], result["displayName"]), (MODULE.TINY_MODEL_ID, "unknown", "Generated tiny training input"))
        self.assertEqual(result["modelFiles"], 6)
        self.assertLess(result["modelBytes"], 1024 * 1024)
        self.assertEqual(MODULE.inspect_tiny(self.root, TINY_ACQUISITION, result["manifestSha256"]), result)
        executable = self.root / MODULE.PYTHON_RELATIVE
        executable.parent.mkdir(parents=True); executable.write_bytes(b"inert interpreter")
        with patch.object(sys, "executable", str(executable)), patch.object(sys, "version_info", (3, 12, 0)):
            facts = MODULE.inspect(self.root, TINY_ACQUISITION, result["manifestSha256"])
        self.assertEqual(facts["schemaVersion"], "training-local-inputs-v2")
        self.assertFalse(facts["accuracyExecuted"]); self.assertFalse(facts["launchAuthorized"])

    def test_fresh_generation_canonicalizes_supplier_slow_save_alias_without_relaxing_inspection(self):
        def supplier_shaped_generator(directory):
            self.fake_generator(directory)
            configuration = {"tokenizer_class": "PreTrainedTokenizer", "model_max_length": 128,
                             "added_tokens_decoder": {"0": {"content": "[PAD]", "special": True}}}
            (directory / "tokenizer_config.json").write_text(json.dumps(configuration), encoding="utf-8")
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", supplier_shaped_generator):
            result = MODULE.create_tiny(self.root, TINY_ACQUISITION)
        manifest = self.root / TINY_ACQUISITION
        tokenizer = manifest.parent / "tokenizer_config.json"
        configuration = json.loads(tokenizer.read_bytes())
        self.assertEqual(configuration, {"tokenizer_class": "PreTrainedTokenizerFast", "model_max_length": 128,
                                         "added_tokens_decoder": {"0": {"content": "[PAD]", "special": True}}})
        self.assertEqual(MODULE.inspect_tiny(self.root, TINY_ACQUISITION, result["manifestSha256"]), result)
        # Existing bytes cannot gain admission by using the supplier's alias,
        # even when their manifest hashes are updated by a caller.
        configuration["tokenizer_class"] = "PreTrainedTokenizer"
        tokenizer.write_text(json.dumps(configuration), encoding="utf-8")
        expected = self.rewrite(lambda value: value["files"]["tokenizer_config.json"].update(
            sha256=hashlib.sha256(tokenizer.read_bytes()).hexdigest(), bytes=tokenizer.stat().st_size))
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, expected)
        before = tokenizer.read_bytes()
        with self.assertRaises(FileExistsError): self.create()
        self.assertEqual(tokenizer.read_bytes(), before)

    def test_already_explicit_fast_metadata_is_not_rewritten(self):
        self.create()
        self.assertEqual((self.root / TINY_ACQUISITION).parent.joinpath("tokenizer_config.json").read_bytes(),
                         b'{"tokenizer_class":"PreTrainedTokenizerFast"}')

    def test_invalid_generated_tokenizer_metadata_is_rejected_before_rewrite(self):
        cases = [b'{"tokenizer_class":"UnapprovedTokenizer"}', b'{"tokenizer_class":true}', b'[]',
                 b'{"tokenizer_class":"PreTrainedTokenizer","auto_map":{"AutoTokenizer":"untrusted.code"}}',
                 b'{"tokenizer_class":"PreTrainedTokenizer","tokenizer_class":"PreTrainedTokenizerFast"}',
                 b'{"tokenizer_class":"PreTrainedTokenizer"}' + b" " * (64 * 1024)]
        for index, original in enumerate(cases, 1):
            acquisition = TINY_ACQUISITION.replace("01234567-", f"{index:08x}-")
            def invalid(directory, raw=original):
                self.fake_generator(directory)
                (directory / "tokenizer_config.json").write_bytes(raw)
            with self.subTest(index=index), patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", invalid):
                with self.assertRaises(ValueError): MODULE.create_tiny(self.root, acquisition)
            self.assertEqual((self.root / acquisition).parent.joinpath("tokenizer_config.json").read_bytes(), original)
            self.assertFalse((self.root / acquisition).exists())

    def test_linked_generated_tokenizer_is_rejected_without_writing_or_manifest(self):
        original = b'{"tokenizer_class":"PreTrainedTokenizer"}'
        def linked(directory):
            self.fake_generator(directory)
            target = directory / "tokenizer_config.json"
            target.write_bytes(original)
            os.link(target, self.root / "owned-unit-tokenizer-link.json")
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", linked):
            with self.assertRaises(ValueError): MODULE.create_tiny(self.root, TINY_ACQUISITION)
        self.assertEqual((self.root / "owned-unit-tokenizer-link.json").read_bytes(), original)
        self.assertFalse((self.root / TINY_ACQUISITION).exists())

    def test_failed_metadata_write_keeps_original_exception_and_does_not_adopt_slot(self):
        original = b'{"tokenizer_class":"PreTrainedTokenizer"}'
        def producer(directory):
            self.fake_generator(directory)
            (directory / "tokenizer_config.json").write_bytes(original)
        original_open = Path.open
        class RefusedWrite:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): return self
            def __exit__(self, *args): return self.stream.__exit__(*args)
            def __getattr__(self, name): return getattr(self.stream, name)
            def write(self, value): raise OSError("synthetic-private-write-detail")
        def open_file(target, *args, **kwargs):
            stream = original_open(target, *args, **kwargs)
            return RefusedWrite(stream) if target.name == "tokenizer_config.json" and args and args[0] == "r+b" else stream
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", producer), patch.object(Path, "open", open_file):
            with self.assertRaises(OSError) as raised: MODULE.create_tiny(self.root, TINY_ACQUISITION)
        self.assertEqual(MODULE.failure_details(raised.exception)["errorType"], "OSError")
        self.assertEqual((self.root / TINY_ACQUISITION).parent.joinpath("tokenizer_config.json").read_bytes(), original)
        self.assertFalse((self.root / TINY_ACQUISITION).exists())
        with self.assertRaises(FileExistsError): self.create()

    def test_tokenizer_change_before_write_is_not_overwritten_or_manifested(self):
        original = b'{"tokenizer_class":"PreTrainedTokenizer"}'
        changed = b'{"tokenizer_class":"PreTrainedTokenizer","changed":true}'
        def producer(directory):
            self.fake_generator(directory)
            (directory / "tokenizer_config.json").write_bytes(original)
        original_open = Path.open
        def open_file(target, *args, **kwargs):
            stream = original_open(target, *args, **kwargs)
            if target.name == "tokenizer_config.json" and args and args[0] == "r+b":
                stream.write(changed); stream.truncate(); stream.flush(); stream.seek(0)
            return stream
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", producer), patch.object(Path, "open", open_file):
            with self.assertRaises(ValueError): MODULE.create_tiny(self.root, TINY_ACQUISITION)
        self.assertEqual((self.root / TINY_ACQUISITION).parent.joinpath("tokenizer_config.json").read_bytes(), changed)
        self.assertFalse((self.root / TINY_ACQUISITION).exists())

    def test_failure_facts_keep_stage_and_type_without_messages_paths_or_unknown_type_names(self):
        marker = "hf_synthetic_secret C:\\private\\test-user-data.json"
        def failed_generation(directory): raise RuntimeError(marker)
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", failed_generation):
            try:
                MODULE.create_tiny(self.root, TINY_ACQUISITION)
            except RuntimeError as error:
                facts = MODULE.failure_details(error)
            else:
                self.fail("The synthetic generation failure must propagate.")
        self.assertEqual(facts, {"stage": "create-tiny-inputs", "errorType": "RuntimeError"})
        self.assertNotIn(marker, json.dumps(facts))
        unknown = type("SyntheticPrivateTypeName", (Exception,), {})(marker)
        self.assertEqual(MODULE.failure_details(unknown), {"stage": "entry-admission", "errorType": "UnhandledError"})

    def test_invalid_argument_cli_has_bounded_useful_json_and_no_model_effect(self):
        result = subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), "--invalid"], cwd=self.root,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, b"")
        self.assertLess(len(result.stdout), 4096)
        facts = json.loads(result.stdout)
        self.assertEqual(facts["status"], "unavailable")
        self.assertFalse(facts["accuracyExecuted"]); self.assertFalse(facts["launchAuthorized"])
        self.assertEqual(facts["diagnostics"], {"stage": "entry-admission", "errorType": "ValueError"})
        self.assertNotIn(str(self.root), result.stdout.decode())
        self.assertNotIn("Traceback", result.stdout.decode())

    def test_existing_and_interrupted_directories_are_never_adopted_retried_or_removed(self):
        result = self.create(); before = (self.root / TINY_ACQUISITION).read_bytes()
        with self.assertRaises(FileExistsError): self.create()
        self.assertEqual((self.root / TINY_ACQUISITION).read_bytes(), before)
        other = TINY_ACQUISITION.replace("01234567-", "11234567-")
        def partial(directory):
            (directory / "model.safetensors").write_bytes(b"retained partial fixture")
            raise RuntimeError("synthetic generation failure")
        with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny", partial):
            with self.assertRaises(RuntimeError): MODULE.create_tiny(self.root, other)
            with self.assertRaises(FileExistsError): MODULE.create_tiny(self.root, other)
        self.assertEqual((self.root / other).parent.joinpath("model.safetensors").read_bytes(), b"retained partial fixture")
        self.assertFalse((self.root / other).exists())
        self.assertEqual(MODULE.inspect_tiny(self.root, TINY_ACQUISITION, result["manifestSha256"])["modelFiles"], 6)

    def test_missing_wrong_hash_partial_extra_changed_or_linked_files_are_rejected(self):
        result = self.create(); digest = result["manifestSha256"]
        for bad in (None, "", "0" * 64, digest + "\n", True):
            with self.subTest(bad=bad), self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, bad)
        file = (self.root / TINY_ACQUISITION).parent / "model.safetensors"
        original = file.read_bytes(); file.write_bytes(original + b"changed")
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, digest)
        file.write_bytes(original)
        extra = file.with_name("model.bin"); extra.write_bytes(b"pickle must not load")
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, digest)
        extra.unlink()
        link = self.root / "inert-weight-link"; os.link(file, link)
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, digest)
        link.unlink(); file.unlink()
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, digest)

    def test_even_a_rehashed_manifest_cannot_change_fixed_model_provider_seed_or_bounds(self):
        self.create(); original = (self.root / TINY_ACQUISITION).read_bytes()
        mutations = [lambda v: v.update(provider="huggingface"), lambda v: v.update(modelId=MODEL),
                     lambda v: v.update(displayName="Qualified Qwen 0.5B input"), lambda v: v.update(seed=True),
                     lambda v: v.update(extra="private"), lambda v: v["configuration"].update(hidden_size=1024),
                     lambda v: v.update(generatorSha256="0" * 64), lambda v: v["files"].pop("config.json"),
                     lambda v: v["files"]["model.safetensors"].update(bytes=True)]
        for mutate in mutations:
            (self.root / TINY_ACQUISITION).write_bytes(original)
            expected = self.rewrite(mutate)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, expected)

    def test_duplicate_manifest_members_and_unsafe_configuration_are_rejected(self):
        self.create(); manifest = self.root / TINY_ACQUISITION
        raw = manifest.read_bytes().replace(b'"seed":13', b'"seed":13,"seed":13')
        self.assertIn(b'"seed":13,"seed":13', raw); manifest.write_bytes(raw)
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, hashlib.sha256(raw).hexdigest())
        # A syntactically valid model manifest still cannot enable remote code.
        raw = raw.replace(b'"seed":13,"seed":13', b'"seed":13'); manifest.write_bytes(raw)
        config = manifest.parent / "config.json"; value = json.loads(config.read_bytes()); value["auto_map"] = {"AutoModel": "untrusted.code"}; config.write_text(json.dumps(value))
        digest = self.rewrite(lambda v: v["files"]["config.json"].update(sha256=hashlib.sha256(config.read_bytes()).hexdigest(), bytes=config.stat().st_size))
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, digest)

    def test_rehashed_oversized_weight_file_is_still_denied(self):
        self.create(); file = (self.root / TINY_ACQUISITION).parent / "model.safetensors"
        file.write_bytes(b"x" * (512 * 1024 + 1))
        digest = self.rewrite(lambda v: v["files"]["model.safetensors"].update(sha256=hashlib.sha256(file.read_bytes()).hexdigest(), bytes=file.stat().st_size))
        with self.assertRaises(ValueError): MODULE.inspect_tiny(self.root, TINY_ACQUISITION, digest)

    def test_invalid_selector_and_offline_flags_fail_before_directory_or_heavy_import(self):
        for selector in (None, "../private", TINY_ACQUISITION.replace("tiny-", "other-"), TINY_ACQUISITION.replace("input.json", "model.py"), TINY_ACQUISITION.replace("/", "\\"), TINY_ACQUISITION + "\n"):
            with patch.dict(os.environ, self.environment, clear=True), patch.object(MODULE, "_generate_tiny") as generate:
                with self.assertRaises(ValueError): MODULE.create_tiny(self.root, selector)
                generate.assert_not_called()
        for key in self.environment:
            with patch.dict(os.environ, {**self.environment, key: "wrong"}, clear=True), patch.object(MODULE, "_generate_tiny") as generate:
                with self.assertRaises(ValueError): MODULE.create_tiny(self.root, TINY_ACQUISITION)
                generate.assert_not_called()
        self.assertFalse((self.root / ".local-codex").exists())


if __name__ == "__main__":
    unittest.main()
