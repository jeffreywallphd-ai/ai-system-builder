import { describe, it, expect, vi } from "vitest";
import { createDesktopImageGenerationClient } from "../api";

describe("desktop image generation client", () => {
  it("reads typed ComfyUI install status", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = { readComfyUiInstallStatus: vi.fn().mockResolvedValue({ ok: true, value: { targetId: "comfyui", status: "installed", installRoot: "/tmp/comfy" } }) } as never;
    const client = createDesktopImageGenerationClient();
    const result = await client.readComfyUiInstallStatus();
    expect(result).toMatchObject({ ok: true, value: { status: "installed" } });
  });

  it("repairs and returns typed install result", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = { repairComfyUiInstall: vi.fn().mockResolvedValue({ ok: true, value: { targetId: "comfyui", status: "installed", installRoot: "/tmp/comfy", source: { type: "git", repositoryUrl: "x" } } }) } as never;
    const client = createDesktopImageGenerationClient();
    const result = await client.repairComfyUiInstall();
    expect(result).toMatchObject({ ok: true, value: { status: "installed" } });
  });

  it("returns clear failure for malformed envelope", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = { readComfyUiInstallStatus: vi.fn().mockResolvedValue({ ok: true, value: null }) } as never;
    const client = createDesktopImageGenerationClient();
    await expect(client.readComfyUiInstallStatus()).resolves.toMatchObject({ ok: false, error: { message: "Malformed ComfyUI install status response." } });
  });
});
