from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker import app as worker_app


def invoke_worker(path: str, authorization: str | None = None) -> tuple[int, dict, dict[str, str]]:
    sent: list[dict] = []
    headers = [] if authorization is None else [(b"authorization", authorization.encode("ascii"))]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 51000),
        "server": ("127.0.0.1", 43111),
    }
    received = False

    async def receive() -> dict:
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        sent.append(message)

    asyncio.run(worker_app.app(scope, receive, send))
    start = next(message for message in sent if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"")
        for message in sent
        if message["type"] == "http.response.body"
    )
    response_headers = {
        name.decode("latin-1"): value.decode("latin-1")
        for name, value in start.get("headers", [])
    }
    return start["status"], json.loads(body.decode("utf-8")), response_headers


class WorkerAuthenticationTests(unittest.TestCase):
    def test_worker_fails_closed_when_launch_token_is_unconfigured(self) -> None:
        with patch.object(worker_app, "RUNTIME_AUTH_TOKEN", ""):
            status, payload, _headers = invoke_worker("/health")
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"]["code"], "runtime_auth_unconfigured")

    def test_worker_rejects_missing_and_incorrect_bearer_tokens(self) -> None:
        token = "worker-runtime-token-0123456789abcdef"
        with patch.object(worker_app, "RUNTIME_AUTH_TOKEN", token):
            missing_status, _missing_payload, missing_headers = invoke_worker("/health")
            incorrect_status, _incorrect_payload, _incorrect_headers = invoke_worker(
                "/health",
                "Bearer incorrect-runtime-token-0123456789",
            )
        self.assertEqual(missing_status, 401)
        self.assertEqual(incorrect_status, 401)
        self.assertEqual(missing_headers.get("www-authenticate"), "Bearer")

    def test_worker_accepts_the_current_launch_token(self) -> None:
        token = "worker-runtime-token-0123456789abcdef"
        with patch.object(worker_app, "RUNTIME_AUTH_TOKEN", token):
            status, payload, _headers = invoke_worker("/health", f"Bearer {token}")
        self.assertEqual(status, 200)
        self.assertTrue(payload["healthy"])


if __name__ == "__main__":
    unittest.main()
