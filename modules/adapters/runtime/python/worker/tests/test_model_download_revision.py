"""Controlled source-selection fixtures; no network, weights, Torch or model pass."""
from contextlib import ExitStack, nullcontext
from pathlib import Path
import os
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.models import EnsureModelDownloadRequest, EnsureModelDownloadResult, LocalModelConfig
from modules.adapters.runtime.python.worker.tasks import local_text_generation as download


REVISION = "a" * 40
OTHER = "b" * 40


class ModelDownloadRevisionTests(unittest.TestCase):
    def test_worker_advertises_exact_revision_protocol_without_model_or_hardware_probing(self):
        from modules.adapters.runtime.python.worker import app as worker
        from modules.adapters.runtime.python.worker.tasks import bounded_model_loader
        with patch.object(worker, "get_constrained_json_decoder_runtime_status", return_value=SimpleNamespace(available=False)), \
                patch.object(bounded_model_loader, "offload_runtime_available", return_value=False), \
                patch.object(worker, "read_local_accelerator_memory_bytes", side_effect=AssertionError("No hardware probe")):
            self.assertIn("ensure-model-download.exact-revision-v1", worker.capabilities().capabilities)

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(TemporaryDirectory(prefix="model-revision-"))).resolve()
        self.root = root
        self.snapshot = root / "models--fixture--model" / "snapshots" / REVISION
        self.snapshot.mkdir(parents=True)
        (self.snapshot / "retained.txt").write_bytes(b"synthetic retained fixture; not model weights")
        self.fetch = Mock(return_value=str(self.snapshot))
        self.stack.enter_context(patch.dict(os.environ, {"HF_HOME": str(root)}))
        self.stack.enter_context(patch.dict(sys.modules, {"huggingface_hub": SimpleNamespace(snapshot_download=self.fetch)}))
        self.stack.enter_context(patch.object(download, "_resolve_huggingface_cache_root", return_value=root))
        self.format = self.stack.enter_context(patch.object(download, "_validate_snapshot_profile_result"))
        self.remove = self.stack.enter_context(patch.object(download, "_cleanup_failed_huggingface_cache"))
        self.sleep = self.stack.enter_context(patch.object(download.time, "sleep"))
        self.stack.enter_context(patch.object(download, "_start_snapshot_cache_progress_monitor", return_value=lambda: None))
        self.stack.enter_context(patch.object(download, "_structured_huggingface_file_progress", side_effect=lambda *args: nullcontext()))
        self.stack.enter_context(patch.object(download, "_create_structured_snapshot_tqdm", return_value=None))
        self.stack.enter_context(patch.dict(download._RESOLVED_MODEL_REFERENCES, {"fixture/model": "previous-floating-alias"}))
        self.model = LocalModelConfig(provider="transformers", modelId="fixture/model")

    def run_download(self, context=None):
        return download.ensure_generation_model_downloaded(self.model, download_context=context)

    def test_request_and_completion_require_exact_optional_commit_values(self):
        for cls in [EnsureModelDownloadRequest, EnsureModelDownloadResult]:
            values = {"provider": "transformers", "modelId": "fixture/model"}
            if cls is EnsureModelDownloadResult:
                values.update(downloaded=False, fromCache=True)
            self.assertIsNone(cls(**values).revision)
            self.assertEqual(cls(**values, revision=REVISION).revision, REVISION)
            for invalid in ["main", "A" * 40, REVISION + "\n", " " + REVISION, "a" * 39, 1, {}, REVISION.encode(),
                            *([None] if cls is EnsureModelDownloadRequest else [])]:
                with self.subTest(cls=cls.__name__, invalid=type(invalid).__name__):
                    with self.assertRaises(ValueError):
                        cls(**values, revision=invalid)

    def test_worker_completion_confirms_the_observed_revision_and_keeps_the_captured_target(self):
        from modules.adapters.runtime.python.worker import app as worker
        request = EnsureModelDownloadRequest(provider="transformers", modelId="fixture/model", revision=REVISION)
        def complete(model, **kwargs):
            self.assertEqual(model.modelId, "fixture/model")
            self.assertEqual(kwargs["download_context"]["revision"], REVISION)
            request.revision = OTHER
            request.modelId = "fixture/foreign"
            return SimpleNamespace(downloaded=False, from_cache=True, cache_handle="synthetic-handle", revision=REVISION)
        with patch.object(worker, "ensure_generation_model_downloaded", side_effect=complete):
            result = worker._ensure_model_download_data(request)
        self.assertEqual(result["modelId"], "fixture/model")
        self.assertEqual(result["revision"], REVISION)
        self.assertNotIn("localPath", result)
        for observed in [None, OTHER]:
            with patch.object(worker, "ensure_generation_model_downloaded", return_value=SimpleNamespace(
                downloaded=False, from_cache=True, cache_handle="synthetic-handle", revision=observed)):
                with self.assertRaises(download.GenerationModelDownloadRevisionError):
                    worker._ensure_model_download_data(EnsureModelDownloadRequest(provider="transformers", modelId="fixture/model", revision=REVISION))

    def test_worker_unpinned_completion_keeps_its_existing_wire_fields(self):
        from modules.adapters.runtime.python.worker import app as worker
        with patch.object(worker, "ensure_generation_model_downloaded", return_value=SimpleNamespace(
            downloaded=False, from_cache=True, cache_handle="synthetic-handle")) as operation:
            result = worker._ensure_model_download_data(EnsureModelDownloadRequest(provider="transformers", modelId="fixture/model"))
        self.assertEqual(set(result), {"provider", "modelId", "downloaded", "fromCache", "modelHandle"})
        self.assertNotIn("revision", operation.call_args.kwargs["download_context"])

    def test_authenticated_http_retains_unpinned_fields_and_exact_pinned_confirmation(self):
        from fastapi.testclient import TestClient
        from modules.adapters.runtime.python.worker import app as worker
        def complete(_model, **kwargs):
            return SimpleNamespace(downloaded=False, from_cache=True, cache_handle="synthetic-handle",
                                   revision=kwargs["download_context"].get("revision"))
        token = "synthetic-runtime-revision-token"
        with patch.object(worker, "RUNTIME_AUTH_TOKEN", token), patch.object(worker, "ensure_generation_model_downloaded", side_effect=complete) as operation:
            with TestClient(worker.app) as client:
                headers = {"Authorization": "Bearer " + token}
                plain = {"provider": "transformers", "modelId": "fixture/model"}
                ordinary = client.post("/models/ensure-downloaded", json=plain, headers=headers)
                self.assertEqual(ordinary.status_code, 200)
                self.assertEqual(set(ordinary.json()), {"provider", "modelId", "downloaded", "fromCache", "modelHandle"})
                pinned = client.post("/models/ensure-downloaded", json={**plain, "revision": REVISION}, headers=headers)
                self.assertEqual(pinned.status_code, 200)
                self.assertEqual(pinned.json()["revision"], REVISION)
                for invalid_revision in ["main", None]:
                    invalid = client.post("/models/ensure-downloaded", json={**plain, "revision": invalid_revision}, headers=headers)
                    self.assertEqual(invalid.status_code, 422)
                    from modules.adapters.runtime.python.worker.models import StartPythonRuntimeTaskRequest
                    with self.assertRaises(ValueError):
                        worker._run_task(StartPythonRuntimeTaskRequest(requestId="revision-denied", taskType="ensure-model-download",
                            payload={**plain, "revision": invalid_revision}))
                self.assertEqual(operation.call_count, 2)

    def test_pinned_cache_uses_and_confirms_exact_revision_without_changing_floating_alias(self):
        result = self.run_download({"revision": REVISION})
        self.assertEqual(self.fetch.call_count, 1)
        self.assertTrue(self.fetch.call_args.kwargs["local_files_only"])
        self.assertEqual(self.fetch.call_args.kwargs["revision"], REVISION)
        self.assertEqual(result.revision, REVISION)
        self.assertTrue(result.from_cache)
        self.assertEqual(download._RESOLVED_MODEL_REFERENCES["fixture/model"], "previous-floating-alias")
        self.format.assert_called_once()
        self.remove.assert_not_called()

    def test_pinned_transfer_after_a_genuine_miss_keeps_revision_and_existing_format_controls(self):
        self.fetch.side_effect = [FileNotFoundError("synthetic cache miss"), str(self.snapshot)]
        result = self.run_download({"revision": REVISION})
        self.assertEqual(self.fetch.call_count, 2)
        self.assertEqual([call.kwargs["local_files_only"] for call in self.fetch.call_args_list], [True, False])
        self.assertTrue(all(call.kwargs["revision"] == REVISION for call in self.fetch.call_args_list))
        self.assertEqual(self.fetch.call_args.kwargs["ignore_patterns"], list(download.GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE.ignore_patterns))
        self.assertEqual(result.revision, REVISION)
        self.assertTrue(result.downloaded)
        self.assertEqual(download._RESOLVED_MODEL_REFERENCES["fixture/model"], "previous-floating-alias")
        self.format.assert_called_once()
        self.remove.assert_not_called()
        self.sleep.assert_not_called()

    def test_wrong_cached_revision_repo_or_outside_path_denies_without_transfer_retry_or_deletion(self):
        for returned in [self.snapshot.parent / OTHER, self.root / "models--foreign--model" / "snapshots" / REVISION,
                         self.root.parent / "outside-synthetic-model"]:
            with self.subTest(path_kind=returned.parent.name):
                self.fetch.reset_mock()
                self.fetch.return_value = str(returned)
                with self.assertRaises(download.GenerationModelDownloadRevisionError) as error:
                    self.run_download({"revision": REVISION})
                self.assertFalse(error.exception.retryable)
                self.assertEqual(str(error.exception), "Pinned model download revision could not be confirmed.")
                self.assertEqual(self.fetch.call_count, 1)
                self.remove.assert_not_called()
                self.sleep.assert_not_called()
                self.assertEqual((self.snapshot / "retained.txt").read_bytes(), b"synthetic retained fixture; not model weights")

    def test_wrong_transfer_result_does_not_retry_clean_or_replace_an_alias(self):
        self.fetch.side_effect = [FileNotFoundError("synthetic cache miss"), str(self.snapshot.parent / OTHER)]
        with self.assertRaises(download.GenerationModelDownloadRevisionError):
            self.run_download({"revision": REVISION})
        self.assertEqual(self.fetch.call_count, 2)
        self.remove.assert_not_called()
        self.sleep.assert_not_called()
        self.assertEqual(download._RESOLVED_MODEL_REFERENCES["fixture/model"], "previous-floating-alias")

    def test_malformed_direct_pin_is_rejected_before_any_provider_or_cache_call(self):
        for value in [None, "main", REVISION + "\n", "A" * 40, 1, {}]:
            with self.assertRaises(ValueError):
                self.run_download({"revision": value})
        self.fetch.assert_not_called()
        self.format.assert_not_called()
        self.remove.assert_not_called()

    def test_unpinned_cache_and_transfer_keep_their_existing_unversioned_shape_and_alias(self):
        for miss in [False, True]:
            self.fetch.reset_mock()
            self.fetch.side_effect = [FileNotFoundError("synthetic miss"), str(self.snapshot)] if miss else None
            result = self.run_download()
            self.assertIsNone(result.revision)
            self.assertTrue(all("revision" not in call.kwargs for call in self.fetch.call_args_list))
            self.assertEqual(download._RESOLVED_MODEL_REFERENCES["fixture/model"], str(self.snapshot))
            self.assertEqual(self.fetch.call_count, 2 if miss else 1)


if __name__ == "__main__":
    unittest.main()
