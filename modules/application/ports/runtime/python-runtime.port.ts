import {
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeModelStatusResult,
  PythonRuntimeTaskRequest,
  PythonRuntimeTaskResult,
  PythonRuntimeUnloadModelsResult
} from "../../../contracts/runtime";

export interface PythonRuntimePort {
  executeTask(
    request: PythonRuntimeTaskRequest
  ): Promise<PythonRuntimeTaskResult>;
  getHealthStatus(): Promise<PythonRuntimeHealthCheckResult>;
  getCapabilities(): Promise<PythonRuntimeCapabilitiesResult>;
  ensureModelDownloaded(request: { provider: "transformers"; modelId: string }): Promise<{
    provider: "transformers";
    modelId: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath?: string;
  }>;
  getModelStatus(): Promise<PythonRuntimeModelStatusResult>;
  unloadModels(): Promise<PythonRuntimeUnloadModelsResult>;
}
