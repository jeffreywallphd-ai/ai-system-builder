"""Trusted command identities and complete per-path impact selection."""
from __future__ import annotations

import fnmatch
import hashlib
import re
import stat
import sys
from pathlib import Path

from .common import digest, fields, read_json, relative, refuse
from .storage import confined_path
from .contracts import ControlError

# The exact regression executor already admits only a tracked test. Keep these
# two form checks separate so one host does not select the other application's tests.
IMAGE_FORM_CHECKS = {
    "thin-image-form-ui": (
        "apps/thin-client/src/features/image-generation/components/ImageGenerationFeature.tsx",
        "apps/thin-client/src/features/image-generation/tests/image-generation-feature.unit.test.tsx",
    ),
    "desktop-image-form-ui": (
        "apps/desktop/src/renderer/features/image-generation/components/ImageGenerationForm.tsx",
        "apps/desktop/src/renderer/features/image-generation/tests/image-generation-feature.unit.test.tsx",
    ),
}

# Opt in only for scoped work with this existing Dataset Preparation suite.
# Ordinary edits to the worker driver still receive generic test selection.
OPT_IN_REGRESSION_CHECKS = {
    "desktop-image-storage-labels": (
        "apps/desktop/src/renderer/features/image-generation/tests/desktop-image-ipc-storage.ui.test.tsx",
        "apps/desktop/src/renderer/features/image-generation/tests/desktop-image-ipc-storage.ui.test.tsx",
    ),
    "dataset-preparation-core-unit": (
        "modules/adapters/runtime/python/worker/tasks/prepare_training_dataset.py",
        "modules/adapters/runtime/python/worker/tests/test_prepare_training_dataset_task.py",
    ),
}

ASSET_DEFENSIVE_TESTS = (
    "modules/application/use-cases/asset-package/tests/asset-package-lifecycle.unit.test.ts",
    "modules/application/use-cases/asset-package/tests/asset-package-workspace-authorization.unit.test.ts",
    "modules/application/use-cases/asset-studio/tests/asset-studio-workflow.unit.test.ts",
    "modules/application/use-cases/asset-authoring/tests/asset-derived-customization-workflow.unit.test.ts",
    "modules/application/services/asset/tests/workspace-asset-registry-read-facade.service.unit.test.ts",
    "modules/adapters/persistence/asset-publication/tests/asset-definition-publication.unit.test.ts",
    "modules/adapters/transport/api-express/asset-package/tests/asset-package-transport-parity.unit.test.ts",
    "modules/adapters/transport/api-express/asset-studio/tests/asset-studio-transport-parity.unit.test.ts",
    "dev-tools/scripts/architecture/tests/asset-system-fitness.unit.test.mjs",
)

STANDARD_RUNNER_CORE_TEST = "dev-tools/scripts/testing/tests/non-browser-test-runner-core.unit.test.ts"
STANDARD_RUNNER_SOURCES = (
    "dev-tools/scripts/testing/run-non-browser-tests.mjs",
    "dev-tools/scripts/testing/non-browser-test-runner-core.mjs",
    STANDARD_RUNNER_CORE_TEST,
)
ASSET_BROWSER_SOURCES = (
    "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-visual-composer.e2e.spec.ts",
    "dev-tools/scripts/qualification/tests/functionality-qualification.unit.test.mjs",
    "modules/ui/shared/styles/components/home.css",
)

# Keep Form-specific paths exact so unrelated Desktop and host work still needs evidence.
FORM_HOST_DEFINITIONS = (
    "dev-tools/scripts/qualification/visual-composer/e2e/form-composer-authoring-journey.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/form-composer-desktop-profile.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/form-composer-publication-journey.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/form-composer-native-observation.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-form-composer.e2e.spec.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-form-composer.e2e.spec.ts",
    "dev-tools/scripts/qualification/tests/form-composer-host-definitions.unit.test.mjs",
)

MANAGED_ASSETS_RESTART_LOADER_FILES = (
    "dev-tools/scripts/qualification/visual-composer/visual-composer-host-lifecycle.mjs",
    "dev-tools/scripts/qualification/visual-composer/visual-composer-owned-process.mjs",
    "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
    "dev-tools/scripts/qualification/tests/managed-assets-restart-loader.unit.test.mjs",
)

HEADLESS_DESKTOP_READ_SOURCES = (
    "modules/contracts/README.md",
    "modules/contracts/headless/index.ts",
    "modules/contracts/headless/headless-read-request.ts",
    "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
    "modules/contracts/headless/headless-read-result.ts",
    "modules/hosts/shared/composition/composeSystemBuilder.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts",
    "modules/hosts/desktop/composition/composeDesktopHost.ts",
    "modules/hosts/desktop/composition/README.md",
    "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts",
)
HEADLESS_DESKTOP_READ_CHECK = "headless-desktop-read-provider"
HEADLESS_DESKTOP_READ_AUTOMATIC_SOURCES = (
    "modules/contracts/headless/headless-read-request.ts",
    "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
    "modules/contracts/headless/headless-read-result.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts",
    "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts",
)
HEADLESS_DESKTOP_ACTIVATION_CHECK = "headless-desktop-activation"
HEADLESS_DESKTOP_ACTIVATION_AUTOMATIC_SOURCES = (
    "apps/desktop/src/main/desktopHeadlessPairingIpc.ts",
    "apps/desktop/src/main/tests/desktop-headless-pairing-ipc.unit.test.ts",
    "apps/desktop/src/renderer/features/settings/components/HeadlessClientSettings.tsx",
    "modules/contracts/headless/desktop-headless-pairing.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessConnection.ts",
    "modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts",
)
HEADLESS_DESKTOP_ACTIVATION_SCOPED_SOURCES = HEADLESS_DESKTOP_ACTIVATION_AUTOMATIC_SOURCES + (
    "apps/desktop/src/renderer/features/system-builder/api/observeDesktopSavedSystems.ts",
    "apps/desktop/src/renderer/features/system-builder/api/observeDesktopSavedSystems.unit.test.ts",
    "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx",
    "modules/contracts/headless/desktop-system-change-poll.ts",
    "modules/hosts/desktop/composition/registerDesktopSystemChangePoll.ts",
    "modules/hosts/desktop/composition/tests/desktop-system-change-poll.unit.test.ts",
    "modules/ui/shared/system-builder/SystemManagementWorkspace.tsx",
    "modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx",
    "modules/adapters/persistence/system-builder/createStructuredSystemBuilderRepository.ts",
    "modules/adapters/persistence/system-builder/structuredSystemChangeJournal.ts",
    "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
    "modules/adapters/persistence/system-builder/createStructuredHeadlessOperationStore.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessAuthoring.ts",
    "modules/hosts/desktop/composition/composeDesktopHost.ts",
    "modules/hosts/desktop/composition/registerDesktopHeadlessTaskList.ts",
    "modules/hosts/desktop/composition/tests/desktop-headless-task-list.unit.test.ts",
    "modules/contracts/headless/desktop-headless-chat-tasks.ts",
    "modules/hosts/desktop/composition/tests/desktop-headless-authoring.unit.test.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessConversation.ts",
    "modules/hosts/desktop/composition/tests/desktop-headless-conversation.unit.test.ts",
    "modules/contracts/headless/index.ts",
    "apps/desktop/src/main/index.ts",
    "apps/desktop/src/preload/exposedApi.ts",
    "apps/desktop/src/renderer/lib/desktopApi.ts",
    "apps/desktop/src/renderer/pages/SettingsPage.tsx",
    "modules/adapters/security/headless/createDesktopHeadlessClientAuthority.ts",
    "modules/adapters/security/headless/tests/desktop-headless-client-authority.unit.test.ts",
    "modules/adapters/security/headless/README.md",
    "modules/adapters/transport/headless-loopback/startDesktopHeadlessLoopback.ts",
    "modules/adapters/transport/headless-loopback/createDesktopPinnedLoopbackAgent.ts",
    "modules/adapters/transport/headless-loopback/index.ts",
    "modules/adapters/transport/headless-loopback/README.md",
    "modules/adapters/transport/headless-loopback/tests/desktop-headless-loopback.unit.test.ts",
)
HEADLESS_MCP_CHECK = "headless-desktop-pinned-mcp"
HEADLESS_PACKAGED_CHECK = "headless-packaged-desktop-journey"
HEADLESS_PACKAGED_SOURCES = (
    "dev-tools/scripts/qualification/visual-composer/e2e/headless-desktop-fixture.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts",
    "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-ui-takeover.e2e.spec.ts",
    "dev-tools/scripts/qualification/visual-composer/headless-approved-conversation-seed.ts",
    "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
)
HEADLESS_MCP_SOURCES = (
    "modules/contracts/headless/headless-approved-turn.ts",
    "modules/contracts/headless/headless-data-local-file.ts",
    "modules/contracts/headless/headless-data-provider-file.ts",
    "modules/adapters/transport/headless-loopback/startDesktopHeadlessLoopback.ts",
    "modules/adapters/transport/headless-loopback/tests/desktop-headless-loopback.unit.test.ts",
    "modules/adapters/transport/headless-mcp/README.md",
    "modules/adapters/transport/headless-mcp/boundHeadlessMcpStdio.mts",
    "modules/adapters/transport/headless-mcp/createHeadlessMcpReadForwarder.mts",
    "modules/adapters/transport/headless-mcp/generateHeadlessMcpToolReference.mts",
    "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts",
    "modules/adapters/transport/headless-mcp/tests/headless-mcp-stdio.unit.test.ts",
    "dev-tools/scripts/agent-support/tests/headless-plan-skill.unit.test.ts",
    "skills/control-ai-system-builder/references/mcp-tools.json",
)

TRAINING_LOCAL_MODEL_TESTS = (
    "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts",
    "modules/application/use-cases/model/tests/headless-model-training-local-files.unit.test.ts",
    "modules/adapters/model/local/tests/context-embedding-model-files.unit.test.ts",
    "modules/adapters/model/local/tests/local-training-model-files.unit.test.ts",
)
TRAINING_LOCAL_MODEL_CODE = (
    "modules/application/ports/model/model-training-files.port.ts",
    "modules/application/ports/model/index.ts",
    "modules/application/use-cases/model/headless-model-training-local-files.use-case.ts",
    "modules/adapters/model/local/localSafeModelDirectoryInspector.ts",
    "modules/adapters/model/local/createLocalContextEmbeddingModelFilesAdapter.ts",
    "modules/adapters/model/local/createLocalTrainingModelFilesAdapter.ts",
    "modules/adapters/model/local/index.ts",
)

TRAINING_HOST_REVIEW_TEST = "modules/hosts/shared/composition/tests/headless-model-training-host-review.unit.test.ts"
TRAINING_HOST_REVIEW_CODE = (
    "modules/hosts/shared/composition/headlessTrainingPlanInputs.ts",
    "modules/hosts/shared/composition/headlessPlanReview.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessPlanReview.ts",
    "modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals.ts",
    "modules/hosts/server/composition/composeManagedHeadlessPlanReview.ts",
    "modules/hosts/server/composition/composeManagedHeadlessPlanApprovals.ts",
    "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
)
TRAINING_HOST_REVIEW_TESTS = (
    TRAINING_HOST_REVIEW_TEST,
    "modules/hosts/shared/composition/tests/headless-model-download-host-review.unit.test.ts",
    "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
    "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
)
TRAINING_HOST_REVIEW_SOURCES = TRAINING_HOST_REVIEW_CODE + TRAINING_HOST_REVIEW_TESTS + (
    "modules/hosts/desktop/composition/README.md",
    "modules/hosts/server/composition/README.md",
    "modules/adapters/persistence/system-builder/README.md",
)

STORY_TASK_SCOPE = (
    "dev-tools/helpers/control_plane/candidate.py", "dev-tools/helpers/control_plane/work.py",
    "dev-tools/helpers/control_plane/deterministic_support.py", "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_story_tasks.py",
    "dev-tools/helpers/tests/test_control_plane_deterministic_support.py",
    "dev-tools/helpers/tests/test_control_plane_roadmap.py",
    "dev-tools/helpers/README.md", "dev-tools/helpers/development_control_plane.py",
    "skills/manage-implementation-roadmaps/scripts/roadmap.py",
    "skills/manage-implementation-roadmaps/tests/test_story_task_tracking.py",
    "skills/manage-implementation-roadmaps/tests/test_roadmap.py",
    "skills/manage-implementation-roadmaps/SKILL.md",
    "skills/manage-implementation-roadmaps/references/workflow.md",
    "skills/manage-implementation-roadmaps/references/events.md",
    "skills/manage-implementation-roadmaps/references/installation.md",
    "docs/diagnostics/implementation-roadmap-skill.md", "docs/diagnostics/ai-development-control-plane.md",
    "docs/diagnostics/deterministic-contributor-support.md", "docs/architecture/ai-development-control-plane.md",
    "docs/security/ai-development-control-plane-threat-model.md", "docs/context/prompt-routing.md",
    "docs/context/packs/docs-standards.pack.md", "docs/operations/roadmap-user-descriptions.json",
)
STORY_TASK_REQUIRED = (
    "dev-tools/helpers/control_plane/candidate.py", "dev-tools/helpers/control_plane/work.py",
    "dev-tools/helpers/control_plane/deterministic_support.py", "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_story_tasks.py",
    "skills/manage-implementation-roadmaps/scripts/roadmap.py",
    "skills/manage-implementation-roadmaps/tests/test_story_task_tracking.py",
    "dev-tools/helpers/tests/test_control_plane_roadmap.py",
    "dev-tools/helpers/tests/test_control_plane_deterministic_support.py",
    "dev-tools/helpers/tests/test_control_plane_delivery.py",
)

ROADMAP_STORAGE_SCOPE = (
    "skills/manage-implementation-roadmaps/SKILL.md",
    "skills/manage-implementation-roadmaps/scripts/roadmap.py",
    "skills/manage-implementation-roadmaps/scripts/roadmap_storage.py",
    "skills/manage-implementation-roadmaps/tests/test_roadmap.py",
    "skills/manage-implementation-roadmaps/tests/test_roadmap_storage.py",
    "skills/manage-implementation-roadmaps/tests/test_state_publication_bounds.py",
    "skills/manage-implementation-roadmaps/tests/fixtures/roadmap-storage-vectors.json",
    "skills/manage-implementation-roadmaps/references/workflow.md",
    "skills/manage-implementation-roadmaps/references/events.md",
    "skills/manage-implementation-roadmaps/references/installation.md",
    "docs/diagnostics/implementation-roadmap-skill.md",
    "docs/architecture/ai-development-control-plane.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "dev-tools/helpers/README.md",
    "dev-tools/helpers/control_plane/roadmap_state.py",
    "dev-tools/helpers/control_plane/candidate.py",
    "dev-tools/helpers/control_plane/work.py",
    "dev-tools/helpers/control_plane/projection.py",
    "dev-tools/helpers/control_plane/user_presentation.py",
    "dev-tools/helpers/control_plane/supporting_work.py",
    "dev-tools/helpers/tests/test_control_plane_roadmap_storage.py",
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/scripts/qualification/run_model_blocker_tests.py",
    "dev-tools/scripts/qualification/functionality-qualification-core.mjs",
    "dev-tools/scripts/qualification/roadmap-record-storage.mjs",
    "dev-tools/scripts/qualification/tests/roadmap-record-storage.unit.test.mjs",
    "dev-tools/scripts/qualification/tests/test_model_blocker_tests.py",
)
# Actual changed authority/Work/read/projection boundaries. Product-specific
# training, UI and Native routing profiles are not storage tests.
ROADMAP_STORAGE_CONTROLLER_TESTS = tuple("dev-tools/helpers/tests/" + name for name in (
    "test_control_plane.py", "test_control_plane_roadmap_storage.py",
    "test_control_plane_roadmap.py", "test_control_plane_support.py",
    "test_control_plane_snapshots.py", "test_control_plane_supporting_work.py",
    "test_control_plane_user_presentation.py", "test_control_plane_criterion_presentation.py",
    "test_control_plane_site.py", "test_control_plane_pagination.py",
    "test_control_plane_review_wire.py", "test_control_plane_focused.py",
    "test_control_plane_published_form_feature_checks.py",
    "test_control_plane_journal_capacity.py", "test_control_plane_delivery.py",
))

DETERMINISTIC_SUPPORT_SCOPE = (
    "dev-tools/helpers/control_plane/deterministic_support.py",
    "dev-tools/helpers/tests/test_control_plane_deterministic_support.py",
    "docs/diagnostics/deterministic-contributor-support.md",
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py",
)
MODEL_TRAINING_BOUND_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/helpers/tests/test_control_plane_model_training_worker.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "dev-tools/helpers/tests/test_control_plane_training_result_validation.py",
    "dev-tools/helpers/run_focused_checks.py",
)
MODEL_TRAINING_ROUTING_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
)
MODEL_TRAINING_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/train_model.py",
    "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/security/headless-system-builder-threat-model.md",
)
MODEL_TRAINING_BOUND_REQUIRED = MODEL_TRAINING_BOUND_SCOPE + (
    "dev-tools/helpers/run_focused_checks.py",
    "modules/adapters/runtime/python/worker/tasks/train_model.py",
    "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
    "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
    "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/security/headless-system-builder-threat-model.md",
    "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts",
    "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
)
TRAINING_RESULT_ROUTING_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_training_result_validation.py",
)
TRAINING_RESULT_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/model_validation.py",
    "modules/adapters/runtime/python/worker/tests/test_model_validation.py",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/security/headless-system-builder-threat-model.md",
)
TRAINING_RESULT_CONTROLLER_FILTERS = (
    "test_control_plane_training_result_validation.",
    "test_control_plane_focused.",
    "test_control_plane_published_form_feature_checks.",
    "test_control_plane_model_training_worker.",
    "test_control_plane_headless_native_model_graph.",
    "test_control_plane_headless_training_runtime.",
    "test_control_plane_delivery.CatalogTests.",
)
TRAINING_RESULT_CONTROLLER_TESTS = tuple(
    "dev-tools/helpers/tests/" + name.split(".")[0] + ".py"
    for name in TRAINING_RESULT_CONTROLLER_FILTERS
)
TRAINING_OUTPUT_RETIREMENT_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_training_output_retirement.py",
)
TRAINING_OUTPUT_RETIREMENT_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
    "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_output_retirement.py",
    "dev-tools/helpers/run_focused_checks.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/security/headless-system-builder-threat-model.md",
)
TRAINING_OUTPUT_RETIREMENT_CONTROLLER_FILTERS = (
    "test_control_plane_training_output_retirement.",
    "test_control_plane_focused.",
    "test_control_plane_headless_training_runtime.",
    "test_control_plane_headless_native_model_graph.",
    "test_control_plane_training_result_validation.",
)
PROTECTED_TRAINING_WORKFLOW_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_protected_training_workflow.py",
)
PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
    "modules/adapters/runtime/python/worker/tasks/train_model.py",
    "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
    "modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py",
    "dev-tools/helpers/run_focused_checks.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/security/headless-system-builder-threat-model.md",
)
PROTECTED_TRAINING_WORKFLOW_CONTROLLER_FILTERS = (
    "test_control_plane_protected_training_workflow.",
    "test_control_plane_focused.",
    "test_control_plane_training_output_retirement.",
    "test_control_plane_headless_training_runtime.",
    "test_control_plane_headless_native_model_graph.",
    "test_control_plane_training_result_validation.",
)
ORIGINAL_TRAINING_FILES_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_original_training_files.py",
)
ORIGINAL_TRAINING_FILES_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
    "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
    "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
    "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
    "dev-tools/helpers/run_focused_checks.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/security/headless-system-builder-threat-model.md",
)
ORIGINAL_TRAINING_FILES_CONTROLLER_FILTERS = (
    "test_control_plane_original_training_files.",
    *PROTECTED_TRAINING_WORKFLOW_CONTROLLER_FILTERS,
)
TRAINING_OUTPUT_DELIVERY_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_training_output_delivery.py",
)
TRAINING_OUTPUT_DELIVERY_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_output_delivery.py",
    "modules/adapters/runtime/python/worker/tasks/train_model.py",
    "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
    "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/adr/ADR-0047-headless-system-builder-delegation.md",
    "docs/security/headless-system-builder-threat-model.md",
    "docs/context/packs/runtime.pack.md",
)
TRAINING_OUTPUT_DELIVERY_CONTROLLER_FILTERS = (
    "test_control_plane_training_output_delivery.",
    *ORIGINAL_TRAINING_FILES_CONTROLLER_FILTERS,
)
TRAINING_OUTPUT_CHANNEL_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_training_output_channel.py",
)
TRAINING_OUTPUT_CHANNEL_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
    "modules/adapters/runtime/python/worker/app.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_output_channel.py",
    "dev-tools/helpers/README.md",
    "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md",
    "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md",
    "docs/adr/ADR-0047-headless-system-builder-delegation.md",
    "docs/security/headless-system-builder-threat-model.md",
    "docs/context/packs/runtime.pack.md",
)
TRAINING_OUTPUT_CHANNEL_CONTROLLER_FILTERS = (
    "test_control_plane_training_output_channel.",
    "test_control_plane_headless_training_runtime.",
    "test_control_plane_training_output_delivery.",
    "test_control_plane_focused.",
)
TRAINING_OUTPUT_RECEIVER_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_training_output_receiver.py",
)
TRAINING_OUTPUT_RECEIVER_OWNER_SCOPE = (
    "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts",
    "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts",
    "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
    "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
    "dev-tools/helpers/README.md", "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md", "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md", "docs/adr/ADR-0047-headless-system-builder-delegation.md",
    "docs/security/headless-system-builder-threat-model.md", "docs/context/packs/runtime.pack.md",
)
TRAINING_OUTPUT_RECEIVER_CONTROLLER_FILTERS = (
    "test_control_plane_training_output_receiver.", "test_control_plane_headless_training_runtime.",
    "test_control_plane_training_output_channel.", "test_control_plane_focused.",
)
TRAINING_EXIT_BARRIER_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py", "dev-tools/helpers/tests/test_control_plane_training_exit_barrier.py",
)
TRAINING_EXIT_BARRIER_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
    "modules/adapters/runtime/python/worker/tasks/original_training_exit_barrier.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_exit_barrier.py",
    "dev-tools/helpers/README.md", "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md", "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md", "docs/adr/ADR-0047-headless-system-builder-delegation.md",
    "docs/security/headless-system-builder-threat-model.md", "docs/context/packs/runtime.pack.md",
)
TRAINING_EXIT_BARRIER_CONTROLLER_FILTERS = (
    "test_control_plane_training_exit_barrier.", "test_control_plane_original_training_files.",
    "test_control_plane_training_output_channel.", "test_control_plane_focused.",
)
TRAINING_IO_RETIREMENT_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py", "dev-tools/helpers/tests/test_control_plane_training_io_retirement.py",
)
TRAINING_IO_RETIREMENT_OWNER_SCOPE = (
    "modules/adapters/filesystem-security/containedFilesystem.ts",
    "modules/application/ports/model/training-result-file-byte-storage.port.ts",
    "modules/adapters/storage/filesystem/artifact-store/createFilesystemTrainingResultFileByteStorageAdapter.ts",
    "modules/adapters/storage/filesystem/artifact-store/tests/training-result-file-byte-storage.integration.test.ts",
    "modules/adapters/storage/filesystem/artifact-store/tests/contained-stream-retirement.integration.test.ts",
    "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts",
    "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
    "dev-tools/helpers/README.md", "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/storage/filesystem/README.md", "modules/adapters/runtime/python/README.md",
    "docs/architecture/runtime-model.md", "docs/adr/ADR-0047-headless-system-builder-delegation.md",
    "docs/security/headless-system-builder-threat-model.md", "docs/context/packs/runtime.pack.md",
)
TRAINING_IO_RETIREMENT_CONTROLLER_FILTERS = (
    "test_control_plane_training_io_retirement.", "test_control_plane_training_output_receiver.",
    "test_control_plane_headless_training_runtime.", "test_control_plane_focused.",
)
TRAINING_SESSION_EXIT_SCOPE = (
    "dev-tools/helpers/control_plane/catalog.py", "dev-tools/helpers/tests/test_control_plane_training_session_exit.py",
)
TRAINING_SESSION_EXIT_OWNER_SCOPE = (
    "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
    "modules/adapters/runtime/python/worker/tasks/original_training_session_exit.py",
    "modules/adapters/runtime/python/worker/app.py",
    "modules/adapters/runtime/python/worker/tests/test_original_training_session_exit.py",
    "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
    "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
    "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
    "dev-tools/helpers/README.md", "docs/diagnostics/ai-development-control-plane.md",
    "modules/adapters/runtime/python/README.md", "modules/adapters/runtime/python/worker/README.md",
    "docs/architecture/runtime-model.md", "docs/adr/ADR-0047-headless-system-builder-delegation.md",
    "docs/security/headless-system-builder-threat-model.md", "docs/context/packs/runtime.pack.md",
)
TRAINING_SESSION_EXIT_CONTROLLER_FILTERS = (
    "test_control_plane_training_session_exit.", "test_control_plane_headless_training_runtime.",
    "test_control_plane_training_exit_barrier.", "test_control_plane_focused.",
)
TOKEN_USAGE_SCOPE = (
    "dev-tools/helpers/control_plane/usage.py", "dev-tools/helpers/development_control_plane.py",
    "dev-tools/helpers/control_plane/projection.py", "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_usage.py", "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/review-site/app.js", "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
    "dev-tools/helpers/README.md", "dev-tools/review-site/README.md", "docs/diagnostics/token-usage-tracking.md",
    "docs/diagnostics/ai-development-control-plane.md", "docs/architecture/ai-development-control-plane.md",
    "docs/security/ai-development-control-plane-threat-model.md", "docs/context/packs/docs-standards.pack.md",
)
TOKEN_USAGE_TEST_MODULES = ("usage", "focused", "site", "pagination", "review_wire", "delivery", "evaluations")
TOKEN_USAGE_REQUIRED = TOKEN_USAGE_SCOPE + tuple(
    "dev-tools/helpers/tests/test_control_plane_" + name + ".py" for name in TOKEN_USAGE_TEST_MODULES
) + ("dev-tools/helpers/control_plane/common.py", "dev-tools/helpers/control_plane/storage.py",
     "dev-tools/helpers/control_plane/records.py", "dev-tools/config/contributor-check-profiles.json")
