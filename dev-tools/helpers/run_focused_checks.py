#!/usr/bin/env python3
"""Derive bounded source-owned tests; never accepts commands or shell text."""
from __future__ import annotations

import argparse
import ast
import importlib.metadata
import os
import re
import subprocess
import sys
from pathlib import Path

from control_plane.candidate import snapshot
from control_plane.common import fields, identifier, inside, read_json, relative, refuse
from control_plane.contracts import ControlError
from control_plane.storage import confined_path

PYTEST_VERSION = "9.1.1"
CONTROLLED_PYTHON_TESTS = frozenset({
    "test_constrained_json_outlines_integration.py",
    "test_context_generation_ai_e2e.py",
    "test_model_training_task_matrix_e2e.py",
})


def pytest_environment(environ):
    # Do not load plugins or extra command options from the calling session.
    env = {key: value for key, value in environ.items() if not key.upper().startswith("PYTEST_")}
    env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    env.pop("PYTHONOPTIMIZE", None)
    return env


def pytest_tooling_ready(root):
    try:
        source = (root / "dev-tools/helpers/requirements-tests.txt").read_bytes()
        if len(source) > 16 * 1024:
            return False
        lines = [line.strip() for line in source.decode("utf-8").splitlines() if line.strip() and not line.startswith("#")]
        if lines[:2] != ["--only-binary=:all:", "--require-hashes"] or not 1 <= len(lines[2:]) <= 16:
            return False
        seen = set()
        for line in lines[2:]:
            match = re.fullmatch(r'([a-zA-Z0-9_-]+)==([0-9]+(?:\.[0-9]+)*)(; [^\r\n]+?)? --hash=sha256:([a-f0-9]{64})', line)
            if match is None:
                return False
            name, version, marker, _hash = match.groups()
            if name in seen:
                return False
            seen.add(name)
            if marker not in (None, '; sys_platform == "win32"', '; python_version < "3.11"'):
                return False
            if name == "pytest" and (version != PYTEST_VERSION or marker is not None):
                return False
            if marker == '; sys_platform == "win32"' and sys.platform != "win32":
                continue
            if marker == '; python_version < "3.11"' and sys.version_info[:2] >= (3, 11):
                continue
            if importlib.metadata.version(name) != version:
                return False
        return "pytest" in seen
    except (OSError, UnicodeError, importlib.metadata.PackageNotFoundError):
        return False


def python_test_command(root, test):
    tree = ast.parse((root / test).read_text(encoding="utf-8-sig"))
    # Fixture functions need pytest even when the module does not import it.
    if any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_") for node in tree.body):
        return [sys.executable, "-B", "-m", "pytest", "-c", "dev-tools/config/pytest-focused.ini",
                "--noconftest", "-p", "no:cacheprovider", "-q", "--", test]
    return [sys.executable, "-B", "-m", "unittest", "discover", "-s", Path(test).parent.as_posix(), "-p", Path(test).name]


def commands(root, affected, *, exact=False):
    files = snapshot(root)["files"]
    owners = set()
    for path in affected:
        parts = relative(path).split("/")
        if path.startswith("modules/") and len(parts) >= 3:
            owners.add("/".join(parts[:3]))
        elif path.startswith("apps/") and len(parts) >= 2:
            owners.add("/".join(parts[:2]))
        elif path.startswith("dev-tools/") and len(parts) >= 3:
            owners.add("/".join(parts[:3]))
    # Controlled modules require their explicit AI or model-training entry point.
    tests = sorted(p for p in files if (p in affected if exact else inside(p, list(owners))) and Path(p).name not in CONTROLLED_PYTHON_TESTS and (".test." in p or Path(p).name.startswith("test_") and p.endswith(".py")))
    if not tests or len(tests) > 300:
        refuse("verification.focused-tests-unavailable", "No bounded owned test set is available.", "Add focused coverage and a tracked catalog mapping for this boundary.")
    node, vitest, python = [], [], []
    for p in tests:
        if not p.endswith(".py") and re.search(r"(?m)^\s*//\s*@test-suite\s+ai\s*$", (root / p).read_text(encoding="utf-8")):
            continue
        if p.endswith(".py"):
            python.append(p)
        elif re.search(r"(?m)^[ \t]*import[ \t]+[^;\"'`]*?\bfrom\s+[\"']vitest[\"']", (root / p).read_text(encoding="utf-8")):
            vitest.append(p)
        else:
            node.append(p)
    result = []
    if not (node or vitest or python):
        refuse("verification.focused-tests-unavailable", "No non-AI focused tests are available.")
    # Chunk arguments to stay below Windows process command-line limits.
    for at in range(0, len(node), 12):
        chunk = node[at:at + 12]
        loader = ["--import", "tsx"] if any(p.endswith((".ts", ".tsx")) for p in chunk) else []
        result.append(["node", *loader, "--test", "--", *chunk])
    if vitest:
        result.append(["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", *vitest])
    for test in python:
        result.append(python_test_command(root, test))
    return result


