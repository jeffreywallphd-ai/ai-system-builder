import {
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeTaskRequest,
  PythonRuntimeTaskResult
} from "../../../contracts/runtime";

export interface PythonRuntimePort {
  executeTask(
    request: PythonRuntimeTaskRequest
  ): Promise<PythonRuntimeTaskResult>;
  getHealthStatus(): Promise<PythonRuntimeHealthCheckResult>;
  getCapabilities(): Promise<PythonRuntimeCapabilitiesResult>;
}
