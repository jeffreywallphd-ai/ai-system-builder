import {
  registerDesktopArtifactIpc,
  type RegisterDesktopArtifactIpcDependencies,
} from "./registerDesktopArtifactIpc";
import {
  registerDesktopAssetIpc,
  type RegisterDesktopAssetIpcDependencies,
} from "./registerDesktopAssetIpc";
import {
  registerDesktopDatasetPreparationIpc,
  type RegisterDesktopDatasetPreparationIpcDependencies,
} from "./registerDesktopDatasetPreparationIpc";
import {
  registerDesktopImageGenerationIpc,
  type RegisterDesktopImageGenerationIpcDependencies,
} from "./registerDesktopImageGenerationIpc";
import {
  registerDesktopIngestionIpc,
  type RegisterDesktopIngestionIpcDependencies,
} from "./registerDesktopIngestionIpc";
import {
  registerDesktopModelIpc,
  type RegisterDesktopModelIpcDependencies,
} from "./registerDesktopModelIpc";
import {
  registerDesktopRuntimeIpc,
  type RegisterDesktopRuntimeIpcDependencies,
} from "./registerDesktopRuntimeIpc";
import {
  registerDesktopStartupIpc,
  type RegisterDesktopStartupIpcDependencies,
} from "./registerDesktopStartupIpc";
import {
  registerAssetAuthoringIpc,
  type RegisterAssetAuthoringIpcDependencies,
} from "./asset-authoring/registerAssetAuthoringIpc";
import {
  registerUserLibraryIpc,
  type RegisterUserLibraryIpcDependencies,
} from "./user-library/registerUserLibraryIpc";
import {
  registerEffectiveAssetProjectionIpc,
  type RegisterEffectiveAssetProjectionIpcDependencies,
} from "./effective-asset-projections/registerEffectiveAssetProjectionIpc";
import {
  registerAssetCompositionIpc,
  type RegisterAssetCompositionIpcDependencies,
} from "./asset-composition/registerAssetCompositionIpc";
import {
  registerConversationExecutionIpc,
  type RegisterConversationExecutionIpcDependencies,
} from "./conversations/registerConversationExecutionIpc";
import {
  registerAssetImplementationIpc,
  type RegisterAssetImplementationIpcDependencies,
} from "./asset-implementation/registerAssetImplementationIpc";
import {
  registerAssetPackageIpc,
  type RegisterAssetPackageIpcDependencies,
} from "./asset-package/registerAssetPackageIpc";
import {
  registerAssetStudioIpc,
  type RegisterAssetStudioIpcDependencies,
} from "./asset-studio/registerAssetStudioIpc";
import {
  registerSystemBuilderIpc,
  type RegisterSystemBuilderIpcDependencies,
} from "./system-builder/registerSystemBuilderIpc";
import {
  registerSystemBuildIpc,
  type RegisterSystemBuildIpcDependencies,
} from "./system-build/registerSystemBuildIpc";
import {
  registerSystemDataIpc,
  type RegisterSystemDataIpcDependencies,
} from "./system-data/registerSystemDataIpc";
import {
  registerSystemReviewIpc,
  type RegisterSystemReviewIpcDependencies,
} from "./system-review/registerSystemReviewIpc";
import {
  registerSystemDeploymentIpc,
  type RegisterSystemDeploymentIpcDependencies,
} from "./system-deployment/registerSystemDeploymentIpc";
import {
  registerSystemRunWorkflowIpc,
  type RegisterSystemRunWorkflowIpcDependencies,
} from "./system-run-workflow/registerSystemRunWorkflowIpc";
export type {
  AsyncFeatureProvider,
  LazyProvidedObjectOptions,
} from "./lazyFeatureProvider";

export type DesktopIpcRegistrationMilestoneRecorder = (
  milestone: string,
) => void;

export interface RegisterElectronIpcDependencies {
  startup: RegisterDesktopStartupIpcDependencies;
  artifact: RegisterDesktopArtifactIpcDependencies;
  asset: RegisterDesktopAssetIpcDependencies;
  model: RegisterDesktopModelIpcDependencies;
  imageGeneration: RegisterDesktopImageGenerationIpcDependencies;
  runtime: RegisterDesktopRuntimeIpcDependencies;
  ingestion: RegisterDesktopIngestionIpcDependencies;
  datasetPreparation: RegisterDesktopDatasetPreparationIpcDependencies;
  userLibrary?: RegisterUserLibraryIpcDependencies;
  assetAuthoring?: RegisterAssetAuthoringIpcDependencies;
  effectiveAssetProjections?: RegisterEffectiveAssetProjectionIpcDependencies;
  assetComposition?: RegisterAssetCompositionIpcDependencies;
  conversations?: RegisterConversationExecutionIpcDependencies;
  assetImplementations?: RegisterAssetImplementationIpcDependencies;
  assetPackages?: RegisterAssetPackageIpcDependencies;
  assetStudio?: RegisterAssetStudioIpcDependencies;
  systemBuilder?: RegisterSystemBuilderIpcDependencies;
  systemBuild?: RegisterSystemBuildIpcDependencies;
  systemData?: RegisterSystemDataIpcDependencies;
  systemReview?: RegisterSystemReviewIpcDependencies;
  systemDeployment?: RegisterSystemDeploymentIpcDependencies;
  systemRunWorkflow?: RegisterSystemRunWorkflowIpcDependencies;
  recordMilestone?: DesktopIpcRegistrationMilestoneRecorder;
}

