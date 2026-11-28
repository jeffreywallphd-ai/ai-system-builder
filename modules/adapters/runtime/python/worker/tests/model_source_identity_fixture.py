"""Controlled owned test child: real ASGI/Task/Handoff, synthetic provider bytes.

The stdlib HTTP shim is a test transport only, not product host qualification.
No production CLI, model, provider network, install or secret output is added.
"""
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from threading import Event, Lock, Thread
from unittest.mock import patch


def host_configuration(environment):
    """Test-only explicit launch; no production entry point reads this selector."""
    mode = environment.get("AISB_MODEL_SOURCE_FIXTURE_HOST")
    if mode is None:
        return None
    if mode != "owned-runtime-v1":
        raise ValueError("Invalid controlled host mode.")
    host = environment.get("PYTHON_RUNTIME_HOST")
    port = environment.get("PYTHON_RUNTIME_PORT", "")
    if (host != "127.0.0.1" or type(port) is not str or
            re.fullmatch(r"[1-9][0-9]{3,4}", port) is None or not 1024 <= int(port) <= 65535 or
            len(environment.get("PYTHON_RUNTIME_AUTH_TOKEN", "")) < 32 or
            re.fullmatch(r"[a-f0-9]{64}", environment.get("PYTHON_RUNTIME_STARTUP_PROOF", "")) is None):
        raise ValueError("Invalid controlled host launch.")
    return host, int(port)


class ControlledSubmissions:
    """Keep the second real task queued briefly for original Future cancellation.

    Only the disposable child installs this observer. No task record or result is
    manufactured. The original executor receives every original callback once.
    """
    def __init__(self, executor, observe):
        self.original = executor.submit
        self.observe = observe
        self.count = 0
        self.lock = Lock()

    def __call__(self, callback, *args, **kwargs):
        with self.lock:
            self.count += 1
            if self.count == 2:
                self.original(Event().wait, 5)
            result = self.original(callback, *args, **kwargs)
            self.observe(self.count)
            return result


def main():
    selected_host = host_configuration(os.environ)
    from fastapi.testclient import TestClient
    from modules.adapters.runtime.python.worker import app as worker
    from modules.adapters.runtime.python.worker.tasks import model_source_task as task
    from modules.adapters.runtime.python.worker.tasks import model_source_identity as identity
    from modules.adapters.runtime.python.worker.tests.test_model_source_staging import ModelSourceStagingTests
    root = Path(os.environ["AISB_MODEL_SOURCE_FIXTURE_CACHE"])
    if (not root.is_absolute() or root.name != "cache" or not root.parent.name.startswith("source-recipient-worker-") or
            not root.is_dir() or root.is_symlink() or len(worker.RUNTIME_AUTH_TOKEN) < 32):
        raise ValueError("Invalid owned fixture configuration.")
    fixture = ModelSourceStagingTests("test_actual_selected_bytes_are_verified_under_private_root_then_only_owned_tree_is_removed")
    with patch.object(tempfile, "tempdir", str(task._private_io_path(Path(tempfile.gettempdir())))):
        fixture.setUp()
    stack = ExitStack()
    try:
        stack.enter_context(patch.object(task, "_resolve_huggingface_cache_root", return_value=root))
        stack.enter_context(patch.object(identity, "_resolve_huggingface_cache_root", return_value=root))
        if selected_host is not None:
            # Reuse original Uvicorn socket binding and current-child pipe proof.
            # Provider transport alone is synthetic; ASGI/task/identity/handoff,
            # recipient acknowledgement and result/cache validation stay real.
            from modules.adapters.runtime.python.worker import main as entry
            observation = root.parent / "worker-observations.json"
            def observe(count):
                value = json.dumps({"submissions": count}) + "\n"
                if len(value.encode("utf8")) > 128:
                    raise ValueError("Controlled observation exceeds its bound.")
                observation.write_text(value, encoding="utf8")
            with patch.object(worker.TASK_EXECUTOR, "submit", ControlledSubmissions(worker.TASK_EXECUTOR, observe)):
                entry._run_runtime(*selected_host)
            worker.TASK_EXECUTOR.shutdown(wait=True, cancel_futures=True)
            return
        client = stack.enter_context(TestClient(worker.app))
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *_args):
                pass
            def serve(self):
                self.close_connection = True
                try:
                    length = int(self.headers.get("content-length", "0"))
                    if length < 0 or length > 32 * 1024:
                        self.send_error(413); return
                    body = self.rfile.read(length) if length else b""
                    result = client.request(self.command, self.path, content=body,
                        headers={"authorization": self.headers.get("authorization", ""), "content-type": "application/json"})
                    if len(result.content) > 64 * 1024:
                        self.send_error(500); return
                    self.send_response(result.status_code)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(result.content)))
                    self.send_header("connection", "close")
                    self.end_headers(); self.wfile.write(result.content)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            do_GET = serve
            do_POST = serve
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        serving = Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True); serving.start()
        print(json.dumps({"event": "model-source-identity-fixture-ready", "port": server.server_port,
            "manifest": fixture.manifest.model_dump(mode="json")}), flush=True)
        try:
            for line in sys.stdin:
                if line.strip() == "stop":
                    break
        finally:
            server.shutdown(); server.server_close(); serving.join(3)
            if serving.is_alive():
                raise RuntimeError("Owned fixture server exit unconfirmed.")
            worker.TASK_EXECUTOR.shutdown(wait=True, cancel_futures=True)
            for record in worker.TASK_REGISTRY.values():
                owner = record.get("_modelSourceOwner")
                if isinstance(owner, task.ModelSourceTaskOwner):
                    owner._finish_context()
    finally:
        stack.close(); fixture.doCleanups()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"event": "model-source-identity-fixture-failed", "errorType": type(error).__name__}), flush=True)
        raise SystemExit(1)
