from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi.responses import JSONResponse

from modules.adapters.runtime.python.worker.app import ensure_model_download
from modules.adapters.runtime.python.worker.models import EnsureModelDownloadRequest


class WorkerAppTests(unittest.TestCase):
    def test_model_download_failure_returns_structured_json_response(self) -> None:
        request = EnsureModelDownloadRequest(
            provider="transformers",
            modelId="Qwen/Qwen3.5-4B",
        )

        with patch(
            "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
            side_effect=RuntimeError("Automatic download failed."),
        ):
            response = ensure_model_download(request)

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 502)
        payload = json.loads(response.body.decode("utf-8"))
        self.assertEqual(payload["error"]["code"], "model_download_failed")
        self.assertEqual(payload["error"]["stage"], "generation")
        self.assertEqual(payload["error"]["details"]["modelId"], "Qwen/Qwen3.5-4B")
        self.assertNotIn("Traceback", payload["error"]["message"])


if __name__ == "__main__":
    unittest.main()
