import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import { registerComfyUiRuntimeIpc } from "../registerComfyUiRuntimeIpc";

describe("registerComfyUiRuntimeIpc", () => {
  it("registers status and repair handlers", async () => {
    const handlers = new Map<string, any>();
    const ipcMain = { handle: testDouble.fn((channel: string, handler: any) => { handlers.set(channel, handler); }) } as never;
    const installer = { getInstallStatus: testDouble.fn().mockResolvedValue({ status: "installed" }), ensureInstalled: testDouble.fn().mockResolvedValue({ status: "installed" }), repairInstall: testDouble.fn().mockResolvedValue({ status: "installed" }) } as never;
    registerComfyUiRuntimeIpc({ ipcMain, installer, installRoot: "/tmp/comfy" });
    expect(ipcMain.handle).toHaveBeenCalledTimes(2);
  });
});
