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
import type {ModelDownloadSource} from "../../../contracts/model";

export interface PythonRuntimePort {
  startTask(request: StartPythonRuntimeTaskRequest): Promise<StartPythonRuntimeTaskResult>;
  /** Internal Context start preserving noninstalling policy through owned recovery. */
  startTaskWithoutInstalling?(request: StartPythonRuntimeTaskRequest): Promise<StartPythonRuntimeTaskResult>;
  readTaskStatus(requestId: string): Promise<PythonRuntimeTaskStatusResult>;
  cancelTask(requestId: string): Promise<CancelPythonRuntimeTaskResult>;
  getHealthStatus(): Promise<PythonRuntimeHealthCheckResult>;
  getCapabilities(): Promise<PythonRuntimeCapabilitiesResult>;
  ensureModelDownloaded(request: {
    provider: "transformers";
    modelId: string;
    revision?: string;
    sourceManifest?: {readonly source: ModelDownloadSource; readonly manifestDigest: string};
    inferenceMode?: string;
    taskTags?: string[];
    artifactForm?: string;
  }): Promise<{
    provider: "transformers";
    modelId: string;
    revision?: string;
    verifiedManifestDigest?: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath?: string;
  }>;
  /** Manifest tasks require their exact trusted accepted-start expectation. */
  resolveModelDownloadTaskResult(payload: unknown,
    expectedManifest?: {readonly source: ModelDownloadSource; readonly manifestDigest: string}): Promise<CompletedModelDownload>;
  getModelStatus(): Promise<PythonRuntimeModelStatusResult>;
  unloadModels(): Promise<PythonRuntimeUnloadModelsResult>;
}
