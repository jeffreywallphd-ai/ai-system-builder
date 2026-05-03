import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ImageGenerationFeature } from "../components/ImageGenerationFeature";
vi.mock("../../settings/components", () => ({
  SettingsPanel: () => <div>settings-panel</div>,
}));

vi.mock("../hooks/useImageGenerationFeature", () => ({
  useImageGenerationFeature: () => ({
    form: { prompt: "", negativePrompt: "", seed: "42", width: "1024", height: "1024", steps: "30", sampler: "euler", scheduler: "normal", model: "", numImages: "1" },
    setForm: vi.fn(), status: "running", requestId: "r1", message: "cancel unsupported", progress: { message: "doing work", current: 1, total: 2 }, error: undefined,
    taskData: { outputs: [{ fileName: "a.png", subfolder: "x", engine: "comfy", promptId: "p1" }] }, outputs: [{ fileName: "a.png", subfolder: "x", engine: "comfy", promptId: "p1" }], finalizedAssets: [{ assetId: "as1", artifactId: "ar1" }], availableModels: [{ value: "runwayml/stable-diffusion-v1-5", label: "Stable Diffusion - runwayml/stable-diffusion-v1-5 - huggingface - downloaded - full-model - inference: text-to-image", modelRecordId: "model-1" }], modelLoadStatus: "success", modelLoadMessage: "Loaded 1 image generation model.", validationError: undefined, isStartDisabled: true, start: vi.fn(), cancel: vi.fn(), repairInstall: vi.fn(), installStatus: "installed",
  }),
}));

describe("ImageGenerationFeature", () => {
  it("displays progress and finalized assets", async () => {
    const c = document.createElement("div");
    const root = createRoot(c);
    await act(async () => { root.render(<ImageGenerationFeature />); });
    expect(c.textContent).toContain("doing work");
    expect(c.textContent).toContain("Asset ID: as1");
    expect(c.textContent).toContain("cancel unsupported");
    await act(async () => { root.unmount(); });
  });
});
