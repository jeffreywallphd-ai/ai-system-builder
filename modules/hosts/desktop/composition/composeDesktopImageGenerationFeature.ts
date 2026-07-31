import { join } from "node:path";
import { FinalizeImageGenerationService } from "../../../application/services/image/finalize-image-generation.service";
import { ImageGenerationFinalizationOrchestratorService } from "../../../application/services/image/image-generation-finalization-orchestrator.service";
import { GenerateImageUseCase } from "../../../application/use-cases/image-generation/generate-image.use-case";
import { createFilesystemGeneratedImagePersistenceAdapter } from "../../../adapters/storage/filesystem";
import { createLocalModelCheckpointResolverAdapter } from "../../../adapters/model/local";
import { createRuntimePreparedModelCheckpointResolver } from "../../shared/createRuntimePreparedModelCheckpointResolver";
import type { LoggingPort } from "../../../application/ports/logging";
import { TaskType } from "../../../contracts/runtime";

export interface ComposeDesktopImageGenerationFeatureOptions {
  storageRootDirectory: string;
  loggingPort: LoggingPort;
  now: () => string;
  recordRuntimeLog: (entry: { level: "info" | "warn" | "error"; message: string }) => void;
  artifacts: any;
  assets: any;
  runtime: any;
  comfyUi: any;
}

export function composeDesktopImageGenerationFeature(options: ComposeDesktopImageGenerationFeatureOptions): any {
  let disposed = false;
  const localModelCheckpointResolver = createLocalModelCheckpointResolverAdapter({
    modelRegistry: options.assets.modelRegistry,
    comfyUiCheckpointDirectory: join(options.comfyUi.installRoot, "models", "checkpoints"),
    log: (entry) => options.recordRuntimeLog({ level: "info", message: `Image generation model checkpoint resolution: ${JSON.stringify(entry)}` }),
  });
  return {
    dispose() { disposed = true; },
    get disposed() { return disposed; },
    async canDispose() {
      try {
        const active = await options.runtime.runtimeTaskRegistry.listTasks({ taskTypes: [TaskType.IMAGE_GENERATION], statuses: ["queued", "running", "unknown"] });
        const activeTaskCount = active.tasks.length;
        return activeTaskCount > 0 ? { blockedReason: "active-runtime-tasks", activeTaskCount } : undefined;
      } catch {
        return { blockedReason: "active-task-status-unavailable" };
      }
    },
    generateImageUseCase: new GenerateImageUseCase({
      runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
      modelCheckpointResolver: createRuntimePreparedModelCheckpointResolver({ runtime: options.comfyUi.supervisorPort, modelCheckpointResolver: localModelCheckpointResolver }),
      runtimeCapabilityGuard: options.runtime.runtimeCapabilityGuard,
    }),
    imageGenerationFinalizationOrchestrator: new ImageGenerationFinalizationOrchestratorService({
      runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
      finalizeImageGenerationService: new FinalizeImageGenerationService({
        imageAssetRegistry: options.assets.imageAssetRegistry,
        generatedImagePersistence: createFilesystemGeneratedImagePersistenceAdapter({ comfyUiOutputRoot: join(options.comfyUi.installRoot, "output"), artifactStorageRoot: options.storageRootDirectory, artifactCatalogAppend: options.artifacts.artifactCatalog, artifactStorageBinding: options.artifacts.artifactBindings, logging: options.loggingPort, now: options.now }),
        now: options.now,
      }),
    }),
  };
}
