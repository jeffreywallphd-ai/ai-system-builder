"""Trusted command identities and complete per-path impact selection."""
from __future__ import annotations

import fnmatch
import hashlib
import re
import sys
from pathlib import Path

from .common import digest, fields, read_json, relative, refuse
from .storage import confined_path

QUALIFICATION_PROFILES = (
    "security-authority", "security-runtime", "security-records", "security-tooling",
    "functionality-browse", "functionality-tasks", "functionality-context", "functionality-outcomes",
    "review-site", "host-memory-fixture", "ingestion-publication", "ocr-provider-contract",
)


QUALIFICATION_PROFILE_PATTERNS = {
    "review-site": ["dev-tools/review-site/index.html", "dev-tools/review-site/app.js", "dev-tools/review-site/style.css", "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs"],
    "ocr-provider-contract": ["modules/adapters/runtime/python/worker/ocr/*", "modules/adapters/runtime/python/worker/tests/test_ocr_protocol.py"],
}


def definitions(root: Path) -> list[dict]:
    node = "node"
    py = sys.executable
    return [
        {"id": "completion-standardande2e", "patterns": [], "argv": [node, "dev-tools/scripts/testing/run-test-suite.mjs", "--suite=standardande2e"], "timeout": 1800},
        {"id": "completion-all", "patterns": [], "argv": [node, "dev-tools/scripts/testing/run-test-suite.mjs", "--suite=all"], "timeout": 1800},
        *[{"id": name, "patterns": list(QUALIFICATION_PROFILE_PATTERNS.get(name, [])), "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--profile", name], "timeout": 300} for name in QUALIFICATION_PROFILES],
        {"id": "documentation", "patterns": ["docs/*", "*.md", "skills/*/*.md", "dev-tools/*/*.md"], "argv": [node, "dev-tools/scripts/docs/check-doc-drift.mjs"], "timeout": 120},
        {"id": "agent-support", "patterns": ["AGENTS.md", "skills/*", "docs/context/*", "dev-tools/agent-evals/*", "dev-tools/helpers/*", "dev-tools/review-site/*"], "argv": [node, "dev-tools/scripts/agent-support/check-agent-support.mjs"], "timeout": 120},
        {"id": "control-plane", "patterns": ["dev-tools/helpers/control_plane/*", "dev-tools/helpers/development_control_plane.py", "dev-tools/helpers/run_focused_checks.py", "dev-tools/helpers/requirements-tests.txt", "dev-tools/config/pytest-focused.ini", "dev-tools/helpers/tests/*", "dev-tools/review-site/*"], "argv": [py, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py"], "timeout": 180},
        {"id": "roadmap", "patterns": ["skills/manage-implementation-roadmaps/*"], "argv": [py, "-B", "skills/manage-implementation-roadmaps/tests/test_roadmap.py"], "timeout": 120},
        {"id": "architecture", "patterns": ["modules/*", "apps/*", "dev-tools/scripts/architecture/*"], "argv": [node, "dev-tools/scripts/architecture/check-module-dependencies.mjs"], "timeout": 120},
        {"id": "focused-tests", "patterns": ["modules/*", "apps/*", "dev-tools/scripts/*", "dev-tools/config/*"], "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py"], "timeout": 300},
        {"id": "dependencies", "patterns": ["package.json", "package-lock.json", "apps/*/package.json", ".github/workflows/*", "deployments/*", "dev-tools/vendor/*", "dev-tools/helpers/requirements-tests.txt", "*webpack*", "*tsconfig*"], "argv": [node, "dev-tools/scripts/security/check-dependency-security.mjs"], "timeout": 300},
        {"id": "evaluation", "patterns": ["dev-tools/agent-evals/*"], "argv": [py, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane_evaluations.py"], "timeout": 120},
        {"id": "repository-policy", "patterns": [".gitignore", ".gitattributes", "dev-tools/helpers/*.json"], "argv": [node, "dev-tools/scripts/agent-support/check-agent-support.mjs"], "timeout": 120},
    ]


def policy_digest(root: Path, checks: list[dict]) -> str:
    sources = {}
    # The executor, catalog and adapters are part of the verification policy.
    for directory in (root / "dev-tools/helpers/control_plane", root / "dev-tools/helpers/tests"):
        if directory.is_dir():
            for p in sorted(directory.glob("*.py")):
                sources[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    for p in (root / "dev-tools/helpers/development_control_plane.py", root / "dev-tools/helpers/run_focused_checks.py", root / "dev-tools/helpers/run_vitest_checks.mjs", root / "dev-tools/config/contributor-check-profiles.json"):
        if p.is_file():
            sources[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return digest({"schema_version": "check-catalog-v1", "checks": checks, "sources": sources})


def plan(root: Path, paths: list[str], required: list[str], candidate: str) -> dict:
    checks = definitions(root)
    ids = {c["id"] for c in checks}
    if not required or set(required) - ids:
        refuse("verification.check-id", "Acceptance references an unavailable check identity.")
    covered = {p: [c["id"] for c in checks if any(fnmatch.fnmatchcase(p, pat) for pat in c["patterns"])] for p in paths}
    # The fixed controller config is exercised by controller routing/isolation
    # tests. Generic config ownership has no runnable test files for this INI.
    if "dev-tools/config/pytest-focused.ini" in covered:
        covered["dev-tools/config/pytest-focused.ini"] = [name for name in covered["dev-tools/config/pytest-focused.ini"] if name != "focused-tests"]
    if any(not matches for matches in covered.values()):
        refuse("verification.unclassified-impact", "Every changed path must have a tracked verification rule.", "Add a bounded catalog rule and a regression test for the uncovered impact.")
    selected = [c for c in checks if c["id"] in required or any(c["id"] in matches for matches in covered.values())]
    for profile_id in QUALIFICATION_PROFILES:
        if profile_id not in {c["id"] for c in selected}:
            continue
        data = read_json(confined_path(root, "dev-tools/config/contributor-check-profiles.json"))
        profile = data.get("profiles", {}).get(profile_id)
        fields(profile, {"test_paths", "source_paths"}, {"test_paths", "source_paths"})
        source_paths = profile["source_paths"]
        if not isinstance(source_paths, list) or not 1 <= len(source_paths) <= 200 or not all(isinstance(p, str) for p in source_paths):
            refuse("verification.profile-coverage", "Use bounded explicit source coverage for a registered profile.")
        declared = {relative(p) for p in source_paths + profile["test_paths"]}
        focused = [p for p, matches in covered.items() if "focused-tests" in matches]
        if "focused-tests" not in required and all(p in declared for p in focused):
            selected = [c for c in selected if c["id"] != "focused-tests"]
    value = {"schema_version": "check-plan-v1", "candidate": candidate, "catalog_digest": policy_digest(root, checks), "changed_paths": paths, "coverage": covered, "selected": selected, "deferred": [c["id"] for c in checks if c not in selected]}
    value["plan_digest"] = digest(value)
    return value
