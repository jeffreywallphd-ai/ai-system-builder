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
    "review-site", "asset-authoring-ui", "system-management-ui", "system-build-publication-ui", "system-runtime-conversation-ui", "system-canvas-authoring-ui", "desktop-startup-ui", "host-memory-fixture", "ingestion-publication", "ocr-provider-contract", "dataset-version-replay", "dataset-version-browser", "dataset-semantic-curation", "native-host-policy", "host-setup-policy",
)


QUALIFICATION_PROFILE_PATTERNS = {
    "host-setup-policy": [
        "dev-tools/scripts/qualification/visual-composer/visual-composer-qualification-environment.mjs",
        "dev-tools/scripts/qualification/visual-composer/visual-composer-global-setup.mjs",
        "dev-tools/scripts/qualification/tests/visual-composer-host-lifecycle.unit.test.mjs",
    ],
    "native-host-policy": [
        "dev-tools/helpers/native-qualification/owned_command_job.py",
        "dev-tools/helpers/native-qualification/tests/test_owned_command_job.py",
        "dev-tools/helpers/native-qualification/README.md",
    ],
    "dataset-semantic-curation": [
        "modules/adapters/runtime/python/worker/tasks/semantic_curation.py",
        "modules/adapters/runtime/python/worker/tests/test_semantic_curation.py",
        "modules/adapters/runtime/python/worker/README.md",
    ],
    "dataset-version-browser": ['modules/ui/shared/dataset-version/DatasetVersionPanel.tsx', 'modules/ui/shared/dataset-version/tests/DatasetVersionPanel.interaction.ui.test.tsx', 'apps/desktop/src/renderer/pages/ArtifactsPage.tsx', 'apps/thin-client/src/pages/ArtifactsPage.tsx', 'apps/desktop/src/renderer/features/artifact-browser/components/ArtifactBrowserFeature.tsx', 'apps/thin-client/src/features/artifact-browser/components/ArtifactBrowserFeature.tsx', 'apps/desktop/src/renderer/pages/tests/artifacts-page-saved-versions.ui.test.tsx', 'apps/thin-client/src/pages/tests/artifacts-page-saved-versions.ui.test.tsx', 'apps/desktop/src/renderer/features/dataset-preparation/hooks/useDatasetPreparationFeature.ts', 'apps/desktop/src/renderer/features/dataset-preparation/components/DatasetPreparationFeature.tsx', 'apps/thin-client/src/features/dataset-preparation/components/DatasetPreparationFeature.tsx', 'apps/desktop/src/renderer/features/dataset-preparation/api/desktopDatasetPreparationClient.ts', 'apps/desktop/src/renderer/features/dataset-preparation/tests/desktop-dataset-preparation-client.unit.test.ts', 'apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-sources.ui.test.tsx', 'apps/thin-client/src/features/dataset-preparation/tests/dataset-preparation-sources.ui.test.tsx', 'apps/thin-client/src/features/artifact-browser/api/apiArtifactBrowserClient.ts', 'apps/thin-client/src/features/artifact-browser/tests/api-artifact-browser-client.unit.test.ts', 'apps/desktop/src/renderer/features/dataset-preparation/tests/datasetVersionReplayFixture.ts', 'apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-version-replay.ui.test.tsx', 'apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-feature.unit.test.tsx', 'apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-ocr.ui.test.tsx', 'modules/ui/shared/dataset-version/useDatasetVersionReplayHandoff.ts', 'modules/ui/shared/dataset-version/tests/datasetVersionReplayHandoff.ui.test.tsx', 'apps/desktop/src/renderer/pages/tests/artifacts-page-reuse.ui.test.tsx', 'modules/ui/shared/dataset-version/datasetVersionReplay.ts', 'modules/ui/shared/dataset-version/tests/datasetVersionReplay.unit.test.ts', 'modules/ui/shared/dataset-version/readDatasetVersionReplaySources.ts', 'modules/ui/shared/dataset-version/tests/readDatasetVersionReplaySources.unit.test.ts', 'apps/thin-client/src/features/dataset-preparation/tests/dataset-version-replay.ui.test.tsx', 'apps/thin-client/src/pages/tests/artifacts-page-reuse.ui.test.tsx', 'apps/thin-client/src/features/dataset-preparation/tests/datasetVersionReplayFixture.ts', 'dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py', 'dev-tools/scripts/qualification/visual-composer/provided-dataset-host-launch-plan.mjs', 'dev-tools/scripts/qualification/visual-composer/provided-dataset-server-entry.ts', 'dev-tools/scripts/qualification/visual-composer/provided-dataset-server-lifecycle.ts', 'dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification.md', 'dev-tools/scripts/qualification/visual-composer/e2e/provided-dataset-version-journey.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/thin-client-dataset-versions.e2e.spec.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-dataset-versions.e2e.spec.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/desktop-task-cleanup.ts', 'dev-tools/scripts/qualification/tests/provided-dataset-host-launch-plan.unit.test.mjs', 'dev-tools/scripts/qualification/tests/test_provided_dataset_qualification_worker.py', 'dev-tools/scripts/qualification/tests/provided-dataset-server-lifecycle.unit.test.ts', 'dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts'],
    "dataset-version-replay": [
        "modules/ui/shared/dataset-version/datasetVersionReplay.ts",
        "modules/ui/shared/dataset-version/tests/datasetVersionReplay.unit.test.ts",
        "modules/ui/shared/dataset-version/index.ts",
    ],
    "system-management-ui": ['modules/ui/shared/system-builder/SystemManagementWorkspace.tsx', 'modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx'],
    "system-build-publication-ui": ['modules/ui/shared/system-builder/SystemBuildTestModal.tsx', 'modules/ui/shared/system-builder/SystemPublishWorkspace.tsx', 'modules/ui/shared/system-builder/tests/SystemBuildPublish.interaction.ui.test.tsx', 'modules/ui/shared/system-builder/SystemPublishedLifecycleCard.tsx', 'modules/ui/shared/system-builder/tests/SystemPublishedLifecycle.interaction.ui.test.tsx'],
    "system-canvas-authoring-ui": ['dev-tools/scripts/qualification/visual-composer/e2e/meaningful-system-journeys.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-meaningful-systems.e2e.spec.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/thin-client-meaningful-systems.e2e.spec.ts', 'dev-tools/scripts/qualification/visual-composer/meaningful-system-oracles.ts', 'dev-tools/scripts/qualification/tests/meaningful-system-oracles.unit.test.ts'],
    "review-site": ["dev-tools/review-site/index.html", "dev-tools/review-site/app.js", "dev-tools/review-site/style.css", "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs"],
    "ocr-provider-contract": ["modules/adapters/runtime/python/worker/ocr/*", "modules/adapters/runtime/python/worker/tests/test_ocr_protocol.py", "modules/adapters/runtime/python/worker/tests/test_ocr_wire.py", "modules/adapters/runtime/python/worker/tests/test_ocr_resource.py", "modules/adapters/runtime/python/worker/tests/test_ocr_process.py", "modules/adapters/runtime/python/worker/tests/test_ocr_provider.py", "modules/adapters/runtime/python/worker/tests/qualification_ocr_windows.py", "modules/adapters/runtime/python/worker/tests/qualification_ocr_documents.py",
"modules/adapters/runtime/python/worker/tests/qualification_ocr_source_snapshot.py",
"modules/adapters/runtime/python/worker/tests/test_ocr_source_snapshot.py", "dev-tools/scripts/native/build_windows_ocr.py", "dev-tools/scripts/native/build_windows_ocr.cjs", "dev-tools/scripts/native/tests/test_build_windows_ocr.py", "dev-tools/scripts/native/tests/windows-ocr-build.unit.test.mjs", "apps/desktop/forge.config.js", "modules/adapters/runtime/python/worker/tasks/document_normalization.py", "modules/adapters/runtime/python/worker/tests/test_ocr_recognition.py", "modules/adapters/runtime/python/worker/tests/test_document_normalization_ocr.py", "modules/adapters/runtime/python/worker/tests/test_document_normalization.py",
        "modules/contracts/runtime/dataset-preparation-ocr.ts",
        "modules/contracts/runtime/tests/dataset-preparation-ocr.unit.test.ts",
        "modules/application/ports/runtime/dataset-preparation-source-hasher.port.ts",
        "modules/application/use-cases/tests/prepare-training-dataset-ocr-source.integration.test.ts",
        "modules/adapters/runtime/python/worker/ocr/task_sources.py",
        "modules/adapters/runtime/python/worker/tests/test_ocr_task_sources.py",
        "modules/adapters/runtime/python/worker/tests/test_prepare_training_dataset_ocr.py",
        "modules/ui/shared/data-management/DatasetPreparationOcrSettings.tsx",
        "modules/ui/shared/data-management/tests/DatasetPreparationOcrSettings.ui.test.tsx",
        "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-ocr.ui.test.tsx",
        "apps/desktop/src/renderer/features/dataset-preparation/api/desktopDatasetPreparationClient.ts",
        "apps/desktop/src/renderer/features/dataset-preparation/tests/desktop-dataset-preparation-client.unit.test.ts",
        "apps/desktop/src/renderer/features/artifact-browser/hooks/useArtifactBrowserFeature.ts",
        "apps/desktop/src/renderer/features/artifact-browser/tests/use-artifact-browser-feature-composition.unit.test.tsx",
        "apps/desktop/README.md",
        "apps/thin-client/src/features/dataset-preparation/tests/dataset-preparation-ocr.ui.test.tsx",
        "dev-tools/scripts/qualification/visual-composer/ocr-qualification-worker.py",
        "dev-tools/scripts/qualification/visual-composer/ocr-host-launch-plan.mjs",
        "dev-tools/scripts/qualification/tests/test_ocr_qualification_worker.py",
        "dev-tools/scripts/qualification/tests/ocr-host-launch-plan.unit.test.mjs",
        "dev-tools/scripts/qualification/visual-composer/e2e/ocr-dataset-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-ocr.e2e.spec.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-ocr.e2e.spec.ts"],
    "system-runtime-conversation-ui": ['apps/desktop/src/system-runtime/SystemRuntimeApp.tsx', 'apps/desktop/src/system-runtime-preload/systemRuntimePreloadApi.ts', 'apps/desktop/src/system-runtime/tests/SystemRuntimeApp.interaction.ui.test.tsx', 'apps/desktop/src/system-runtime-preload/tests/systemRuntimePreloadApi.unit.test.ts'],
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
        {"id": "dependencies", "patterns": ["package.json", "package-lock.json", "apps/*/package.json", ".github/workflows/*", "deployments/*", "dev-tools/vendor/*", "dev-tools/helpers/requirements-tests.txt", "*webpack*", "*tsconfig*", "dev-tools/scripts/native/build_windows_ocr.py", "dev-tools/scripts/native/build_windows_ocr.cjs", "apps/desktop/forge.config.js"], "argv": [node, "dev-tools/scripts/security/check-dependency-security.mjs"], "timeout": 300},
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
