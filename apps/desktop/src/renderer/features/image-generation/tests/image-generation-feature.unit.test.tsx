// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageGenerationFeature } from "../components/ImageGenerationFeature";
import { ImageGenerationForm, type ImageGenerationFormProps } from "../components/ImageGenerationForm";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";

const imageForm: ImageGenerationFormProps["form"] = {
  prompt: "",
  negativePrompt: "",
  seed: "42",
  width: "1024",
  height: "1024",
  steps: "30",
  cfg: "8",
  denoise: "1",
  sampler: "euler",
  scheduler: "normal",
  model: "",
  numImages: "1",
  latentSourceArtifactId: "",
  faceIdEnabled: false,
  faceIdArtifactId1: "",
  faceIdArtifactId2: "",
  faceIdArtifactId3: "",
  faceIdIdentityStrength: "0.85",
  faceIdStructureStrength: "0.75",
  faceIdNoise: "0.35",
};

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { vi.unstubAllGlobals(); });

vi.mock("../../settings/components", () => ({
  SettingsPanel: () => <div>settings-panel</div>,
}));

vi.mock("../hooks/useImageGenerationFeature", () => ({
  useImageGenerationFeature: () => ({
    form: imageForm,
    setForm: vi.fn(),
    status: "running",
    requestId: "r1",
    message: "cancel unsupported",
    progress: { message: "doing work", current: 1, total: 2 },
    error: "Synthetic generation failure",
    taskData: {
      outputs: [
        { fileName: "a.png", subfolder: "x", engine: "comfy", promptId: "p1" },
      ],
    },
    outputs: [
      { fileName: "a.png", subfolder: "x", engine: "comfy", promptId: "p1" },
    ],
    finalizedAssets: [{ assetId: "as1", artifactId: "ar1" }],
    availableModels: [
      {
        value: "runwayml/stable-diffusion-v1-5",
        label:
          "Stable Diffusion - runwayml/stable-diffusion-v1-5 - huggingface - downloaded - full-model - inference: text-to-image",
        modelRecordId: "model-1",
      },
    ],
    availableImageArtifacts: [],
    artifactLoadMessage: undefined,
    modelLoadStatus: "success",
    modelLoadMessage: undefined,
    validationError: undefined,
    isStartDisabled: true,
    start: vi.fn(),
    cancel: vi.fn(),
    refreshInstallStatus: vi.fn(),
    repairInstall: vi.fn(),
    installStatus: "installed",
  }),
}));

describe("ImageGenerationFeature", () => {
  it("displays progress and finalized assets", async () => {
    const c = document.createElement("div");
    const root = createRoot(c);
    await act(async () => {
      root.render(<NotificationTestHarness><ImageGenerationFeature workspaceId="workspace-a" /></NotificationTestHarness>);
    });
    expect(c.textContent).toContain("doing work");
    expect(c.textContent).toContain("Asset ID: as1");
    expect(c.textContent).toContain("cancel unsupported");
    expect(readNotificationMessages(c)).toContain("Synthetic generation failure");
    expect(c.textContent).not.toContain("Synthetic generation failure");
    expect(c.textContent).not.toContain("Loaded 1 image generation model.");
    expect(c.querySelectorAll(".ui-workflow__step").length).toBeGreaterThan(4);
    await act(async () => {
      root.unmount();
    });
  });
});

describe("ImageGenerationForm", () => {
  it.each([false, true])("names every field when FaceID is %s", async (faceIdEnabled) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <ImageGenerationForm
          form={{ ...imageForm, faceIdEnabled }}
          setForm={vi.fn()}
          isStartDisabled={false}
          onSubmit={vi.fn()}
          availableModels={[]}
          modelLoadStatus="success"
        />,
      ));
      const prompt = container.querySelector<HTMLTextAreaElement>('[data-testid="image-prompt"]');
      expect(prompt?.labels).toHaveLength(1);
      expect(prompt?.labels?.[0]?.textContent).toBe("Prompt");

      const names = [
        "Model/Checkpoint", "Latent Source", "Prompt", "Negative Prompt",
        "Enable FaceID (optional)",
        ...(faceIdEnabled ? [
          "Face reference image 1", "Face reference image 2 (optional)",
          "Face reference image 3 (optional)", "Face identity weight",
          "Face structure weight", "Face noise",
        ] : []),
        "Seed", "Width", "Height", "Steps", "CFG", "Denoise", "Sampler",
        "Scheduler", "Number of Images",
      ];
      const controls = Array.from(container.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input, textarea, select"));
      expect(controls).toHaveLength(names.length);
      expect(new Set(controls.map(control => control.id)).size).toBe(controls.length);
      for (const [index, control] of controls.entries()) {
        const name = names[index];
        expect(control.id, name).toBeTruthy();
        expect(control.labels, name).toHaveLength(1);
        const label = control.labels?.[0];
        expect(label?.htmlFor, name).toBe(control.id);
        expect(label?.control, name).toBe(control);
        expect(label?.textContent, name).toBe(name);
        const help = control.parentElement?.querySelector<HTMLButtonElement>(
          "button.ui-glossary-hint__button",
        );
        expect(help?.type, name).toBe("button");
        expect(help?.closest("label"), name).toBeNull();
      }
    } finally {
      try {
        await act(async () => root.unmount());
      } finally {
        container.remove();
      }
    }
  });

  it("opens FaceID help separately from enabling FaceID", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const setForm = vi.fn();
    const onSubmit = vi.fn();
    try {
      await act(async () => root.render(
        <ImageGenerationForm
          form={imageForm}
          setForm={setForm}
          isStartDisabled={false}
          onSubmit={onSubmit}
          availableModels={[]}
          modelLoadStatus="success"
        />,
      ));
      const row = container.querySelector(".ui-workflow__checkbox-row");
      const help = row?.querySelector<HTMLButtonElement>("button");
      const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const label = checkbox?.labels?.[0];
      expect(help?.getAttribute("aria-expanded")).toBe("false");
      await act(async () => help?.click());
      expect(help?.getAttribute("aria-expanded")).toBe("true");
      expect(setForm).not.toHaveBeenCalled();
      expect(help?.closest("label")).toBeNull();
      expect(label?.control).toBe(checkbox);
      await act(async () => label?.click());
      expect(setForm).toHaveBeenCalledExactlyOnceWith({ ...imageForm, faceIdEnabled: true });
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      try {
        await act(async () => root.unmount());
      } finally {
        container.remove();
      }
    }
  });
});
