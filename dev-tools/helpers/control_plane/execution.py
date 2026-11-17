"""Allowlisted execution with streaming output digests and bounded process lifetime."""
from __future__ import annotations

import hashlib
import os
import signal
import subprocess
import threading
import time
from pathlib import Path

from .common import digest, refuse

MAX_OUTPUT = 2 * 1024 * 1024


def execute(root: Path, check: dict, *, paths: list[str] | None = None) -> dict:
    argv = list(check["argv"])
    if check["id"] == "focused-tests":
        # Arguments come only from catalog-classified repository paths, not arbitrary commands.
        for p in paths or []:
            argv.extend(["--affected", p])
    env = dict(os.environ)
    # Node's internal test-worker marker is not a permission setting. Inheriting
    # it makes a nested `node --test` skip its runner and can report false success.
    env.pop("NODE_TEST_CONTEXT", None)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    temp = root / ".local-codex/t"
    temp.mkdir(parents=True, exist_ok=True)
    env["TEMP"] = env["TMP"] = str(temp)
    start = time.monotonic()
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        p = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags, start_new_session=os.name != "nt")
    except OSError:
        return {"check_id": check["id"], "status": "unavailable", "exit_code": None, "duration_ms": round((time.monotonic() - start) * 1000, 3), "output": {}}
    outputs = {}
    exceeded = threading.Event()
    def drain(stream, name):
        h, count = hashlib.sha256(), 0
        try:
            while chunk := stream.read(8192):
                count += len(chunk)
                if count <= MAX_OUTPUT:
                    h.update(chunk)
                else:
                    exceeded.set()
        finally:
            stream.close()
            outputs[name] = {"sha256": h.hexdigest(), "bytes": min(count, MAX_OUTPUT + 1), "truncated": count > MAX_OUTPUT}
    threads = [threading.Thread(target=drain, args=(p.stdout, "stdout"), daemon=True), threading.Thread(target=drain, args=(p.stderr, "stderr"), daemon=True)]
    for thread in threads:
        thread.start()
    reason = None
    while p.poll() is None:
        if exceeded.is_set() or time.monotonic() - start > check["timeout"]:
            reason = "output-limit" if exceeded.is_set() else "timed-out"
            break
        time.sleep(0.02)
    if reason:
        if os.name == "nt":
            # Fixed OS operation: terminate only this child and its descendants.
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True, timeout=10)
        else:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if p.poll() is None:
            p.kill()
    p.wait(timeout=10)
    for thread in threads:
        thread.join(timeout=2)
    if any(t.is_alive() for t in threads):
        reason = reason or "incomplete-output"
    if exceeded.is_set():
        reason = "output-limit"
    return {"check_id": check["id"], "status": reason or ("passed" if p.returncode == 0 else "failed"), "exit_code": p.returncode, "duration_ms": round((time.monotonic() - start) * 1000, 3), "output": outputs, "command_digest": digest(argv)}
