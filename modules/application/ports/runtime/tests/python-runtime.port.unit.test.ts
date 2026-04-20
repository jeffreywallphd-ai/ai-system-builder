import { describe, expectTypeOf, it } from "../../../../testing/node-test";

import type {
  PrepareTemplatedDatasetRequest,
  PrepareTemplatedDatasetResult,
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeTaskRequest,
  PythonRuntimeTaskResult,
} from "../../../../contracts/runtime";
import type {
  PythonDatasetPreparationPort,
  PythonRuntimePort,
} from "..";

describe("Python runtime ports", () => {
  it("exposes runtime lifecycle, health, capabilities, and generic task execution seams", () => {
    expectTypeOf<keyof PythonRuntimePort>().toEqualTypeOf<
      "executeTask" | "getHealthStatus" | "getCapabilities"
    >();

    expectTypeOf<Parameters<PythonRuntimePort["executeTask"]>[0]>().toExtend<
      PythonRuntimeTaskRequest
    >();
    expectTypeOf<Awaited<ReturnType<PythonRuntimePort["executeTask"]>>>().toEqualTypeOf<
      PythonRuntimeTaskResult
    >();

    expectTypeOf<Awaited<ReturnType<PythonRuntimePort["getHealthStatus"]>>>().toEqualTypeOf<
      PythonRuntimeHealthCheckResult
    >();
    expectTypeOf<Awaited<ReturnType<PythonRuntimePort["getCapabilities"]>>>().toEqualTypeOf<
      PythonRuntimeCapabilitiesResult
    >();
  });

  it("keeps dataset preparation as a task-specific application-facing seam", () => {
    expectTypeOf<keyof PythonDatasetPreparationPort>().toEqualTypeOf<"prepareTemplatedDataset">();

    expectTypeOf<Parameters<PythonDatasetPreparationPort["prepareTemplatedDataset"]>[0]>().toExtend<
      PrepareTemplatedDatasetRequest
    >();
    expectTypeOf<Awaited<ReturnType<PythonDatasetPreparationPort["prepareTemplatedDataset"]>>>().toEqualTypeOf<
      PrepareTemplatedDatasetResult
    >();
  });
});
