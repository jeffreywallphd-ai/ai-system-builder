export type NotificationMessageClassification =
  | "migrated-with-contextual-state"
  | "migrated-outcome-only"
  | "contextual-only"
  | "notification-infrastructure";

export interface NotificationMessageInventoryEntry {
  readonly path: string;
  readonly classification: NotificationMessageClassification;
  readonly rationale: string;
}

export const NOTIFICATION_MESSAGE_INVENTORY: readonly NotificationMessageInventoryEntry[] = [
  ...[
    "apps/desktop/src/renderer/features/artifact-browser/components/ArtifactBrowserFeature.tsx",
    "apps/desktop/src/renderer/features/artifact-upload/components/ArtifactHuggingFaceForm.tsx",
    "apps/desktop/src/renderer/features/artifact-upload/components/ArtifactScrapeForm.tsx",
    "apps/desktop/src/renderer/features/artifact-upload/components/ArtifactUploadForm.tsx",
    "apps/desktop/src/renderer/features/asset-authoring/components/AssetAuthoringFeature.tsx",
    "apps/desktop/src/renderer/features/asset-library/components/AssetLibraryFeature.tsx",
    "apps/desktop/src/renderer/features/dataset-preparation/components/DatasetPreparationFeature.tsx",
    "apps/desktop/src/renderer/features/models/components/BrowseModelsTab.tsx",
    "apps/desktop/src/renderer/features/models/components/ManageModelsTab.tsx",
    "apps/desktop/src/renderer/features/settings/components/SettingsStatusMessage.tsx",
    "apps/desktop/src/renderer/features/user-library/components/UserLibraryFeature.tsx",
    "apps/thin-client/src/features/artifact-browser/components/ArtifactBrowserFeature.tsx",
    "apps/thin-client/src/features/artifact-upload/components/ArtifactHuggingFaceForm.tsx",
    "apps/thin-client/src/features/artifact-upload/components/ArtifactScrapeForm.tsx",
    "apps/thin-client/src/features/artifact-upload/components/ArtifactUploadForm.tsx",
    "apps/thin-client/src/features/asset-authoring/components/AssetAuthoringFeature.tsx",
    "apps/thin-client/src/features/asset-library/components/AssetLibraryFeature.tsx",
    "apps/thin-client/src/features/image-generation/components/ImageGenerationFeature.tsx",
    "apps/thin-client/src/features/user-library/components/UserLibraryFeature.tsx",
    "modules/ui/shared/asset-authoring/AssetDerivedCustomizationEditor.tsx",
    "modules/ui/shared/asset-package/AssetPackageManager.tsx",
    "modules/ui/shared/asset-studio/AssetStudioManager.tsx",
    "modules/ui/shared/asset-studio/UnifiedAssetStudio.tsx",
    "modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx",
    "modules/ui/shared/system-builder/SystemManagementWorkspace.tsx",
    "modules/ui/shared/system-builder/SystemPublishedLifecycleCard.tsx",
    "modules/ui/shared/system-builder/SystemPublishWorkspace.tsx",
    "modules/ui/shared/system-builder/SystemRunWorkflow.tsx",
  ].map((path) => ({
    path,
    classification: "migrated-with-contextual-state" as const,
    rationale: "Transient action outcomes publish globally; validation, loading, diagnostics, progress, result detail, or retry context remains inline.",
  })),
  ...[
    "apps/thin-client/src/pages/SettingsPage.tsx",
    "apps/thin-client/src/features/model-management/components/ModelManagementFeature.tsx",
  ].map((path) => ({
    path,
    classification: "migrated-outcome-only" as const,
    rationale: "The prior page-level terminal outcome is owned by the notification center.",
  })),
  ...[
    "apps/desktop/src/renderer/features/image-generation/components/ImageGenerationForm.tsx",
    "apps/desktop/src/renderer/features/image-generation/components/ImageGenerationResults.tsx",
    "apps/desktop/src/renderer/features/image-generation/components/ImageGenerationStatus.tsx",
    "apps/desktop/src/renderer/features/models/components/TrainModelTab.tsx",
    "apps/desktop/src/renderer/features/python-runtime/components/PythonRuntimeFooter.tsx",
    "apps/desktop/src/renderer/features/settings/components/SoftwareStatusSection.tsx",
    "apps/desktop/src/renderer/features/workspace/components/WorkspaceCreateForm.tsx",
    "apps/desktop/src/renderer/features/workspace/components/WorkspaceRequiredSurface.tsx",
    "apps/desktop/src/renderer/features/workspace/components/WorkspaceSwitcher.tsx",
    "apps/thin-client/src/features/workspace/components/WorkspaceCreateForm.tsx",
    "apps/thin-client/src/features/workspace/components/WorkspaceRequiredSurface.tsx",
    "apps/thin-client/src/features/workspace/components/WorkspaceSwitcher.tsx",
    "modules/ui/shared/artifact-preview/ArtifactPreviewPanel.tsx",
    "modules/ui/shared/asset-library/assetLibraryDetailPanels.tsx",
    "modules/ui/shared/asset-library/AssetMutationConfirmationDialog.tsx",
    "modules/ui/shared/foundation-assets/FoundationAssetPreview.tsx",
    "modules/ui/shared/foundation-assets/FoundationAssetSurface.tsx",
    "modules/ui/shared/system-builder/SystemBuildTestModal.tsx",
    "modules/ui/shared/system-builder/SystemComposerClickEditor.tsx",
    "modules/ui/shared/system-builder/SystemComposerInspector.tsx",
    "modules/ui/shared/system-builder/SystemComposerStylingPanel.tsx",
    "modules/ui/shared/system-builder/SystemCompositionPreview.tsx",
  ].map((path) => ({
    path,
    classification: "contextual-only" as const,
    rationale: "Inline feedback is required to validate, unblock, retry, inspect, or follow active task progress in this surface.",
  })),
  ...[
    "apps/desktop/src/renderer/components/layout/DesktopPageLoadingFallback.tsx",
    "apps/desktop/src/renderer/components/ui/LoadingSpinner.tsx",
    "apps/desktop/src/renderer/components/ui/SectionErrorState.tsx",
    "apps/desktop/src/renderer/components/ui/SectionLoadingState.tsx",
    "apps/thin-client/src/components/ui/LoadingSpinner.tsx",
    "modules/ui/shared/components/LoadingSpinner.tsx",
    "modules/ui/shared/notifications/NotificationCenter.tsx",
  ].map((path) => ({
    path,
    classification: "notification-infrastructure" as const,
    rationale: "This is semantic loading/error infrastructure or the global notification presenter, not a page-level transient producer.",
  })),
];
