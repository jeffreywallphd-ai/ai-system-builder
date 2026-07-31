import { describe, expect, it, testDouble } from "../../testing/node-test";

import { createRuntimePreparedModelCheckpointResolver } from "./createRuntimePreparedModelCheckpointResolver";

describe("createRuntimePreparedModelCheckpointResolver", () => {
  it("starts the runtime before resolving a checkpoint", async () => {
    const calls: string[] = [];
    const resolver = createRuntimePreparedModelCheckpointResolver({
      runtime: {
        start: testDouble.fn(async () => {
          calls.push("runtime.start");
        }),
      },
      modelCheckpointResolver: {
        resolveCheckpoint: testDouble.fn(async () => {
          calls.push("checkpoint.resolve");
          return { checkpoint: "model.safetensors" };
        }),
      },
    });

    const result = await resolver.resolveCheckpoint({ selectedModel: "model-record-1" });
    expect(result).toEqual({ checkpoint: "model.safetensors" });
    expect(calls).toEqual(["runtime.start", "checkpoint.resolve"]);
  });

  it("passes runtime device mode to runtimes that support mode-aware startup", async () => {
    const start = testDouble.fn();
    const resolver = createRuntimePreparedModelCheckpointResolver({
      runtime: {
        start: testDouble.fn(async () => {
          throw new Error("plain start should not be used");
        }),
        startWithRuntimeDeviceMode: testDouble.fn(async (request) => {
          start(request);
        }),
      },
      modelCheckpointResolver: {
        resolveCheckpoint: testDouble.fn(async () => ({ checkpoint: "model.safetensors" })),
      },
    });

    await resolver.resolveCheckpoint({ selectedModel: "model-record-1", runtimeDeviceMode: "directml" });

    expect(start).toHaveBeenCalledWith({ runtimeDeviceMode: "directml" });
  });
});
