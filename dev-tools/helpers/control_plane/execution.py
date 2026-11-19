"""Allowlisted execution with streaming output digests and bounded process lifetime."""
from __future__ import annotations

import hashlib
import os
import re
import signal
import stat
import subprocess
import threading
import time
from pathlib import Path

from .common import digest, refuse, relative
from .storage import confined_path
from .contracts import ControlError

MAX_OUTPUT = 2 * 1024 * 1024
MAX_FAILURE_TAIL = 64 * 1024


def failure_diagnostics(root: Path, check: dict, tails: dict[str, bytes]) -> dict:
    """Advisory fixed metadata only; output is never authority or persisted text."""
    allowed = set()
    for argument in check["argv"][:256]:
        if (not isinstance(argument, str) or len(argument) > 400 or
                not argument.startswith(("modules/", "apps/", "dev-tools/", "skills/")) or
                any(ord(char) < 32 or ord(char) == 127 for char in argument) or
                not re.search(r"(?:\.test\.|\.spec\.|(?:^|/)test_)", argument) or
                not re.search(r"\.(?:[cm]?[jt]sx?|py)$", argument)):
            continue
        try:
            name = relative(argument)
            parts = name.split("/")
            if len(parts) > 32:
                continue
            cursor = root
            for index, part in enumerate(parts):
                cursor = cursor / part
                info = cursor.lstat()
                if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                    break
                if not (stat.S_ISREG(info.st_mode) if index == len(parts) - 1 else stat.S_ISDIR(info.st_mode)):
                    break
            else:
                # confined_path alone intentionally permits inside-root aliases.
                # The bounded lexical walk above denies those for diagnostics.
                confined_path(root, name)
                allowed.add(name)
        except (ControlError, OSError, ValueError):
            continue
        if len(allowed) == 64:
            break
    locations = []
    kinds = set()
    errors = set()
    failed = None
    root_prefix = str(root.resolve()).replace("\\", "/").rstrip("/") + "/"
    for raw in list(tails.values()):
        value = raw[-MAX_FAILURE_TAIL:].decode("utf-8", errors="replace")
        kinds.update(re.findall(r"\b(AssertionError|TypeError|SyntaxError|ReferenceError|RangeError|TimeoutError)\b", value))
        errors.update(re.findall(r"\b(ERR_ASSERTION|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_TEST_FAILURE|ERR_TEST_TIMEOUT)\b", value))
        for count in re.findall(r"(?:ℹ|#) fail ([0-9]{1,6})(?:\s|$)", value):
            failed = max(failed or 0, min(int(count), 100000))
        for match in re.finditer(r"(?:^|\n)(?:test at |\s*location: ['\"])([^\r\n]+?):([0-9]{1,8}):([0-9]{1,8})(?:['\"]?\r?(?:\n|$))", value):
            filename = match[1].replace("\\", "/")
            if filename.lower().startswith(root_prefix.lower()):
                filename = filename[len(root_prefix):]
            if filename not in allowed:
                continue
            line, column = int(match[2]), int(match[3])
            row = {"path": filename, "line": line, "column": column}
            if 0 < line <= 10000000 and 0 < column <= 10000000 and row not in locations and len(locations) < 8:
                locations.append(row)
    result = {}
    if locations:
        result["test_locations"] = locations
    if kinds:
        result["error_kinds"] = sorted(kinds)
    if errors:
        result["error_codes"] = sorted(errors)
    if failed is not None:
        result["failed_tests"] = failed
    return {"schema_version": "check-failure-diagnostics-v1", **result} if result else {}


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
    tails = {}
    exceeded = threading.Event()
    def drain(stream, name):
        h, count = hashlib.sha256(), 0
        tail = b""
        try:
            while chunk := stream.read(8192):
                count += len(chunk)
                if count <= MAX_OUTPUT:
                    h.update(chunk)
                    tail = (tail + chunk)[-MAX_FAILURE_TAIL:]
                else:
                    exceeded.set()
        finally:
            stream.close()
            outputs[name] = {"sha256": h.hexdigest(), "bytes": min(count, MAX_OUTPUT + 1), "truncated": count > MAX_OUTPUT}
            tails[name] = tail
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
    result = {"check_id": check["id"], "status": reason or ("passed" if p.returncode == 0 else "failed"), "exit_code": p.returncode, "duration_ms": round((time.monotonic() - start) * 1000, 3), "output": outputs, "command_digest": digest(argv)}
    if result["status"] != "passed":
        diagnostics = failure_diagnostics(root, check, tails)
        if diagnostics:
            result["failure_diagnostics"] = diagnostics
    return result
