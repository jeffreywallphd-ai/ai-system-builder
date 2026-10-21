import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";

import { createGitRuntimeInstallerAdapter } from "../createGitRuntimeInstallerAdapter";

const baseRequest = {
  targetId: "runtime-a",
  installRoot: "/runtime/root",
  source: {
    type: "git" as const,
    repositoryUrl: "https://example.com/repo.git",
    ref: "main",
  },
};

function createFsMocks({
  existingRoot = false,
  emptyRoot = false,
  metadata,
}: { existingRoot?: boolean; emptyRoot?: boolean; metadata?: unknown } = {}) {
  const stat = testDouble.fn(async (targetPath: string) => {
    if (targetPath === baseRequest.installRoot && existingRoot)
      return {} as never;
    if (
      targetPath.endsWith(".ai-system-builder-runtime-install.json") &&
      metadata !== undefined
    )
      return {} as never;
    throw Object.assign(new Error("Missing synthetic entry"), { code: "ENOENT" });
  });
  const readdir = testDouble.fn(async () => (emptyRoot ? [] : ["file"]));
  const readFile = testDouble.fn(async () => JSON.stringify(metadata));
  const writeFile = testDouble.fn(async () => undefined);
  const mkdir = testDouble.fn(async () => undefined);
  return { stat, readdir, readFile, writeFile, mkdir };
}

