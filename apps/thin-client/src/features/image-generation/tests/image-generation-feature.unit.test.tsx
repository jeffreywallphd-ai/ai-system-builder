import { readFile } from "node:fs/promises";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));
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
      root.render(<ImageGenerationFeature onNavigateToArtifacts={() => {}} />);
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
