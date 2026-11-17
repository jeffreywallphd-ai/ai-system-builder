import type { ImageGenerationTaskAuthorityService } from "../../../application/services/image/image-generation-task-authority.service";
import { join } from "node:path";
import { FinalizeImageGenerationService } from "../../../application/services/image/finalize-image-generation.service";
import { ImageGenerationFinalizationOrchestratorService } from "../../../application/services/image/image-generation-finalization-orchestrator.service";
import { GenerateImageUseCase } from "../../../application/use-cases/image-generation/generate-image.use-case";
import { createFilesystemGeneratedImagePersistenceAdapter } from "../../../adapters/storage/filesystem";
import { createLocalModelCheckpointResolverAdapter } from "../../../adapters/model/local";
import { createRuntimePreparedModelCheckpointResolver } from "../../shared/createRuntimePreparedModelCheckpointResolver";
import type { LoggingPort } from "../../../application/ports/logging";

export interface ComposeDesktopImageGenerationFeatureOptions {
  storageRootDirectory: string;
  taskAuthority: ImageGenerationTaskAuthorityService;
  loggingPort: LoggingPort;
  now: () => string;
  recordRuntimeLog: (entry: {
    level: "info" | "warn" | "error";
    message: string;
  }) => void;
  artifacts: any;
  assets: any;
  runtime: any;
  comfyUi: any;
}

export function composeDesktopImageGenerationFeature(
  options: ComposeDesktopImageGenerationFeatureOptions,
): any {
  const localModelCheckpointResolver =
    createLocalModelCheckpointResolverAdapter({
      modelRegistry: options.assets.modelRegistry,
      comfyUiCheckpointDirectory: join(
        options.comfyUi.installRoot,
        "models",
        "checkpoints",
      ),
      log: (entry) =>
        options.recordRuntimeLog({
          level: "info",
          message: `Image generation model checkpoint resolution: ${JSON.stringify(entry)}`,
        }),
    });
  return {
    generateImageUseCase: new GenerateImageUseCase({
      taskAuthority: options.taskAuthority,
      taskReconciler: options.runtime.taskReconciler,
      runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
      modelCheckpointResolver: createRuntimePreparedModelCheckpointResolver({
        runtime: options.comfyUi.supervisorPort,
        modelCheckpointResolver: localModelCheckpointResolver,
      }),
      runtimeCapabilityGuard: options.runtime.runtimeCapabilityGuard,
    }),
    imageGenerationFinalizationOrchestrator:
      new ImageGenerationFinalizationOrchestratorService({
        taskAuthority: options.taskAuthority,
        runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
        finalizeImageGenerationService: new FinalizeImageGenerationService({
          imageAssetRegistry: options.assets.imageAssetRegistry,
          generatedImagePersistence:
            createFilesystemGeneratedImagePersistenceAdapter({
              comfyUiOutputRoot: join(options.comfyUi.installRoot, "output"),
              artifactStorageRoot: options.storageRootDirectory,
              artifactCatalogAppend: options.artifacts.artifactCatalog,
              artifactStorageBinding: options.artifacts.artifactBindings,
              logging: options.loggingPort,
              now: options.now,
            }),
          now: options.now,
        }),
      }),
  };
}