TOKEN_DASHBOARD_SCOPE = (
    "dev-tools/helpers/control_plane/usage.py", "dev-tools/helpers/control_plane/catalog.py",
    "dev-tools/helpers/tests/test_control_plane_usage.py", "dev-tools/helpers/tests/test_control_plane_focused.py",
    "dev-tools/helpers/tests/test_control_plane_site.py", "dev-tools/review-site/index.html",
    "dev-tools/review-site/app.js", "dev-tools/review-site/style.css",
    "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs", "dev-tools/review-site/README.md",
    "docs/diagnostics/token-usage-tracking.md", "docs/diagnostics/ai-development-control-plane.md",
    "docs/architecture/ai-development-control-plane.md", "docs/security/ai-development-control-plane-threat-model.md",
    "docs/context/packs/docs-standards.pack.md",
)
TOKEN_DASHBOARD_REQUIRED = TOKEN_DASHBOARD_SCOPE + TOKEN_USAGE_REQUIRED
TOKEN_CAPTURE_SCOPE = (
    "AGENTS.md", "README.md", "dev-tools/helpers/README.md",
    "dev-tools/helpers/control_plane/usage_capture.py", "dev-tools/helpers/development_control_plane.py",
    "dev-tools/helpers/control_plane/catalog.py", "dev-tools/helpers/tests/test_control_plane_capture.py",
    "dev-tools/helpers/tests/test_control_plane_focused.py", "dev-tools/review-site/app.js",
    "dev-tools/review-site/README.md", "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
    "docs/diagnostics/token-usage-tracking.md", "docs/diagnostics/ai-development-control-plane.md",
    "docs/architecture/ai-development-control-plane.md", "docs/security/ai-development-control-plane-threat-model.md",
    "docs/context/packs/docs-standards.pack.md", "docs/context/prompt-routing.md",
)
TOKEN_CAPTURE_REQUIRED = TOKEN_CAPTURE_SCOPE + TOKEN_USAGE_REQUIRED
TOKEN_LOCAL_SCOPE = TOKEN_CAPTURE_SCOPE + (
    "dev-tools/helpers/control_plane/usage_local.py", "dev-tools/helpers/tests/test_control_plane_local_usage.py",
    "dev-tools/helpers/control_plane/work.py",
)
TOKEN_LOCAL_REQUIRED = TOKEN_LOCAL_SCOPE + TOKEN_CAPTURE_REQUIRED
TOKEN_PHASE_SCOPE = TOKEN_LOCAL_SCOPE + (
    "dev-tools/helpers/control_plane/usage.py", "dev-tools/helpers/tests/test_control_plane_usage.py",
    "dev-tools/helpers/control_plane/usage_phases.py", "dev-tools/helpers/tests/test_control_plane_phases.py",
    "skills/manage-implementation-roadmaps/SKILL.md", "skills/manage-implementation-roadmaps/references/workflow.md",
    "skills/manage-implementation-roadmaps/references/installation.md", "skills/manage-implementation-roadmaps/tests/test_roadmap.py",
)
TOKEN_PHASE_REQUIRED = TOKEN_PHASE_SCOPE + TOKEN_LOCAL_REQUIRED
DETERMINISTIC_SUPPORT_REQUIRED = DETERMINISTIC_SUPPORT_SCOPE + tuple(
    "dev-tools/helpers/control_plane/" + name for name in (
        "__init__.py", "candidate.py", "common.py", "contracts.py", "execution.py",
        "records.py", "storage.py", "work.py", "roadmap_state.py", "projection.py",
    )) + (
    "dev-tools/helpers/development_control_plane.py",
    "dev-tools/helpers/run_focused_checks.py",
    "dev-tools/helpers/tests/test_control_plane_delivery.py",
    "skills/manage-implementation-roadmaps/scripts/roadmap.py",
    "skills/manage-implementation-roadmaps/scripts/roadmap_storage.py",
    "skills/manage-implementation-roadmaps/tests/test_roadmap.py",
)

