"""Read-only admission for an already approved local 0.5B training input.

No interpreter/model selector, download, installation, inference or accuracy run.
The owning trusted Node composition separately checks production dependencies.
"""
from __future__ import annotations
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[4]
PYTHON_RELATIVE = "artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe"
SOURCE_RELATIVE = "dev-tools/scripts/qualification/run_installed_generation_qualification.py"
MAXIMUM_WEIGHTS = 1024 ** 3


def deny():
    raise ValueError("The fixed training prerequisites are unavailable.")


def regular(root, relative, maximum):
    if not isinstance(relative, str) or len(relative) > 512 or "\\" in relative or any(p in ("", ".", "..") for p in relative.split("/")):
        deny()
    target = root.joinpath(*relative.split("/"))
    if not target.is_relative_to(root) or target.resolve() != target:
        deny()
    for current in [root, *[root.joinpath(*target.relative_to(root).parts[:i]) for i in range(1, len(target.relative_to(root).parts) + 1)]]:
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            deny()
    info = target.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= maximum:
        deny()
    return target, info


def digest_regular(root, relative, maximum):
    target, before = regular(root, relative, maximum)
    digest = hashlib.sha256()
    total = 0
    with target.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size) != (before.st_dev, before.st_ino, before.st_size):
            deny()
        while chunk := stream.read(64 * 1024):
            total += len(chunk)
            if total > maximum:
                deny()
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    _, current = regular(root, relative, maximum)
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    if total != before.st_size or identity(before) != identity(after) or identity(before) != identity(current):
        deny()
    return digest.hexdigest(), total


def fixed_model(root):
    """Read only three literal constants; never import the accuracy runner."""
    source, _ = regular(root, SOURCE_RELATIVE, 256 * 1024)
    tree = ast.parse(source.read_text(encoding="utf-8"))
    result = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ("MODEL", "REVISION", "MODEL_FILES"):
            name = node.targets[0].id
            if name in result:
                deny()
            result[name] = ast.literal_eval(node.value)
    if (result.get("MODEL"), result.get("REVISION")) != ("Qwen/Qwen2.5-0.5B-Instruct", "7ae557604adf67be50417f59c2c2f167def9a775"):
        deny()
    files = result.get("MODEL_FILES")
    if not isinstance(files, dict) or len(files) != 8 or "model.safetensors" not in files or any(not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", k) or not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v) for k, v in files.items()):
        deny()
    return result


def verify_model(root, acquisition):
    if not isinstance(acquisition, str) or not re.fullmatch(r"\.local-codex/model-qualification/qwen-[a-f0-9-]{36}/acquisition\.json", acquisition):
        deny()
    fixed = fixed_model(root)
    manifest, _ = regular(root, acquisition, 64 * 1024)
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or (data.get("model"), data.get("revision"), data.get("status")) != (fixed["MODEL"], fixed["REVISION"], "verified"):
        deny()
    entries = data.get("files")
    if not isinstance(entries, list) or len(entries) != 8 or any(not isinstance(row, dict) or not isinstance(row.get("name"), str) or not isinstance(row.get("sha256"), str) for row in entries):
        deny()
    if {row.get("name"): row.get("sha256") for row in entries} != fixed["MODEL_FILES"]:
        deny()
    names = []
    with os.scandir(manifest.parent) as entries:
        for entry in entries:
            if len(names) == 9:
                deny()
            names.append(entry.name)
    if set(names) != set(fixed["MODEL_FILES"]) | {"acquisition.json"}:
        deny()
    total = 0
    for name, expected in fixed["MODEL_FILES"].items():
        relative = (manifest.parent / name).relative_to(root).as_posix()
        digest, size = digest_regular(root, relative, MAXIMUM_WEIGHTS if name == "model.safetensors" else 16 * 1024 ** 2)
        if digest != expected:
            deny()
        total += size
    if total > MAXIMUM_WEIGHTS + 64 * 1024 ** 2:
        deny()
    return {"modelId": fixed["MODEL"], "revision": fixed["REVISION"], "modelRelativeDirectory": manifest.parent.relative_to(root).as_posix(), "modelFiles": 8, "modelBytes": total}


def inspect(root, acquisition):
    fixed_python, _ = regular(root, PYTHON_RELATIVE, 128 * 1024 ** 2)
    if Path(sys.executable).resolve() != fixed_python or sys.version_info[:2] != (3, 12):
        deny()
    python_hash, _ = digest_regular(root, PYTHON_RELATIVE, 128 * 1024 ** 2)
    return {"schemaVersion": "training-local-inputs-v1", "status": "verified-inputs-only", "pythonSha256": python_hash,
            "pythonRelative": PYTHON_RELATIVE, **verify_model(root, acquisition), "accuracyExecuted": False, "launchAuthorized": False}


def main():
    if sys.argv[1:] != ["--inspect"] or os.name != "nt":
        deny()
    # An exact known acquisition is supplied by the owning qualification plan.
    result = inspect(ROOT, os.getenv("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION"))
    body = json.dumps(result, separators=(",", ":"))
    if len(body.encode("utf-8")) > 4096:
        deny()
    print(body)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"schemaVersion": "training-local-inputs-v1", "status": "unavailable", "reason": "fixed-input-prerequisites", "accuracyExecuted": False, "launchAuthorized": False}))
        raise SystemExit(1) from None
