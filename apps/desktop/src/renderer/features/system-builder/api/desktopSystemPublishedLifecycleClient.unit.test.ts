import { describe, expect, it, testDouble } from "../../../../../../../modules/testing/node-test";
import { createDesktopSystemPublishedLifecycleClient } from "./desktopSystemPublishedLifecycleClient";

function setDesktopApi(api: Record<string, unknown>): void {
  (globalThis as unknown as { window?: Record<string, unknown> }).window = {
    desktopApi: api,
  };
}

describe("desktop published system lifecycle client", () => {
  it("forwards only exact-release lifecycle reads and intents", async () => {
    const read = testDouble.fn().mockResolvedValue({
      ok: true,
      value: { state: "not-installed", revision: "not-installed" },
    });
    const invoke = testDouble.fn().mockResolvedValue({
      ok: true,
      value: { state: "active-stopped", revision: "deployment:2:session:none" },
    });
    setDesktopApi({
      readPublishedSystemLifecycle: read,
      invokePublishedSystemLifecycle: invoke,
    });
    const client = createDesktopSystemPublishedLifecycleClient();
    await client.read({ workspaceId: "workspace-a", releaseId: "release-a" });
    await client.invoke({
      workspaceId: "workspace-a",
      releaseId: "release-a",
      action: "install",
      expectedRevision: "not-installed",
    });

    expect(read).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      releaseId: "release-a",
    });
    expect(invoke).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      releaseId: "release-a",
      action: "install",
      expectedRevision: "not-installed",
    });
  });

  it("returns sanitized failures when the bridge is absent", async () => {
    setDesktopApi({});
    expect(
      await createDesktopSystemPublishedLifecycleClient().read({
        workspaceId: "workspace-a",
        releaseId: "release-a",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Published system lifecycle is unavailable.",
      },
    });
  });
});
