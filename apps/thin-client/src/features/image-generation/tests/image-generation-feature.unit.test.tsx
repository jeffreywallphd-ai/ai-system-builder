import { readFile } from "node:fs/promises";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
const { secureFetchMock, formFixture } = vi.hoisted(() => ({
  secureFetchMock: vi.fn(),
  formFixture: { faceIdEnabled: false },
}));
vi.mock("../../../security/secureFetch", () => ({
  secureFetch: secureFetchMock,
}));
vi.mock("../hooks/useImageGenerationFeature", () => ({
  useImageGenerationFeature: () => ({
    form: {
      prompt:
        "raw photo quality image; 35mm camera quality image; a dog in the park",
      negativePrompt: "anime; cartoon; melty; blurry",
      seed: "",
      width: "1024",
      height: "1024",
      steps: "20",
      cfg: "8",
      denoise: "1",
      sampler: "dpmpp_2m",
      scheduler: "karras",
      model: "",
      numImages: "1",
      latentSourceArtifactId: "",
      faceIdEnabled: formFixture.faceIdEnabled,
      faceIdArtifactId1: "",
      faceIdArtifactId2: "",
      faceIdArtifactId3: "",
      faceIdIdentityStrength: "0.85",
      faceIdStructureStrength: "0.75",
      faceIdNoise: "0.35",
    },
    setForm: vi.fn(),
    runtimeMode: "cpu",
    setRuntimeMode: vi.fn(),
    status: "failed",
    error: "boom",
    requestId: "r1",
    results: [
      {
        assetId: "a1",
        artifactId: "art1",
        storageKey: "key/1",
        mediaType: "image/png",
        source: "generated",
      },
    ],
    sessionGallery: [
      {
        id: "g1",
        createdAt: "2026-05-27T00:00:00.000Z",
        assets: [
          {
            assetId: "a0",
            artifactId: "art0",
            storageKey: "key/0",
            mediaType: "image/png",
            source: "generated",
          },
        ],
      },
    ],
    start: vi.fn(),
    cancel: vi.fn(),
    unloadModel: vi.fn(),
    unloadModelState: { status: "idle" },
    runtimeResources: {
      memoryUsagePercent: 33,
      cpuUsagePercent: 22,
      gpuUsagePercent: 0,
    },
    qualityNote: undefined,
    validationError: undefined,
    isGenerateDisabled: false,
    isCancelDisabled: true,
    isUnloadModelDisabled: false,
    createPreviewUrl: (k: string) =>
      `/api/artifact/media/view?storageKey=${encodeURIComponent(k)}`,
    selectedModelRecordId: "",
    setSelectedModelRecordId: vi.fn(),
    refreshModelInventory: vi.fn(),
    modelInventoryLoading: false,
    modelInventoryError: undefined,
    imageArtifacts: [],
    imageArtifactsLoading: false,
    imageArtifactsError: undefined,
    refreshImageArtifacts: vi.fn(),
    downloadedImageGenerationModels: [
      {
        modelRecordId: "d1",
        displayName: "D1",
        modelId: "org/d1",
        provider: "hf",
        lifecycleStatus: "downloaded",
        artifactForm: "checkpoint",
        inferenceMode: "text-to-image",
      },
    ],
    referenceOnlyImageGenerationModels: [
      {
        modelRecordId: "r1",
        displayName: "R1",
        modelId: "org/r1",
        provider: "hf",
        lifecycleStatus: "registered",
        artifactForm: "checkpoint",
        inferenceMode: "text-to-image",
      },
    ],
    selectedModelRecord: undefined,
  }),
}));
import { ImageGenerationFeature } from "../components/ImageGenerationFeature";
describe("ImageGenerationFeature", () => {
  it("shows grouped model options and artifact-backed preview", async () => {
    secureFetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    });
    const originalCreateObjectUrl = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    const c = document.createElement("div");
    const root = createRoot(c);
    await act(async () => {
      root.render(<NotificationTestHarness><ImageGenerationFeature onNavigateToArtifacts={() => {}} /></NotificationTestHarness>);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      c.querySelector('optgroup[label="Downloaded image models"]'),
    ).toBeTruthy();
    expect(
      c.querySelector('optgroup[label="Saved references / download required"]'),
    ).toBeTruthy();
    expect(c.textContent).toContain("reference only");
    expect(c.textContent).toContain("Session Gallery");
    expect(secureFetchMock).toHaveBeenCalledWith(
      "/api/artifact/media/view?storageKey=key%2F1",
      expect.any(Object),
    );
    const img = c.querySelector("img") as HTMLImageElement;
    expect(img.src).toContain("blob:preview");
    expect(readNotificationMessages(c)).toContain("boom");
    expect(c.textContent).not.toContain("boom");
    await act(async () => root.unmount());
    URL.createObjectURL = originalCreateObjectUrl;
  });

  it("uses textarea prompts, a denoise slider, and shared workflow steps", async () => {
    const c = document.createElement("div");
    const root = createRoot(c);
    await act(async () => {
      root.render(<ImageGenerationFeature />);
    });
    expect(
      (c.querySelector("#image-generation-prompt") as HTMLTextAreaElement)
        .tagName,
    ).toBe("TEXTAREA");
    expect(
      (
        c.querySelector(
          "#image-generation-negativePrompt",
        ) as HTMLTextAreaElement
      ).tagName,
    ).toBe("TEXTAREA");
    const denoise = c.querySelector(
      "#image-generation-denoise",
    ) as HTMLInputElement;
    expect(denoise.type).toBe("range");
    expect(denoise.min).toBe("0");
    expect(denoise.max).toBe("1");
    expect(c.querySelectorAll(".ui-workflow__step").length).toBeGreaterThan(4);
  });

  it.each([false, true])("associates every field with its label when FaceID is %s", async (faceIdEnabled) => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const root = createRoot(c);
    formFixture.faceIdEnabled = faceIdEnabled;
    try {
      await act(async () => root.render(<ImageGenerationFeature />));
      const fields = [
        ["model-record", "Model (server inventory)"],
        ["runtime-mode", "Runtime mode"],
        ["latent-source", "Latent source"],
        ["face-id-enabled", "Enable FaceID (optional)"],
        ["prompt", "Prompt"],
        ["negativePrompt", "Negative Prompt (optional)"],
        ["seed", "Seed (optional)"],
        ["width", "Width"],
        ["height", "Height"],
        ["steps", "Steps"],
        ["cfg", "CFG"],
        ["sampler", "Sampler"],
        ["scheduler", "Scheduler"],
        ["numImages", "Number of Images"],
        ["denoise", "Denoise"],
        ["model", "Manual model/checkpoint"],
      ];
      if (faceIdEnabled) fields.push(
        ["faceIdArtifactId1", "Face reference image 1"],
        ["faceIdArtifactId2", "Face reference image 2 (optional)"],
        ["faceIdArtifactId3", "Face reference image 3 (optional)"],
        ["faceIdIdentityStrength", "Face identity strength"],
        ["faceIdStructureStrength", "Face structure strength"],
        ["faceIdNoise", "Face noise"],
      );
      expect(c.querySelectorAll("input, select, textarea")).toHaveLength(fields.length);
      for (const [key, text] of fields) {
        const id = `image-generation-${key}`;
        const control = c.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`);
        expect(control?.labels?.length, id).toBe(1);
        const label = control?.labels?.[0];
        expect(label?.htmlFor).toBe(id);
        expect(label?.control === control).toBe(true);
        expect(label?.textContent?.trim()).toBe(text);
        const help = control?.parentElement?.querySelector("button.ui-glossary-hint__button");
        expect(Boolean(help), id).toBe(true);
        expect(help?.closest("label")).toBeNull();
      }
    } finally {
      try { await act(async () => root.unmount()); }
      finally { c.remove(); formFixture.faceIdEnabled = false; }
    }
  });

  it("does not import desktop/preload/ipc modules", async () => {
    const source = await readFile(
      "apps/thin-client/src/features/image-generation/components/ImageGenerationFeature.tsx",
      "utf-8",
    );
    for (const fragment of ["desktop", "preload", "ipc", "electron"])
      expect(source.includes(fragment)).toBe(false);
  });

  it("keeps thin-client image-generation sources free of duplicate implementation fragments", async () => {
    const [apiClient, hook, component, page, routes] = await Promise.all([
      readFile(
        "apps/thin-client/src/features/image-generation/api/apiImageGenerationClient.ts",
        "utf-8",
      ),
      readFile(
        "apps/thin-client/src/features/image-generation/hooks/useImageGenerationFeature.ts",
        "utf-8",
      ),
      readFile(
        "apps/thin-client/src/features/image-generation/components/ImageGenerationFeature.tsx",
        "utf-8",
      ),
      readFile("apps/thin-client/src/pages/ImageGenerationPage.tsx", "utf-8"),
      readFile("apps/thin-client/src/routes/thinClientPages.ts", "utf-8"),
    ]);

    expect(
      apiClient.match(/export function createApiImageGenerationClient/g),
    ).toHaveLength(1);
    expect(apiClient).not.toContain("export class ImageGenerationApiError");
    expect(
      hook.match(/export function useImageGenerationFeature/g),
    ).toHaveLength(1);
    expect(hook.match(/const defaultArtifactBrowserClient =/g)).toHaveLength(1);
    expect(
      component.match(/export function ImageGenerationFeature/g),
    ).toHaveLength(1);
    expect(page.match(/export function ImageGenerationPage/g)).toHaveLength(1);
    expect(routes.match(/export type ThinClientPageKey/g)).toHaveLength(1);
  });
});
