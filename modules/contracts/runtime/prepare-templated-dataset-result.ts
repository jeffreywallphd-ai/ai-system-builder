import type { PythonRuntimeOutputDescriptor } from "./python-runtime-output-descriptor";

export interface PrepareTemplatedDatasetResult {
  outputs: PythonRuntimeOutputDescriptor[];
  trainRowCount: number;
  testRowCount: number;
  warnings?: string[];
}
