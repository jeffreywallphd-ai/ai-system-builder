import { describe, expect, it } from "../../testing/node-test";
import {
  createDesktopComfyUiInstallStatusRequest,
  createDesktopComfyUiRepairInstallRequest,
  createDesktopComfyUiInstallStatusSuccessResponse,
  createDesktopComfyUiRepairInstallSuccessResponse,
} from "./desktop-comfyui-runtime-contract";

describe("desktop comfyui runtime contract", () => {
  it("builds status request/response", () => {
    const req = createDesktopComfyUiInstallStatusRequest();
    expect(req.payload).toEqual({});
    const res = createDesktopComfyUiInstallStatusSuccessResponse({
      targetId: "comfyui",
      status: "installed",
      installRoot: "/tmp/c",
      source: { type: "git", repositoryUrl: "x" },
    } as never);
    expect(res.ok).toBe(true);
  });
  it("builds repair request/response", () => {
    const req = createDesktopComfyUiRepairInstallRequest();
    expect(req.payload).toEqual({});
    const res = createDesktopComfyUiRepairInstallSuccessResponse({
      targetId: "comfyui",
      status: "installed",
      installRoot: "/tmp/c",
      source: { type: "git", repositoryUrl: "x" },
    } as never);
    expect(res.ok).toBe(true);
  });
});
