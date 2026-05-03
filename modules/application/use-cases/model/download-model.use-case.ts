import {
  normalizeDownloadModelRequest,
  normalizeModelInventoryRecord,
  type DownloadModelRequest,
  type DownloadModelResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";
import type { PythonRuntimePort } from "../../ports/runtime";

export class DownloadModelUseCase {
  public constructor(private readonly dependencies: {
    modelRegistry: ModelRegistryPort;
    modelDownloader: Pick<PythonRuntimePort, "ensureModelDownloaded">;
  }) {}

  public async execute(request: DownloadModelRequest): Promise<DownloadModelResult> {
    const normalizedRequest = normalizeDownloadModelRequest(request);
    const download = await this.dependencies.modelDownloader.ensureModelDownloaded({
      provider: "transformers",
      modelId: normalizedRequest.modelId,
    });

    if (!download.localPath) {
      throw new Error(`Downloaded model ${normalizedRequest.modelId} did not report a local path.`);
    }

    const result = await this.dependencies.modelRegistry.registerDownloadedModel({
      modelRecordId: normalizedRequest.modelRecordId,
      displayName: normalizedRequest.displayName ?? normalizedRequest.modelId,
      source: "huggingface",
      provider: normalizedRequest.provider,
      modelId: normalizedRequest.modelId,
      localPath: download.localPath,
      artifactForm: normalizedRequest.artifactForm ?? "full-model",
      inferenceMode: normalizedRequest.inferenceMode,
      taskTags: normalizedRequest.taskTags,
      metadata: {
        ...normalizedRequest.metadata,
        download: {
          provider: download.provider,
          fromCache: download.fromCache,
          downloaded: download.downloaded,
        },
      },
    });

    return {
      model: normalizeModelInventoryRecord(result.model),
      download: {
        ...download,
        localPath: download.localPath,
      },
    };
  }
}
