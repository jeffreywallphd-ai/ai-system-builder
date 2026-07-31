// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopIngestionTaskClient } from "../api/desktopIngestionTaskClient";

describe("desktop ingestion task client", () => {
  afterEach(() => { delete (window as any).desktopApi; });
  it("uses the typed preload bridge and unwraps its canonical value", async () => {
    const executeIngestionTask = vi.fn().mockResolvedValue({ ok: true, value: { kind: "tasks", tasks: [] } });
    (window as any).desktopApi = { executeIngestionTask };
    await expect(createDesktopIngestionTaskClient().execute({ workspaceId: "workspace-a", command: { action: "list" } })).resolves.toEqual({ kind: "tasks", tasks: [] });
    expect(executeIngestionTask).toHaveBeenCalledWith({ workspaceId: "workspace-a", command: { action: "list" } });
  });
  it("fails clearly when the bridge is unavailable", async () => {
    await expect(createDesktopIngestionTaskClient().execute({ workspaceId: "workspace-a", command: { action: "list" } })).rejects.toThrow(/unavailable/i);
  });
});
