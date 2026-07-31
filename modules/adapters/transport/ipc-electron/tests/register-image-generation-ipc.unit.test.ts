import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { RuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";
import { createRuntimeCapabilityStatus } from "../../../../contracts/runtime";
import {
  DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL,
  createDesktopImageGenerationCancelRequest,
  createDesktopImageGenerationFinalizeRequest,
  createDesktopImageGenerationReadRequest,
  createDesktopImageGenerationStartRequest,
} from "../../../../contracts/ipc";
import { registerImageGenerationIpc } from "../image-generation/registerImageGenerationIpc";

function handlers() {
  const map = new Map<string, any>();
  return {
    map,
    ipcMain: { handle: testDouble.fn((channel: string, handler: any) => map.set(channel, handler)) },
  };
}

describe("registerImageGenerationIpc", () => {
  it("maps runtime capability unavailable start failures to sanitized unavailable response", async () => {
    const { map, ipcMain } = handlers();
    const unavailable = new RuntimeCapabilityUnavailableError(createRuntimeCapabilityStatus({
      capabilityId: "image-generation",
      status: "starting",
      summary: "Image generation runtime is starting.",
      reason: { code: "runtime.comfyui.starting", message: "raw stack /tmp/secret", category: "startup", retryable: true },
      recommendedActions: ["wait"],
    }));
    registerImageGenerationIpc({
      ipcMain,
      generateImageUseCase: {
        startImageGeneration: testDouble.fn(async () => { throw unavailable; }),
        readImageGeneration: testDouble.fn(),
        cancelImageGeneration: testDouble.fn(),
      },
    });

    const response = await map.get("ipc.image-generation.start.request")({}, createDesktopImageGenerationStartRequest(
      { prompt: "cat" },
      { requestId: "req-img", correlationId: "corr-img" },
    ));

    expect(response).toMatchObject({
      ok: false,
      channel: DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL.value,
      requestId: "req-img",
      correlationId: "corr-img",
      error: {
        code: "unavailable",
        message: "Required runtime capability is not ready.",
        details: { capabilityId: "image-generation", status: "starting", reason: { code: "runtime.comfyui.starting", category: "startup" }, recommendedActions: ["wait"] },
      },
    });
    expect(JSON.stringify(response)).not.toContain("/tmp/secret");
  });

  it("sanitizes internal read cancel and finalize failures", async () => {
    const { map, ipcMain } = handlers();
    registerImageGenerationIpc({
      ipcMain,
      generateImageUseCase: {
        startImageGeneration: testDouble.fn(),
        readImageGeneration: testDouble.fn(async () => { throw new Error("read raw failure at /tmp/secret\nstack trace"); }),
        cancelImageGeneration: testDouble.fn(async () => { throw new Error("cancel raw failure at C:\\tmp\\secret"); }),
      },
      imageGenerationFinalizationOrchestrator: { finalizeIfCompleted: testDouble.fn(async () => { throw new Error("finalize raw failure at /var/tmp/secret"); }) },
    });

    const read = await map.get("ipc.image-generation.read.request")({}, createDesktopImageGenerationReadRequest({ requestId: "r1" }));
    const cancel = await map.get("ipc.image-generation.cancel.request")({}, createDesktopImageGenerationCancelRequest({ requestId: "r1" }));
    const finalize = await map.get("ipc.image-generation.finalize-if-completed.request")({}, createDesktopImageGenerationFinalizeRequest({ requestId: "r1" }));

    expect(read.error).toMatchObject({ code: "internal", message: "Image generation request failed." });
    expect(cancel.error).toMatchObject({ code: "internal", message: "Image generation request failed." });
    expect(finalize.error).toMatchObject({ code: "internal", message: "Image generation request failed." });
    expect(JSON.stringify({ read, cancel, finalize })).not.toContain("/tmp/secret");
    expect(JSON.stringify({ read, cancel, finalize })).not.toContain("C:\\tmp\\secret");
    expect(JSON.stringify({ read, cancel, finalize })).not.toContain("stack trace");
  });
});
