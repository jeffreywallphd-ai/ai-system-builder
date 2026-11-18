import {
  ContextBrowserUseCases,
  ContextGenerationUseCase,
  ContextManagementCommandUseCase,
} from "../../../application/use-cases";
import { createPythonContextArtifactRuntimeAdapter } from "../../../adapters/runtime/python";
import type {ApprovedContextEmbeddingModelResolverPort} from "../../../application/ports/context-management";

export interface ComposeDesktopContextManagementFeatureOptions {
  readonly artifacts: any;
  readonly runtime: any;
  readonly workspaceRepository?: any;
  readonly workspaceAuthorization?: any;
  readonly now?: () => string;
  readonly embeddingModels?: ApprovedContextEmbeddingModelResolverPort;
}

export function composeDesktopContextManagementFeature(
  options: ComposeDesktopContextManagementFeatureOptions,
): any {
  const generation = new ContextGenerationUseCase({
    resultBytes: options.artifacts.contextResultBytes,
    resultSource: options.artifacts.contextResultSource,
    embeddingModels: options.embeddingModels,
    runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
    taskReconciler: options.runtime.taskReconciler,
    storageBindings: options.artifacts.artifactBindings,
    storage: options.artifacts.storage,
    artifactCatalog: options.artifacts.artifactCatalog,
    taskPowerLifecycle: options.runtime.taskPowerLifecycle,
    workspaceRepository: options.workspaceRepository,
    workspaceAuthorization: options.workspaceAuthorization,
    now: options.now,
  });
  const browser = new ContextBrowserUseCases({
    catalog: options.artifacts.artifactCatalog,
    storageBindings: options.artifacts.artifactBindings,
    storage: options.artifacts.storage,
    runtime: createPythonContextArtifactRuntimeAdapter(
      options.runtime.runtimeTaskRegistry,
    ),
    generation,
    deleteArtifact: options.artifacts.deleteRegisteredArtifactUseCase,
    workspaceRepository: options.workspaceRepository,
    workspaceAuthorization: options.workspaceAuthorization,
  });
  const contextManagement = new ContextManagementCommandUseCase({
    generation,
    browser,
    runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
    workspaceRepository: options.workspaceRepository,
    workspaceAuthorization: options.workspaceAuthorization,
  });

  return {
    contextManagement,
    generation,
    browser,
  };
}
