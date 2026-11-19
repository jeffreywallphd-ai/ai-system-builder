"""Real disposable file integrity and synthetic SDK transport; no weights or network."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.models import EnsureModelDownloadRequest
from modules.adapters.runtime.python.worker.tasks import local_text_generation as download
from modules.adapters.runtime.python.worker.tasks.model_download_manifest import (
    ModelDownloadManifestError, capture_manifest, verify_snapshot,
)

REVISION = "a" * 40


def fixture_manifest(contents):
    files = []
    for name, data in sorted(contents.items()):
        weight = name.endswith(".safetensors")
        digest = hashlib.sha256(data).hexdigest() if weight else hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
        files.append({"path": name, "sizeBytes": len(data), "integrity": {
            "algorithm": "sha256" if weight else "git-blob-sha1", "digest": digest}})
    source = {"provider": "huggingface", "modelId": "fixture/model", "revision": REVISION,
        "format": "transformers-safetensors", "license": {"kind": "provider-declared", "identifier": "apache-2.0"},
        "files": files, "totalBytes": sum(len(data) for data in contents.values()), "excludedFileCount": 1,
        "sourceVerification": "provider-metadata", "bytesVerification": "not-checked", "runtimeReadiness": "not-checked"}
    digest = "sha256:" + hashlib.sha256(json.dumps(source, separators=(",", ":")).encode()).hexdigest()
    return {"source": source, "manifestDigest": digest}


class ModelDownloadManifestTests(unittest.TestCase):
    def test_typescript_normalized_source_digest_vector_matches_worker_contract(self):
        raw = json.loads(json.dumps(self.raw))
        raw["source"]["files"] = [{"path": name, "sizeBytes": 10, "integrity": {
            "algorithm": "sha256" if name.endswith("safetensors") else "git-blob-sha1",
            "digest": "b" * (64 if name.endswith("safetensors") else 40)}}
            for name in ("tokenizer.json", "model.safetensors", "config.json")]
        raw["source"]["totalBytes"] = 30
        raw["manifestDigest"] = "sha256:13c6493fcd0112708cb2bf37b4aebb2124ae07c40ce41dfa85614fc5d533d8e9"
        self.assertEqual(capture_manifest(raw, "fixture/model", REVISION).manifestDigest, raw["manifestDigest"])

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.cache = Path(self.stack.enter_context(TemporaryDirectory(prefix="model-manifest-"))).resolve()
        self.root = self.cache / "models--fixture--model" / "snapshots" / REVISION
        self.root.mkdir(parents=True)
        self.contents = {"config.json": b'{"model_type":"synthetic"}', "tokenizer.json": b'{"synthetic":true}',
            "model.safetensors": b"synthetic fixture; never model weights"}
        self.raw = fixture_manifest(self.contents)
        self.manifest = capture_manifest(self.raw, "fixture/model", REVISION)
        self.stack.enter_context(patch.object(download, "_resolve_huggingface_cache_root", return_value=self.cache))
        self.format = self.stack.enter_context(patch.object(download, "_validate_snapshot_profile_result"))
        self.cleanup = self.stack.enter_context(patch.object(download, "_cleanup_failed_huggingface_cache"))
        self.environment = self.stack.enter_context(patch.object(download, "configure_huggingface_download_environment"))
        self.fetch = Mock(side_effect=self.populate)
        self.stack.enter_context(patch.dict("sys.modules", {"huggingface_hub": SimpleNamespace(snapshot_download=self.fetch)}))
        self.stack.enter_context(patch.dict(download._RESOLVED_MODEL_REFERENCES, {"fixture/model": "retained-alias"}))
        self.model = download.LocalModelConfig(provider="transformers", modelId="fixture/model")

    def populate(self, **kwargs):
        self.root.mkdir(parents=True, exist_ok=True)
        for name, data in self.contents.items():
            (self.root / name).write_bytes(data)
        return str(self.root)

    def execute(self, raw=None):
        return download.ensure_generation_model_downloaded(self.model,
            download_context={"revision": REVISION, "sourceManifest": self.raw if raw is None else raw})

    def test_manifest_is_normalized_immutable_copied_and_requires_exact_model_revision_digest(self):
        self.raw["source"]["files"].reverse()
        captured = capture_manifest(self.raw, "fixture/model", REVISION)
        self.raw["source"]["files"][0]["path"] = "changed.safetensors"
        self.assertEqual([file.path for file in captured.source.files], sorted(self.contents))
        for model, revision in [("fixture/other", REVISION), ("fixture/model", None), ("fixture/model", "b" * 40)]:
            with self.assertRaises(ModelDownloadManifestError):
                capture_manifest(self.raw, model, revision)
        with self.assertRaises(Exception):
            captured.source.totalBytes = 0

    def test_malformed_presence_denies_before_sdk_cache_or_environment_and_keeps_omission(self):
        for value in [None, {}, {**self.raw, "manifestDigest": "sha256:" + "f" * 64},
                      {**self.raw, "private": "not-a-credential"}]:
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(ModelDownloadManifestError):
                    download.ensure_generation_model_downloaded(self.model,
                        download_context={"revision": REVISION, "sourceManifest": value})
                with self.assertRaises(ValueError):
                    EnsureModelDownloadRequest(provider="transformers", modelId="fixture/model", revision=REVISION, sourceManifest=value)
        self.environment.assert_not_called(); self.fetch.assert_not_called(); self.cleanup.assert_not_called()
        self.assertIsNone(EnsureModelDownloadRequest(provider="transformers", modelId="fixture/model").sourceManifest)

    def test_real_selected_bytes_verify_sha256_and_git_blob_sha1_without_runtime_claims(self):
        self.populate()
        self.assertTrue(verify_snapshot(self.manifest, str(self.root)))
        result = self.execute()
        self.assertTrue(result.from_cache); self.assertFalse(result.downloaded)
        self.assertEqual(result.verified_manifest_digest, self.manifest.manifestDigest)
        self.assertEqual(result.revision, REVISION)
        self.fetch.assert_not_called(); self.environment.assert_not_called(); self.cleanup.assert_not_called()
        self.format.assert_called_once()
        self.assertEqual(download._RESOLVED_MODEL_REFERENCES["fixture/model"], "retained-alias")

    def test_transfer_is_literal_pinned_single_worker_and_never_uses_implicit_credentials(self):
        result = self.execute()
        self.assertFalse(result.from_cache)
        self.assertEqual(self.fetch.call_count, 1)
        self.assertEqual(self.fetch.call_args.kwargs, {"repo_id": "fixture/model", "revision": REVISION,
            "cache_dir": str(self.cache), "allow_patterns": sorted(self.contents), "token": False, "local_files_only": False, "max_workers": 1})
        self.assertTrue(verify_snapshot(self.manifest, result.local_path))
        self.cleanup.assert_not_called()

    def test_sdk_stale_default_cache_cannot_replace_the_captured_explicit_destination(self):
        other = self.cache / "unused-default-cache"
        other.mkdir()
        def sdk(**kwargs):
            destination = Path(kwargs.get("cache_dir", str(other)))
            self.assertEqual(destination, self.cache)
            self.assertEqual(list(other.iterdir()), [])
            return self.populate()
        self.fetch.side_effect = sdk
        self.assertEqual(self.execute().local_path, str(self.root))
        self.assertEqual(list(other.iterdir()), [])

    def test_cache_extras_truncation_growth_and_hash_mismatch_deny_without_network_or_cleanup(self):
        for mutation in ["extra", "truncate", "grow", "hash", "directory"]:
            with self.subTest(mutation=mutation):
                self.populate()
                target = self.root / "model.safetensors"
                extra = self.root / "unapproved.py"
                if mutation == "extra": extra.write_bytes(b"retained unapproved fixture")
                elif mutation == "truncate": target.write_bytes(b"short")
                elif mutation == "grow": target.write_bytes(self.contents[target.name] + b"extra")
                elif mutation == "hash": target.write_bytes(b"x" * len(self.contents[target.name]))
                else: target.unlink(); target.mkdir()
                try:
                    with self.assertRaises(ModelDownloadManifestError): self.execute()
                    self.fetch.assert_not_called(); self.cleanup.assert_not_called()
                    self.assertTrue(target.exists())
                finally:
                    if target.is_dir(): target.rmdir()
                    if extra.exists(): extra.unlink()

    def test_shard_index_is_bounded_and_closed_to_the_selected_weight_set(self):
        base = {name: data for name, data in self.contents.items() if name != "model.safetensors"}
        base["model-00001.safetensors"] = b"synthetic shard"
        for reference in ["model-00001.safetensors", "missing.safetensors", "../foreign.safetensors"]:
            contents = {**base, "model.safetensors.index.json": json.dumps({"weight_map": {"tensor": reference}}).encode()}
            self.raw = fixture_manifest(contents); self.contents = contents; self.populate()
            if reference == "model-00001.safetensors": self.assertTrue(verify_snapshot(capture_manifest(self.raw, "fixture/model", REVISION), str(self.root)))
            else:
                with self.assertRaises(ModelDownloadManifestError): self.execute()
        self.fetch.assert_not_called(); self.cleanup.assert_not_called()

    def test_network_failure_preserves_partial_data_and_cannot_retry_delete_or_change_alias(self):
        def interrupted(**_kwargs):
            (self.root / "config.json").write_bytes(self.contents["config.json"])
            raise RuntimeError("Synthetic private provider details")
        self.fetch.side_effect = interrupted
        with self.assertRaisesRegex(ModelDownloadManifestError, "^The selected model files could not be verified\\.$"):
            self.execute()
        self.assertEqual(self.fetch.call_count, 1)
        self.assertTrue((self.root / "config.json").exists())
        self.cleanup.assert_not_called()
        self.assertEqual(download._RESOLVED_MODEL_REFERENCES["fixture/model"], "retained-alias")

    def test_changes_during_hashing_and_descriptor_fact_drift_deny_without_effects(self):
        from modules.adapters.runtime.python.worker.tasks import model_download_manifest as verifier
        original_open = os.fdopen
        for mutation in ("grow", "replace"):
            with self.subTest(mutation=mutation):
                self.populate()
                target = self.root / "config.json"
                mutated = False
                class Reader:
                    def __init__(self, stream): self.stream = stream
                    def fileno(self): return self.stream.fileno()
                    def read(self, amount):
                        nonlocal mutated
                        data = self.stream.read(amount)
                        if not mutated:
                            mutated = True
                            if mutation == "grow":
                                with target.open("ab") as changed: changed.write(b"late bytes")
                            else:
                                target.rename(self.root / "retained-original")
                                target.write_bytes(self.contents["config.json"])
                        return data
                    def __enter__(self): return self
                    def __exit__(self, *args): return self.stream.__exit__(*args)
                try:
                    with patch.object(verifier.os, "fdopen", side_effect=lambda fd, mode: Reader(original_open(fd, mode))):
                        with self.assertRaises(ModelDownloadManifestError): verify_snapshot(self.manifest, str(self.root))
                    self.fetch.assert_not_called(); self.cleanup.assert_not_called()
                finally:
                    retained = self.root / "retained-original"
                    if retained.exists(): retained.unlink()
        self.populate()
        original_fstat = os.fstat
        calls = 0
        def changed_fstat(fd):
            nonlocal calls
            facts = original_fstat(fd); calls += 1
            if calls != 2: return facts
            return SimpleNamespace(**{name: getattr(facts, name) for name in (
                "st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_file_attributes", "st_reparse_tag")},
                st_ctime_ns=facts.st_ctime_ns + 1)
        with patch.object(verifier.os, "fstat", side_effect=changed_fstat):
            with self.assertRaises(ModelDownloadManifestError): verify_snapshot(self.manifest, str(self.root))

    def test_worker_wire_confirms_only_returned_manifest_proof_and_preserves_ordinary_shape(self):
        from modules.adapters.runtime.python.worker import app as worker
        request = EnsureModelDownloadRequest(provider="transformers", modelId="fixture/model", revision=REVISION, sourceManifest=self.raw)
        def done(_model, **kwargs):
            self.assertEqual(kwargs["download_context"]["sourceManifest"], self.raw)
            return SimpleNamespace(downloaded=False, from_cache=True, cache_handle="synthetic-handle", revision=REVISION,
                verified_manifest_digest=self.manifest.manifestDigest)
        with patch.object(worker, "ensure_generation_model_downloaded", side_effect=done):
            result = worker._ensure_model_download_data(request)
            self.assertEqual(result["verifiedManifestDigest"], self.manifest.manifestDigest)
        for proof in (None, "sha256:" + "f" * 64):
            with patch.object(worker, "ensure_generation_model_downloaded", return_value=SimpleNamespace(
                    downloaded=False, from_cache=True, cache_handle="synthetic-handle", revision=REVISION, verified_manifest_digest=proof)):
                with self.assertRaises(ModelDownloadManifestError): worker._ensure_model_download_data(request)

    def test_foreign_repository_revision_and_resource_refusal_do_not_start_transfer(self):
        self.populate()
        other = self.cache / "models--foreign--model" / "snapshots" / REVISION
        other.mkdir(parents=True)
        for name, data in self.contents.items(): (other / name).write_bytes(data)
        with self.assertRaises(ModelDownloadManifestError): verify_snapshot(self.manifest, str(other))
        wrong = self.root.parent / ("b" * 40)
        self.root.rename(wrong)
        try:
            with self.assertRaises(ModelDownloadManifestError): verify_snapshot(self.manifest, str(wrong))
        finally: wrong.rename(self.root)
        for name in self.contents: (self.root / name).unlink()
        with patch.object(download.shutil, "disk_usage", return_value=SimpleNamespace(free=1)):
            with self.assertRaises(ModelDownloadManifestError): self.execute()
        self.fetch.assert_not_called(); self.environment.assert_not_called(); self.cleanup.assert_not_called()
        self.assertTrue((other / "model.safetensors").exists())

    def test_duplicate_and_unbounded_index_data_cannot_be_verified(self):
        base = {name: data for name, data in self.contents.items() if name != "model.safetensors"}
        base["model-00001.safetensors"] = b"synthetic shard"
        for index in [b'{"weight_map":{"x":"model-00001.safetensors","x":"model-00001.safetensors"}}',
                      b" " * (1024 * 1024 + 1)]:
            self.contents = {**base, "model.safetensors.index.json": index}
            self.raw = fixture_manifest(self.contents); self.populate()
            with self.assertRaises(ModelDownloadManifestError): self.execute()
        self.fetch.assert_not_called(); self.cleanup.assert_not_called()