PUBLISHED_FORM_CHECKS = {
    "story-task-bindings": {
        "interpreter": "python",
        "command": ["-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                    "-k", "test_control_plane_story_tasks.", "-k", "test_control_plane_roadmap.",
                    "-k", "test_control_plane_deterministic_support.", "-k", "test_control_plane_delivery."],
        "sources": STORY_TASK_SCOPE,
        "automatic_sources": ("dev-tools/helpers/control_plane/candidate.py", "dev-tools/helpers/control_plane/work.py",
                              "dev-tools/helpers/control_plane/deterministic_support.py",
                              "dev-tools/helpers/tests/test_control_plane_story_tasks.py"),
        "automatic_required_files": STORY_TASK_REQUIRED,
        "timeout": 300,
    },
    "roadmap-storage-node": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/roadmap-record-storage.mjs",
            "dev-tools/scripts/qualification/functionality-qualification-core.mjs",
            "dev-tools/scripts/qualification/tests/roadmap-record-storage.unit.test.mjs",
        ),
        "automatic_required_files": (
            "skills/manage-implementation-roadmaps/scripts/roadmap_storage.py",
            "skills/manage-implementation-roadmaps/tests/fixtures/roadmap-storage-vectors.json",
            "dev-tools/scripts/qualification/roadmap-record-storage.mjs",
            "dev-tools/scripts/qualification/functionality-qualification-core.mjs",
            "dev-tools/scripts/qualification/tests/roadmap-record-storage.unit.test.mjs",
        ),
        "sources": (
            "skills/manage-implementation-roadmaps/scripts/roadmap_storage.py",
            "skills/manage-implementation-roadmaps/tests/fixtures/roadmap-storage-vectors.json",
            "dev-tools/scripts/qualification/roadmap-record-storage.mjs",
            "dev-tools/scripts/qualification/functionality-qualification-core.mjs",
            "dev-tools/scripts/qualification/tests/roadmap-record-storage.unit.test.mjs",
        ),
        "command": ("--test", "--test-reporter=tap", "--",
            "dev-tools/scripts/qualification/tests/roadmap-record-storage.unit.test.mjs"),
    },
    "headless-training-host-review-unit": {
        "automatic_sources": (TRAINING_HOST_REVIEW_TEST,),
        "automatic_required_files": TRAINING_HOST_REVIEW_CODE + TRAINING_HOST_REVIEW_TESTS,
        "sources": TRAINING_HOST_REVIEW_SOURCES,
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--") + TRAINING_HOST_REVIEW_TESTS,
    },
    "headless-training-host-review-types": {
        "companion_to": "headless-training-host-review-unit",
        "sources": TRAINING_HOST_REVIEW_SOURCES,
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM") +
            TRAINING_HOST_REVIEW_CODE + TRAINING_HOST_REVIEW_TESTS,
    },
    "headless-training-host-review-server-build": {
        "companion_to": "headless-training-host-review-unit",
        "sources": TRAINING_HOST_REVIEW_SOURCES,
        "command": ("node_modules/typescript/bin/tsc", "-p", "apps/server/tsconfig.json"),
    },
    "headless-training-task-controls-unit": {
        "automatic_sources": (
            "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts",
        ),
        "automatic_required_files": (
            "modules/hosts/shared/composition/headlessModelTrainingTasks.ts",
            "modules/hosts/shared/composition/headlessModelTrainingExecution.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/contracts/headless/headless-model-training-task.ts",
            "modules/contracts/headless/index.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts",
        ),
        "sources": (
            "modules/hosts/shared/composition/headlessModelTrainingTasks.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/headless-model-training-task.ts",
            "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts",
            "modules/contracts/headless/index.ts",
            "modules/hosts/README.md", "modules/contracts/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--",
            "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts"),
    },
    "headless-training-task-controls-types": {
        "companion_to": "headless-training-task-controls-unit",
        "sources": (
            "modules/hosts/shared/composition/headlessModelTrainingTasks.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/headless-model-training-task.ts",
            "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts",
            "modules/contracts/headless/index.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/hosts/shared/composition/headlessModelTrainingTasks.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts"),
    },
    "headless-training-io-retirement-unit": {
        "automatic_sources": TRAINING_IO_RETIREMENT_OWNER_SCOPE[:7],
        "automatic_required_files": TRAINING_IO_RETIREMENT_OWNER_SCOPE[:7] + (
            "modules/adapters/storage/filesystem/artifact-store/verifiedPublicationStream.ts",
            "modules/adapters/filesystem-security/index.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/filesystem-artifact-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/ingestion-file-byte-storage.integration.test.ts",
        ),
        "sources": TRAINING_IO_RETIREMENT_OWNER_SCOPE,
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--",
            "modules/adapters/storage/filesystem/artifact-store/tests/contained-stream-retirement.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/training-result-file-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/filesystem-artifact-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/ingestion-file-byte-storage.integration.test.ts"),
    },
    "headless-training-io-retirement-types": {
        "companion_to": "headless-training-io-retirement-unit",
        "sources": TRAINING_IO_RETIREMENT_OWNER_SCOPE[:7],
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/adapters/storage/filesystem/artifact-store/tests/contained-stream-retirement.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/training-result-file-byte-storage.integration.test.ts",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts"),
    },
    "headless-training-runtime-unit": {
        "automatic_sources": (
            "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
            "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
            "modules/adapters/runtime/python/client/originalTrainingModelSource.ts",
            "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
            "modules/adapters/runtime/python/tests/pythonRuntimeHttpProtocol.unit.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemTrainingResultFileByteStorageAdapter.ts",
            "modules/application/ports/model/training-result-file-byte-storage.port.ts",
            "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts",
            "modules/adapters/runtime/python/client/originalTrainingModelSource.ts",
            "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
            "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts",
            "modules/adapters/runtime/python/client/originalTrainingModelSource.ts",
            "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
            "modules/adapters/runtime/python/tests/pythonRuntimeHttpProtocol.unit.test.ts",
            "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts"),
    },
    "headless-training-runtime-types": {
        "companion_to": "headless-training-runtime-unit",
        "sources": (
            "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
            "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts",
            "modules/adapters/runtime/python/client/originalTrainingModelSource.ts",
            "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts",
            "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts"),
    },
    "headless-training-session-exit-ready-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_session_exit.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_session_exit.py",
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
        ),
        "automatic_required_files": TRAINING_SESSION_EXIT_OWNER_SCOPE[:5] + (
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
        ),
        "sources": TRAINING_SESSION_EXIT_OWNER_SCOPE,
        "command": ("-m", "unittest", "-v",
            "modules/adapters/runtime/python/worker/tests/test_original_training_session_exit.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py"),
    },
    "headless-training-runtime-worker-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "dev-tools/helpers/run_focused_checks.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/README.md",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
        ),
        "command": ("-B", "-m", "unittest", "-v",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py"),
    },
    "headless-training-local-files-unit": {
        "automatic_sources": tuple(path for path in TRAINING_LOCAL_MODEL_CODE if not path.endswith("/index.ts")) + (
            "modules/application/use-cases/model/tests/headless-model-training-local-files.unit.test.ts",
            "modules/adapters/model/local/tests/local-training-model-files.unit.test.ts"),
        "automatic_required_files": TRAINING_LOCAL_MODEL_CODE + TRAINING_LOCAL_MODEL_TESTS,
        "sources": TRAINING_LOCAL_MODEL_CODE + TRAINING_LOCAL_MODEL_TESTS + (
            "modules/adapters/model/local/README.md", "modules/application/use-cases/README.md"),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--", *TRAINING_LOCAL_MODEL_TESTS),
    },
    "headless-training-local-files-types": {
        "companion_to": "headless-training-local-files-unit",
        "sources": TRAINING_LOCAL_MODEL_CODE + TRAINING_LOCAL_MODEL_TESTS,
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck",
            "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop",
            "--jsx", "react-jsx", "--lib", "ES2021,DOM",
            "modules/application/use-cases/model/headless-model-training-local-files.use-case.ts",
            *TRAINING_LOCAL_MODEL_TESTS),
    },
    "headless-training-model-record-unit": {
        "automatic_sources": (
            "modules/application/use-cases/model/headless-model-training-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts",
        ),
        "automatic_required_files": (
            "modules/application/use-cases/model/headless-model-training-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts",
        ),
        "sources": (
            "modules/application/use-cases/model/headless-model-training-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts",
            "modules/application/use-cases/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--",
            "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts"),
    },
    "headless-training-model-record-types": {
        "companion_to": "headless-training-model-record-unit",
        "sources": (
            "modules/application/use-cases/model/headless-model-training-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck",
            "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop",
            "--jsx", "react-jsx", "--lib", "ES2021,DOM",
            "modules/application/use-cases/model/headless-model-training-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts"),
    },
    "training-ui-evidence-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/helpers/native-qualification/training_ui_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_ui_evidence.py",
        ),
        "automatic_required_files": (
            "dev-tools/helpers/native-qualification/training_ui_evidence.py",
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_ui_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "dev-tools/helpers/native-qualification/training_ui_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_ui_evidence.py",
            "dev-tools/helpers/native-qualification/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
                    "dev-tools/helpers/native-qualification/tests/test_training_ui_evidence.py"),
    },
    "training-ui-retained-evidence": {
        "interpreter": "python",
        "automatic_sources": ("docs/operations/headless-local-training-ui-qualification.json",),
        "automatic_required_files": (
            "docs/operations/headless-local-training-ui-qualification.json",
            "dev-tools/helpers/native-qualification/training_ui_evidence.py",
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
            "dev-tools/helpers/native-qualification/owned_command_job.py",
        ),
        "sources": (
            "docs/operations/headless-local-training-ui-qualification.json",
            "dev-tools/helpers/native-qualification/training_ui_evidence.py",
        ),
        "command": ("dev-tools/helpers/native-qualification/training_ui_evidence.py",),
        "timeout": 180,
    },
    "training-package-evidence-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_package_evidence.py",
        ),
        "automatic_required_files": (
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_package_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_package_evidence.py",
            "dev-tools/helpers/native-qualification/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
                    "dev-tools/helpers/native-qualification/tests/test_training_package_evidence.py"),
    },
    "training-package-retained-evidence": {
        "interpreter": "python",
        "automatic_sources": ("docs/operations/headless-local-training-package-qualification.json",),
        "automatic_required_files": (
            "docs/operations/headless-local-training-package-qualification.json",
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
        ),
        "sources": (
            "docs/operations/headless-local-training-package-qualification.json",
            "dev-tools/helpers/native-qualification/training_package_evidence.py",
        ),
        "command": ("dev-tools/helpers/native-qualification/training_package_evidence.py",),
        "timeout": 180,
    },
    "training-first-phase-evidence-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py",
        ),
        "automatic_required_files": (
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
            "dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
                    "dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py"),
    },
    "training-first-phase-retained-evidence": {
        "interpreter": "python",
        "automatic_sources": ("docs/operations/headless-local-training-input-qualification.json",),
        "automatic_required_files": (
            "docs/operations/headless-local-training-input-qualification.json",
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
        ),
        "sources": (
            "docs/operations/headless-local-training-input-qualification.json",
            "dev-tools/helpers/native-qualification/training_first_phase_evidence.py",
        ),
        "command": ("dev-tools/helpers/native-qualification/training_first_phase_evidence.py",),
        "timeout": 120,
    },
    "training-package-inputs-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
            "dev-tools/helpers/native-qualification/tests/test_training_package_inputs.py",
        ),
        "automatic_required_files": (
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
            "dev-tools/helpers/native-qualification/tests/test_training_package_inputs.py",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "dev-tools/README.md", "dev-tools/helpers/native-qualification/README.md",
            "dev-tools/helpers/native-qualification/training_package_inputs.py",
            "dev-tools/helpers/native-qualification/tests/test_training_package_inputs.py",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "dev-tools/helpers/native-qualification/tests/test_training_package_inputs.py"),
    },
    "training-local-loader-fixture-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py",
            "dev-tools/scripts/qualification/tests/test_training_qualification_worker.py",
            "dev-tools/scripts/qualification/tests/training-request-producer.ts",
        ),
        "automatic_required_files": (
            "dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py",
            "dev-tools/scripts/qualification/tests/test_training_qualification_worker.py",
            "dev-tools/scripts/qualification/tests/training-request-producer.ts",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "dev-tools/README.md", "modules/adapters/runtime/python/worker/README.md",
            "dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py",
            "dev-tools/scripts/qualification/tests/test_training_qualification_worker.py",
            "dev-tools/scripts/qualification/tests/training-request-producer.ts",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "dev-tools/scripts/qualification/tests/test_training_qualification_worker.py"),
    },
    "model-training-image-worker-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/README.md",
            "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py"),
    },
    "model-training-worker-unit": {
        "interpreter": "python",
        # The complete batch exceeded240s after new result-binding regressions.
        # This developer-check ceiling does not change model/runtime limits.
        "timeout": 420,
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/README.md",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py"),
    },
    "headless-training-result-validation-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_model_validation.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_model_validation.py",
            # Declared Native coverage must retain the original Native check
            # even when one of its inherited prerequisites is unavailable.
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "dev-tools/helpers/run_focused_checks.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_model_validation.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_model_validation.py"),
    },
    "headless-training-output-retirement-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_retirement.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "dev-tools/helpers/run_focused_checks.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_retirement.py",
        ),
        "sources": TRAINING_OUTPUT_RETIREMENT_OWNER_SCOPE[:3] + (
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_retirement.py"),
    },
    "headless-protected-training-workflow-unit": {
        "interpreter": "python",
        "timeout": 270,
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "dev-tools/helpers/run_focused_checks.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py"),
    },
    "headless-original-training-files-unit": {
        "interpreter": "python",
        "timeout": 120,
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
            "modules/adapters/runtime/python/worker/tasks/model_serialization.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tasks/__init__.py",
            "dev-tools/helpers/run_focused_checks.py",
            "dev-tools/helpers/requirements-tests.txt",
            "dev-tools/config/pytest-focused.ini",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py"),
    },
    "headless-training-exit-barrier-unit": {
        "interpreter": "python", "timeout": 120,
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/tasks/original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tasks/model_serialization.py",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tasks/__init__.py",
            "dev-tools/helpers/run_focused_checks.py", "dev-tools/helpers/requirements-tests.txt",
            "dev-tools/config/pytest-focused.ini",
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_exit_barrier.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_original_training_exit_barrier.py"),
    },
    "headless-training-output-delivery-unit": {
        "interpreter": "python",
        "timeout": 300,
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tasks/model_serialization.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "dev-tools/helpers/run_focused_checks.py",
            "dev-tools/helpers/requirements-tests.txt",
            "dev-tools/config/pytest-focused.ini",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_files.py",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tests/test_train_model_task.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_files.py",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_delivery.py"),
    },
    "headless-training-output-channel-unit": {
        "interpreter": "python",
        "timeout": 300,
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_channel.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_channel.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py",
            "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
            "modules/adapters/runtime/python/worker/tasks/train_model.py",
            "modules/adapters/runtime/python/worker/tasks/model_serialization.py",
            "modules/adapters/runtime/python/worker/tasks/model_validation.py",
            "dev-tools/helpers/run_focused_checks.py",
            "dev-tools/helpers/requirements-tests.txt",
            "dev-tools/config/pytest-focused.ini",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_channel.py",
            "modules/adapters/runtime/python/worker/tasks/original_training_output_delivery.py",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("dev-tools/helpers/run_focused_checks.py", "--regression-test",
            "modules/adapters/runtime/python/worker/tests/test_original_training_output_channel.py"),
    },
    "headless-approved-training-owner-unit": {
        "automatic_sources": (
            "modules/application/ports/model/approved-local-model-training.port.ts",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
        ),
        "automatic_required_files": (
            "modules/application/ports/model/approved-local-model-training.port.ts",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
        ),
        "sources": (
            "modules/application/ports/model/approved-local-model-training.port.ts",
            "modules/application/ports/model/index.ts",
            "modules/application/README.md",
            "modules/application/use-cases/README.md",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts"),
    },
    "headless-approved-training-owner-types": {
        "companion_to": "headless-approved-training-owner-unit",
        "sources": (
            "modules/application/ports/model/approved-local-model-training.port.ts",
            "modules/application/ports/model/index.ts",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts"),
    },
    "model-training-lifecycle-unit": {
        "automatic_sources": (
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/tests/train-model.use-case.unit.test.ts",
        ),
        "automatic_required_files": (
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/tests/train-model.use-case.unit.test.ts",
        ),
        "sources": (
            "modules/application/use-cases/README.md",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/tests/train-model.use-case.unit.test.ts",
        ),
        "command": ("--import", "tsx", "--test", "--test-concurrency=1", "--",
            "modules/application/use-cases/tests/train-model.use-case.unit.test.ts"),
    },
    "model-training-lifecycle-types": {
        "companion_to": "model-training-lifecycle-unit",
        "sources": (
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/tests/train-model.use-case.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/application/use-cases/model/train-model.use-case.ts"),
    },
    "headless-model-manifest-worker": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/client/modelDownloadManifest.ts",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/client/modelSourceRecipient.ts",
            "modules/adapters/runtime/python/client/modelSourceTaskSession.ts",
            "modules/adapters/runtime/python/client/modelSourceAcquisition.ts",
            "modules/application/ports/model/approved-model-source-download.port.ts",
            "modules/adapters/runtime/python/client/modelSourceIdentity.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/adapters/runtime/python/worker/tasks/model_download_manifest.py",
            "modules/adapters/runtime/python/worker/tests/test_model_download_manifest.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_transport.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_transport.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_staging.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_staging.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_handoff.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_handoff.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_task.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_task.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_identity.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_identity.py",
            "modules/adapters/runtime/python/worker/tests/model_source_identity_fixture.py",
        ),
        "sources": (
            "modules/application/ports/runtime/python-runtime.port.ts",
            "modules/application/ports/model/model-download-completion.port.ts",
            "modules/adapters/runtime/python/client/modelDownloadManifest.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/client/modelSourceRecipient.ts",
            "modules/adapters/runtime/python/client/modelSourceTaskSession.ts",
            "modules/adapters/runtime/python/client/modelSourceAcquisition.ts",
            "modules/application/ports/model/approved-model-source-download.port.ts",
            "modules/adapters/runtime/python/client/modelSourceIdentity.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tasks/local_text_generation.py",
            "modules/adapters/runtime/python/worker/tasks/model_download_manifest.py",
            "modules/adapters/runtime/python/worker/tests/test_model_download_manifest.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_transport.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_transport.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_staging.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_staging.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_handoff.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_handoff.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_task.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_task.py",
            "modules/adapters/runtime/python/worker/tasks/model_source_identity.py",
            "modules/adapters/runtime/python/worker/tests/test_model_source_identity.py",
            "modules/adapters/runtime/python/worker/tests/model_source_identity_fixture.py",
            "modules/adapters/runtime/python/worker/tests/test_task_lifecycle.py",
            "modules/adapters/runtime/python/worker/tests/test_worker_app.py",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "command": ("-m", "unittest", "-v",
            "modules.adapters.runtime.python.worker.tests.test_model_download_manifest.ModelDownloadManifestTests",
            "modules.adapters.runtime.python.worker.tests.test_model_source_transport.ModelSourceTransportTests",
            "modules.adapters.runtime.python.worker.tests.test_model_source_staging.ModelSourceStagingTests",
            "modules.adapters.runtime.python.worker.tests.test_model_source_handoff.ModelSourceHandoffTests",
            "modules.adapters.runtime.python.worker.tests.test_model_source_task.ModelSourceTaskTests",
            "modules.adapters.runtime.python.worker.tests.test_model_source_identity.ModelSourceIdentityTests",
            "modules.adapters.runtime.python.worker.tests.test_task_lifecycle.TaskLifecycleTests",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_unload_fences_new_admission_and_releases_after_confirmed_completion",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_unload_failure_retains_safe_pending_response_and_releases_admission_fence",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_queued_and_running_tasks_block_unload_before_model_graph_changes",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_model_download_success_emits_lifecycle_logs",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_model_download_failure_returns_structured_json_response",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_model_download_interruption_returns_safe_retryable_response",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_async_model_download_task_returns_download_result",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_async_model_download_task_updates_progress",
            "modules.adapters.runtime.python.worker.tests.test_worker_app.WorkerAppTests.test_async_model_download_failure_preserves_retryable_safe_error"),
    },
    "headless-training-execution-unit": {
        "automatic_sources": (
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
        ),
        "automatic_required_files": (
            "modules/hosts/shared/composition/headlessModelTrainingExecution.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/application/use-cases/model/train-model.use-case.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
            "modules/application/use-cases/model/headless-model-training-dataset.use-case.ts",
            "modules/application/use-cases/model/headless-model-training-model.use-case.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
        ),
        "sources": (
            "modules/hosts/shared/composition/headlessModelTrainingExecution.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/hosts/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts"),
    },
    "headless-training-execution-types": {
        "companion_to": "headless-training-execution-unit",
        "sources": (
            "modules/hosts/shared/composition/headlessModelTrainingExecution.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/hosts/shared/composition/headlessModelTrainingExecution.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts"),
    },
    "headless-training-step-unit": {
        "automatic_sources": (
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
        ),
        "automatic_required_files": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
        ),
        "sources": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
            "modules/adapters/persistence/system-builder/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts"),
    },
    "headless-training-step-types": {
        "companion_to": "headless-training-step-unit",
        "sources": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2021",
            "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts"),
    },
    "headless-training-task-ledger-unit": {
        "automatic_sources": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts",
        ),
        "automatic_required_files": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
        ),
        "sources": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--test-reporter=tap", "--",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts"),
    },
    "headless-training-task-ledger-types": {
        "companion_to": "headless-training-task-ledger-unit",
        "sources": (
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck",
            "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop",
            "--jsx", "react-jsx", "--lib", "ES2021,DOM",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts"),
    },
    "headless-model-metadata-owner-unit": {
        "automatic_required_files": (
            "modules/contracts/headless/headless-model-training-build-plan.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/hosts/shared/composition/headlessModelTrainingReview.ts",
            "modules/contracts/headless/headless-system-management.ts",
            "modules/contracts/headless/desktop-headless-plan-approval.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
        ),
        "automatic_sources": (
            "modules/hosts/shared/composition/headlessModelDownloadExecution.ts",
            "modules/hosts/shared/composition/headlessModelDownloadTasks.ts",
            "modules/contracts/headless/headless-model-task.ts",
            "modules/hosts/shared/composition/headlessModelDownloadReview.ts",
            "modules/hosts/shared/composition/headlessModelReferenceSave.ts",
            "modules/contracts/headless/headless-model-training-inputs.ts",
            "modules/application/use-cases/model/headless-model-training-inputs.use-case.ts",
            "modules/contracts/headless/headless-model-training-plan.ts",
            "modules/contracts/headless/headless-model-training-build-plan.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/hosts/shared/composition/headlessModelTrainingReview.ts",
            "modules/application/use-cases/model/headless-model-training-plan.use-case.ts",
            "modules/application/use-cases/model/headless-model-training-dataset.use-case.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-host-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-reference-save.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-inputs.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-inputs.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-dataset.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/headlessModelDownloadReviewBindings.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-download-review.unit.test.ts",
            "modules/contracts/headless/headless-model-download-plan.ts",
            "modules/contracts/headless/tests/headless-model-download-plan.unit.test.ts",
            "modules/application/use-cases/model/headless-model-download-preview.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-download-preview.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessModelDownloadApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
            "modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-hosts.unit.test.ts",
            "modules/adapters/runtime/python/client/modelDownloadManifest.ts",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/client/modelSourceRecipient.ts",
            "modules/adapters/runtime/python/client/modelSourceTaskSession.ts",
            "modules/adapters/runtime/python/client/modelSourceAcquisition.ts",
            "modules/application/ports/model/approved-model-source-download.port.ts",
            "modules/adapters/runtime/python/client/modelSourceIdentity.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/model_source_identity_fixture.py",
            "modules/contracts/headless/headless-model-source-preview.ts",
            "modules/contracts/headless/tests/headless-model-source-preview.unit.test.ts",
            "modules/application/use-cases/model/headless-model-source-preview.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-source-preview.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelSourcePreview.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-preview.unit.test.ts",
            "modules/contracts/model/model-download-source.ts",
            "modules/contracts/model/tests/model-download-source.unit.test.ts",
            "modules/adapters/model/huggingface/createHuggingFaceModelSourceInspector.ts",
            "modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts",
            "modules/contracts/headless/headless-model-metadata.ts",
            "modules/contracts/headless/tests/headless-model-metadata.unit.test.ts",
            "modules/application/use-cases/model/headless-model-metadata.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-metadata.unit.test.ts",
            "modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts",
            "modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
            "modules/adapters/persistence/model/tests/model-registry-pagination.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelMetadata.ts",
            "modules/hosts/shared/composition/headlessReadCurrent.ts",
            "modules/hosts/shared/composition/tests/headless-model-metadata.unit.test.ts",
            "modules/application/use-cases/model/download-model.use-case.ts",
            "modules/application/use-cases/model/model-download-tasks.use-case.ts",
            "modules/adapters/runtime/python/worker/tests/test_model_download_revision.py",
        ),
        "sources": (
            "modules/hosts/server/composition/composeManagedHeadlessPlanApprovals.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanReview.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanReview.ts",
            "modules/hosts/shared/composition/headlessModelDownloadExecution.ts",
            "modules/hosts/shared/composition/headlessModelDownloadTasks.ts",
            "modules/contracts/headless/headless-model-task.ts",
            "modules/hosts/shared/composition/headlessModelDownloadReview.ts",
            "modules/hosts/shared/composition/headlessModelReferenceSave.ts",
            "modules/contracts/headless/headless-model-training-inputs.ts",
            "modules/application/use-cases/model/headless-model-training-inputs.use-case.ts",
            "modules/contracts/headless/headless-model-training-plan.ts",
            "modules/contracts/headless/headless-model-training-build-plan.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/hosts/shared/composition/headlessModelTrainingReview.ts",
            "modules/application/use-cases/model/headless-model-training-plan.use-case.ts",
            "modules/application/use-cases/model/headless-model-training-dataset.use-case.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-host-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-reference-save.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-inputs.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-inputs.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-dataset.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/hosts/README.md",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/headlessModelDownloadReviewBindings.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-download-review.unit.test.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
            "modules/adapters/persistence/system-builder/README.md",
            "modules/contracts/headless/headless-model-download-plan.ts",
            "modules/contracts/headless/tests/headless-model-download-plan.unit.test.ts",
            "modules/application/use-cases/model/headless-model-download-preview.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-download-preview.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessModelDownloadApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/README.md",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-hosts.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopRuntimeTaskFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopModelFeature.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/adapters/runtime/python/client/modelDownloadManifest.ts",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/client/modelSourceRecipient.ts",
            "modules/adapters/runtime/python/client/modelSourceTaskSession.ts",
            "modules/adapters/runtime/python/client/modelSourceAcquisition.ts",
            "modules/application/ports/model/approved-model-source-download.port.ts",
            "modules/adapters/runtime/python/client/modelSourceIdentity.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/model_source_identity_fixture.py",
            "modules/contracts/headless/headless-model-source-preview.ts",
            "modules/contracts/headless/tests/headless-model-source-preview.unit.test.ts",
            "modules/application/use-cases/model/headless-model-source-preview.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-source-preview.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelSourcePreview.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-preview.unit.test.ts",
            "apps/desktop/src/main/index.ts",
            "apps/desktop/src/main/tests/desktop-headless-pairing-ipc.unit.test.ts",
            "modules/contracts/model/model-download-source.ts",
            "modules/contracts/model/index.ts",
            "modules/contracts/model/tests/model-download-source.unit.test.ts",
            "modules/application/ports/model/model-download-source.port.ts",
            "modules/application/ports/model/index.ts",
            "modules/adapters/model/huggingface/createHuggingFaceModelSourceInspector.ts",
            "modules/adapters/model/huggingface/createHuggingFaceModelBrowseDetailsAdapter.ts",
            "modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts",
            "modules/contracts/headless/headless-model-metadata.ts",
            "modules/contracts/headless/tests/headless-model-metadata.unit.test.ts",
            "modules/contracts/headless/index.ts",
            "modules/contracts/README.md",
            "modules/application/use-cases/model/headless-model-metadata.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-metadata.unit.test.ts",
            "modules/application/use-cases/model/index.ts",
            "modules/application/use-cases/README.md",
            "modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts",
            "modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
            "modules/adapters/persistence/model/tests/model-registry-pagination.unit.test.ts",
            "modules/adapters/README.md",
            "modules/contracts/model/model-management-operations.ts",
            "modules/contracts/headless/headless-read-request.ts",
            "modules/contracts/headless/headless-read-result.ts",
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelMetadata.ts",
            "modules/hosts/shared/composition/headlessReadCurrent.ts",
            "modules/hosts/shared/composition/tests/headless-model-metadata.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts",
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-headless-agent-reads.unit.test.ts",
            "modules/hosts/README.md",
            "modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts",
            "modules/application/ports/model/model-download-completion.port.ts",
            "modules/application/ports/runtime/python-runtime.port.ts",
            "modules/application/use-cases/model/download-model.use-case.ts",
            "modules/application/use-cases/model/model-download-tasks.use-case.ts",
            "modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts",
            "modules/contracts/model/model-contracts.unit.test.ts",
            "modules/contracts/model/tests/model-family-invariants.unit.test.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tasks/local_text_generation.py",
            "modules/adapters/runtime/python/worker/tests/test_model_download_revision.py",
            "modules/adapters/runtime/python/README.md",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
        ),
        "command": ("--import", "tsx", "--test", "--test-concurrency=1", "--",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-host-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-reference-save.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-inputs.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-inputs.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-dataset.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-download-review.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-hosts.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-download-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-download-preview.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessModelDownloadApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-source-preview.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-source-preview.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-preview.unit.test.ts",
            "apps/desktop/src/main/tests/desktop-headless-pairing-ipc.unit.test.ts",
            "modules/contracts/model/tests/model-download-source.unit.test.ts",
            "modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts",
            "modules/adapters/model/huggingface/tests/createHuggingFaceModelBrowseDetailsAdapter.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-metadata.unit.test.ts",
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-metadata.unit.test.ts",
            "modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts",
            "modules/application/use-cases/tests/model-browse-details.use-cases.unit.test.ts",
            "modules/application/use-cases/model/tests/list-models.use-case.unit.test.ts",
            "modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
            "modules/adapters/persistence/model/tests/model-registry-pagination.unit.test.ts",
            "modules/contracts/model/model-contracts.unit.test.ts",
            "modules/contracts/model/tests/model-family-invariants.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-metadata.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts"),
    },
    "headless-model-metadata-owner-types": {
        "companion_to": "headless-model-metadata-owner-unit",
        "sources": (
            "modules/hosts/server/composition/composeManagedHeadlessPlanApprovals.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanReview.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanReview.ts",
            "modules/hosts/shared/composition/headlessModelDownloadExecution.ts",
            "modules/hosts/shared/composition/headlessModelDownloadTasks.ts",
            "modules/contracts/headless/headless-model-task.ts",
            "modules/hosts/shared/composition/headlessModelDownloadReview.ts",
            "modules/hosts/shared/composition/headlessModelReferenceSave.ts",
            "modules/contracts/headless/headless-model-training-inputs.ts",
            "modules/application/use-cases/model/headless-model-training-inputs.use-case.ts",
            "modules/contracts/headless/headless-model-training-plan.ts",
            "modules/contracts/headless/headless-model-training-build-plan.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/hosts/shared/composition/headlessModelTrainingReview.ts",
            "modules/application/use-cases/model/headless-model-training-plan.use-case.ts",
            "modules/application/use-cases/model/headless-model-training-dataset.use-case.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-host-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-reference-save.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-inputs.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-inputs.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-dataset.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/hosts/README.md",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/headlessModelDownloadReviewBindings.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-download-review.unit.test.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
            "modules/adapters/persistence/system-builder/README.md",
            "modules/contracts/headless/headless-model-download-plan.ts",
            "modules/contracts/headless/tests/headless-model-download-plan.unit.test.ts",
            "modules/application/use-cases/model/headless-model-download-preview.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-download-preview.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessModelDownloadApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/README.md",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-hosts.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopRuntimeTaskFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopModelFeature.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/adapters/runtime/python/client/modelDownloadManifest.ts",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/client/modelSourceRecipient.ts",
            "modules/adapters/runtime/python/client/modelSourceTaskSession.ts",
            "modules/adapters/runtime/python/client/modelSourceAcquisition.ts",
            "modules/application/ports/model/approved-model-source-download.port.ts",
            "modules/adapters/runtime/python/client/modelSourceIdentity.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/contracts/headless/headless-model-source-preview.ts",
            "modules/contracts/headless/tests/headless-model-source-preview.unit.test.ts",
            "modules/application/use-cases/model/headless-model-source-preview.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-source-preview.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelSourcePreview.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-preview.unit.test.ts",
            "modules/contracts/model/model-download-source.ts",
            "modules/contracts/model/tests/model-download-source.unit.test.ts",
            "modules/application/ports/model/model-download-source.port.ts",
            "modules/adapters/model/huggingface/createHuggingFaceModelSourceInspector.ts",
            "modules/adapters/model/huggingface/createHuggingFaceModelBrowseDetailsAdapter.ts",
            "modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts",
            "modules/contracts/headless/headless-model-metadata.ts",
            "modules/contracts/headless/tests/headless-model-metadata.unit.test.ts",
            "modules/application/use-cases/model/headless-model-metadata.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-metadata.unit.test.ts",
            "modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts",
            "modules/adapters/persistence/model/tests/model-registry-pagination.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelMetadata.ts",
            "modules/hosts/shared/composition/headlessReadCurrent.ts",
            "modules/hosts/shared/composition/tests/headless-model-metadata.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts",
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
            "modules/contracts/model/model-contracts.unit.test.ts",
            "modules/application/ports/model/model-download-completion.port.ts",
            "modules/application/ports/runtime/python-runtime.port.ts",
            "modules/application/use-cases/model/download-model.use-case.ts",
            "modules/application/use-cases/model/model-download-tasks.use-case.ts",
            "modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
        ),
        "command": ("node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck",
            "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--jsx", "react-jsx", "--lib", "ES2021,DOM",
            "modules/hosts/shared/composition/headlessModelDownloadTasks.ts",
            "modules/contracts/headless/headless-model-task.ts",
            "modules/hosts/shared/composition/headlessModelDownloadReview.ts",
            "modules/hosts/shared/composition/headlessModelReferenceSave.ts",
            "modules/contracts/headless/headless-model-training-inputs.ts",
            "modules/application/use-cases/model/headless-model-training-inputs.use-case.ts",
            "modules/contracts/headless/headless-model-training-plan.ts",
            "modules/contracts/headless/headless-model-training-build-plan.ts",
            "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
            "modules/hosts/shared/composition/headlessModelTrainingReview.ts",
            "modules/application/use-cases/model/headless-model-training-plan.use-case.ts",
            "modules/application/use-cases/model/headless-model-training-dataset.use-case.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-download-host-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-reference-save.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-inputs.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-inputs.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-training-dataset.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-model-download-review.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-hosts.unit.test.ts",
            "modules/contracts/headless/tests/headless-model-download-plan.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-download-preview.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessModelDownloadApproval.interaction.ui.test.tsx",
            "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
            "modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-task-session.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-acquisition.unit.test.ts",
            "modules/adapters/runtime/python/tests/model-source-identity-client.unit.test.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/contracts/headless/tests/headless-model-source-preview.unit.test.ts",
            "modules/application/use-cases/model/tests/headless-model-source-preview.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-model-source-preview.unit.test.ts",
            "modules/contracts/model/tests/model-download-source.unit.test.ts",
            "modules/application/ports/model/model-download-source.port.ts",
            "modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts",
            "modules/contracts/headless/headless-model-metadata.ts",
            "modules/contracts/headless/tests/headless-model-metadata.unit.test.ts",
            "modules/application/use-cases/model/headless-model-metadata.use-case.ts",
            "modules/application/use-cases/model/tests/headless-model-metadata.unit.test.ts",
            "modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts",
            "modules/adapters/persistence/model/tests/model-registry-pagination.unit.test.ts",
            "modules/hosts/shared/composition/headlessModelMetadata.ts",
            "modules/hosts/shared/composition/headlessReadCurrent.ts",
            "modules/hosts/shared/composition/tests/headless-model-metadata.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts",
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
            "modules/contracts/model/model-contracts.unit.test.ts",
            "modules/application/ports/model/model-download-completion.port.ts",
            "modules/application/ports/runtime/python-runtime.port.ts",
            "modules/application/use-cases/model/download-model.use-case.ts",
            "modules/application/use-cases/model/model-download-tasks.use-case.ts",
            "modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts"),
    },
    "headless-context-current-evidence": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/scripts/qualification/check_headless_context_evidence.py",
            "docs/operations/headless-context-increment-qualification.json",
        ),
        "sources": (
            "dev-tools/scripts/qualification/check_headless_context_evidence.py",
            "docs/operations/headless-context-increment-qualification.json",
        ),
        "command": ("dev-tools/scripts/qualification/check_headless_context_evidence.py",),
    },
    "headless-context-evidence-unit": {
        "interpreter": "python",
        "automatic_sources": (
            "dev-tools/scripts/qualification/check_headless_context_evidence.py",
            "dev-tools/scripts/qualification/tests/test_headless_context_evidence.py",
        ),
        "sources": (
            "dev-tools/scripts/qualification/check_headless_context_evidence.py",
            "dev-tools/scripts/qualification/tests/test_headless_context_evidence.py",
        ),
        "command": ("-m", "unittest", "-v", "dev-tools/scripts/qualification/tests/test_headless_context_evidence.py"),
    },
    "headless-context-failure-oracles": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-failure-oracles.ts",
            "dev-tools/scripts/qualification/tests/headless-context-failure-oracles.unit.test.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-failure-oracles.ts",
            "dev-tools/scripts/qualification/tests/headless-context-failure-oracles.unit.test.ts",
        ),
        "command": ("--import", "tsx", "--test", "--", "dev-tools/scripts/qualification/tests/headless-context-failure-oracles.unit.test.ts"),
    },
    "headless-context-failure-types": {
        "automatic_sources": (),
        "companion_to": "headless-context-failure-oracles",
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-failure-oracles.ts",
            "dev-tools/scripts/qualification/tests/headless-context-failure-oracles.unit.test.ts",
        ),
        "command": ("node_modules/typescript/lib/tsc.js", "--noEmit", "--pretty", "false", "--strict", "--target", "ES2021", "--module", "CommonJS",
            "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-failure-oracles.ts",
            "dev-tools/scripts/qualification/tests/headless-context-failure-oracles.unit.test.ts"),
    },
    "headless-context-native-cleanup": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/desktop-task-cleanup.ts",
            "dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-lifecycle.mjs",
        ),
        "command": ("dev-tools/helpers/run_vitest_checks.mjs", "--",
            "dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts"),
    },
    "headless-context-native-cleanup-node": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/tests/desktop-owned-cleanup.unit.test.ts",
            "dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/desktop-task-cleanup.ts",
            "dev-tools/scripts/qualification/tests/desktop-owned-cleanup.unit.test.ts",
            "dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts",
        ),
        "command": ("--import", "tsx", "--test", "--",
            "dev-tools/scripts/qualification/tests/desktop-owned-cleanup.unit.test.ts",
            "dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts",
            "dev-tools/scripts/qualification/tests/qualification-report-wiring.unit.test.ts"),
    },
    "headless-context-managed-journey": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/managed-headless-context.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-workflow.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/managed-headless-context.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-workflow.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
            "dev-tools/scripts/qualification/visual-composer/headless-context-fixture.ts",
        ),
        "command": ("--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-context.ts"),
        "timeout": 600,
    },
    "headless-context-managed-fixture": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/tests/managed-headless-context.unit.test.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/tests/managed-headless-context.unit.test.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
        ),
        "command": ("--import", "tsx", "--test", "--", "dev-tools/scripts/qualification/tests/managed-headless-context.unit.test.ts",
            "dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs"),
    },
    "python-runtime-owned-startup": {
        "automatic_sources": (
            "modules/adapters/runtime/python/supervisor/ownedPythonRuntimeProof.ts",
            "modules/adapters/runtime/python/tests/ownedPythonRuntimeProof.unit.test.ts",
            "modules/adapters/runtime/python/tests/ownedPythonRuntimeStartup.unit.test.ts",
        ),
        "sources": (
            "modules/adapters/runtime/python/supervisor/ownedPythonRuntimeProof.ts",
            "modules/adapters/runtime/python/supervisor/createPythonRuntimeSupervisor.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/python/tests/ownedPythonRuntimeProof.unit.test.ts",
            "modules/adapters/runtime/python/tests/ownedPythonRuntimeStartup.unit.test.ts",
        ),
        "command": ("--import", "tsx", "--test", "--",
            "modules/adapters/runtime/python/tests/ownedPythonRuntimeProof.unit.test.ts",
            "modules/adapters/runtime/python/tests/ownedPythonRuntimeStartup.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts"),
    },
    "python-runtime-owned-worker": {
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/main.py",
            "modules/adapters/runtime/python/worker/tests/test_owned_startup.py",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/main.py",
            "modules/adapters/runtime/python/worker/tests/test_main.py",
            "modules/adapters/runtime/python/worker/tests/test_owned_startup.py",
            "modules/adapters/runtime/python/worker/README.md",
        ),
        "interpreter": "python",
        "command": ("-B", "-m", "unittest",
            "modules.adapters.runtime.python.worker.tests.test_owned_startup",
            "modules.adapters.runtime.python.worker.tests.test_main",
            "modules.adapters.runtime.python.worker.tests.test_worker_authentication"),
    },
    "headless-context-default-port": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/headless-context-default-port.mjs",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/headless-context-default-port.mjs",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-journey.ts",
        ),
        "command": ("--preserve-symlinks", "--preserve-symlinks-main", "dev-tools/scripts/qualification/visual-composer/headless-context-default-port.mjs"),
        "timeout": 720,
    },
    "python-runtime-port-node": {
        "automatic_sources": (
            "modules/adapters/runtime/python/network/selectPythonRuntimeEndpoint.ts",
            "modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.socket.unit.test.ts",
            "dev-tools/scripts/qualification/tests/headless-context-default-port.unit.test.mjs",
        ),
        "sources": (
            "modules/adapters/runtime/python/network/selectPythonRuntimeEndpoint.ts",
            "modules/adapters/runtime/python/index.ts",
            "modules/hosts/desktop/composition/composeDesktopPythonRuntimeFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/desktop/composition/tests/desktopPythonStartupDiagnostics.unit.test.ts",
            "modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.socket.unit.test.ts",
            "dev-tools/scripts/qualification/tests/headless-context-default-port.unit.test.mjs",
        ),
        "command": ("--import", "tsx", "--test", "--",
            "modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.socket.unit.test.ts",
            "modules/adapters/runtime/python/tests/pythonRuntimeEndpoint.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktopPythonRuntimeHelpers.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktopPythonStartupDiagnostics.unit.test.ts",
            "dev-tools/scripts/qualification/tests/headless-context-default-port.unit.test.mjs"),
    },
    "python-runtime-port-composition": {
        "automatic_sources": (
            "modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.unit.test.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopPythonRuntimeFeature.unit.test.ts",
        ),
        "sources": (
            "modules/adapters/runtime/python/network/selectPythonRuntimeEndpoint.ts",
            "modules/adapters/runtime/python/index.ts",
            "modules/hosts/desktop/composition/composeDesktopPythonRuntimeFeature.ts",
            "modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.unit.test.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopPythonRuntimeFeature.unit.test.ts",
        ),
        "command": ("dev-tools/helpers/run_vitest_checks.mjs", "--",
            "modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.unit.test.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopPythonRuntimeFeature.unit.test.ts"),
    },
    "headless-context-desktop-journey": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-journey.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-workflow.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-journey.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-context-workflow.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts",
            # The former standalone registration is removed by this same move.
            "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless-context.e2e.spec.ts",
            "dev-tools/scripts/qualification/visual-composer/headless-context-fixture.ts",
            "dev-tools/scripts/qualification/visual-composer/headless-context-model-seed.ts",
        ),
        "command": ("--preserve-symlinks", "--preserve-symlinks-main", "node_modules/@playwright/test/cli.js", "test",
            "--config=dev-tools/config/playwright.visual-composer.config.ts", "--project=packaged-desktop", "--workers=1",
            "--grep", "approves saves queries rebuilds and reveals real Context through MCP", "packaged-desktop-headless.e2e.spec.ts"),
        "timeout": 720,
    },
    "headless-context-desktop-fixture": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/headless-context-fixture.ts",
            "dev-tools/scripts/qualification/visual-composer/headless-context-model-seed.ts",
            "dev-tools/scripts/qualification/tests/headless-context-fixture.unit.test.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/headless-context-fixture.ts",
            "dev-tools/scripts/qualification/visual-composer/headless-context-model-seed.ts",
            "dev-tools/scripts/qualification/tests/headless-context-fixture.unit.test.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/headless-desktop-fixture.ts",
        ),
        "command": ("--import", "tsx", "--test", "--", "dev-tools/scripts/qualification/tests/headless-context-fixture.unit.test.ts"),
    },
    "headless-context-model-reference": {
        "automatic_sources": (
            "modules/application/ports/context-management/approved-context-embedding-model.port.ts",
            "modules/application/use-cases/context-management/approved-context-embedding-model.ts",
            "modules/application/use-cases/context-management/resolve-approved-context-embedding-model.use-case.ts",
            "modules/application/use-cases/context-management/tests/approved-context-model-reference.unit.test.ts",
            "modules/adapters/model/local/createLocalContextEmbeddingModelFilesAdapter.ts",
            "modules/adapters/model/local/tests/context-embedding-model-files.unit.test.ts",
        ),
        "sources": (
            "modules/application/ports/context-management/approved-context-embedding-model.port.ts",
            "modules/application/ports/context-management/approved-context-generation-admission.port.ts",
            "modules/application/ports/context-management/index.ts",
            "modules/application/ports/context-management/README.md",
            "modules/application/use-cases/context-management/approved-context-embedding-model.ts",
            "modules/application/use-cases/context-management/resolve-approved-context-embedding-model.use-case.ts",
            "modules/application/use-cases/context-management/approved-context-generation-admission.ts",
            "modules/application/use-cases/context-management/context-generation.use-case.ts",
            "modules/application/use-cases/context-management/headless-context-preview.use-case.ts",
            "modules/application/use-cases/context-management/index.ts",
            "modules/application/use-cases/context-management/README.md",
            "modules/application/use-cases/context-management/tests/approved-context-model-reference.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/contracts/runtime/context-generation.ts",
            "modules/adapters/model/local/createLocalContextEmbeddingModelFilesAdapter.ts",
            "modules/adapters/model/local/index.ts",
            "modules/adapters/model/local/README.md",
            "modules/adapters/model/local/tests/context-embedding-model-files.unit.test.ts",
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tasks/context_generation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_generation.py",
            "modules/adapters/runtime/python/worker/README.md",
            "modules/hosts/desktop/composition/composeDesktopContextManagementFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopModelFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/desktop/composition/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": ("--import", "tsx", "--test", "--",
            "modules/application/use-cases/context-management/tests/approved-context-model-reference.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-preview.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-generation.use-case.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-browser.use-cases.unit.test.ts",
            "modules/adapters/model/local/tests/context-embedding-model-files.unit.test.ts",
            "modules/adapters/model/local/tests/createLocalModelFileListerAdapter.unit.test.ts"),
    },
    "headless-context-pack-contract": {
        "automatic_sources": (
            "modules/contracts/headless/headless-context-plan.ts",
            "modules/contracts/headless/headless-context-task.ts",
            "modules/contracts/headless/tests/headless-context-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-context-task.unit.test.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-context-plan.ts",
            "modules/contracts/headless/headless-context-task.ts",
            "modules/contracts/headless/headless-system-management.ts",
            "modules/contracts/headless/headless-plan-review-wire.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/contracts/headless/desktop-headless-plan-approval.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/contracts/headless/index.ts",
            "modules/contracts/headless/headless-read-request.ts",
            "modules/contracts/headless/headless-read-result.ts",
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-result-plan.unit.test.ts",
            "modules/application/ports/context-management/approved-context-generation-admission.port.ts",
            "modules/application/use-cases/context-management/approved-context-generation-admission.ts",
            "modules/application/use-cases/context-management/context-generation.use-case.ts",
            "modules/application/use-cases/context-management/headless-context-task.use-case.ts",
            "modules/application/use-cases/context-management/index.ts",
            "modules/application/use-cases/context-management/tests/headless-context-task.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/README.md",
            "modules/adapters/runtime/python/worker/tasks/context_generation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_generation.py",
            "modules/adapters/runtime/python/worker/README.md",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-plan-task-store.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextExecution.ts",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx",
            "modules/contracts/headless/tests/headless-context-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-context-task.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-context-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-context-task.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-result-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-task.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-plan-task-store.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx",
        ),
    },
    "headless-context-pack-browser": {
        "automatic_sources": (),
        "companion_to": "headless-context-pack-contract",
        "sources": (
            "apps/thin-client/src/features/workspace/api/managedBrowserConsentClient.ts",
            "apps/thin-client/src/features/workspace/api/tests/managed-browser-plan-approval.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
        ),
        "command": ("dev-tools/helpers/run_vitest_checks.mjs", "--",
            "apps/thin-client/src/features/workspace/api/tests/managed-browser-plan-approval.unit.test.ts"),
    },
    "headless-context-existing-runtime": {
        # Registry-only edits retain the primary ownership profile's coverage
        # contract, including fallback when its declared source map is damaged.
        "automatic_sources": (
            "modules/application/ports/runtime/runtime-task-registry.port.ts",
            "modules/application/ports/runtime/python-runtime.port.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/createRuntimeTaskRegistryRouter.ts",
            "modules/adapters/runtime/tests/createRuntimeTaskRegistryRouter.unit.test.ts",
            "modules/adapters/runtime/python/checkPythonRuntimeInstallation.ts",
            "modules/adapters/runtime/python/tests/checkPythonRuntimeInstallation.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/createPythonRuntimeSupervisor.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
        ),
        "automatic_required_files": (
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
            "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py",
            "modules/adapters/runtime/python/tests/checkPythonRuntimeInstallation.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/tests/createRuntimeTaskRegistryRouter.unit.test.ts",
        ),
        "sources": (
            "modules/application/ports/runtime/runtime-task-registry.port.ts",
            "modules/application/ports/runtime/python-runtime.port.ts",
            "modules/adapters/runtime/python/createPythonRuntimePort.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/python/index.ts",
            "modules/application/ports/runtime/README.md",
            "modules/adapters/runtime/createRuntimeTaskRegistryRouter.ts",
            "modules/adapters/runtime/tests/createRuntimeTaskRegistryRouter.unit.test.ts",
            "modules/adapters/runtime/python/checkPythonRuntimeInstallation.ts",
            "modules/adapters/runtime/python/tests/checkPythonRuntimeInstallation.unit.test.ts",
            "modules/adapters/runtime/python/createPythonRuntimeTaskRegistryAdapter.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/createPythonRuntimeSupervisor.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts",
            "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts",
            "modules/adapters/runtime/python/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/adapters/runtime/python/tests/checkPythonRuntimeInstallation.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts",
            "modules/adapters/runtime/python/tests/createPythonRuntimeAdapterFoundation.unit.test.ts",
            "modules/adapters/runtime/tests/createRuntimeTaskRegistryRouter.unit.test.ts",
        ),
    },
    "headless-context-installed-host": {
        # Pair exact host wiring with the restrictive runtime change. Generic
        # root tests alone must not mask unrelated primary-profile fallback.
        "automatic_sources": (),
        "companion_to": "headless-context-existing-runtime",
        "sources": (
            "modules/hosts/desktop/composition/composeDesktopPythonRuntimeFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopRuntimeTaskFeature.ts",
            "modules/hosts/desktop/composition/desktopPythonRuntimeHelpers.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopHost.unit.test.ts",
            "modules/hosts/desktop/composition/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/tests/composeServerHost.unit.test.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test",
            "--test-name-pattern", "installed-only|prepares Context dependencies|prepares text-training dependencies|starts the lazy Python runtime",
            "--",
            "modules/hosts/desktop/composition/tests/composeDesktopHost.unit.test.ts",
            "modules/hosts/server/composition/tests/composeServerHost.unit.test.ts",
        ),
    },
    "headless-context-rebuild-inputs": {
        "automatic_sources": (
            "modules/contracts/headless/headless-context-query-plan.ts",
            "modules/contracts/headless/tests/headless-context-query-contract.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextQueryExecution.ts",
            "modules/hosts/shared/composition/tests/headless-context-query-execution.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-task.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-task.unit.test.ts",
            "modules/contracts/headless/headless-context-query-preview.ts",
            "modules/contracts/headless/tests/headless-context-query-preview.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-query-preview.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-query-preview.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextQueryPreview.ts",
            "modules/contracts/headless/headless-context-rebuild.ts",
            "modules/contracts/headless/tests/headless-context-rebuild.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-rebuild.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-rebuild.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextRebuild.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-context-query-plan.ts",
            "modules/contracts/headless/tests/headless-context-query-contract.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextQueryExecution.ts",
            "modules/hosts/shared/composition/tests/headless-context-query-execution.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-task.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-task.unit.test.ts",
            "modules/contracts/headless/headless-context-query-preview.ts",
            "modules/contracts/headless/tests/headless-context-query-preview.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-query-preview.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-query-preview.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextQueryPreview.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-headless-agent-reads.unit.test.ts",
            "modules/contracts/headless/headless-context-rebuild.ts",
            "modules/contracts/headless/tests/headless-context-rebuild.unit.test.ts",
            "modules/contracts/headless/headless-read-request.ts",
            "modules/contracts/headless/headless-read-result.ts",
            "modules/contracts/headless/index.ts",
            "modules/contracts/README.md",
            "modules/application/use-cases/context-management/headless-context-rebuild.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-rebuild.unit.test.ts",
            "modules/application/use-cases/context-management/index.ts",
            "modules/application/use-cases/context-management/README.md",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/system-builder/README.md",
            "modules/hosts/shared/composition/headlessContextRebuild.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/desktop/composition/README.md",
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/README.md",
            "modules/hosts/server/composition/README.md",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts",
            "dev-tools/scripts/agent-support/tests/headless-plan-skill.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-context-query-contract.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-query-execution.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-task.unit.test.ts",
            "modules/contracts/headless/tests/headless-context-query-preview.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-query-preview.unit.test.ts",
            "modules/contracts/headless/tests/headless-context-rebuild.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-rebuild.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-plan-task-store.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-headless-agent-reads.unit.test.ts",
            "dev-tools/scripts/agent-support/tests/headless-plan-skill.unit.test.ts",
        ),
    },
    "headless-context-installed-query-worker": {
        "interpreter": "python",
        "automatic_sources": (
            "modules/adapters/runtime/python/worker/tasks/context_artifact_operation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_artifact_operation.py",
            "dev-tools/scripts/qualification/run_trained_context_qualification.py",
            "dev-tools/scripts/qualification/tests/test_trained_context_qualification.py",
            "dev-tools/scripts/qualification/trained_context_fixture.py",
            "docs/operations/headless-context-query-runtime-evidence.json",
        ),
        "sources": (
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tasks/context_artifact_operation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_artifact_operation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_generation.py",
            "modules/adapters/runtime/python/worker/README.md",
            "dev-tools/scripts/qualification/run_trained_context_qualification.py",
            "dev-tools/scripts/qualification/tests/test_trained_context_qualification.py",
            "dev-tools/scripts/qualification/trained_context_fixture.py",
            "docs/operations/headless-context-query-runtime-evidence.json",
        ),
        "command": ("-u", "-m", "unittest", "-v",
            "modules.adapters.runtime.python.worker.tests.test_context_artifact_operation",
            "modules.adapters.runtime.python.worker.tests.test_context_generation",
            "dev-tools/scripts/qualification/tests/test_trained_context_qualification.py"),
    },
    "headless-context-artifact-lifecycle": {
        "automatic_sources": (
            "modules/application/use-cases/context-management/approved-context-query-owner.ts",
            "modules/application/use-cases/context-management/context-browser.use-cases.ts",
            "modules/application/use-cases/context-management/tests/context-approved-query.unit.test.ts",
            "modules/application/ports/context-management/approved-context-query-owner.port.ts",
            "modules/adapters/runtime/python/context-management/createPythonContextArtifactRuntimeAdapter.ts",
            "modules/adapters/runtime/python/context-management/tests/createPythonContextArtifactRuntimeAdapter.unit.test.ts",
        ),
        "sources": (
            "modules/application/use-cases/context-management/approved-context-query-owner.ts",
            "modules/application/use-cases/context-management/context-browser.use-cases.ts",
            "modules/application/use-cases/context-management/tests/context-approved-query.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-browser.use-cases.unit.test.ts",
            "modules/application/use-cases/context-management/README.md",
            "modules/application/ports/context-management/approved-context-query-owner.port.ts",
            "modules/application/ports/context-management/index.ts",
            "modules/application/ports/context-management/context-artifact-runtime.port.ts",
            "modules/application/ports/context-management/README.md",
            "modules/contracts/runtime/context-retrieval.ts",
            "modules/contracts/runtime/README.md",
            "modules/adapters/runtime/python/context-management/createPythonContextArtifactRuntimeAdapter.ts",
            "modules/adapters/runtime/python/context-management/tests/createPythonContextArtifactRuntimeAdapter.unit.test.ts",
            "modules/adapters/runtime/python/README.md",
            "modules/hosts/desktop/composition/composeDesktopContextManagementFeature.ts",
            "modules/hosts/desktop/composition/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/application/use-cases/context-management/tests/context-approved-query.unit.test.ts",
            "modules/adapters/runtime/python/context-management/tests/createPythonContextArtifactRuntimeAdapter.unit.test.ts",
            "modules/application/services/runtime/tests/owned-task-reconciler.service.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-browser.use-cases.unit.test.ts",
        ),
    },
    "headless-context-result-bytes": {
        "automatic_sources": (
            "modules/application/ports/context-management/context-result-byte-storage.port.ts",
            "modules/adapters/storage/filesystem/artifact-store/verifiedPublicationStream.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemContextResultByteStorageAdapter.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemIngestionFileByteStorageAdapter.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemContextResultOutputSourceAdapter.ts",
        ),
        "sources": (
            "modules/application/ports/context-management/context-result-byte-storage.port.ts",
            "modules/application/ports/context-management/README.md",
            "modules/adapters/storage/filesystem/artifact-store/verifiedPublicationStream.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemContextResultOutputSourceAdapter.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemContextResultByteStorageAdapter.ts",
            "modules/adapters/storage/filesystem/artifact-store/createFilesystemIngestionFileByteStorageAdapter.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/ingestion-file-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/index.ts",
            "modules/adapters/storage/filesystem/artifact-store/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/ingestion-file-byte-storage.integration.test.ts",
        ),
    },
    "headless-context-result-save-contract": {
        "automatic_sources": (
            "modules/contracts/headless/headless-context-result-plan.ts",
            "modules/contracts/headless/tests/headless-context-result-plan.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-saved.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-saved.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-context-result-plan.ts",
            "modules/contracts/headless/tests/headless-context-result-plan.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-saved.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-saved.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-context-result-plan.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-saved.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
        ),
    },
    "headless-context-result-save-bootstrap": {
        "automatic_sources": (
            "modules/hosts/shared/composition/tests/headless-context-result-bootstrap.unit.test.ts",
        ),
        "sources": (
            "apps/server/src/createServer.ts",
            "modules/hosts/shared/composition/tests/headless-context-result-bootstrap.unit.test.ts",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "modules/hosts/shared/composition/tests/headless-context-result-bootstrap.unit.test.ts",
        ),
    },
    "headless-context-result-save-owner": {
        "automatic_sources": (
            "modules/application/ports/context-management/context-result-save-admission.port.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessContextResultStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-result-store.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextResults.ts",
        ),
        "sources": (
            "modules/application/ports/context-management/context-result-save-admission.port.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessContextResultStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-result-store.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextResults.ts",
            "modules/hosts/desktop/composition/composeDesktopArtifactFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopContextManagementFeature.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/desktop/composition/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-context-result-store.unit.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts",
        ),
    },
    "headless-context-owned-start": {
        "automatic_sources": (
            "modules/application/use-cases/context-management/context-generation.use-case.ts",
            "modules/application/use-cases/context-management/approved-context-generation-admission.ts",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/application/ports/context-management/approved-context-generation-admission.port.ts",
            "modules/application/ports/context-management/index.ts",
        ),
        "sources": (
            "modules/application/use-cases/context-management/context-generation.use-case.ts",
            "modules/application/use-cases/context-management/approved-context-generation-admission.ts",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-generation.use-case.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-browser.use-cases.unit.test.ts",
            "modules/application/use-cases/context-management/README.md",
            "modules/application/ports/context-management/approved-context-generation-admission.port.ts",
            "modules/application/ports/context-management/index.ts",
            "modules/application/ports/context-management/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/application/use-cases/context-management/tests/context-approved-start.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-generation.use-case.unit.test.ts",
            "modules/application/use-cases/context-management/tests/context-browser.use-cases.unit.test.ts",
            "modules/application/services/runtime/tests/owned-task-reconciler.service.unit.test.ts",
            "modules/application/services/runtime/tests/task-power-lifecycle.service.unit.test.ts",
        ),
    },
    "headless-context-input-preview": {
        "automatic_sources": (
            "modules/contracts/headless/headless-context-preview.ts",
            "modules/contracts/headless/tests/headless-context-preview.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-preview.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-preview.unit.test.ts",
            "modules/application/ports/model/model-registry.port.ts",
            "modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts",
            "modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextPreview.ts",
            "modules/hosts/shared/composition/tests/headless-context-preview.unit.test.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-context-preview.ts",
            "modules/contracts/headless/tests/headless-context-preview.unit.test.ts",
            "modules/contracts/headless/headless-read-request.ts",
            "modules/contracts/headless/headless-read-result.ts",
            "modules/contracts/headless/index.ts",
            "modules/application/use-cases/context-management/headless-context-preview.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-preview.unit.test.ts",
            "modules/application/ports/model/model-registry.port.ts",
            "modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts",
            "modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextPreview.ts",
            "modules/hosts/shared/composition/tests/headless-context-preview.unit.test.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-context-preview.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-preview.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-preview.unit.test.ts",
            "modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
        ),
    },
    "managed-headless-browser-live-fixture": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/headless-dataset-runtime-worker.py",
            "dev-tools/scripts/qualification/tests/test_headless_dataset_runtime_worker.py",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-consent.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/headless-dataset-runtime-worker.py",
            "dev-tools/scripts/qualification/tests/test_headless_dataset_runtime_worker.py",
            "dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-lifecycle.mjs",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-consent.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-server-entry.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs",
            "modules/adapters/transport/api-express/headless/tests/managed-browser-consent-route.integration.test.ts",
        ),
    },
    "managed-headless-live-fixture": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/managed-headless-agent.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/managed-headless-agent.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-plan-staging.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
            "apps/server/src/createServer.ts",
            "apps/server/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/composeManagedSavedState.ts",
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
            "modules/adapters/transport/headless-mcp/createHeadlessMcpReadForwarder.mts",
            "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
        ),
    },
    "managed-headless-browser-documents": {
        "automatic_sources": (
            "modules/hosts/server/composition/createManagedHeadlessBrowserDocuments.ts",
        ),
        "sources": (
            "modules/hosts/server/composition/createManagedHeadlessBrowserDocuments.ts",
            "modules/hosts/server/composition/tests/managed-headless-browser-documents.unit.test.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/composition/tests/managed-headless-browser-documents.unit.test.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
    },
    "managed-headless-browser-consent": {
        "automatic_sources": (
            "modules/hosts/server/composition/composeManagedBrowserConsent.ts",
        ),
        "sources": (
            "modules/application/services/ui-control/ui-control-authority.service.ts",
            "modules/hosts/server/composition/composeManagedBrowserConsent.ts",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
    },
    "managed-headless-browser-consent-http": {
        "automatic_sources": (
            "modules/adapters/transport/api-express/headless/registerManagedBrowserConsentRoute.ts",
        ),
        "sources": (
            "modules/contracts/headless/managed-browser-consent.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/contracts/headless/managed-browser-presentation.ts",
            "modules/contracts/headless/index.ts",
            "modules/adapters/transport/api-express/headless/registerManagedBrowserConsentRoute.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-browser-consent-route.integration.test.ts",
            "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts",
            "modules/adapters/transport/api-express/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/composeManagedBrowserConsent.ts",
            "apps/server/src/createServer.ts",
            "apps/server/README.md",
            "modules/adapters/transport/api-express/security/createExpressOrganizationAuthorizationMiddleware.ts",
            "modules/adapters/transport/api-express/security/createExpressOrganizationAuthorizationMiddleware.unit.test.ts",
            "modules/hosts/server/security/createManagedSavedStateAuthorizationAudit.ts",
            "modules/hosts/server/security/tests/managed-saved-state-authorization-audit.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/adapters/transport/api-express/headless/tests/managed-browser-consent-route.integration.test.ts",
            "modules/adapters/transport/api-express/security/security-enforcement.unit.test.ts",
            "apps/server/src/tests/server-postgres-selection.unit.test.ts",
            "modules/adapters/transport/api-express/security/createExpressOrganizationAuthorizationMiddleware.unit.test.ts",
            "modules/hosts/server/security/tests/managed-saved-state-authorization-audit.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
        ),
    },
    "managed-headless-browser-consent-ui": {
        "automatic_sources": (
            "apps/thin-client/src/features/workspace/hooks/useManagedBrowserTakeover.ts",
        ),
        "sources": (
            "apps/thin-client/src/App.tsx",
            "apps/thin-client/src/pages/SettingsPage.tsx",
            "apps/thin-client/src/components/layout/AppShell.tsx",
            "apps/thin-client/src/pages/SystemBuilderPage.tsx",
            "apps/thin-client/src/tests/app-shell-visible-page.ui.test.tsx",
            "apps/thin-client/src/features/workspace/hooks/useActiveWorkspace.tsx",
            "apps/thin-client/src/features/workspace/hooks/useManagedBrowserTakeover.ts",
            "apps/thin-client/src/features/workspace/hooks/tests/managed-browser-takeover.ui.test.tsx",
            "apps/thin-client/src/features/workspace/api/managedBrowserConsentClient.ts",
            "apps/thin-client/src/features/workspace/api/tests/managed-browser-plan-approval.unit.test.ts",
            "apps/thin-client/src/pages/ArtifactsPage.tsx",
            "apps/thin-client/src/features/artifact-upload/components/ArtifactIngestionFeature.tsx",
            "apps/thin-client/README.md",
            "apps/desktop/src/renderer/App.tsx",
            "apps/desktop/src/renderer/features/settings/components/HeadlessPlanApprovals.tsx",
            "apps/desktop/src/renderer/features/settings/tests/recent-headless-chat-tasks.ui.test.tsx",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/shared/takeover/PresentedWindowResource.tsx",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "apps/thin-client/src/features/workspace/hooks/tests/managed-browser-takeover.ui.test.tsx",
            "apps/thin-client/src/features/workspace/tests/workspace-gate.unit.test.tsx",
            "apps/thin-client/src/tests/app-shell-visible-page.ui.test.tsx",
            "apps/desktop/src/renderer/tests/desktop-window-takeover.ui.test.tsx",
            "apps/thin-client/src/features/workspace/api/tests/managed-browser-plan-approval.unit.test.ts",
            "apps/desktop/src/renderer/features/settings/tests/recent-headless-chat-tasks.ui.test.tsx",
        ),
    },
    "managed-headless-agent-window": {
        "automatic_sources": (
            "modules/contracts/headless/managed-headless-window.ts",
        ),
        "sources": (
            "modules/contracts/headless/managed-headless-window.ts",
            "modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts",
            "modules/adapters/transport/headless-mcp/createHeadlessMcpReadForwarder.mts",
            "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts",
            "modules/adapters/transport/headless-mcp/README.md",
            "apps/server/src/createServer.ts",
            "apps/server/README.md",
            "modules/hosts/server/composition/composeManagedBrowserConsent.ts",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "modules/adapters/transport/headless-mcp/tests/headless-mcp-stdio.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "modules/adapters/transport/headless-mcp/tests/headless-mcp-stdio.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
        ),
    },
    "managed-headless-browser-presentation": {
        "automatic_sources": (
            "modules/hosts/server/composition/createManagedBrowserPresentation.ts",
        ),
        "sources": (
            "modules/hosts/server/composition/createManagedBrowserPresentation.ts",
            "modules/hosts/server/composition/tests/managed-browser-presentation.unit.test.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/composition/tests/managed-browser-presentation.unit.test.ts",
            "modules/application/services/ui-control/tests/ui-control-delivery.unit.test.ts",
        ),
    },
    "managed-headless-browser-presentation-host": {
        "automatic_sources": (
            "modules/hosts/server/composition/composeManagedBrowserPresentationResources.ts",
        ),
        "sources": (
            "modules/hosts/server/composition/composeManagedBrowserPresentationResources.ts",
            "modules/hosts/server/composition/composeManagedBrowserConsent.ts",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "apps/server/src/tests/server-postgres-selection.unit.test.ts",
        ),
    },
    "managed-headless-agent-server": {
        "automatic_sources": (
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
        ),
        "sources": (
            "apps/server/src/createServer.ts",
            "apps/server/src/tests/server-postgres-selection.unit.test.ts",
            "apps/server/README.md",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/composeManagedSavedState.ts",
            "modules/hosts/server/composition/composeManagedAgentReads.ts",
            "modules/hosts/server/composition/tests/managed-headless-agent-reads.unit.test.ts",
            "modules/hosts/server/composition/composeManagedHeadlessAuthoring.ts",
            "modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes.ts",
            "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "apps/server/src/tests/server-postgres-selection.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-headless-agent-reads.unit.test.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-saved-state-routes.integration.test.ts",
        ),
    },
    "managed-saved-state-browser": {
        "automatic_sources": (
            "apps/thin-client/src/features/system-builder/api/observeManagedSavedSystems.ts",
            "apps/thin-client/src/features/system-builder/api/observeManagedSavedSystems.unit.test.ts",
        ),
        "sources": (
            "apps/thin-client/src/features/system-builder/api/observeManagedSavedSystems.ts",
            "apps/thin-client/src/features/system-builder/api/observeManagedSavedSystems.unit.test.ts",
            "apps/thin-client/src/pages/SystemBuilderPage.tsx",
            "apps/thin-client/README.md",
            "apps/thin-client/src/features/model-management/api/apiModelManagementClient.ts",
            "dev-tools/helpers/tests/test_control_plane.py",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "apps/thin-client/src/features/system-builder/api/observeManagedSavedSystems.unit.test.ts",
            "apps/thin-client/tests/api-model-management-client-timeout.unit.test.ts",
        ),
    },
    "managed-saved-state-browser-ui": {
        "automatic_sources": (
            "apps/thin-client/src/features/system-builder/api/observeManagedSavedSystems.ts",
        ),
        "sources": (
            "apps/thin-client/src/security/pairedDeviceTokenStore.ts",
            "apps/thin-client/src/security/tests/paired-device-token-store.unit.test.ts",
            "modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx",
            "modules/ui/shared/system-builder/SystemManagementWorkspace.tsx",
            "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
            "modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "apps/thin-client/src/security/tests/paired-device-token-store.unit.test.ts",
            "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
            "modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx",
        ),
    },
    "managed-headless-client-policy": {
        "automatic_sources": (
            "modules/hosts/server/security/resolveManagedHeadlessClientPolicy.ts",
        ),
        "sources": (
            "modules/hosts/server/security/resolveManagedHeadlessClientPolicy.ts",
            "modules/hosts/server/security/tests/managed-headless-client-policy.unit.test.ts",
            "modules/adapters/security/oidc/createOidcBearerTokenVerifierAdapter.ts",
            "modules/adapters/security/oidc/tests/oidc-bearer-token-verifier.unit.test.ts",
            "modules/hosts/server/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/security/tests/managed-headless-client-policy.unit.test.ts",
            "modules/adapters/security/oidc/tests/oidc-bearer-token-verifier.unit.test.ts",
        ),
    },
    "managed-headless-transactional-authoring": {
        "automatic_sources": (
            "modules/hosts/server/composition/composeManagedHeadlessAuthoring.ts",
        ),
        "sources": (
            "modules/hosts/server/composition/composeManagedHeadlessAuthoring.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanReview.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanApprovals.ts",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanReview.ts",
            "modules/hosts/server/composition/tests/managed-headless-authoring.unit.test.ts",
            "modules/hosts/server/composition/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/composition/tests/managed-headless-authoring.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/headless-system-authoring.unit.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts",
        ),
    },
    "managed-headless-agent-routes": {
        "automatic_sources": (
            "modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes.ts",
        ),
        "sources": (
            "modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts",
            "modules/adapters/transport/api-express/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "modules/adapters/transport/api-express/security/security-enforcement.unit.test.ts",
        ),
    },
    "managed-saved-state-replay": {
        "automatic_sources": (
            "modules/adapters/transport/api-express/headless/registerManagedSavedStateRoutes.ts",
            "modules/hosts/server/composition/composeManagedSavedState.ts",
            "modules/hosts/server/security/createManagedSavedStateAuthorizationAudit.ts",
        ),
        "sources": (
            "apps/server/src/createServer.ts",
            "apps/server/src/tests/server-postgres-selection.unit.test.ts",
            "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts",
            "modules/adapters/transport/api-express/security/createExpressOrganizationAuthorizationMiddleware.ts",
            "modules/adapters/transport/api-express/headless/registerManagedSavedStateRoutes.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-saved-state-routes.integration.test.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/composeManagedSavedState.ts",
            "modules/hosts/server/composition/README.md",
            "modules/hosts/server/security/createManagedSavedStateAuthorizationAudit.ts",
            "modules/hosts/server/security/tests/managed-saved-state-authorization-audit.unit.test.ts",
            "modules/adapters/persistence/postgres/postgres-database.ts",
            "modules/adapters/persistence/postgres/tests/postgres-database.unit.test.ts",
            "modules/adapters/persistence/postgres/tests/postgres-database.live.integration.test.ts",
            "modules/adapters/persistence/postgres/README.md",
            "modules/adapters/persistence/system-builder/createStructuredSystemBuilderRepository.ts",
            "modules/application/use-cases/system-builder/headless-committed-changes.use-case.ts",
            "dev-tools/helpers/tests/test_control_plane.py",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "apps/server/src/tests/server-postgres-selection.unit.test.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-saved-state-routes.integration.test.ts",
            "modules/hosts/server/security/tests/managed-saved-state-authorization-audit.unit.test.ts",
            "modules/adapters/persistence/postgres/tests/postgres-database.unit.test.ts",
            "modules/adapters/persistence/postgres/tests/postgres-database.live.integration.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-system-builder-repository.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/headless-committed-changes.unit.test.ts",
        ),
    },
    "managed-headless-delivery-fixture": {
        "automatic_sources": (
            "dev-tools/scripts/qualification/visual-composer/managed-headless-delivery.ts",
        ),
        "sources": (
            "dev-tools/scripts/qualification/visual-composer/managed-headless-delivery.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
        ),
        "command": (
            "--test", "--",
            "dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs",
            "dev-tools/scripts/qualification/tests/managed-assets-restart-loader.unit.test.mjs",
        ),
    },
    "headless-desktop-window-renderer": {
        "companion_to": "headless-desktop-takeover-controls",
        "sources": (
            "apps/desktop/src/renderer/tests/desktop-window-takeover.ui.test.tsx",
            "apps/desktop/src/renderer/features/workspace/hooks/useActiveWorkspaceTakeover.ts",
            "apps/desktop/src/renderer/App.tsx",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "apps/desktop/src/renderer/tests/desktop-window-takeover.ui.test.tsx",
        ),
    },
    "headless-desktop-takeover-controls": {
        "automatic_sources": (
            "modules/ui/shared/takeover/PresentedWindowResource.tsx",
            "modules/hosts/desktop/composition/tests/desktop-ui-control.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopUiControl.ts",
            "modules/ui/shared/takeover/WindowTakeoverControls.tsx",
            "apps/desktop/src/main/desktopUiControlIpc.ts",
            "apps/desktop/src/main/tests/desktop-ui-control-ipc.unit.test.ts",
            "modules/ui/shared/takeover/windowTakeoverController.ts",
            "modules/ui/shared/takeover/tests/window-takeover-controller.unit.test.ts",
        ),
        "sources": (
            "modules/hosts/desktop/composition/README.md",
            "modules/ui/shared/README.md",
            "modules/ui/shared/takeover/PresentedWindowResource.tsx",
            "modules/hosts/desktop/composition/tests/desktop-ui-control.unit.test.ts",
            "apps/desktop/src/main/desktopUiControlIpc.ts",
            "apps/desktop/src/main/tests/desktop-ui-control-ipc.unit.test.ts",
            "apps/desktop/src/renderer/App.tsx",
            "apps/desktop/src/renderer/components/layout/AppShell.tsx",
            "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx",
            "apps/desktop/src/renderer/features/workspace/hooks/useActiveWorkspaceTakeover.ts",
            "modules/hosts/desktop/composition/composeDesktopUiControl.ts",
            "modules/hosts/desktop/composition/desktopHeadlessAudit.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-audit.unit.test.ts",
            "modules/application/services/ui-control/ui-control-delivery.service.ts",
            "modules/ui/shared/components/ModalDialog.tsx",
            "modules/ui/shared/styles/components/shell.css",
            "modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx",
            "modules/ui/shared/takeover/windowTakeoverController.ts",
            "modules/ui/shared/takeover/WindowTakeoverControls.tsx",
            "modules/ui/shared/takeover/WindowTakeoverContext.tsx",
            "modules/ui/shared/takeover/tests/window-takeover-controller.unit.test.ts",
            "modules/ui/shared/takeover/tests/window-takeover-controls.interaction.test.tsx",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/desktop/composition/tests/desktop-ui-control.unit.test.ts",
            "apps/desktop/src/main/tests/desktop-ui-control-ipc.unit.test.ts",
            "modules/ui/shared/takeover/tests/window-takeover-controller.unit.test.ts",
            "modules/ui/shared/takeover/tests/window-takeover-controls.interaction.test.tsx",
            "modules/ui/shared/components/tests/ModalDialog.unit.test.tsx",
            "modules/hosts/desktop/composition/tests/desktop-headless-audit.unit.test.ts",
        ),
    },
    "headless-desktop-takeover-startup": {
        "companion_to": "headless-desktop-takeover-controls",
        "sources": (
            "apps/desktop/tests/forge-packaging-boundaries.unit.test.ts",
            "apps/desktop/src/main/index.ts",
            "apps/desktop/src/main/desktopMainWindowMenu.ts",
            "apps/desktop/src/main/tests/desktop-main-window-menu.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "apps/desktop/tests/forge-packaging-boundaries.unit.test.ts",
            "apps/desktop/src/main/tests/desktop-main-window-menu.unit.test.ts",
        ),
    },
    "headless-desktop-takeover-draft": {
        "companion_to": "headless-desktop-takeover-controls",
        "sources": (
            "modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx",
            "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
            "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
        ),
    },
    "headless-ui-control-authority": {
        "sources": (
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/application/use-cases/context-management/README.md",
            "modules/application/use-cases/context-management/headless-context-presentation.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-presentation.unit.test.ts",
            "modules/application/use-cases/context-management/index.ts",
            "modules/hosts/shared/composition/headlessContextPresentation.ts",
            "modules/hosts/shared/composition/tests/headless-context-presentation.unit.test.ts",
            "modules/contracts/headless/ui-control-delivery.ts",
            "modules/contracts/headless/tests/ui-control-delivery.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-data-presentation.use-case.ts",
            "modules/hosts/shared/composition/headlessDataPresentation.ts",
            "modules/hosts/shared/composition/tests/headless-data-presentation.unit.test.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-plan-task-store.unit.test.ts",
            "modules/contracts/headless/ui-control-authority.ts",
            "modules/contracts/headless/index.ts",
            "modules/contracts/headless/tests/ui-control-authority-contract.unit.test.ts",
            "modules/application/services/ui-control/ui-control-authority.service.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
        "automatic_sources": (
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "modules/application/use-cases/context-management/headless-context-presentation.use-case.ts",
            "modules/application/use-cases/context-management/tests/headless-context-presentation.unit.test.ts",
            "modules/hosts/shared/composition/headlessContextPresentation.ts",
            "modules/hosts/shared/composition/tests/headless-context-presentation.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-data-presentation.use-case.ts",
            "modules/hosts/shared/composition/headlessDataPresentation.ts",
            "modules/hosts/shared/composition/tests/headless-data-presentation.unit.test.ts",
            "modules/contracts/headless/ui-control-authority.ts",
            "modules/contracts/headless/tests/ui-control-authority-contract.unit.test.ts",
            "modules/application/services/ui-control/ui-control-authority.service.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/hosts/server/composition/tests/managed-browser-consent.unit.test.ts",
            "modules/contracts/headless/tests/ui-control-delivery.unit.test.ts",
            "modules/application/use-cases/context-management/tests/headless-context-presentation.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-context-presentation.unit.test.ts",
            "modules/hosts/shared/composition/tests/headless-data-presentation.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-plan-task-store.unit.test.ts",
            "modules/contracts/headless/tests/ui-control-authority-contract.unit.test.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
    },
    "desktop-headless-chat-task-settings": {
        "sources": (
            "apps/desktop/src/renderer/features/settings/components/RecentHeadlessChatTasks.tsx",
            "apps/desktop/src/renderer/features/settings/tests/recent-headless-chat-tasks.ui.test.tsx",
        ),
        "automatic_sources": (
            "apps/desktop/src/renderer/features/settings/components/RecentHeadlessChatTasks.tsx",
            "apps/desktop/src/renderer/features/settings/tests/recent-headless-chat-tasks.ui.test.tsx",
        ),
        "command": ("dev-tools/helpers/run_vitest_checks.mjs", "--",
                    "apps/desktop/src/renderer/features/settings/tests/recent-headless-chat-tasks.ui.test.tsx"),
    },
    "headless-workflow-metadata": {
        "sources": (
            "modules/application/services/system-run-workflow/conversation-workflow-handler.service.ts",
            "modules/application/services/system-run-workflow/tests/conversation-workflow-handler.unit.test.ts",
            "modules/application/ports/system-run-workflow/headless-turn-reservation.port.ts",
            "modules/application/use-cases/system-run-workflow/headless-approved-conversation-dispatch.use-case.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessTurnReservation.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-turn-reservation.unit.test.ts",
            "modules/application/ports/conversations/conversation-operation-repository.port.ts",
            "modules/application/ports/execution-runs/execution-run-repository.port.ts",
            "modules/adapters/persistence/execution-runs/createLocalExecutionRunRepositoryAdapters.ts",
            "modules/contracts/execution-runs/execution-run-normalization.ts",
            "modules/contracts/execution-runs/execution-run-provenance.ts",
            "modules/application/ports/conversations/delegated-conversation-turn-admission.port.ts",
            "modules/application/ports/conversations/conversation-session-repository.port.ts",
            "modules/application/ports/conversational-execution/conversation-turn-invocation.port.ts",
            "modules/adapters/persistence/conversations/createLocalDelegatedConversationTurnAdmission.ts",
            "modules/adapters/persistence/conversations/createLocalConversationRepositoryAdapters.ts",
            "modules/adapters/persistence/conversations/local-conversation-record-store.ts",
            "modules/adapters/persistence/conversations/tests/local-conversation-repositories.unit.test.ts",
            "modules/adapters/persistence/conversations/tests/local-delegated-turn-admission.unit.test.ts",
            "modules/adapters/runtime/conversational-text-generation/python-conversational-text-generation.adapter.ts",
            "modules/adapters/runtime/conversational-text-generation/tests/python-conversational-text-generation.adapter.unit.test.ts",
            "modules/application/use-cases/conversations/submit-conversation-turn.use-case.ts",
            "modules/application/use-cases/conversations/tests/conversation-turn-phase13-prompt7.unit.test.ts",
            "modules/application/services/conversational-execution/conversation-turn-invocation-orchestrator.service.ts",
            "modules/application/services/conversational-execution/tests/conversational-execution-services.unit.test.ts",
            "modules/application/use-cases/system-run-workflow/headless-workflow-metadata.use-case.ts",
            "modules/application/use-cases/system-run-workflow/tests/headless-workflow-metadata.unit.test.ts",
            "modules/application/use-cases/system-run-workflow/headless-conversation-status.use-case.ts",
            "modules/application/use-cases/system-run-workflow/tests/headless-conversation-status.unit.test.ts",
        ),
        "automatic_sources": (
            "modules/application/services/system-run-workflow/conversation-workflow-handler.service.ts",
            "modules/application/services/system-run-workflow/tests/conversation-workflow-handler.unit.test.ts",
            "modules/application/use-cases/system-run-workflow/headless-workflow-metadata.use-case.ts",
            "modules/application/use-cases/system-run-workflow/tests/headless-workflow-metadata.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/adapters/persistence/system-builder/tests/structured-headless-turn-reservation.unit.test.ts",
            "modules/application/services/system-run-workflow/tests/conversation-workflow-handler.unit.test.ts",
            "modules/adapters/persistence/conversations/tests/local-conversation-repositories.unit.test.ts",
            "modules/adapters/persistence/conversations/tests/local-delegated-turn-admission.unit.test.ts",
            "modules/adapters/runtime/conversational-text-generation/tests/python-conversational-text-generation.adapter.unit.test.ts",
            "modules/application/use-cases/conversations/tests/conversation-turn-phase13-prompt7.unit.test.ts",
            "modules/application/services/conversational-execution/tests/conversational-execution-services.unit.test.ts",
            "modules/application/use-cases/system-run-workflow/tests/headless-workflow-metadata.unit.test.ts",
            "modules/application/use-cases/system-run-workflow/tests/headless-conversation-status.unit.test.ts",
            "modules/application/use-cases/system-run-workflow/tests/system-run-workflow-use-cases.unit.test.ts",
        ),
    },
    "headless-data-task-status": {
        "automatic_sources": (
            "modules/contracts/headless/headless-data-task-status.ts",
            "modules/contracts/headless/headless-data-local-file.ts",
            "modules/contracts/headless/headless-data-provider-file.ts",
            "modules/contracts/headless/headless-data-app-selection.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessLocalFileSelection.ts",
            "apps/desktop/src/main/desktopHeadlessLocalFileSelectionIpc.ts",
            "apps/desktop/src/renderer/features/artifact-upload/components/ArtifactIngestionFeature.tsx",
            "apps/desktop/src/renderer/features/artifact-upload/api/desktopIngestionTaskClient.ts",
            "modules/ui/shared/data-management/GuidedIngestionTaskPanel.tsx",
            "modules/application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-local-file-selection.use-case.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository.ts",
            "modules/application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/ingestion-file-publication.service.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessLocalFilePlanStepStore.ts",
            "modules/application/use-cases/register-artifact-from-repo.use-case.ts",
            "modules/application/ports/ingestion/ingestion-acquisition-repository.port.ts",
            "modules/adapters/persistence/ingestion/createStructuredIngestionAcquisitionRepository.ts",
            "modules/hosts/shared/composition/composeIngestionAcquisitionRepository.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanReview.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanApprovals.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-data-task-status.ts",
            "modules/contracts/headless/headless-data-local-file.ts",
            "modules/contracts/headless/headless-data-provider-file.ts",
            "modules/contracts/headless/headless-data-app-selection.ts",
            "modules/contracts/headless/index.ts",
            "modules/contracts/headless/tests/headless-data-task-status.unit.test.ts",
            "modules/contracts/headless/tests/headless-data-local-file.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-ingestion-status.unit.test.ts",
            "modules/application/ports/ingestion/headless-local-file-selection.port.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-local-file-selection.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-local-file-selection.unit.test.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository.ts",
            "modules/application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/governed-ingestion-tasks.unit.test.ts",
            "modules/application/use-cases/register-artifact-from-repo.use-case.ts",
            "modules/application/use-cases/tests/register-artifact-from-repo.use-case.unit.test.ts",
            "modules/application/ports/ingestion/ingestion-acquisition-repository.port.ts",
            "modules/application/ports/ingestion/README.md",
            "modules/adapters/persistence/ingestion/createStructuredIngestionAcquisitionRepository.ts",
            "modules/adapters/persistence/ingestion/tests/structured-ingestion-acquisition-repository.unit.test.ts",
            "modules/hosts/shared/composition/composeIngestionAcquisitionRepository.ts",
            "modules/application/use-cases/ingestion-acquisition/ingestion-file-publication.service.ts",
            "modules/application/ports/ingestion/ingestion-file-publication.port.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessLocalFileSelection.ts",
            "modules/hosts/desktop/composition/composeDesktopIngestionFeature.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopIngestionFeature.unit.test.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessConnection.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-local-file-selection.unit.test.ts",
            "apps/desktop/src/main/desktopHeadlessLocalFileSelectionIpc.ts",
            "apps/desktop/src/main/tests/desktop-headless-local-file-selection-ipc.unit.test.ts",
            "apps/desktop/src/main/index.ts",
            "apps/desktop/src/preload/exposedApi.ts",
            "apps/desktop/src/renderer/lib/desktopApi.ts",
            "apps/desktop/src/renderer/features/artifact-upload/components/ArtifactIngestionFeature.tsx",
            "apps/desktop/src/renderer/features/artifact-upload/api/desktopIngestionTaskClient.ts",
            "modules/ui/shared/data-management/GuidedIngestionTaskPanel.tsx",
            "modules/ui/shared/data-management/tests/GuidedIngestionTaskPanel.interaction.ui.test.tsx",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessLocalFilePlanStepStore.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/contracts/headless/headless-system-management.ts",
            "modules/contracts/headless/headless-plan-review-wire.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/contracts/headless/desktop-headless-plan-approval.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/contracts/headless/tests/headless-system-management.unit.test.ts",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/createStructuredIngestionFilePublicationRepository.ts",
            "modules/adapters/persistence/ingestion/tests/structured-ingestion-file-publication-repository.unit.test.ts",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanReview.ts",
            "modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals.ts",
            "modules/hosts/desktop/composition/desktopHeadlessAudit.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-audit.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanReview.ts",
            "modules/hosts/server/composition/composeManagedHeadlessPlanApprovals.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/hosts/server/composition/tests/managed-headless-authoring.unit.test.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-browser-consent-route.integration.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-data-task-status.unit.test.ts",
            "modules/contracts/headless/tests/headless-data-local-file.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-ingestion-status.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-local-file-selection.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/governed-ingestion-tasks.unit.test.ts",
            "modules/application/use-cases/tests/register-artifact-from-repo.use-case.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-ingestion-acquisition-repository.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-local-file-selection.unit.test.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopIngestionFeature.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktopStartupLazyComposition.unit.test.ts",
            "apps/desktop/src/main/tests/desktop-headless-local-file-selection-ipc.unit.test.ts",
            "modules/ui/shared/data-management/tests/GuidedIngestionTaskPanel.interaction.ui.test.tsx",
            "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
            "modules/contracts/headless/tests/headless-system-management.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx",
            "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-ingestion-file-publication-repository.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-audit.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts",
            "modules/hosts/server/composition/tests/managed-headless-authoring.unit.test.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
            "modules/adapters/transport/api-express/headless/tests/managed-browser-consent-route.integration.test.ts",
        ),
    },
    "headless-approved-dataset-task-wiring": {
        "automatic_sources": (
            "modules/contracts/headless/headless-dataset-result-plan.ts",
            "modules/contracts/headless/headless-dataset-task-review.ts",
            "modules/contracts/runtime/dataset-preparation.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-dataset-task-review.use-case.ts",
            "modules/application/ports/dataset-version/dataset-version-commit-admission.port.ts",
            "modules/application/services/dataset-version/dataset-version-finalization.service.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetResultStore.ts",
            "modules/adapters/persistence/dataset-version/createStructuredDatasetVersionRepository.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-server-entry.ts",
            "modules/contracts/headless/headless-dataset-plan.ts",
            "modules/contracts/headless/headless-dataset-task-status.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-dataset-task-status.use-case.ts",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-dataset-result-plan.ts",
            "modules/contracts/headless/headless-dataset-task-review.ts",
            "modules/contracts/headless/tests/headless-dataset-result-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-task-review.unit.test.ts",
            "modules/contracts/runtime/dataset-preparation.ts",
            "modules/adapters/runtime/python/worker/README.md",
            "modules/application/use-cases/ingestion-acquisition/headless-dataset-task-review.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-task-review.unit.test.ts",
            "modules/application/ports/dataset-version/dataset-version-commit-admission.port.ts",
            "modules/application/ports/dataset-version/index.ts",
            "modules/application/ports/dataset-version/README.md",
            "modules/application/services/dataset-version/dataset-version-finalization.service.ts",
            "modules/application/services/dataset-version/tests/dataset-version-finalization.service.unit.test.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetResultStore.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-result-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/adapters/persistence/dataset-version/createStructuredDatasetVersionRepository.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts",
            "dev-tools/scripts/qualification/visual-composer/managed-reference-server-entry.ts",
            "modules/contracts/headless/headless-dataset-plan.ts",
            "modules/contracts/headless/headless-dataset-task-status.ts",
            "modules/contracts/headless/tests/headless-dataset-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-task-status.unit.test.ts",
            "modules/contracts/headless/headless-system-management.ts",
            "modules/contracts/headless/headless-plan-step-wire.ts",
            "modules/contracts/headless/headless-plan-review-wire.ts",
            "modules/contracts/headless/desktop-headless-plan-approval.ts",
            "modules/contracts/headless/managed-browser-plan-approval.ts",
            "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-approved-dataset-hosts.integration.test.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-dataset-task-status.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-task-status.unit.test.ts",
            "modules/hosts/shared/composition/headlessPlanReview.ts",
            "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
            "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx",
            "apps/server/src/createServer.ts",
            "apps/thin-client/src/features/workspace/api/managedBrowserConsentClient.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-dataset-result-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-task-review.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-task-review.unit.test.ts",
            "modules/application/services/dataset-version/tests/dataset-version-finalization.service.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-result-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
            "modules/adapters/persistence/dataset-version/tests/structured-dataset-version-repository.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-plan.unit.test.ts",
            "modules/contracts/headless/tests/headless-dataset-task-status.unit.test.ts",
            "modules/contracts/headless/tests/headless-system-management.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-task-status.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-plan-task-store.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/headless-approved-dataset-hosts.integration.test.ts",
            "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
            "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx",
        ),
    },
    "headless-dataset-preview-contract": {
        "automatic_sources": (
            "modules/contracts/headless/headless-dataset-preparation.ts",
            "modules/contracts/headless/headless-protocol.ts",
            "modules/contracts/headless/tests/headless-dataset-preparation.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case.ts",
        ),
        "sources": (
            "modules/contracts/headless/headless-dataset-preparation.ts",
            "modules/contracts/headless/headless-protocol.ts",
            "modules/contracts/headless/tests/headless-dataset-preparation.unit.test.ts",
            "modules/contracts/headless/headless-read-request.ts",
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-preparation.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-dataset-preparation.unit.test.ts",
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-preparation.unit.test.ts",
        ),
    },
    "headless-dataset-owned-start": {
        "automatic_sources": (
            "modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-local-admission.unit.test.ts",
            "modules/application/ports/runtime/local-dataset-preparation-admission.port.ts",
        ),
        "sources": (
            "modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-local-admission.unit.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-from-artifacts.use-case.unit.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-quality-policy.unit.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-source-isolation.integration.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-version-finalization.unit.test.ts",
            "modules/application/ports/runtime/local-dataset-preparation-admission.port.ts",
            "modules/application/ports/runtime/index.ts",
            "modules/application/ports/runtime/README.md",
            "modules/application/use-cases/README.md",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/application/use-cases/tests/prepare-training-dataset-local-admission.unit.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-from-artifacts.use-case.unit.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-quality-policy.unit.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-source-isolation.integration.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-version-finalization.unit.test.ts",
        ),
    },
    "headless-data-definition-witnesses": {
        "automatic_sources": ("dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts",),
        "sources": (
            "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts",
            "docs/operations/comprehensive-ui-automation-current-census.json",
            "docs/operations/headless-dataset-preparation-preview-census-history.json",
            "docs/operations/headless-dataset-task-census-history.json",
        ),
        "command": ("dev-tools/helpers/run_vitest_checks.mjs", "--",
                    "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts"),
    },
    "headless-data-desktop-plan-qualification": {
        "companion_to": "headless-data-task-status",
        "sources": ("dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts",),
        "command": (
            "--preserve-symlinks", "--preserve-symlinks-main", "node_modules/@playwright/test/cli.js", "test",
            "--config=dev-tools/config/playwright.visual-composer.config.ts", "--project=packaged-desktop",
            "--workers=1", "--grep", "reviews an MCP plan in the app popup and reports the exact decision",
            "packaged-desktop-headless.e2e.spec.ts",
        ),
        "timeout": 420,
    },
    "headless-system-builder-semantic-edits": {
        "sources": (
            "modules/application/ports/system-builder/headless-operation-store.port.ts",
            "modules/application/use-cases/system-builder/headless-system-authoring.use-case.ts",
            "modules/application/use-cases/system-builder/tests/headless-system-authoring.unit.test.ts",
            "modules/hosts/shared/composition/composeSystemBuilder.ts",
            "modules/application/use-cases/system-builder/headless-committed-changes.use-case.ts",
            "modules/application/use-cases/system-builder/tests/headless-committed-changes.unit.test.ts",
            "modules/application/use-cases/system-builder/headless-semantic-edit-draft.ts",
            "modules/application/use-cases/system-builder/headless-semantic-edit.use-case.ts",
            "modules/application/use-cases/system-builder/index.ts",
            "modules/application/use-cases/system-builder/system-builder-use-cases.ts",
            "modules/application/use-cases/system-builder/tests/headless-semantic-edit.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/contracts/headless/tests/headless-semantic-batch.unit.test.ts",
            "modules/contracts/headless/tests/headless-system-management.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/headless-committed-changes.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/headless-semantic-edit.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/headless-system-authoring.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/system-builder-use-cases.unit.test.ts",
        ),
    },
    "managed-assets-restart-loader": {
        "automatic_sources": MANAGED_ASSETS_RESTART_LOADER_FILES,
        "sources": MANAGED_ASSETS_RESTART_LOADER_FILES,
        "command": (
            "--test", "--",
            "dev-tools/scripts/qualification/tests/managed-assets-restart-loader.unit.test.mjs",
            "dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs",
            "dev-tools/scripts/qualification/tests/visual-composer-host-lifecycle.unit.test.mjs",
        ),
    },
    "published-form-host-definitions": {
        "automatic_sources": FORM_HOST_DEFINITIONS,
        "sources": FORM_HOST_DEFINITIONS,
        "command": (
            "--import", "tsx", "--test", "--",
            "dev-tools/scripts/qualification/tests/form-composer-host-definitions.unit.test.mjs",
        ),
    },
    "published-form-desktop-bridge": {
        "sources": (
            "apps/desktop/src/preload/exposedApi.ts",
            "apps/desktop/src/preload/tests/publishedSystemFormBridge.unit.test.ts",
            "apps/desktop/src/renderer/features/system-builder/api/desktopSystemPublishedFormClient.ts",
            "apps/desktop/src/renderer/lib/desktopApi.ts",
            "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx",
            "modules/ui/shared/system-builder/SystemPublishedFormClient.ts",
            "modules/ui/shared/system-builder/index.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--test-concurrency=1", "--",
            "apps/desktop/src/preload/tests/publishedSystemFormBridge.unit.test.ts",
            "apps/desktop/tests/desktop-webpack-tsconfig.unit.test.ts",
        ),
    },
    "published-form-editor-interactions": {
        "sources": (
            "modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx",
            "modules/ui/shared/system-builder/SystemFormComposerView.tsx",
            "modules/ui/shared/system-builder/SystemComposerClickEditor.tsx",
            "modules/ui/shared/system-builder/tests/SystemFormComposerStyling.interaction.ui.test.tsx",
            "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "modules/ui/shared/system-builder/tests/SystemComposerStructureEditor.interaction.ui.test.tsx",
            "modules/ui/shared/system-builder/tests/SystemFormComposerStyling.interaction.ui.test.tsx",
            "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
        ),
    },
    "headless-composer-draft-witnesses": {
        "automatic_sources": (
            "dev-tools/helpers/tests/ui-coverage-census.unit.test.mjs",
        ),
        "sources": (
            "modules/ui/shared/notifications/tests/notificationMigrationInventory.ts",
            "modules/ui/shared/notifications/tests/notificationMigrationGuard.unit.test.ts",
            "docs/operations/comprehensive-ui-automation-current-census.json",
            "dev-tools/helpers/tests/ui-coverage-census.unit.test.mjs",
            "dev-tools/helpers/ui_coverage_census.mjs",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/ui/shared/notifications/tests/notificationMigrationGuard.unit.test.ts",
            "dev-tools/helpers/tests/ui-coverage-census.unit.test.mjs",
        ),
    },
    "published-form-editor-styles": {
        "companion_to": "published-form-editor-interactions",
        "sources": (
            "modules/ui/shared/styles/components/system-composer.css",
            "modules/ui/shared/styles/components/feature-surfaces.css",
            "modules/ui/shared/styles/tests/system-builder-style-tokens.unit.test.ts",
        ),
        "command": ("--import", "tsx", "--test", "--", "modules/ui/shared/styles/tests/system-builder-style-tokens.unit.test.ts"),
    },
    "system-composition-preview-management-interaction": {
        "automatic_sources": (
            "modules/ui/shared/system-builder/SystemCompositionPreview.tsx",
            "modules/ui/shared/system-builder/tests/SystemCompositionPreview.unit.test.tsx",
        ),
        "sources": (
            "modules/ui/shared/system-builder/SystemCompositionPreview.tsx",
            "modules/ui/shared/system-builder/tests/SystemCompositionPreview.unit.test.tsx",
        ),
        "command": (
            "dev-tools/helpers/run_vitest_checks.mjs", "--",
            "modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx",
        ),
    },
    "system-composition-preview-model": {
        "companion_to": "system-composition-preview-management-interaction",
        "sources": (
            "modules/ui/shared/system-builder/SystemCompositionPreview.tsx",
            "modules/ui/shared/system-builder/tests/SystemCompositionPreview.unit.test.tsx",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "modules/ui/shared/system-builder/tests/SystemCompositionPreview.unit.test.tsx",
        ),
    },
    "asset-library-definition-dialog": {
        "companion_to": "asset-authoring-ui",
        "sources": (
            "apps/desktop/src/renderer/features/asset-library/components/AssetLibraryFeature.tsx",
            "apps/thin-client/src/features/asset-library/components/AssetLibraryFeature.tsx",
            "apps/desktop/src/renderer/features/asset-library/tests/asset-library-feature.unit.test.tsx",
            "apps/thin-client/src/features/asset-library/tests/asset-library-feature.unit.test.tsx",
            "modules/ui/shared/asset-library/assetLibraryDetailPanels.tsx",
            "modules/ui/shared/asset-library/tests/assetLibraryDetailPanels.unit.test.tsx",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "apps/desktop/src/renderer/features/asset-library/tests/asset-library-feature.unit.test.tsx",
            "apps/thin-client/src/features/asset-library/tests/asset-library-feature.unit.test.tsx",
            "modules/ui/shared/asset-library/tests/assetLibraryDetailPanels.unit.test.tsx",
        ),
    },
    "published-form-browser-client": {
        "sources": (
            "apps/thin-client/src/features/system-builder/api/thinClientSystemPublishedFormClient.ts",
            "apps/thin-client/src/features/system-builder/api/thinClientSystemPublishedFormClient.unit.test.ts",
            "apps/thin-client/src/pages/SystemBuilderPage.tsx",
        ),
        "command": (
            "--import", "tsx", "--test", "--test-concurrency=1", "--",
            "apps/thin-client/src/features/system-builder/api/thinClientSystemPublishedFormClient.unit.test.ts",
        ),
    },
    "published-form-host-composition": {
        "sources": (
            "modules/hosts/shared/composition/composePublishedSystemForms.ts",
            "modules/hosts/shared/composition/tests/compose-published-system-forms.unit.test.ts",
            "modules/hosts/shared/composition/tests/form-submission-recovery.unit.test.ts",
            "modules/hosts/shared/composition/tests/fixtures/form-submission-recovery-child.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--test-concurrency=1", "--",
            "modules/hosts/shared/composition/tests/compose-published-system-forms.unit.test.ts",
            "modules/adapters/transport/api-express/system-builder/tests/published-form-transport.unit.test.ts",
            "modules/hosts/shared/composition/tests/form-submission-recovery.unit.test.ts",
            "modules/application/use-cases/system-builder/tests/submit-released-system-form.use-case.unit.test.ts",
        ),
    },
    "published-form-host-registration": {
        "sources": (
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/application/ports/system-build/system-build-services.port.ts",
            "modules/application/use-cases/system-build/guided-system-build.use-cases.ts",
            "modules/application/use-cases/system-build/system-build-use-cases.ts",
            "modules/application/use-cases/system-build/tests/guided-system-build.use-cases.unit.test.ts",
            "modules/application/use-cases/system-build/tests/system-build-use-cases.unit.test.ts",
            "modules/adapters/transport/api-express/system-data/registerSystemDataApiRoutes.ts",
            "modules/adapters/transport/api-express/system-data/tests/system-data-transport-parity.unit.test.ts",
            "modules/hosts/shared/composition/composeSystemData.ts",
            "modules/hosts/shared/composition/tests/managed-system-data-principal.unit.test.ts",
            "modules/hosts/desktop/composition/tests/published-form-host-registration.unit.test.ts",
            "modules/hosts/server/composition/tests/published-form-host-registration.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--test-concurrency=1", "--",
            "modules/application/use-cases/system-build/tests/guided-system-build.use-cases.unit.test.ts",
            "modules/application/use-cases/system-build/tests/system-build-use-cases.unit.test.ts",
            "modules/adapters/transport/api-express/system-data/tests/system-data-transport-parity.unit.test.ts",
            "modules/hosts/shared/composition/tests/managed-system-data-principal.unit.test.ts",
            "modules/hosts/desktop/composition/tests/published-form-host-registration.unit.test.ts",
            "modules/hosts/server/composition/tests/published-form-host-registration.unit.test.ts",
        ),
    },
}

QUALIFICATION_PROFILES = (
    "artifact-confirmation-ui",
    "shared-forced-colors",
    "offload-resource-lifecycle",
    "model-qualification-scheduling",
    "windows-guarded-tree-probe",
    "windows-guarded-inventory-probe",
    "windows-owned-job-probe",
    "windows-file-protection-probe",
    "windows-staging-protection-probe",
    "windows-file-identity",
    "offload-restart-readiness",
    "model-file-listing",
    "model-file-delete-ack",
    "model-download-ownership",
    "notification-dismiss-focus",
    "desktop-prerequisite-bootstrap",
    "headless-data-license-discovery",
    "headless-data-license-provenance",
    "security-authority", "security-runtime", "security-records", "security-tooling",
    "functionality-browse", "functionality-tasks", "functionality-context", "functionality-outcomes",
    "functional-host-ui", "review-site", "settings-ui", "security-status-ui", "operational-ui", "asset-authoring-ui", "system-management-ui", "system-build-publication-ui", "system-runtime-conversation-ui", "system-canvas-authoring-ui", "desktop-startup-ui", "host-memory-fixture", "ingestion-publication", "ocr-provider-contract", "dataset-version-replay", "dataset-version-browser", "dataset-semantic-curation", "native-host-policy", "host-setup-policy", "comfyui-host-policy",
)


QUALIFICATION_PROFILE_PATTERNS = {
    "headless-data-license-discovery": [
        "modules/contracts/storage/huggingface-dataset-license.ts",
    ],
    "desktop-prerequisite-bootstrap": [
        "dev-tools/scripts/bootstrap/desktop-dev.mjs",
        "dev-tools/scripts/bootstrap/desktop-python.mjs",
        "dev-tools/scripts/bootstrap/desktop-python-artifact.json",
        "dev-tools/scripts/bootstrap/desktop-prerequisites.unit.test.mjs",
        "modules/hosts/desktop/composition/desktopPythonRuntimeInstallation.ts",
        "modules/adapters/runtime/python/checkPythonRuntimeInstallation.ts",
    ],
    "artifact-confirmation-ui": [
        "apps/desktop/src/renderer/features/artifact-browser/components/ArtifactBrowserFeature.tsx",
        "apps/thin-client/src/features/artifact-browser/components/ArtifactBrowserFeature.tsx",
        "apps/desktop/src/renderer/features/artifact-browser/tests/use-artifact-browser-feature.unit.test.tsx",
        "apps/thin-client/src/features/artifact-browser/tests/use-artifact-browser-feature.unit.test.tsx",
        "apps/thin-client/tests/thin-client-shell-css.unit.test.ts",
        "dev-tools/helpers/tests/test_control_plane_artifact_confirmation_profile.py"
    ],
    "shared-forced-colors": [
        "modules/ui/shared/styles/forced-colors.css",
        "modules/ui/shared/styles/tests/forced-colors-theme.unit.test.mjs",
        "dev-tools/helpers/tests/test_control_plane_forced_colors_profile.py",
        "apps/desktop/src/renderer/styles/app.css",
        "apps/thin-client/src/styles/app.css"
    ],
    "notification-dismiss-focus": [
        "modules/ui/shared/notifications/NotificationCenter.tsx",
        "modules/ui/shared/notifications/tests/notification-dismiss-focus.ui.test.tsx",
    ],
    "model-file-listing": [
        "modules/adapters/model/local/createLocalModelFileListerAdapter.ts",
        "modules/application/use-cases/model/list-model-files.use-case.ts",
        "modules/adapters/model/local/tests/createLocalModelFileListerAdapter.unit.test.ts",
        "modules/application/use-cases/model/tests/list-model-files.use-case.unit.test.ts",
    ],
    "model-file-delete-ack": [
        "modules/application/use-cases/model/delete-model-record.use-case.ts",
        "modules/application/use-cases/model/tests/delete-model-record.use-case.unit.test.ts",
        "dev-tools/helpers/tests/test_control_plane_model_file_delete_ack_profile.py",
    ],
    "model-download-ownership": [
        "modules/adapters/runtime/python/createPythonRuntimeTaskRegistryAdapter.ts",
        "modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts",
    ],
    "offload-resource-lifecycle": ['modules/adapters/runtime/python/worker/tasks/bounded_model_inputs.py', 'modules/adapters/runtime/python/worker/tests/test_bounded_model_inputs.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_sources.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_sources.py', 'modules/adapters/runtime/python/worker/tasks/local_model_offload.py', 'modules/adapters/runtime/python/worker/tasks/bounded_model_loader.py', 'modules/adapters/runtime/python/worker/tasks/local_text_generation.py', 'modules/adapters/runtime/python/worker/tasks/offload_recovery.py', 'modules/adapters/runtime/python/worker/tests/test_offload_recovery.py', 'dev-tools/scripts/qualification/run_offload_resource_qualification.py', 'dev-tools/scripts/qualification/tests/test_offload_resource_qualification.py', 'dev-tools/helpers/tests/test_control_plane_offload_lifecycle_profile.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_core.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_backend.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_core.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_backend.py', 'dev-tools/scripts/qualification/qualify_windows_offload_core.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_core_qualification.py', 'dev-tools/scripts/qualification/windows_offload_core_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_core_fixture.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py', 'dev-tools/scripts/qualification/qualify_windows_offload_journal.py', 'dev-tools/scripts/qualification/windows_offload_journal_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_journal_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_journal_qualification.py', 'dev-tools/scripts/qualification/qualify_windows_offload_read_binding.py', 'dev-tools/scripts/qualification/windows_offload_read_binding_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_qualification.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_execution.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_execution_child.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_execution.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_execution_child.py', 'dev-tools/scripts/qualification/qualify_windows_offload_read_session.py', 'dev-tools/scripts/qualification/windows_offload_read_session_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_read_session_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_read_session_qualification.py', 'dev-tools/scripts/qualification/tests/test_offload_supplier_boundary.py', 'modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py', 'dev-tools/scripts/qualification/qualify_windows_offload_sources.py', 'dev-tools/scripts/qualification/windows_offload_sources_fixture.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_sources_fixture.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_source_ledger.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_native_session.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_source_session.py', 'modules/adapters/runtime/python/worker/tasks/windows_offload_source_session_child.py', 'dev-tools/scripts/qualification/qualify_windows_offload_source_session.py', 'dev-tools/scripts/qualification/windows_offload_source_session_fixture.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_source_session.py', 'modules/adapters/runtime/python/worker/tests/test_windows_offload_source_session_child.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_source_session_qualification.py', 'dev-tools/scripts/qualification/tests/test_windows_offload_source_session_fixture.py'],
    "model-qualification-scheduling": ['dev-tools/scripts/qualification/run_model_blocker_tests.py', 'dev-tools/scripts/qualification/tests/test_model_blocker_tests.py', 'dev-tools/helpers/tests/test_control_plane_model_scheduling_profile.py'],
    "windows-guarded-tree-probe": ['dev-tools/scripts/native/probe_windows_guarded_tree.py', 'dev-tools/scripts/native/tests/test_windows_guarded_tree_probe.py', 'dev-tools/helpers/tests/test_control_plane_tree_probe_profile.py'],
    "windows-guarded-inventory-probe": ['dev-tools/scripts/native/probe_windows_guarded_inventory.py', 'dev-tools/scripts/native/tests/test_windows_guarded_inventory_probe.py', 'dev-tools/helpers/tests/test_control_plane_inventory_probe_profile.py'],
    "windows-owned-job-probe": ['dev-tools/scripts/native/probe_windows_owned_job.py', 'dev-tools/scripts/native/tests/test_windows_owned_job_probe.py', 'dev-tools/helpers/tests/test_control_plane_owned_job_probe_profile.py'],
    "windows-file-protection-probe": ['dev-tools/scripts/native/probe_windows_file_protection.py', 'dev-tools/scripts/native/tests/test_windows_file_protection_probe.py', 'dev-tools/helpers/tests/test_control_plane_file_probe_profile.py'],
    "windows-staging-protection-probe": ['dev-tools/scripts/native/probe_windows_staging_protection.py', 'dev-tools/scripts/native/tests/test_windows_staging_protection_probe.py', 'dev-tools/helpers/tests/test_control_plane_staging_probe_profile.py'],
    "windows-file-identity": ['modules/adapters/model/local/native/windows/model_file_identity.cc', 'modules/adapters/model/local/windowsModelFileIdentityProtocol.ts', 'modules/adapters/model/local/createWindowsModelFileIdentityAdapter.ts', 'modules/adapters/model/local/tests/windows-model-file-identity.unit.test.ts', 'modules/adapters/model/local/tests/windows-model-file-identity.native.integration.test.ts', 'dev-tools/scripts/native/build_windows_model_file_identity.py', 'dev-tools/scripts/native/tests/test_build_windows_model_file_identity.py', 'dev-tools/helpers/tests/test_control_plane_windows_identity_profile.py'],
    "offload-restart-readiness": ['dev-tools/scripts/qualification/offload_guarded_restart.py', 'dev-tools/scripts/qualification/tests/test_offload_guarded_restart.py', 'dev-tools/helpers/tests/test_control_plane_offload_restart_readiness_profile.py'],
    "functional-host-ui": ['dev-tools/scripts/qualification/visual-composer/functional-host-oracles.ts', 'dev-tools/scripts/qualification/visual-composer/functional-host-launch-plan.mjs', 'dev-tools/scripts/qualification/visual-composer/functional-host-global-setup.mjs', 'dev-tools/scripts/qualification/visual-composer/functional-host-server-entry.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/functional-host-common.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/model-reference-host-journey.ts', 'dev-tools/scripts/qualification/tests/functional-host-oracles.unit.test.ts', 'dev-tools/scripts/qualification/tests/functional-host-launch-plan.unit.test.mjs', 'dev-tools/scripts/qualification/tests/functional-host-wiring.unit.test.mjs', 'dev-tools/config/playwright.functional-host-desktop.config.ts', 'dev-tools/config/playwright.functional-host-thin.config.ts', 'dev-tools/helpers/tests/test_control_plane_functional_host_ui_profile.py', 'dev-tools/scripts/qualification/visual-composer/functional-artifact-oracles.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/artifact-lifecycle-host-journey.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/artifact-host-browser-reads.ts', 'dev-tools/scripts/qualification/visual-composer/functional-artifact-read-identity.mjs', 'dev-tools/scripts/qualification/tests/functional-artifact-oracles.unit.test.ts', 'dev-tools/scripts/qualification/tests/functional-artifact-read-identity.unit.test.mjs', 'dev-tools/scripts/qualification/tests/functional-artifact-wiring.unit.test.mjs', 'dev-tools/scripts/qualification/tests/functional-publication-denial.unit.test.ts', 'dev-tools/config/playwright.functional-artifact-desktop.config.ts', 'dev-tools/config/playwright.functional-artifact-thin.config.ts', 'dev-tools/scripts/qualification/visual-composer/functional-provider-plan.mjs', 'dev-tools/scripts/qualification/visual-composer/functional-private-provider-fixture.ts', 'dev-tools/scripts/qualification/visual-composer/functional-provider-oracles.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/provider-source-host-journey.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/private-publication-host-journey.ts', 'dev-tools/scripts/qualification/tests/functional-provider-plan.unit.test.mjs', 'dev-tools/scripts/qualification/tests/functional-private-provider-fixture.unit.test.ts', 'dev-tools/scripts/qualification/tests/functional-provider-witness.unit.test.ts', 'dev-tools/scripts/qualification/tests/functional-provider-oracles.unit.test.ts', 'dev-tools/scripts/qualification/tests/functional-provider-wiring.unit.test.mjs', 'dev-tools/scripts/qualification/tests/fixtures/functional-provider-loader-proof.mjs', 'dev-tools/config/playwright.functional-provider-desktop.config.ts', 'dev-tools/config/playwright.functional-provider-thin.config.ts', 'dev-tools/scripts/qualification/visual-composer/private-provider-artifact-boundary.mjs', 'dev-tools/scripts/qualification/visual-composer/private-provider-test.mjs', 'dev-tools/scripts/qualification/visual-composer/private-provider-test.d.mts', 'dev-tools/scripts/qualification/visual-composer/fixed-private-provider-reporter.mjs', 'dev-tools/scripts/qualification/tests/private-provider-ui-privacy.unit.test.mjs', 'dev-tools/scripts/qualification/tests/fixtures/private-provider-failure-probe.config.mjs', 'dev-tools/scripts/qualification/tests/fixtures/private-provider-failure-probe.spec.mjs', 'dev-tools/scripts/qualification/tests/fixtures/private-provider-failure-probe-reporter.mjs'],
    "comfyui-host-policy": [
        "modules/hosts/shared/resolveComfyUiAutoInstall.ts",
        "modules/hosts/shared/resolveComfyUiAutoInstall.unit.test.ts",
    ],
    "operational-ui": [
        "apps/desktop/src/renderer/features/python-runtime/hooks/usePythonRuntimeFooter.ts",
        "apps/desktop/src/renderer/features/python-runtime/components/PythonRuntimeFooter.tsx",
        "apps/desktop/src/renderer/features/python-runtime/api/desktopPythonRuntimeClient.ts",
        "apps/desktop/src/renderer/features/python-runtime/tests/python-runtime-controls.recovery.ui.test.tsx",
        "apps/desktop/src/renderer/features/python-runtime/tests/desktop-python-runtime-client.unit.test.ts",
        "modules/ui/shared/notifications/tests/notification-center-actions.ui.test.tsx",
        "modules/ui/shared/notifications/tests/notificationMigrationInventory.ts",
        "modules/ui/shared/notifications/tests/notificationMigrationGuard.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/operational-ui-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/operational-ui-oracles.ts",
        "dev-tools/scripts/qualification/tests/operational-ui-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts",
        "dev-tools/scripts/qualification/visual-composer/technical-accessibility-observation.ts",
        "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/critical-surface-accessibility.ts",
        "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
        "modules/ui/shared/hooks/useNavigationMenu.ts",
        "apps/desktop/src/renderer/components/layout/AppShell.tsx",
        "apps/thin-client/src/components/layout/AppShell.tsx",
        "dev-tools/config/playwright.review-site.config.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/website-acquisition-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/website-acquisition-oracles.ts",
        "dev-tools/scripts/qualification/tests/website-acquisition-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/model-training-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts",
        "dev-tools/scripts/qualification/visual-composer/training-host-launch-plan.mjs",
        "dev-tools/scripts/qualification/visual-composer/training-host-prerequisites.py",
        "dev-tools/scripts/qualification/visual-composer/training-host-fixture.ts",
        "dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py",
        "dev-tools/scripts/qualification/visual-composer/training-host-global-setup.mjs",
        "dev-tools/scripts/qualification/tests/model-training-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/training-host-launch-plan.unit.test.mjs",
        "dev-tools/scripts/qualification/tests/test_training_host_prerequisites.py",
        "dev-tools/scripts/qualification/tests/test_training_qualification_worker.py",
        "dev-tools/config/playwright.training-host.config.ts",
        "apps/desktop/src/renderer/features/image-generation/hooks/image-generation-draft-state.ts",
        "apps/desktop/src/renderer/features/image-generation/tests/image-generation-draft-state.unit.test.ts",
        "apps/desktop/src/renderer/features/image-generation/hooks/useImageGenerationFeature.ts",
        "dev-tools/scripts/qualification/tests/owned-native-process-exit.unit.test.mjs",
        "dev-tools/scripts/qualification/tests/test_observe_windows_process_exit.py",
        "dev-tools/scripts/qualification/visual-composer/image-generation-host-oracles.ts",
        "dev-tools/scripts/qualification/tests/image-generation-host-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/image-generation-host-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/image-host-launch-plan.mjs",
        "dev-tools/scripts/qualification/tests/image-host-launch-plan.unit.test.mjs",
        "dev-tools/scripts/qualification/visual-composer/image-host-inputs.mjs",
        "dev-tools/scripts/qualification/tests/image-host-inputs.unit.test.mjs",
        "dev-tools/scripts/qualification/visual-composer/image-host-fixture.ts",
        "dev-tools/scripts/qualification/visual-composer/image-host-input-records.ts",
        "dev-tools/scripts/qualification/tests/image-host-input-records.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/image-host-shutdown.mjs",
        "dev-tools/scripts/qualification/tests/image-host-shutdown.unit.test.mjs",
        "dev-tools/scripts/qualification/visual-composer/image-host-server-entry.ts",
        "dev-tools/scripts/qualification/visual-composer/image-host-global-setup.mjs",
        "dev-tools/scripts/qualification/tests/image-host-wiring.unit.test.mjs",
        "dev-tools/config/playwright.image-host-desktop.config.ts",
        "dev-tools/config/playwright.image-host-thin.config.ts",
        "dev-tools/scripts/qualification/tests/image-host-preview.unit.test.ts",
        "dev-tools/scripts/qualification/visual-composer/owned-host-shutdown.mjs",
        "dev-tools/scripts/qualification/visual-composer/settings-host-launch-plan.mjs",
        "dev-tools/scripts/qualification/visual-composer/settings-host-global-setup.mjs",
        "dev-tools/scripts/qualification/visual-composer/settings-host-oracles.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/settings-host-journey.ts",
        "dev-tools/config/playwright.settings-host-desktop.config.ts",
        "dev-tools/config/playwright.settings-host-thin.config.ts",
        "dev-tools/scripts/qualification/tests/settings-host-launch-plan.unit.test.mjs",
        "dev-tools/scripts/qualification/tests/owned-host-shutdown.unit.test.mjs",
        "dev-tools/scripts/qualification/tests/settings-host-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/settings-host-wiring.unit.test.mjs",
        "modules/ui/shared/styles/components/home.css",
        "modules/ui/shared/styles/components/notifications.css",
        "dev-tools/scripts/qualification/visual-composer/e2e/functional-host-common.ts",
    ],
    "security-status-ui": [
        "apps/thin-client/src/features/security/hooks/useThinClientSecurity.ts",
        "apps/thin-client/src/features/security/components/SecurityStatusPanel.tsx",
        "apps/thin-client/src/features/security/hooks/tests/useThinClientSecurity.unit.test.ts",
        "apps/thin-client/src/features/security/components/SecurityStatusPanel.unit.test.tsx",
        "apps/thin-client/src/features/security/hooks/tests/useThinClientSecurity.recovery.ui.test.tsx",
        "apps/thin-client/src/security/pairedDeviceTokenStore.ts",
        "apps/thin-client/src/security/tests/paired-device-token-store.unit.test.ts",
        "apps/thin-client/src/security/securityApiClient.ts",
        "apps/thin-client/src/security/tests/securityApiClient.unit.test.ts",
        "apps/thin-client/src/security/securityErrors.ts",
        "apps/thin-client/src/security/tests/security-errors.unit.test.ts",
        "apps/thin-client/README.md",
    ],
    "settings-ui": [
        "apps/desktop/src/renderer/features/settings/hooks/useApplicationSettings.ts",
        "apps/desktop/src/renderer/features/settings/components/SettingsPanel.tsx",
        "apps/desktop/src/renderer/features/settings/components/SettingsStatusMessage.tsx",
        "apps/desktop/src/renderer/features/settings/components/SettingField.tsx",
        "apps/desktop/src/renderer/features/settings/components/SecretSettingField.tsx",
        "apps/desktop/src/renderer/features/settings/components/ModelDefaultSettingField.tsx",
        "apps/desktop/src/renderer/features/settings/api/desktopApplicationSettingsClient.ts",
        "apps/desktop/src/renderer/features/settings/tests/settings-panel.unit.test.tsx",
        "apps/desktop/src/renderer/features/settings/tests/settings-page.unit.test.tsx",
        "apps/desktop/src/renderer/features/settings/tests/settings-recovery.ui.test.tsx",
        "apps/desktop/src/renderer/features/settings/README.md",
        "apps/desktop/src/renderer/lib/applicationSettingsApi.ts",
        "apps/desktop/src/renderer/lib/application-settings-api.unit.test.ts",
        "modules/ui/shared/settings/SettingField.tsx",
        "modules/ui/shared/settings/SecretSettingField.tsx",
        "modules/ui/shared/settings/ModelDefaultSettingField.tsx",
        "modules/ui/shared/settings/index.ts",
        "apps/thin-client/src/pages/SettingsPage.tsx",
        "apps/thin-client/src/features/settings/hooks/useThinClientSettings.ts",
        "apps/thin-client/src/features/settings/api/apiApplicationSettingsClient.ts",
        "apps/thin-client/src/pages/tests/settings-recovery.ui.test.tsx",
        "apps/thin-client/src/features/settings/tests/api-application-settings-client.unit.test.ts",
        "modules/ui/shared/settings/tests/SettingField.unit.test.tsx",
    ],
    "host-setup-policy": [
        "dev-tools/scripts/qualification/visual-composer/visual-composer-qualification-environment.mjs",
        "dev-tools/scripts/qualification/visual-composer/visual-composer-global-setup.mjs",
        "dev-tools/scripts/qualification/tests/visual-composer-host-lifecycle.unit.test.mjs",
        "dev-tools/scripts/qualification/tests/settings-public-identity.unit.test.mjs",
        "dev-tools/helpers/tests/test_control_plane_settings_public_identity_profile.py",
        "dev-tools/scripts/qualification/visual-composer/settings-host-server-entry.ts",
        "dev-tools/scripts/qualification/visual-composer/settings-host-listener.mjs",
        "dev-tools/scripts/qualification/visual-composer/settings-host-listener.d.mts",
        "dev-tools/scripts/qualification/tests/settings-host-listener.unit.test.mjs",
    ],
    "native-host-policy": [
        "dev-tools/helpers/native-qualification/training_operator.py",
        "dev-tools/helpers/native-qualification/tests/test_training_operator.py",
        "dev-tools/helpers/native-qualification/training-operator/global-setup.mjs",
        "dev-tools/helpers/native-qualification/training-operator/offline-package.mjs",
        "dev-tools/helpers/native-qualification/training-operator/package-tree.mjs",
        "dev-tools/helpers/native-qualification/training-operator/playwright.config.mjs",
        "dev-tools/helpers/native-qualification/owned_command_job.py",
        "dev-tools/helpers/native-qualification/tests/test_owned_command_job.py",
        "dev-tools/helpers/native-qualification/serial_provided_coordinator.py",
        "dev-tools/helpers/native-qualification/tests/test_serial_provided_coordinator.py",
        "dev-tools/helpers/native-qualification/README.md",
    ],
    "dataset-semantic-curation": [
        "modules/adapters/runtime/python/worker/tasks/semantic_curation.py",
        "modules/adapters/runtime/python/worker/tests/test_semantic_curation.py",
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
    "review-site": ["dev-tools/review-site/index.html", "dev-tools/review-site/app.js", "dev-tools/review-site/style.css", "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
                    "dev-tools/scripts/qualification/visual-composer/e2e/review-site-journey.ts",
                    "dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",
                    "dev-tools/scripts/qualification/tests/review-site-oracles.unit.test.ts"],
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
    "asset-authoring-ui": [
        "dev-tools/scripts/qualification/visual-composer/e2e/asset-experience-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-asset-experience.e2e.spec.ts",
        "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-asset-experience.e2e.spec.ts",
        "dev-tools/scripts/qualification/visual-composer/asset-experience-oracles.ts",
        "dev-tools/scripts/qualification/tests/asset-experience-oracles.unit.test.ts",
    ],
}


def definitions(root: Path) -> list[dict]:
    node = "node"
    py = sys.executable
    return [
        {"id": "completion-standardande2e", "patterns": [], "argv": [node, "dev-tools/scripts/testing/run-test-suite.mjs", "--suite=standardande2e"], "timeout": 1800},
        {"id": "completion-all", "patterns": [], "argv": [node, "dev-tools/scripts/testing/run-test-suite.mjs", "--suite=all"], "timeout": 1800},
        {"id": "headless-context-pack-worker", "patterns": [
            "modules/adapters/runtime/python/worker/tasks/context_generation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_generation.py",
            "modules/adapters/runtime/python/worker/README.md"],
         "argv": [py, "-B", "-m", "unittest", "-v",
            "modules.adapters.runtime.python.worker.tests.test_context_generation.ContextGenerationTests.test_source_pack_preserves_recorded_terms_in_inspection_and_archive_without_models",
            "modules.adapters.runtime.python.worker.tests.test_context_generation.ContextGenerationTests.test_recorded_rag_terms_respect_attribution_selection_before_embedding"], "timeout": 120},
        {"id": "headless-context-model-worker", "patterns": [
            "modules/adapters/runtime/python/worker/models.py",
            "modules/adapters/runtime/python/worker/tasks/context_generation.py",
            "modules/adapters/runtime/python/worker/tests/test_context_generation.py",
            "modules/adapters/runtime/python/worker/tests/test_model_download_revision.py"],
         "argv": [py, "-B", "-m", "unittest", "-v",
            "modules.adapters.runtime.python.worker.tests.test_context_generation.ContextGenerationTests",
            "modules.adapters.runtime.python.worker.tests.test_model_download_revision.ModelDownloadRevisionTests"], "timeout": 120},
        *[{"id": name, "patterns": list(QUALIFICATION_PROFILE_PATTERNS.get(name, [])), "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--profile", name], "timeout": 660 if name == "review-site" else 300} for name in QUALIFICATION_PROFILES],
        *[{"id": name, "patterns": [form, test],
           "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--regression-test", test],
           "timeout": 120} for name, (form, test) in IMAGE_FORM_CHECKS.items()],
        *[{"id": name, "patterns": [],
           "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--regression-test", test],
           "timeout": 120} for name, (_, test) in OPT_IN_REGRESSION_CHECKS.items()],
        *[{"id": name, "patterns": [], "argv": [*([py, "-B"] if check.get("interpreter") == "python" else [node]), *check["command"]], "timeout": check.get("timeout", 120)}
          for name, check in PUBLISHED_FORM_CHECKS.items()],
        {"id": HEADLESS_DESKTOP_READ_CHECK, "patterns": [],
         "argv": [node, "--import", "tsx", "--test", "--",
                  "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts",
                  "modules/contracts/headless/tests/headless-read-request.unit.test.ts"],
         "timeout": 120},
        {"id": HEADLESS_DESKTOP_ACTIVATION_CHECK, "patterns": [],
         "argv": [node, "--import", "tsx", "--test", "--",
                  "apps/desktop/src/main/tests/desktop-headless-pairing-ipc.unit.test.ts",
                  "modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts",
                  "modules/hosts/desktop/composition/tests/desktop-headless-task-list.unit.test.ts",
                  "modules/hosts/desktop/composition/tests/desktop-headless-authoring.unit.test.ts",
                  "modules/hosts/desktop/composition/tests/desktop-headless-conversation.unit.test.ts",
                  "modules/hosts/desktop/composition/tests/desktop-system-change-poll.unit.test.ts",
                  "apps/desktop/src/renderer/features/system-builder/api/observeDesktopSavedSystems.unit.test.ts",
                  "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
                  "modules/adapters/persistence/system-builder/tests/structured-system-builder-repository.unit.test.ts",
                  "modules/adapters/security/headless/tests/desktop-headless-client-authority.unit.test.ts",
                  "modules/adapters/transport/headless-loopback/tests/desktop-headless-loopback.unit.test.ts"],
         "timeout": 120},
        {"id": HEADLESS_MCP_CHECK, "patterns": list(HEADLESS_MCP_SOURCES),
         "argv": [node, "--import", "tsx", "--test", "--",
                  "modules/adapters/transport/headless-loopback/tests/desktop-headless-loopback.unit.test.ts",
                  "modules/adapters/transport/headless-mcp/tests/headless-mcp-stdio.unit.test.ts",
                  "dev-tools/scripts/agent-support/tests/headless-plan-skill.unit.test.ts"],
         "timeout": 120},
        {"id": HEADLESS_PACKAGED_CHECK, "patterns": [],
         "argv": [node, "node_modules/@playwright/test/cli.js", "test",
                  "--config=dev-tools/config/playwright.visual-composer.config.ts", "--project=packaged-desktop",
                  "packaged-desktop-headless.e2e.spec.ts", "packaged-desktop-ui-takeover.e2e.spec.ts"],
         "timeout": 720},
        {"id": "asset-defensive-acceptance", "patterns": [],
         "argv": [node, "--import", "tsx", "--test", "--test-concurrency=1", "--", *ASSET_DEFENSIVE_TESTS],
         "timeout": 180},
        {"id": "standard-source-fixture-runner", "patterns": [],
         "argv": [node, "--import", "tsx", "--test", "--", STANDARD_RUNNER_CORE_TEST], "timeout": 120},
        {"id": "asset-browser-qualification-contract", "patterns": [],
         "argv": [node, "--import", "tsx", "--test", "--", ASSET_BROWSER_SOURCES[1],
                  "modules/ui/shared/styles/tests/page-dashboard-layout.unit.test.ts"], "timeout": 120},
        {"id": "documentation", "patterns": ["docs/*", "*.md", "skills/*/*.md", "dev-tools/*/*.md"], "argv": [node, "dev-tools/scripts/docs/check-doc-drift.mjs"], "timeout": 120},
        {"id": "agent-support", "patterns": ["AGENTS.md", "skills/*", "docs/context/*", "dev-tools/agent-evals/*", "dev-tools/helpers/*", "dev-tools/review-site/*"], "argv": [node, "dev-tools/scripts/agent-support/check-agent-support.mjs"], "timeout": 120},
        {"id": "control-plane", "patterns": ["dev-tools/helpers/control_plane/*", "dev-tools/helpers/development_control_plane.py", "dev-tools/helpers/run_focused_checks.py", "dev-tools/helpers/requirements-tests.txt", "dev-tools/config/pytest-focused.ini", "dev-tools/config/contributor-check-profiles.json", "dev-tools/helpers/tests/*", "dev-tools/review-site/*"], "argv": [py, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py"], "timeout": 600},
        {"id": "roadmap", "patterns": ["skills/manage-implementation-roadmaps/*"], "argv": [py, "-B", "skills/manage-implementation-roadmaps/tests/test_roadmap.py"], "timeout": 120},
        {"id": "architecture", "patterns": ["modules/*", "apps/*", "dev-tools/scripts/architecture/*"], "argv": [node, "dev-tools/scripts/architecture/check-module-dependencies.mjs"], "timeout": 120},
        {"id": "focused-tests", "patterns": ["modules/*", "apps/*", "dev-tools/scripts/*", "dev-tools/config/*"], "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py"], "timeout": 300},
        {"id": "dependencies", "patterns": ["package.json", "package-lock.json", "apps/*/package.json", ".github/workflows/*", "deployments/*", "dev-tools/vendor/*", "dev-tools/helpers/requirements-tests.txt", "*webpack*", "*tsconfig*", "dev-tools/scripts/native/build_windows_ocr.py", "dev-tools/scripts/native/build_windows_ocr.cjs", "dev-tools/scripts/native/build_windows_model_file_identity.py", "apps/desktop/forge.config.js"], "argv": [node, "dev-tools/scripts/security/check-dependency-security.mjs"], "timeout": 300},
        {"id": "evaluation", "patterns": ["dev-tools/agent-evals/*"], "argv": [py, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane_evaluations.py"], "timeout": 120},
        {"id": "repository-policy", "patterns": [".gitignore", ".gitattributes", "dev-tools/helpers/*.json"], "argv": [node, "dev-tools/scripts/agent-support/check-agent-support.mjs"], "timeout": 120},
        {"id": "managed-saved-state-postgres-migration", "patterns": ["migrations/postgres/0003-index-workspace-saved-state.sql"],
         "argv": [node, "--import", "tsx", "--test", "--", "modules/adapters/persistence/postgres/tests/postgres-database.unit.test.ts"],
         "timeout": 120},
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


def _automatic_files_available(root: Path, check: dict) -> bool:
    """An opted-in automatic profile cannot cover files absent from this root.

    Presence is not passing evidence; its fixed commands must still execute.
    Missing files/aliases retain generic fallback in incomplete source roots.
    """
    names = check.get("automatic_required_files", ())
    if not isinstance(names, (tuple, list)) or len(names) > 16:
        return False
    try:
        for name in names:
            parts = relative(name).split("/")
            if len(parts) > 32:
                return False
            confined_path(root, name)
            cursor = root
            for index, part in enumerate(parts):
                cursor = cursor / part
                facts = cursor.lstat()
                if stat.S_ISLNK(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
                    return False
                if not (stat.S_ISREG(facts.st_mode) if index == len(parts) - 1 else stat.S_ISDIR(facts.st_mode)):
                    return False
        return True
    except (OSError, ControlError, ValueError, TypeError):
        return False


def plan(root: Path, paths: list[str], required: list[str], candidate: str) -> dict:
    checks = definitions(root)
    ids = {c["id"] for c in checks}
    if not required or set(required) - ids:
        refuse("verification.check-id", "Acceptance references an unavailable check identity.")
    # A form-only UI check never claims coverage of the shared Canvas CSS.
    # Include its existing stylesheet contracts only for the explicit Form slice.
    required = set(required)
    explicit_required = set(required)
    headless_explicit = HEADLESS_DESKTOP_READ_CHECK in required
    headless_sources = HEADLESS_DESKTOP_READ_SOURCES if headless_explicit else HEADLESS_DESKTOP_READ_AUTOMATIC_SOURCES
    activation_explicit = HEADLESS_DESKTOP_ACTIVATION_CHECK in required
    activation_sources = HEADLESS_DESKTOP_ACTIVATION_SCOPED_SOURCES if activation_explicit else HEADLESS_DESKTOP_ACTIVATION_AUTOMATIC_SOURCES
    if set(paths).intersection(HEADLESS_DESKTOP_READ_AUTOMATIC_SOURCES):
        required.add(HEADLESS_DESKTOP_READ_CHECK)
    if set(paths).intersection(HEADLESS_DESKTOP_ACTIVATION_AUTOMATIC_SOURCES):
        required.add(HEADLESS_DESKTOP_ACTIVATION_CHECK)
    required.update(name for name, check in PUBLISHED_FORM_CHECKS.items()
                    if set(paths).intersection(check.get("automatic_sources", ())) and _automatic_files_available(root, check))
    required.update(name for name, check in PUBLISHED_FORM_CHECKS.items()
                    if check.get("companion_to") in required and set(paths).intersection(check["sources"]))
    # Exact training fixture/producer files have their own executed regression
    # profile. They do not require unrelated operational UI fixtures. Preserve
    # explicit operational coverage, unavailable-file and every other-path rule.
    training_fixture = PUBLISHED_FORM_CHECKS["training-local-loader-fixture-unit"]
    isolated_training_fixture = ("training-local-loader-fixture-unit" in required and
                                 _automatic_files_available(root, training_fixture))
    covered = {p: [c["id"] for c in checks
                   if (any(fnmatch.fnmatchcase(p, pat) for pat in c["patterns"]) and not (
                       c["id"] == "operational-ui" and c["id"] not in explicit_required and
                       isolated_training_fixture and p in training_fixture["automatic_sources"]))
                   or (c["id"] in required and (
                       p in OPT_IN_REGRESSION_CHECKS.get(c["id"], ()) or
                       (c["id"] == HEADLESS_DESKTOP_READ_CHECK and p in headless_sources) or
                       (c["id"] == HEADLESS_DESKTOP_ACTIVATION_CHECK and p in activation_sources) or
                       (c["id"] == HEADLESS_PACKAGED_CHECK and p in HEADLESS_PACKAGED_SOURCES) or
                       p in PUBLISHED_FORM_CHECKS.get(c["id"], {}).get("sources", ()) or
                       (c["id"] == "standard-source-fixture-runner" and p in STANDARD_RUNNER_SOURCES) or
                       (c["id"] == "asset-browser-qualification-contract" and p in ASSET_BROWSER_SOURCES)
                   ))]
               for p in paths}
    # The fixed controller config is exercised by controller routing/isolation
    # tests. Generic config ownership has no runnable test files for this INI.
    if "dev-tools/config/pytest-focused.ini" in covered:
        covered["dev-tools/config/pytest-focused.ini"] = [name for name in covered["dev-tools/config/pytest-focused.ini"] if name != "focused-tests"]
    if any(not matches for matches in covered.values()):
        refuse("verification.unclassified-impact", "Every changed path must have a tracked verification rule.", "Add a bounded catalog rule and a regression test for the uncovered impact.")
    selected = [c for c in checks if c["id"] in required or any(c["id"] in matches for matches in covered.values())]
    selected_ids = {c["id"] for c in selected}
    declared_sources = {path for check, paths in IMAGE_FORM_CHECKS.items() if check in selected_ids for path in paths}
    declared_sources.update(path for check in required for path in OPT_IN_REGRESSION_CHECKS.get(check, ()))
    declared_sources.update(path for check in required for path in PUBLISHED_FORM_CHECKS.get(check, {}).get("sources", ()))
    if "standard-source-fixture-runner" in required:
        declared_sources.update(STANDARD_RUNNER_SOURCES)
    if "asset-browser-qualification-contract" in required:
        declared_sources.update(ASSET_BROWSER_SOURCES)
    if HEADLESS_DESKTOP_READ_CHECK in required:
        declared_sources.update(headless_sources)
    if HEADLESS_DESKTOP_ACTIVATION_CHECK in required:
        declared_sources.update(activation_sources)
    if HEADLESS_MCP_CHECK in selected_ids:
        declared_sources.update(HEADLESS_MCP_SOURCES)
    if HEADLESS_PACKAGED_CHECK in required:
        declared_sources.update(HEADLESS_PACKAGED_SOURCES)
    selected_profiles = [name for name in QUALIFICATION_PROFILES if name in selected_ids]
    if selected_profiles:
        data = read_json(confined_path(root, "dev-tools/config/contributor-check-profiles.json"))
        fields(data, {"schema_version", "profiles"}, {"schema_version", "profiles"})
        if data["schema_version"] != "contributor-check-profiles-v1" or not isinstance(data["profiles"], dict):
            refuse("verification.profile-schema", "Use the versioned source-owned profile schema.")
    for profile_id in selected_profiles:
        profile = data.get("profiles", {}).get(profile_id)
        fields(profile, {"test_paths", "source_paths"}, {"test_paths", "source_paths"})
        source_paths = profile["source_paths"]
        if not isinstance(source_paths, list) or not 1 <= len(source_paths) <= 200 or not all(isinstance(p, str) for p in source_paths):
            refuse("verification.profile-coverage", "Use bounded explicit source coverage for a registered profile.")
        test_paths = profile["test_paths"]
        if (not isinstance(test_paths, list) or not 1 <= len(test_paths) <= 100
                or not all(isinstance(p, str) for p in test_paths)
                or len(set(test_paths)) != len(test_paths)):
            refuse("verification.profile-coverage", "Use bounded explicit tests for a registered profile.")
        declared_sources.update(relative(p) for p in source_paths + test_paths)
    # Joint ownership comes only from selected, individually valid profiles and exact checks.
    # Unknown paths and an explicitly requested generic check retain fallback.
    focused = [p for p, matches in covered.items() if "focused-tests" in matches]
    if "focused-tests" not in required and all(p in declared_sources for p in focused):
        selected = [c for c in selected if c["id"] != "focused-tests"]
    # Only a complete known storage scope can use the related framework suites.
    # Exact story/task sources have complete related controller coverage. Unknown
    # paths, missing support and an explicit generic request retain the fallback.
    story_check = PUBLISHED_FORM_CHECKS["story-task-bindings"]
    if ("story-task-bindings" in selected_ids and paths and set(paths) <= set(STORY_TASK_SCOPE)
            and "control-plane" not in explicit_required and _automatic_files_available(root, story_check)):
        selected = [check for check in selected if check["id"] != "control-plane"]
    # Empty/mixed/unknown scope or missing/nonregular support retains the ordinary
    # complete controller command. The actual argv is bound to plan and receipt.
    storage_files = ROADMAP_STORAGE_SCOPE + ROADMAP_STORAGE_CONTROLLER_TESTS
    if (set(paths) == set(ROADMAP_STORAGE_SCOPE) and
            all(_automatic_files_available(root, {"automatic_required_files": storage_files[index:index+16]})
                for index in range(0, len(storage_files), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "dev-tools/helpers/tests/test_control_plane_roadmap_storage.py", "--related"]
    if (set(paths) == set(DETERMINISTIC_SUPPORT_SCOPE) and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": DETERMINISTIC_SUPPORT_REQUIRED[index:index+16]})
                for index in range(0, len(DETERMINISTIC_SUPPORT_REQUIRED), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            # Discovery preserves sibling imports; repeated native unittest -k
            # filters execute only these two existing regression modules.
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                                  "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                                  "-k", "test_control_plane_deterministic_support.",
                                  "-k", "test_control_plane_focused."]
    model_training_support = (MODEL_TRAINING_BOUND_REQUIRED
                             + PUBLISHED_FORM_CHECKS["headless-training-result-validation-unit"]["automatic_required_files"])
    if (set(MODEL_TRAINING_ROUTING_SCOPE) <= set(paths) <= set(MODEL_TRAINING_BOUND_SCOPE + MODEL_TRAINING_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": model_training_support[index:index+16]})
                for index in range(0, len(model_training_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            # All related modules run, including their actual complete text/
            # image/parser commands and environment/negative routing cases. This does
            # not trim the model regression file or relax another check limit.
            # Known owner edits remain covered by their independent automatic/
            # required checks; unknown mixed work keeps the broad fallback.
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                                  "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                                  "-k", "test_control_plane_model_training_worker.",
                                  "-k", "test_control_plane_focused.",
                                  "-k", "test_control_plane_training_result_validation."]
    result_support = (TRAINING_RESULT_ROUTING_SCOPE + TRAINING_RESULT_OWNER_SCOPE + TRAINING_RESULT_CONTROLLER_TESTS
                      + PUBLISHED_FORM_CHECKS["headless-training-result-validation-unit"]["automatic_required_files"])
    if (set(TRAINING_RESULT_ROUTING_SCOPE) <= set(paths) <= set(TRAINING_RESULT_ROUTING_SCOPE + TRAINING_RESULT_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": result_support[index:index+16]})
                for index in range(0, len(result_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            # Reuse the closed-scope mechanism for the result parser and its
            # routing. Run complete related suites, including actual fixed
            # model/Native commands, under the unchanged controller limit.
            # Unknown, mixed, incomplete or explicitly generic work retains
            # full controller discovery; this is not final suite qualification.
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                                  "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                                  *[item for name in TRAINING_RESULT_CONTROLLER_FILTERS for item in ("-k", name)]]
    retirement_support = (TRAINING_OUTPUT_RETIREMENT_SCOPE + TRAINING_OUTPUT_RETIREMENT_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_OUTPUT_RETIREMENT_CONTROLLER_FILTERS)
        + PUBLISHED_FORM_CHECKS["headless-training-runtime-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-runtime-worker-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-result-validation-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-output-retirement-unit"]["automatic_required_files"])
    if (set(TRAINING_OUTPUT_RETIREMENT_SCOPE) <= set(paths) <= set(TRAINING_OUTPUT_RETIREMENT_SCOPE + TRAINING_OUTPUT_RETIREMENT_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": retirement_support[index:index+16]})
                for index in range(0, len(retirement_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            # Whole related routing modules retain actual Native/session/parser
            # execution. This closed owner scope is no final suite qualification.
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_OUTPUT_RETIREMENT_CONTROLLER_FILTERS for item in ("-k", name)]]
    workflow_support = (PROTECTED_TRAINING_WORKFLOW_SCOPE + PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in PROTECTED_TRAINING_WORKFLOW_CONTROLLER_FILTERS)
        + PUBLISHED_FORM_CHECKS["headless-protected-training-workflow-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-runtime-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-output-retirement-unit"]["automatic_required_files"])
    if (set(PROTECTED_TRAINING_WORKFLOW_SCOPE) <= set(paths) <= set(PROTECTED_TRAINING_WORKFLOW_SCOPE + PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": workflow_support[index:index+16]})
                for index in range(0, len(workflow_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            # Whole related routing suites execute their actual fixed feature
            # commands. The full existing text-worker regression remains an
            # independently selected required check for this source Work; do
            # not repeat that long unchanged command inside its routing suite.
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in PROTECTED_TRAINING_WORKFLOW_CONTROLLER_FILTERS for item in ("-k", name)]]
    files_support = (ORIGINAL_TRAINING_FILES_SCOPE + ORIGINAL_TRAINING_FILES_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in ORIGINAL_TRAINING_FILES_CONTROLLER_FILTERS)
        + PUBLISHED_FORM_CHECKS["headless-original-training-files-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-runtime-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-runtime-worker-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-protected-training-workflow-unit"]["automatic_required_files"]
        + PUBLISHED_FORM_CHECKS["headless-training-output-retirement-unit"]["automatic_required_files"])
    if (set(ORIGINAL_TRAINING_FILES_SCOPE) <= set(paths) <= set(ORIGINAL_TRAINING_FILES_SCOPE + ORIGINAL_TRAINING_FILES_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": files_support[index:index+16]})
                for index in range(0, len(files_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in ORIGINAL_TRAINING_FILES_CONTROLLER_FILTERS for item in ("-k", name)]]
    delivery_support = (TRAINING_OUTPUT_DELIVERY_SCOPE + TRAINING_OUTPUT_DELIVERY_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_OUTPUT_DELIVERY_CONTROLLER_FILTERS)
        + tuple(name for identity in ("headless-training-output-delivery-unit","headless-original-training-files-unit",
            "headless-training-runtime-unit","headless-training-runtime-worker-unit",
            "headless-protected-training-workflow-unit","headless-training-output-retirement-unit")
            for name in PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))
    if (set(TRAINING_OUTPUT_DELIVERY_SCOPE) <= set(paths) <= set(TRAINING_OUTPUT_DELIVERY_SCOPE + TRAINING_OUTPUT_DELIVERY_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": delivery_support[index:index+16]})
                for index in range(0, len(delivery_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_OUTPUT_DELIVERY_CONTROLLER_FILTERS for item in ("-k", name)]]
    channel_support = (TRAINING_OUTPUT_CHANNEL_SCOPE + TRAINING_OUTPUT_CHANNEL_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_OUTPUT_CHANNEL_CONTROLLER_FILTERS)
        + tuple(name for identity in ("headless-training-output-channel-unit","headless-training-output-delivery-unit",
            "headless-training-runtime-unit","headless-training-runtime-worker-unit")
            for name in PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))
    if (set(TRAINING_OUTPUT_CHANNEL_SCOPE) <= set(paths) <= set(TRAINING_OUTPUT_CHANNEL_SCOPE + TRAINING_OUTPUT_CHANNEL_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": channel_support[index:index+16]})
                for index in range(0, len(channel_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_OUTPUT_CHANNEL_CONTROLLER_FILTERS for item in ("-k", name)]]
    receiver_support = (TRAINING_OUTPUT_RECEIVER_SCOPE + TRAINING_OUTPUT_RECEIVER_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_OUTPUT_RECEIVER_CONTROLLER_FILTERS)
        + tuple(name for identity in ("headless-training-runtime-unit", "headless-training-output-channel-unit")
            for name in PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))
    if (set(TRAINING_OUTPUT_RECEIVER_SCOPE) <= set(paths) <= set(TRAINING_OUTPUT_RECEIVER_SCOPE + TRAINING_OUTPUT_RECEIVER_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": receiver_support[index:index+16]})
                for index in range(0, len(receiver_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_OUTPUT_RECEIVER_CONTROLLER_FILTERS for item in ("-k", name)]]
    exit_support = (TRAINING_EXIT_BARRIER_SCOPE + TRAINING_EXIT_BARRIER_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_EXIT_BARRIER_CONTROLLER_FILTERS)
        + tuple(name for identity in ("headless-training-exit-barrier-unit", "headless-original-training-files-unit",
            "headless-training-output-channel-unit") for name in PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))
    if (set(TRAINING_EXIT_BARRIER_SCOPE) <= set(paths) <= set(TRAINING_EXIT_BARRIER_SCOPE + TRAINING_EXIT_BARRIER_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": exit_support[index:index+16]})
                for index in range(0, len(exit_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_EXIT_BARRIER_CONTROLLER_FILTERS for item in ("-k", name)]]
    io_support = (TRAINING_IO_RETIREMENT_SCOPE + TRAINING_IO_RETIREMENT_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_IO_RETIREMENT_CONTROLLER_FILTERS)
        + tuple(name for identity in ("headless-training-io-retirement-unit", "headless-training-runtime-unit")
            for name in PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))
    if (set(TRAINING_IO_RETIREMENT_SCOPE) <= set(paths) <= set(TRAINING_IO_RETIREMENT_SCOPE + TRAINING_IO_RETIREMENT_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": io_support[index:index+16]})
                for index in range(0, len(io_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_IO_RETIREMENT_CONTROLLER_FILTERS for item in ("-k", name)]]
    session_exit_support = (TRAINING_SESSION_EXIT_SCOPE + TRAINING_SESSION_EXIT_OWNER_SCOPE
        + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in TRAINING_SESSION_EXIT_CONTROLLER_FILTERS)
        + tuple(name for identity in ("headless-training-session-exit-ready-unit", "headless-training-runtime-unit",
            "headless-training-runtime-worker-unit", "headless-training-exit-barrier-unit")
            for name in PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))
    if (set(TRAINING_SESSION_EXIT_SCOPE) <= set(paths) <= set(TRAINING_SESSION_EXIT_SCOPE + TRAINING_SESSION_EXIT_OWNER_SCOPE)
            and "focused-tests" not in explicit_required and
            all(_automatic_files_available(root, {"automatic_required_files": session_exit_support[index:index+16]})
                for index in range(0, len(session_exit_support), 16))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        if controller is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover",
                "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
                *[item for name in TRAINING_SESSION_EXIT_CONTROLLER_FILTERS for item in ("-k", name)]]
    if ("focused-tests" not in explicit_required and any(
            set(paths) == set(scope) and all(
                _automatic_files_available(root, {"automatic_required_files": support[index:index+16]})
                for index in range(0, len(support), 16))
            for scope, support in ((TOKEN_USAGE_SCOPE, TOKEN_USAGE_REQUIRED), (TOKEN_DASHBOARD_SCOPE, TOKEN_DASHBOARD_REQUIRED),
                                   (TOKEN_CAPTURE_SCOPE, TOKEN_CAPTURE_REQUIRED), (TOKEN_LOCAL_SCOPE, TOKEN_LOCAL_REQUIRED),
                                   (TOKEN_PHASE_SCOPE, TOKEN_PHASE_REQUIRED)))):
        controller = next((check for check in selected if check["id"] == "control-plane"), None)
        browser = next((check for check in selected if check["id"] == "review-site"), None)
        if controller is not None and browser is not None:
            controller["argv"] = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests",
                                  "-p", "test_control_plane*.py", *[item for name in TOKEN_USAGE_TEST_MODULES +
                                  (("capture",) if set(paths) in (set(TOKEN_CAPTURE_SCOPE), set(TOKEN_LOCAL_SCOPE), set(TOKEN_PHASE_SCOPE)) else ()) +
                                  (("local_usage",) if set(paths) in (set(TOKEN_LOCAL_SCOPE), set(TOKEN_PHASE_SCOPE)) else ()) +
                                  (("phases",) if set(paths) == set(TOKEN_PHASE_SCOPE) else ())
                                  for item in ("-k", "test_control_plane_" + name + ".")]]
            # All DOM/controller cases still run. Its wrapper that launches the
            # complete Python controller is covered by the exact suites above.
            browser["argv"] = ["node", "--test", "--test-skip-pattern=^contributor control plane passes focused behavioral qualification$",
                               "--", "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs"]
            selected = [check for check in selected if check["id"] != "focused-tests"]
            if set(paths) == set(TOKEN_PHASE_SCOPE):
                roadmap = next((check for check in selected if check["id"] == "roadmap"), None)
                if roadmap is not None:
                    roadmap["argv"] = [sys.executable, "-B", "skills/manage-implementation-roadmaps/tests/test_roadmap.py", "-k", "usage_phase"]
    value = {"schema_version": "check-plan-v1", "candidate": candidate, "catalog_digest": policy_digest(root, checks), "changed_paths": paths, "coverage": covered, "selected": selected, "deferred": [c["id"] for c in checks if c not in selected]}
    value["plan_digest"] = digest(value)
    return value
