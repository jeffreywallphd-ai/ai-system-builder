import {
  CancelPythonRuntimeTaskResult,
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeModelStatusResult,
  PythonRuntimeTaskStatusResult,
  StartPythonRuntimeTaskRequest,
  StartPythonRuntimeTaskResult,
  PythonRuntimeUnloadModelsResult
} from "../../../contracts/runtime";
import type { CompletedModelDownload } from "../model";

export interface PythonRuntimePort {
  startTask(request: StartPythonRuntimeTaskRequest): Promise<StartPythonRuntimeTaskResult>;
  readTaskStatus(requestId: string): Promise<PythonRuntimeTaskStatusResult>;
  cancelTask(requestId: string): Promise<CancelPythonRuntimeTaskResult>;
  getHealthStatus(): Promise<PythonRuntimeHealthCheckResult>;
  getCapabilities(): Promise<PythonRuntimeCapabilitiesResult>;
  ensureModelDownloaded(request: {
    provider: "transformers";
    modelId: string;
    inferenceMode?: string;
    taskTags?: string[];
    artifactForm?: string;
  }): Promise<{
    provider: "transformers";
    modelId: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath?: string;
  }>;
  resolveModelDownloadTaskResult(payload: unknown): Promise<CompletedModelDownload>;
  getModelStatus(): Promise<PythonRuntimeModelStatusResult>;
  unloadModels(): Promise<PythonRuntimeUnloadModelsResult>;
}
