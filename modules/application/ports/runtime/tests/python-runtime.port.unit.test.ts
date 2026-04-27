import { describe, expectTypeOf, it } from "../../../../testing/node-test";

import type {
  PrepareTrainingDatasetRequest,
  PrepareTrainingDatasetResult,
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
      "executeTask" | "getHealthStatus" | "getCapabilities" | "ensureModelDownloaded"
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
    expectTypeOf<Awaited<ReturnType<PythonRuntimePort["ensureModelDownloaded"]>>>().toEqualTypeOf<{
      provider: "transformers";
      modelId: string;
      downloaded: boolean;
      fromCache: boolean;
      localPath?: string;
    }>();
  });

  it("keeps dataset preparation as a task-specific application-facing seam", () => {
    expectTypeOf<keyof PythonDatasetPreparationPort>().toEqualTypeOf<"prepareTrainingDataset">();

    expectTypeOf<Parameters<PythonDatasetPreparationPort["prepareTrainingDataset"]>[0]>().toExtend<
      PrepareTrainingDatasetRequest
    >();
    expectTypeOf<Awaited<ReturnType<PythonDatasetPreparationPort["prepareTrainingDataset"]>>>().toEqualTypeOf<
      PrepareTrainingDatasetResult
    >();
  });
});
