import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { buildComfyUiRuntimeLaunchArguments, createComfyUiRuntimeSupervisor } from "../createComfyUiRuntimeSupervisor";
import { buildComfyUiRuntimeEnvironment } from "../comfyUiPythonEnvironment";

function createMockChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    kill: (signal?: string) => boolean;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = testDouble.fn(() => true);
  return emitter;
}

describe("createComfyUiRuntimeSupervisor", () => {
  it("builds DirectML launch arguments without falling through to CUDA autodetection", () => {
    expect(buildComfyUiRuntimeLaunchArguments({ host: "127.0.0.1", port: 8188, runtimeDeviceMode: "directml" })).toEqual([
      "main.py",
      "--directml",
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
    ]);
  });

  it("builds CPU launch arguments when cpu mode is selected", () => {
    expect(buildComfyUiRuntimeLaunchArguments({ host: "127.0.0.1", port: 8188, runtimeDeviceMode: "cpu" })).toEqual([
      "main.py",
      "--cpu",
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
    ]);
  });

  it("start is idempotent and does not spawn multiple processes", async () => {
    const spawnImplementation = testDouble.fn(() => createMockChildProcess() as any);
    const fetchImplementation = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: [] }),
    });
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 200,
    });

    await supervisor.start();
    await supervisor.start();

    expect(spawnImplementation).toHaveBeenCalledOnce();
  });

  it("passes the resolved runtime device mode to the spawned ComfyUI process", async () => {
    const spawnImplementation = testDouble.fn(() => createMockChildProcess() as any);
    const fetchImplementation = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: [] }),
    });
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      runtimeDeviceMode: "directml",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 200,
    });

    await supervisor.start();

    expect(spawnImplementation).toHaveBeenCalledWith("python", [
      "main.py",
      "--directml",
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
    ], { cwd: "/tmp/comfyui", env: expect.any(Object), stdio: "pipe" });
    expect((spawnImplementation.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv }).env?.PYTHONNOUSERSITE).toBe("1");
  });

  it("builds a runtime environment that ignores incompatible user-site Python packages", () => {
    expect(buildComfyUiRuntimeEnvironment({ PYTHONNOUSERSITE: "0", KEEP_ME: "1" }).PYTHONNOUSERSITE).toBe("1");
    expect(buildComfyUiRuntimeEnvironment({ KEEP_ME: "1" }).KEEP_ME).toBe("1");
  });

  it("transitions health states", async () => {
    const spawnImplementation = testDouble.fn(() => createMockChildProcess() as any);
    let call = 0;
    const fetchImplementation = testDouble.fn(async () => {
      call += 1;
      if (call < 2) {
        throw new Error("not ready");
      }
      return { ok: true, status: 200, json: async () => ({ devices: [] }) };
    });
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 50,
    });

    await supervisor.start();
    const health = await supervisor.getHealth();
    expect(health.status).toBe("ready");
    expect(fetchImplementation.mock.calls[0]?.[0]).toContain("/system_stats");
  });

  it("emits shared structured runtime log events", async () => {
    const spawnImplementation = testDouble.fn(() => createMockChildProcess() as any);
    const fetchImplementation = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: [] }),
    });
    const log = testDouble.fn();
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 200,
      logging: { log },
    });

    await supervisor.start();

    expect(log).toHaveBeenCalled();
    const event = log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(event).toMatchObject({
      level: "info",
      verbosity: "normal",
      event: "runtime.comfyui.supervisor.activity",
      component: "comfyui-runtime-supervisor",
      subsystem: "runtime",
      data: {
        pythonExecutable: "python",
        spawnWorkingDirectory: "/tmp/comfyui",
        host: "127.0.0.1",
        port: 8188,
      },
    });
    expect(event.context).toBeUndefined();
  });

  it("logs startup health polling details before the runtime becomes ready", async () => {
    const spawnImplementation = testDouble.fn(() => createMockChildProcess() as any);
    let call = 0;
    const fetchImplementation = testDouble.fn(async () => {
      call += 1;
      if (call === 1) {
        throw new Error("not ready");
      }
      return { ok: true, status: 200, json: async () => ({ devices: [] }) };
    });
    const log = testDouble.fn();
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 200,
      logging: { log },
    });

    await supervisor.start();

    const messages = log.mock.calls.map((call) => (call[0] as { message: string }).message);
    expect(messages).toContain("ComfyUI runtime process spawned; polling health endpoint.");
    expect(messages).toContain("Waiting for ComfyUI runtime health endpoint.");
    expect(messages).toContain("ComfyUI runtime is ready.");
  });

  it("kills process and marks unhealthy when startup times out", async () => {
    const mockChild = createMockChildProcess();
    const spawnImplementation = testDouble.fn(() => mockChild as any);
    const fetchImplementation = testDouble.fn(async () => {
      throw new Error("still booting");
    });
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 5,
    });

    await expect(supervisor.start()).rejects.toThrow("failed to become ready");
    expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(supervisor.isRunning()).toBe(false);
    const health = await supervisor.getHealth();
    expect(health).toMatchObject({ status: "stopped" });
  });

  it("fails startup without timeout cleanup when the process exits before health checks complete", async () => {
    const mockChild = createMockChildProcess();
    const spawnImplementation = testDouble.fn(() => mockChild as any);
    const fetchImplementation = testDouble.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      throw new Error("still booting");
    });
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 100,
    });

    queueMicrotask(() => {
      mockChild.stderr.write("ModuleNotFoundError: No module named 'torch'");
      mockChild.emit("exit", 1, null);
    });

    await expect(supervisor.start()).rejects.toThrow(
      /ComfyUI runtime exited before health check completed\.[\s\S]*Recent runtime output: ModuleNotFoundError/,
    );
    expect(mockChild.kill).not.toHaveBeenCalled();
  });

  it("fails startup clearly when spawning throws synchronously", async () => {
    const spawnImplementation = testDouble.fn(() => {
      throw new Error("spawn EPERM");
    });
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: testDouble.fn() as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 100,
    });

    await expect(supervisor.start()).rejects.toThrow("ComfyUI runtime failed during startup. ComfyUI runtime process failed to start: spawn EPERM");
  });

  it("repairs dependency mismatch once and retries startup to ready", async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnImplementation = testDouble.fn()
      .mockImplementationOnce(() => firstChild as any)
      .mockImplementationOnce(() => secondChild as any);
    const fetchImplementation = testDouble.fn()
      .mockRejectedValueOnce(new Error("booting"))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ devices: [] }) });
    const installer = {
      ensureInstalled: testDouble.fn(async () => ({ status: "installed" as const })),
      repairInstall: testDouble.fn(async () => ({ status: "installed" as const })),
      getInstallStatus: testDouble.fn(),
    };
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui",
      installRoot: "/tmp/comfyui",
      autoInstall: true,
      installer,
      spawnImplementation: spawnImplementation as never,
      fetchImplementation: fetchImplementation as never,
      healthCheckIntervalMs: 1,
      startupTimeoutMs: 100,
    });
    queueMicrotask(() => {
      firstChild.stderr.write("torchaudio WinError 127 specified procedure could not be found");
      firstChild.emit("exit", 1, null);
    });
    await supervisor.start();
    expect(installer.repairInstall).toHaveBeenCalledTimes(1);
    expect(installer.repairInstall.mock.calls[0]?.[0]?.metadata?.repairReason).toBe("torchaudio");
    expect(spawnImplementation).toHaveBeenCalledTimes(2);
    expect((await supervisor.getHealth()).status).toBe("ready");
  });

  it("throws clear error when dependency repair fails", async () => {
    const firstChild = createMockChildProcess();
    const spawnImplementation = testDouble.fn(() => firstChild as any);
    const installer = {
      ensureInstalled: testDouble.fn(async () => ({ status: "installed" as const })),
      repairInstall: testDouble.fn(async () => ({ status: "failed" as const, error: { message: "pip failed" } })),
      getInstallStatus: testDouble.fn(),
    };
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui", installRoot: "/tmp/comfyui", autoInstall: true, installer,
      spawnImplementation: spawnImplementation as never, fetchImplementation: testDouble.fn(async () => { throw new Error("boot"); }) as never, healthCheckIntervalMs: 1, startupTimeoutMs: 50,
    });
    queueMicrotask(() => {
      firstChild.stderr.write("_torchaudio WinError 127");
      firstChild.emit("exit", 1, null);
    });
    await expect(supervisor.start()).rejects.toThrow("ComfyUI dependency mismatch detected (torchaudio/torchvision). The system attempted repair but failed.");
  });

  it("throws clear error when retry startup fails after repair", async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnImplementation = testDouble.fn().mockImplementationOnce(() => firstChild as any).mockImplementationOnce(() => secondChild as any);
    const installer = {
      ensureInstalled: testDouble.fn(async () => ({ status: "installed" as const })),
      repairInstall: testDouble.fn(async () => ({ status: "installed" as const })),
      getInstallStatus: testDouble.fn(),
    };
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui", installRoot: "/tmp/comfyui", autoInstall: true, installer,
      spawnImplementation: spawnImplementation as never, fetchImplementation: testDouble.fn(async () => { throw new Error("boot"); }) as never, healthCheckIntervalMs: 1, startupTimeoutMs: 80,
    });
    queueMicrotask(() => { firstChild.stderr.write("torchaudio WinError 127"); firstChild.emit("exit", 1, null); });
    setTimeout(() => { secondChild.stderr.write("still broken"); secondChild.emit("exit", 1, null); }, 10);
    await expect(supervisor.start()).rejects.toThrow("ComfyUI failed after dependency repair. See logs for details.");
    expect(installer.repairInstall).toHaveBeenCalledTimes(1);
  });

  it("does not repair non-dependency startup failures or when autoInstall is false", async () => {
    const child = createMockChildProcess();
    const installer = { repairInstall: testDouble.fn(), ensureInstalled: testDouble.fn(), getInstallStatus: testDouble.fn() };
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui", autoInstall: false, installer,
      spawnImplementation: testDouble.fn(() => child as any) as never, fetchImplementation: testDouble.fn(async () => { throw new Error("boot"); }) as never, healthCheckIntervalMs: 1, startupTimeoutMs: 50,
    });
    queueMicrotask(() => { child.stderr.write("ModuleNotFoundError"); child.emit("exit", 1, null); });
    await expect(supervisor.start()).rejects.toThrow();
    expect(installer.repairInstall).not.toHaveBeenCalled();
  });

  it("classifies torchvision mismatch and uses targeted repair reason", async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnImplementation = testDouble.fn().mockImplementationOnce(() => firstChild as any).mockImplementationOnce(() => secondChild as any);
    const installer = {
      ensureInstalled: testDouble.fn(async () => ({ status: "installed" as const })),
      repairInstall: testDouble.fn(async () => ({ status: "installed" as const })),
      getInstallStatus: testDouble.fn(),
    };
    const supervisor = createComfyUiRuntimeSupervisor({
      workingDirectory: "/tmp/comfyui", installRoot: "/tmp/comfyui", autoInstall: true, installer,
      spawnImplementation: spawnImplementation as never, fetchImplementation: testDouble.fn().mockRejectedValueOnce(new Error("boot")).mockResolvedValue({ ok: true, status: 200, json: async () => ({ devices: [] }) }) as never, healthCheckIntervalMs: 1, startupTimeoutMs: 80,
    });
    queueMicrotask(() => { firstChild.stderr.write("torchvision import failure"); firstChild.emit("exit", 1, null); });
    await supervisor.start();
    expect(installer.repairInstall.mock.calls[0]?.[0]?.metadata?.repairReason).toBe("torchvision");
  });
});
