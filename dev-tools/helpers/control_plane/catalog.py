"""Trusted command identities and complete per-path impact selection."""
from __future__ import annotations

import fnmatch
import hashlib
import re
import sys
from pathlib import Path

from .common import digest, fields, read_json, relative, refuse
from .storage import confined_path

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
    "dev-tools/scripts/qualification/visual-composer/headless-approved-conversation-seed.ts",
    "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
)
HEADLESS_MCP_SOURCES = (
    "modules/contracts/headless/headless-approved-turn.ts",
    "modules/adapters/transport/headless-loopback/tests/desktop-headless-loopback.unit.test.ts",
    "modules/adapters/transport/headless-mcp/README.md",
    "modules/adapters/transport/headless-mcp/boundHeadlessMcpStdio.mts",
    "modules/adapters/transport/headless-mcp/createHeadlessMcpReadForwarder.mts",
    "modules/adapters/transport/headless-mcp/generateHeadlessMcpToolReference.mts",
    "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts",
    "modules/adapters/transport/headless-mcp/tests/headless-mcp-stdio.unit.test.ts",
)

PUBLISHED_FORM_CHECKS = {
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
            "apps/desktop/src/main/desktopUiControlIpc.ts",
            "apps/desktop/src/main/tests/desktop-ui-control-ipc.unit.test.ts",
            "modules/ui/shared/takeover/windowTakeoverController.ts",
            "modules/ui/shared/takeover/tests/window-takeover-controller.unit.test.ts",
        ),
        "sources": (
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
        ),
        "command": (
            "--import", "tsx", "--test", "--",
            "apps/desktop/tests/forge-packaging-boundaries.unit.test.ts",
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
            "modules/contracts/headless/ui-control-authority.ts",
            "modules/contracts/headless/index.ts",
            "modules/contracts/headless/tests/ui-control-authority-contract.unit.test.ts",
            "modules/application/services/ui-control/ui-control-authority.service.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
        "automatic_sources": (
            "modules/contracts/headless/ui-control-authority.ts",
            "modules/contracts/headless/tests/ui-control-authority-contract.unit.test.ts",
            "modules/application/services/ui-control/ui-control-authority.service.ts",
            "modules/application/services/ui-control/tests/ui-control-authority.unit.test.ts",
        ),
        "command": (
            "--import", "tsx", "--test", "--",
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
    "security-authority", "security-runtime", "security-records", "security-tooling",
    "functionality-browse", "functionality-tasks", "functionality-context", "functionality-outcomes",
    "functional-host-ui", "review-site", "settings-ui", "security-status-ui", "operational-ui", "asset-authoring-ui", "system-management-ui", "system-build-publication-ui", "system-runtime-conversation-ui", "system-canvas-authoring-ui", "desktop-startup-ui", "host-memory-fixture", "ingestion-publication", "ocr-provider-contract", "dataset-version-replay", "dataset-version-browser", "dataset-semantic-curation", "native-host-policy", "host-setup-policy", "comfyui-host-policy",
)


QUALIFICATION_PROFILE_PATTERNS = {
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
        "dev-tools/scripts/qualification/visual-composer/e2e/review-site-journey.ts",
        "dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",
        "dev-tools/scripts/qualification/tests/review-site-oracles.unit.test.ts",
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
        *[{"id": name, "patterns": list(QUALIFICATION_PROFILE_PATTERNS.get(name, [])), "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--profile", name], "timeout": 660 if name == "review-site" else 300} for name in QUALIFICATION_PROFILES],
        *[{"id": name, "patterns": [form, test],
           "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--regression-test", test],
           "timeout": 120} for name, (form, test) in IMAGE_FORM_CHECKS.items()],
        *[{"id": name, "patterns": [],
           "argv": [py, "-B", "dev-tools/helpers/run_focused_checks.py", "--regression-test", test],
           "timeout": 120} for name, (_, test) in OPT_IN_REGRESSION_CHECKS.items()],
        *[{"id": name, "patterns": [], "argv": [node, *check["command"]], "timeout": 120}
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
                  "modules/adapters/transport/headless-mcp/tests/headless-mcp-stdio.unit.test.ts"],
         "timeout": 120},
        {"id": HEADLESS_PACKAGED_CHECK, "patterns": [],
         "argv": [node, "node_modules/@playwright/test/cli.js", "test",
                  "--config=dev-tools/config/playwright.visual-composer.config.ts", "--project=packaged-desktop",
                  "packaged-desktop-headless.e2e.spec.ts"],
         "timeout": 540},
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
    # A form-only UI check never claims coverage of the shared Canvas CSS.
    # Include its existing stylesheet contracts only for the explicit Form slice.
    required = set(required)
    headless_explicit = HEADLESS_DESKTOP_READ_CHECK in required
    headless_sources = HEADLESS_DESKTOP_READ_SOURCES if headless_explicit else HEADLESS_DESKTOP_READ_AUTOMATIC_SOURCES
    activation_explicit = HEADLESS_DESKTOP_ACTIVATION_CHECK in required
    activation_sources = HEADLESS_DESKTOP_ACTIVATION_SCOPED_SOURCES if activation_explicit else HEADLESS_DESKTOP_ACTIVATION_AUTOMATIC_SOURCES
    if set(paths).intersection(HEADLESS_DESKTOP_READ_AUTOMATIC_SOURCES):
        required.add(HEADLESS_DESKTOP_READ_CHECK)
    if set(paths).intersection(HEADLESS_DESKTOP_ACTIVATION_AUTOMATIC_SOURCES):
        required.add(HEADLESS_DESKTOP_ACTIVATION_CHECK)
    required.update(name for name, check in PUBLISHED_FORM_CHECKS.items()
                    if set(paths).intersection(check.get("automatic_sources", ())))
    required.update(name for name, check in PUBLISHED_FORM_CHECKS.items()
                    if check.get("companion_to") in required and set(paths).intersection(check["sources"]))
    covered = {p: [c["id"] for c in checks
                   if any(fnmatch.fnmatchcase(p, pat) for pat in c["patterns"])
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
    value = {"schema_version": "check-plan-v1", "candidate": candidate, "catalog_digest": policy_digest(root, checks), "changed_paths": paths, "coverage": covered, "selected": selected, "deferred": [c["id"] for c in checks if c not in selected]}
    value["plan_digest"] = digest(value)
    return value
