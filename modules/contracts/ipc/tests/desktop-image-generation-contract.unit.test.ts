import { describe, expect, it } from "../../../testing/node-test";
import { DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL, createDesktopImageGenerationStartRequest } from "../desktop-image-generation-contract";

describe("desktop image generation ipc contract", () => {
  it("defines channels", () => {
    expect(DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.kind).toBe("request");
    expect(DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.kind).toBe("request");
    expect(DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.kind).toBe("request");
  });
  it("creates start request", () => {
    const request = createDesktopImageGenerationStartRequest({ prompt: "cat" });
    expect(request.payload.prompt).toBe("cat");
  });
});