def profile_commands(root, profile_id):
    identifier(profile_id)
    data = read_json(confined_path(root, "dev-tools/config/contributor-check-profiles.json"))
    fields(data, {"schema_version", "profiles"}, {"schema_version", "profiles"})
    if data["schema_version"] != "contributor-check-profiles-v1" or not isinstance(data["profiles"], dict):
        refuse("verification.profile-schema", "Use the versioned source-owned profile schema.")
    profile = data["profiles"].get(profile_id)
    fields(profile, {"test_paths", "source_paths"}, {"test_paths", "source_paths"})
    paths = profile["test_paths"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= 100 or not all(isinstance(p, str) for p in paths) or len(set(paths)) != len(paths):
        refuse("verification.profile-unavailable", "Choose a bounded registered qualification profile.")
    source = snapshot(root)["files"]
    for path in paths:
        relative(path)
        confined_path(root, path)
        if not path.startswith(("modules/", "apps/", "dev-tools/")) or path not in source or (
            ".test." not in path and not (Path(path).name.startswith("test_") and path.endswith(".py"))
        ) or Path(path).name in CONTROLLED_PYTHON_TESTS or ".ai." in path or "/tests/ai/" in path:
            refuse("verification.profile-path", "Profiles contain only available source-owned non-AI tests.")
        if re.search(r"(?m)^\s*//\s*@test-suite\s+ai\s*$", (root / path).read_text(encoding="utf-8")):
            refuse("verification.profile-ai", "Controlled AI qualification is reserved for the explicit AI suite.")
    return commands(root, paths, exact=True)


def main():
    if sys.flags.optimize:
        print("Focused verification requires Python assertions. Run without -O or PYTHONOPTIMIZE.", file=sys.stderr)
        return 1
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--affected", action="append", default=[])
    parser.add_argument("--regression-test")
    parser.add_argument("--profile")
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve().parents[2]
        if sum(bool(v) for v in (args.regression_test, args.affected, args.profile)) > 1:
            refuse("verification.arguments", "Choose affected ownership or one exact regression.")
        selected = profile_commands(root, args.profile) if args.profile else commands(root, [relative(args.regression_test)] if args.regression_test else args.affected, exact=bool(args.regression_test))
        for argv in selected:
            env = dict(os.environ)
            env.pop("PYTHONOPTIMIZE", None)
            if "pytest" in argv:
                if not pytest_tooling_ready(root):
                    print("Focused pytest tests require the exact developer tooling in dev-tools/helpers/requirements-tests.txt. Install it explicitly in the selected verification environment; the helper does not install packages.", file=sys.stderr)
                    return 1
                env = pytest_environment(os.environ)
            r = subprocess.run(argv, cwd=root, check=False, timeout=270, env=env)
            if r.returncode:
                return r.returncode
        return 0
    except (ControlError, OSError, SyntaxError, subprocess.TimeoutExpired):
        print("Focused verification unavailable or failed; inspect the owning tests.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