function registerGroup(
  recordMilestone: DesktopIpcRegistrationMilestoneRecorder | undefined,
  milestone: string,
  register: () => void,
): void {
  recordMilestone?.(`desktop.host.ipc.${milestone}.register.before`);
  register();
  recordMilestone?.(`desktop.host.ipc.${milestone}.register.after`);
}

export function registerElectronIpc(
  dependencies: RegisterElectronIpcDependencies,
): void {
  registerGroup(dependencies.recordMilestone, "startup-group", () =>
    registerDesktopStartupIpc(dependencies.startup),
  );
  registerGroup(dependencies.recordMilestone, "artifact-group", () =>
    registerDesktopArtifactIpc(dependencies.artifact),
  );
  registerGroup(dependencies.recordMilestone, "asset-group", () =>
    registerDesktopAssetIpc(dependencies.asset),
  );
  registerGroup(dependencies.recordMilestone, "model-group", () =>
    registerDesktopModelIpc(dependencies.model),
  );
  registerGroup(dependencies.recordMilestone, "image-generation-group", () =>
    registerDesktopImageGenerationIpc(dependencies.imageGeneration),
  );
  registerGroup(dependencies.recordMilestone, "runtime-group", () =>
    registerDesktopRuntimeIpc(dependencies.runtime),
  );
  registerGroup(dependencies.recordMilestone, "ingestion-group", () =>
    registerDesktopIngestionIpc(dependencies.ingestion),
  );
  registerGroup(dependencies.recordMilestone, "dataset-preparation-group", () =>
    registerDesktopDatasetPreparationIpc(dependencies.datasetPreparation),
  );
  if (dependencies.userLibrary) {
    registerGroup(dependencies.recordMilestone, "user-library-group", () =>
      registerUserLibraryIpc(dependencies.userLibrary!),
    );
  }
  if (dependencies.assetAuthoring) {
    registerGroup(dependencies.recordMilestone, "asset-authoring-group", () =>
      registerAssetAuthoringIpc(dependencies.assetAuthoring!),
    );
  }
  if (dependencies.effectiveAssetProjections) {
    registerGroup(
      dependencies.recordMilestone,
      "effective-asset-projections-group",
      () =>
        registerEffectiveAssetProjectionIpc(
          dependencies.effectiveAssetProjections!,
        ),
    );
  }
  if (dependencies.assetComposition) {
    registerGroup(dependencies.recordMilestone, "asset-composition-group", () =>
      registerAssetCompositionIpc(dependencies.assetComposition!),
    );
  }
  if (dependencies.conversations) {
    registerGroup(dependencies.recordMilestone, "conversations-group", () =>
      registerConversationExecutionIpc(dependencies.conversations!),
    );
  }
  if (dependencies.assetImplementations) {
    registerGroup(
      dependencies.recordMilestone,
      "asset-implementations-group",
      () => registerAssetImplementationIpc(dependencies.assetImplementations!),
    );
  }
  if (dependencies.assetPackages) {
    registerGroup(dependencies.recordMilestone, "asset-packages-group", () =>
      registerAssetPackageIpc(dependencies.assetPackages!),
    );
  }
  if (dependencies.assetStudio) {
    registerGroup(dependencies.recordMilestone, "asset-studio-group", () =>
      registerAssetStudioIpc(dependencies.assetStudio!),
    );
  }
  if (dependencies.systemBuilder) {
    registerGroup(dependencies.recordMilestone, "system-builder-group", () =>
      registerSystemBuilderIpc(dependencies.systemBuilder!),
    );
  }
  if (dependencies.systemBuild) {
    registerGroup(dependencies.recordMilestone, "system-build-group", () =>
      registerSystemBuildIpc(dependencies.systemBuild!),
    );
  }
  if (dependencies.systemData) {
    registerGroup(dependencies.recordMilestone, "system-data-group", () =>
      registerSystemDataIpc(dependencies.systemData!),
    );
  }
  if (dependencies.systemReview) {
    registerGroup(dependencies.recordMilestone, "system-review-group", () =>
      registerSystemReviewIpc(dependencies.systemReview!),
    );
  }
  if (dependencies.systemDeployment) {
    registerGroup(dependencies.recordMilestone, "system-deployment-group", () =>
      registerSystemDeploymentIpc(dependencies.systemDeployment!),
    );
  }
  if (dependencies.systemRunWorkflow) {
    registerGroup(dependencies.recordMilestone, "system-run-workflow-group", () =>
      registerSystemRunWorkflowIpc(dependencies.systemRunWorkflow!),
    );
  }
}

export type {
  RegisterDesktopArtifactIpcDependencies,
  RegisterDesktopAssetIpcDependencies,
  RegisterDesktopDatasetPreparationIpcDependencies,
  RegisterDesktopImageGenerationIpcDependencies,
  RegisterDesktopIngestionIpcDependencies,
  RegisterDesktopModelIpcDependencies,
  RegisterDesktopRuntimeIpcDependencies,
  RegisterDesktopStartupIpcDependencies,
  RegisterUserLibraryIpcDependencies,
  RegisterAssetAuthoringIpcDependencies,
  RegisterEffectiveAssetProjectionIpcDependencies,
  RegisterAssetCompositionIpcDependencies,
  RegisterConversationExecutionIpcDependencies,
  RegisterAssetImplementationIpcDependencies,
  RegisterAssetPackageIpcDependencies,
  RegisterAssetStudioIpcDependencies,
  RegisterSystemBuilderIpcDependencies,
  RegisterSystemReviewIpcDependencies,
  RegisterSystemDeploymentIpcDependencies,
  RegisterSystemRunWorkflowIpcDependencies,
};
