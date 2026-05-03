import { describe, expect, expectTypeOf, it } from "../../../testing/node-test";

import {
  RUNTIME_INSTALL_TARGET_COMFYUI,
  type RuntimeInstallRequest,
  type RuntimeInstallResult,
  type RuntimeInstallSource,
  type RuntimeInstallStatus,
  type RuntimeInstallStatusRequest,
  type RuntimeInstallStatusResult,
} from "..";

describe("runtime installer contracts", () => {
  it("defines install status literals", () => {
    const statuses: RuntimeInstallStatus[] = [
      "not-installed",
      "installing",
      "checking",
      "installed",
      "update-available",
      "failed",
      "unknown",
    ];

    expect(statuses).toContain("installed");
    expect(statuses).toContain("checking");
    expect(statuses).toContain("update-available");
  });

  it("defines install request/result/status shapes", () => {
    const source: RuntimeInstallSource = {
      type: "git",
      repositoryUrl: "https://github.com/comfyanonymous/ComfyUI.git",
      ref: "master",
    };

    const request: RuntimeInstallRequest = {
      targetId: RUNTIME_INSTALL_TARGET_COMFYUI,
      installRoot: "/tmp/runtime/comfyui",
      source,
      allowUpdate: true,
      metadata: {
        initiatedBy: "desktop-host",
      },
    };

    const statusRequest: RuntimeInstallStatusRequest = {
      targetId: request.targetId,
      installRoot: request.installRoot,
      source,
      metadata: {
        initiatedBy: "desktop-host",
      },
    };

    const result: RuntimeInstallResult = {
      targetId: request.targetId,
      status: "installed",
      installRoot: request.installRoot,
      source: request.source,
      requestedRef: "master",
      resolvedRef: "origin/master",
      commitSha: "abc123",
      installedAt: "2026-04-30T00:00:00.000Z",
      lastCheckedAt: "2026-04-30T00:01:00.000Z",
      warnings: [],
      metadata: { adapter: "git" },
    };

    const statusResult: RuntimeInstallStatusResult = {
      targetId: request.targetId,
      status: "installed",
      installRoot: request.installRoot,
      source: request.source,
      requestedRef: "master",
      resolvedRef: "origin/master",
      commitSha: "abc123",
      installedAt: result.installedAt,
      lastCheckedAt: result.lastCheckedAt,
      metadata: { adapter: "git" },
    };

    expect(statusRequest.targetId).toBe("comfyui");
    expect(result.status).toBe("installed");
    expect(statusResult.commitSha).toBe("abc123");
  });

  it("accepts git source shape and rejects unsupported source literals at type level", () => {
    const source: RuntimeInstallSource = {
      type: "git",
      repositoryUrl: "https://example.test/runtime.git",
    };

    expect(source.type).toBe("git");

    expectTypeOf<RuntimeInstallSource["type"]>().toEqualTypeOf<"git">();
  });
});
