"""Fixed local review-server lifecycle. No arbitrary process launch interface."""
from __future__ import annotations

import json
import hashlib
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from .common import digest, read_json, refuse
from .storage import atomic_write, canonical_bytes, confined_path, exclusive_lock


def server_version():
    root = Path(__file__).resolve().parents[3]
    files = list((root / "dev-tools/review-site").glob("*")) + list(Path(__file__).parent.glob("*.py"))
    return digest({p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()})


def probe(port, root, *, require_current=True):
    if type(port) is not int or not 1024 <= port <= 65535:
        return None
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/api/status", timeout=1) as response:
            value = json.loads(response.read(4097))
        current = value.get("server_version") == server_version()
        if value.get("schema_version") == "development-review-server-v1" and value.get("repository_id") == digest(str(root.resolve())) and (current or not require_current) and isinstance(value.get("instance_id"), str) and type(value.get("pid")) is int:
            return {"url": f"http://127.0.0.1:{port}", "port": port, "repository_id": value["repository_id"], "instance_id": value.get("instance_id"), "pid": value.get("pid"), "status": "running" if current else "stale"}
    except (OSError, ValueError):
        pass
    return None


def ensure(root: Path, port=8766):
    if type(port) is not int or not 1024 <= port <= 65528:
        refuse("review.port", "Choose a local port between 1024 and 65528.")
    record = confined_path(root, ".local-codex/control-plane/review-server.json")
    lock = confined_path(root, ".local-codex/control-plane/review-server.lock")
    with exclusive_lock(lock):
        if record.exists():
            old = read_json(record, maximum=4096)
            if found := probe(old.get("port"), root):
                atomic_write(record, canonical_bytes(found))
                return found
            if stale := probe(old.get("port"), root, require_current=False):
                terminate_recorded(old, stale)
                for _ in range(20):
                    if not probe(old.get("port"), root, require_current=False):
                        break
                    time.sleep(0.1)
        for candidate in range(port, min(port + 8, 65536)):
            if found := probe(candidate, root):
                atomic_write(record, canonical_bytes(found))
                return found
            argv = [sys.executable, "-B", str(root / "dev-tools/review-site/server.py"), "--repo", str(root), "--port", str(candidate)]
            flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
            p = subprocess.Popen(argv, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags, start_new_session=os.name != "nt")
            for _ in range(20):
                if found := probe(candidate, root):
                    if found["pid"] != p.pid:
                        if p.poll() is None:
                            p.terminate()
                            p.wait(timeout=5)
                    atomic_write(record, canonical_bytes(found))
                    return found
                if p.poll() is not None:
                    break
                time.sleep(0.1)
            if p.poll() is None:
                p.terminate()
                p.wait(timeout=5)
        refuse("review.server-unavailable", "The local review server could not become reachable.", "Use the host's permitted loopback execution environment and retry review-site start.")


def status(root):
    path = confined_path(root, ".local-codex/control-plane/review-server.json")
    if not path.exists():
        return {"status": "not-started"}
    old = read_json(path, maximum=4096)
    return probe(old.get("port"), root, require_current=False) or {"status": "unavailable"}


def terminate_recorded(record, current):
    if not record.get("instance_id") or current["instance_id"] != record["instance_id"] or type(record.get("pid")) is not int or current["pid"] != record["pid"] or record["pid"] <= 0 or record["pid"] == os.getpid():
        refuse("review.instance-mismatch", "The saved server identity does not authorize stopping this process.")
    os.kill(record["pid"], signal.SIGTERM)


def stop(root):
    path = confined_path(root, ".local-codex/control-plane/review-server.json")
    with exclusive_lock(path.with_suffix(".lock")):
        if not path.exists():
            return {"status": "not-started"}
        record = read_json(path, maximum=4096)
        current = probe(record.get("port"), root, require_current=False)
        if not current:
            return {"status": "unavailable"}
        terminate_recorded(record, current)
        return {"status": "stop-requested"}
