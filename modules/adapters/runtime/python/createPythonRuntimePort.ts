import type { PythonRuntimePort } from "../../../application/ports/runtime";

import {
  createPythonRuntimeHttpClient,
  type CreatePythonRuntimeHttpClientOptions,
} from "./client/createPythonRuntimeHttpClient";
import {
  createPythonRuntimeSupervisor,
  type CreatePythonRuntimeSupervisorOptions,
  type PythonRuntimeSupervisor,
} from "./supervisor/createPythonRuntimeSupervisor";

export interface CreatePythonRuntimePortOptions {
  client: CreatePythonRuntimeHttpClientOptions;
  supervisor: Omit<CreatePythonRuntimeSupervisorOptions, "runtimeClient">;
}

export interface PythonRuntimeAdapterFoundation {
  runtimePort: PythonRuntimePort;
  supervisor: PythonRuntimeSupervisor;
}

export function createPythonRuntimeAdapterFoundation(
  options: CreatePythonRuntimePortOptions,
): PythonRuntimeAdapterFoundation {
  const client = createPythonRuntimeHttpClient(options.client);
  const supervisor = createPythonRuntimeSupervisor({
    ...options.supervisor,
    runtimeClient: client,
  });

  const runtimePort: PythonRuntimePort = {
    startTask: (request) => client.startTask(request),
    readTaskStatus: (requestId) => client.readTaskStatus(requestId),
    cancelTask: (requestId) => client.cancelTask(requestId),
    getHealthStatus: () => client.getHealthStatus(),
    getCapabilities: () => client.getCapabilities(),
    ensureModelDownloaded: (request) => client.ensureModelDownloaded(request),
    getModelStatus: () => client.getModelStatus(),
    unloadModels: () => client.unloadModels(),
  };

  return {
    runtimePort,
    supervisor,
  };
}
