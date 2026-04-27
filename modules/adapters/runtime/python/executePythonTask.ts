import type { PythonRuntimePort } from "../../../application/ports/runtime";
import type { PythonRuntimeTaskRequest } from "../../../contracts/runtime";

export function executePythonTask(
  runtimePort: PythonRuntimePort,
  request: PythonRuntimeTaskRequest,
) {
  return runtimePort.executeTask(request);
}