describe("createGitRuntimeInstallerAdapter", () => {
  it("denies repair and forceRepair without explicit update authority before I/O", async () => {
    for (const allowUpdate of [false, undefined]) {
      for (const operation of ["repairInstall", "ensureInstalled"] as const) {
        const fs = createFsMocks({ existingRoot: true });
        const execFile = testDouble.fn();
        const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
        const result = await adapter[operation]({
          ...baseRequest,
          allowUpdate,
          forceRepair: true,
        });
        expect(result.status).toBe("failed");
        expect(result.error?.code).toBe("update-not-authorized");
        for (const effect of [...Object.values(fs), execFile])
          expect(effect).not.toHaveBeenCalled();
      }
    }
  });

  it("never interprets unreadable or indeterminate filesystem state as initial-install authority", async () => {
    for (const stage of ["root-stat", "root-list", "metadata-stat", "metadata-read"]) {
      for (const failureCode of ["EACCES", "EIO", "ENOTDIR", undefined]) {
        const fs = createFsMocks({ existingRoot: true });
        const fail = () => { throw Object.assign(new Error("Synthetic private diagnostic"), { code: failureCode }); };
        if (stage === "root-stat") fs.stat.mockImplementation(fail);
        if (stage === "root-list") fs.readdir.mockImplementation(fail);
        if (stage === "metadata-stat") fs.stat.mockImplementation(async (name: string) => name === baseRequest.installRoot ? {} as never : fail());
        if (stage === "metadata-read") {
          fs.stat.mockImplementation(async () => ({} as never));
          fs.readFile.mockImplementation(fail);
        }
        const execFile = testDouble.fn(async () => ({ stdout: "abc", stderr: "" }));
        const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
        const status = await adapter.getInstallStatus(baseRequest);
        expect(["unknown", "failed"]).toContain(status.status);
        for (const operation of ["ensureInstalled", "repairInstall"] as const) {
          const result = await adapter[operation]({ ...baseRequest, allowUpdate: true, forceRepair: true });
          expect(result.status).toBe("failed");
          for (const effect of [execFile, fs.mkdir, fs.writeFile]) expect(effect).not.toHaveBeenCalled();
        }
      }
    }
  });

  it("status returns not-installed when root missing", async () => {
    const fs = createFsMocks();
    const adapter = createGitRuntimeInstallerAdapter({ ...fs });
    const result = await adapter.getInstallStatus(baseRequest);
    expect(result.status).toBe("not-installed");
  });

  it("approved repair retains the exact source without manufacturing forceRepair", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: baseRequest.targetId,
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => ({
        stdout: args.includes("rev-parse") ? "abc\n" : "",
        stderr: "",
      }),
    );
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    const result = await adapter.repairInstall({
      ...baseRequest,
      allowUpdate: true,
      forceRepair: false,
    });
    expect(result.status).toBe("installed");
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      baseRequest.installRoot,
      "checkout",
      "main",
    ]);
    expect(execFile.mock.calls.some((call) => call[1]?.includes("pull"))).toBe(
      false,
    );
  });

  it("status returns installed from valid metadata", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: baseRequest.targetId,
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: now,
        lastCheckedAt: now,
      },
    });
    const adapter = createGitRuntimeInstallerAdapter({ ...fs });
    const result = await adapter.getInstallStatus(baseRequest);
    expect(result.status).toBe("installed");
  });

  it("metadata malformed JSON returns metadata-read-failed", async () => {
    const fs = createFsMocks({ existingRoot: true, metadata: { ok: true } });
    const badRead = testDouble.fn(async () => "{ bad json");
    const adapterWithBadRead = createGitRuntimeInstallerAdapter({
      ...fs,
      readFile: badRead as never,
    });
    const result = await adapterWithBadRead.getInstallStatus(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("metadata-read-failed");
  });

  it("metadata wrong shape returns metadata-read-failed", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: { managedBy: "ai-system-builder" },
    });
    const adapter = createGitRuntimeInstallerAdapter({ ...fs });
    const result = await adapter.getInstallStatus(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("metadata-read-failed");
  });

  it("wrong targetId metadata is treated as unmanaged", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: "other-target",
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const adapter = createGitRuntimeInstallerAdapter({ ...fs });
    const result = await adapter.getInstallStatus(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unmanaged-install-root");
  });

  it("ensureInstalled clones git repo without precreating installRoot", async () => {
    const fs = createFsMocks();
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        if (args.includes("rev-parse"))
          return { stdout: "abc123\n", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    );
    const adapter = createGitRuntimeInstallerAdapter({
      ...fs,
      execFile,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const result = await adapter.ensureInstalled(baseRequest);
    expect(result.status).toBe("installed");
    expect(execFile).toHaveBeenCalledWith("git", [
      "clone",
      baseRequest.source.repositoryUrl,
      baseRequest.installRoot,
    ]);
    expect(fs.mkdir).toHaveBeenCalledTimes(1);
    expect(fs.mkdir).toHaveBeenCalledWith("/runtime", { recursive: true });
  });

  it("emits shared structured git runtime install log events", async () => {
    const fs = createFsMocks();
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        if (args.includes("rev-parse"))
          return { stdout: "abc123\n", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    );
    const log = testDouble.fn();
    const adapter = createGitRuntimeInstallerAdapter({
      ...fs,
      execFile,
      now: () => "2026-01-01T00:00:00.000Z",
      logging: { log },
    });

    await adapter.ensureInstalled(baseRequest);

    expect(log).toHaveBeenCalled();
    const event = log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(event).toMatchObject({
      level: "info",
      verbosity: "normal",
      event: "runtime.git.installer.activity",
      component: "git-runtime-installer",
      subsystem: "runtime",
      data: {
        targetId: "runtime-a",
        installRoot: "/runtime/root",
      },
    });
    expect(event.context).toBeUndefined();
  });

  it("failed clone does not write metadata", async () => {
    const fs = createFsMocks();
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        if (args[0] === "clone") throw new Error("clone failed");
        return { stdout: "", stderr: "" };
      },
    );
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    const result = await adapter.ensureInstalled(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("git-clone-failed");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("allowUpdate with ref runs fetch + checkout + rev-parse without pull", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: baseRequest.targetId,
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const calls: string[][] = [];
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        calls.push([...args]);
        return {
          stdout: args.includes("rev-parse") ? "abc\n" : "",
          stderr: "",
        };
      },
    );
    const adapter = createGitRuntimeInstallerAdapter({
      ...fs,
      execFile,
      now: () => "2026-01-02T00:00:00.000Z",
    });
    await adapter.ensureInstalled({ ...baseRequest, allowUpdate: true });
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      baseRequest.installRoot,
      "fetch",
      "--all",
      "--tags",
    ]);
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      baseRequest.installRoot,
      "checkout",
      "main",
    ]);
    expect(calls.some((args) => args.includes("pull"))).toBe(false);
  });

  it("allowUpdate without ref runs fetch + pull + rev-parse", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: baseRequest.targetId,
        installRoot: baseRequest.installRoot,
        source: { type: "git", repositoryUrl: "https://example.com/repo.git" },
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const request = {
      ...baseRequest,
      source: {
        type: "git" as const,
        repositoryUrl: "https://example.com/repo.git",
      },
      allowUpdate: true,
    };
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => ({
        stdout: args.includes("rev-parse") ? "abc\n" : "",
        stderr: "",
      }),
    );
    const adapter = createGitRuntimeInstallerAdapter({
      ...fs,
      execFile,
      now: () => "2026-01-02T00:00:00.000Z",
    });
    await adapter.ensureInstalled(request);
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      baseRequest.installRoot,
      "fetch",
      "--all",
      "--tags",
    ]);
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      baseRequest.installRoot,
      "pull",
      "--ff-only",
    ]);
  });

  it("forceRepair true on unmanaged root does not modify files", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: "other-target",
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const execFile = testDouble.fn();
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    const result = await adapter.ensureInstalled({
      ...baseRequest,
      allowUpdate: true,
      forceRepair: true,
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unmanaged-install-root");
    expect(result.error?.message).toContain("forceRepair is not implemented");
    expect(execFile).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("denies unmanaged Git trees even when editable origin matches the requested source", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: "other-target",
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        if (args.includes("config"))
          return {
            stdout: `${baseRequest.source.repositoryUrl}\n`,
            stderr: "",
          };
        if (args.includes("rev-parse"))
          return { stdout: "abc123\n", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    );
    const adapter = createGitRuntimeInstallerAdapter({
      ...fs,
      execFile,
      now: () => "2026-01-03T00:00:00.000Z",
    });
    const result = await adapter.ensureInstalled(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unmanaged-install-root");
    expect(execFile).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not adopt unmanaged git install when origin remote does not match request source", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: "other-target",
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        if (args.includes("config"))
          return { stdout: "https://example.com/other.git\n", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    );
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    const result = await adapter.ensureInstalled(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unmanaged-install-root");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("rejects absent, wrong-target, wrong-root and wrong-source metadata under every operation flag", async () => {
    const managed = {
      managedBy: "ai-system-builder",
      targetId: baseRequest.targetId,
      installRoot: baseRequest.installRoot,
      source: baseRequest.source,
      installedAt: "2026-01-01T00:00:00.000Z",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    };
    for (const metadata of [
      undefined,
      { ...managed, targetId: "other" },
      { ...managed, installRoot: "/other/root" },
      {
        ...managed,
        source: {
          ...managed.source,
          repositoryUrl: "https://example.com/other.git",
        },
      },
    ]) {
      for (const allowUpdate of [false, true, undefined]) {
        for (const forceRepair of [false, true]) {
          for (const operation of [
            "ensureInstalled",
            "repairInstall",
          ] as const) {
            const fs = createFsMocks({ existingRoot: true, metadata });
            const execFile = testDouble.fn(async () => ({
              stdout: baseRequest.source.repositoryUrl,
              stderr: "",
            }));
            const adapter = createGitRuntimeInstallerAdapter({
              ...fs,
              execFile,
            });
            expect(
              (
                await adapter[operation]({
                  ...baseRequest,
                  allowUpdate,
                  forceRepair,
                })
              ).status,
            ).toBe("failed");
            for (const effect of [execFile, fs.mkdir, fs.writeFile])
              expect(effect).not.toHaveBeenCalled();
          }
        }
      }
    }
  });

  it("permits initial installation into an existing empty root", async () => {
    const fs = createFsMocks({ existingRoot: true, emptyRoot: true });
    const execFile = testDouble.fn(async () => ({
      stdout: "abc123",
      stderr: "",
    }));
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    expect((await adapter.ensureInstalled(baseRequest)).status).toBe(
      "installed",
    );
    expect(execFile).toHaveBeenCalledWith("git", [
      "clone",
      baseRequest.source.repositoryUrl,
      baseRequest.installRoot,
    ]);
    expect(fs.writeFile).toHaveBeenCalledOnce();
  });

  it("forceRepair true on managed install runs conservative update path", async () => {
    const fs = createFsMocks({
      existingRoot: true,
      metadata: {
        managedBy: "ai-system-builder",
        targetId: baseRequest.targetId,
        installRoot: baseRequest.installRoot,
        source: baseRequest.source,
        installedAt: "2026-01-01T00:00:00.000Z",
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => ({
        stdout: args.includes("rev-parse") ? "abc\n" : "",
        stderr: "",
      }),
    );
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    const result = await adapter.ensureInstalled({
      ...baseRequest,
      allowUpdate: true,
      forceRepair: true,
    });
    expect(result.status).toBe("installed");
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      baseRequest.installRoot,
      "fetch",
      "--all",
      "--tags",
    ]);
  });

  it("metadata write throw maps to metadata-write-failed", async () => {
    const fs = createFsMocks();
    const writeFile = testDouble.fn(async () => {
      throw new Error("nope");
    });
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => ({
        stdout: args.includes("rev-parse") ? "abc\n" : "",
        stderr: "",
      }),
    );
    const adapter = createGitRuntimeInstallerAdapter({
      ...fs,
      execFile,
      writeFile: writeFile as never,
    });
    const result = await adapter.ensureInstalled(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("metadata-write-failed");
  });

  it("rev-parse failure maps to git-rev-parse-failed", async () => {
    const fs = createFsMocks();
    const execFile = testDouble.fn(
      async (_file: string, args: readonly string[] = []) => {
        if (args.includes("rev-parse")) throw new Error("bad rev");
        return { stdout: "", stderr: "" };
      },
    );
    const adapter = createGitRuntimeInstallerAdapter({ ...fs, execFile });
    const result = await adapter.ensureInstalled(baseRequest);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("git-rev-parse-failed");
  });
});
