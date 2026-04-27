import type { SpawnSyncReturns } from "node:child_process";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { ensurePythonRuntimeWorkerDependencies } from "../ensurePythonRuntimeWorkerDependencies";

function createSpawnSyncResult(overrides: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
  return {
    pid: 123,
    output: [],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    error: undefined,
    ...overrides,
  };
}

type SpawnHandler = (command: string, args: readonly string[]) => SpawnSyncReturns<string>;

function createSpawnSyncImplementation(handler: SpawnHandler) {
  return testDouble.fn((command: string, args?: readonly string[]) =>
    handler(command, Array.isArray(args) ? args : []));
}

function createEnvironmentInspectionJson(version = "3.11.9"): string {
  return JSON.stringify({
    platform: "Linux",
    pythonVersion: version,
    pythonMajor: Number(version.split(".")[0]),
    pythonMinor: Number(version.split(".")[1]),
    pythonExecutable: "/usr/bin/python3",
  });
}

const workerDependencyProbeScript = "import accelerate, fastapi, hf_xet, uvicorn, huggingface_hub, transformers";

describe("ensurePythonRuntimeWorkerDependencies", () => {
  it("keeps existing torch installation when already matching selected CPU target", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson() });
      }
      if (command === "python" && args.join(" ") === "-m pip --version") {
        return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access") && args[2] === "/tmp/runtime-worker") {
        return createSpawnSyncResult({ stdout: "1\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
        return createSpawnSyncResult({ status: 0 });
      }
      if (command === "nvidia-smi") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "rocminfo") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
        return createSpawnSyncResult({
          stdout: JSON.stringify({
            installed: true,
            version: "2.6.0+cpu",
            cudaVersion: null,
            hipVersion: null,
            cudaAvailable: false,
          }),
        });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
        return createSpawnSyncResult({ stdout: JSON.stringify({ ok: true, backend: "cpu", version: "2.6.0+cpu" }) });
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(
      spawnSyncImplementation.mock.calls.some((call) =>
        Array.isArray(call[1]) && call[1].join(" ") === "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu"),
    ).toBe(false);
  });

  it("falls back to CPU when CUDA installation fails", () => {
    let torchProbeCount = 0;
    let networkProbeCount = 0;
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson() });
      }
      if (command === "python" && args.join(" ") === "-m pip --version") {
        return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access") && args[2] === "/tmp/runtime-worker") {
        return createSpawnSyncResult({ stdout: "1\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
        return createSpawnSyncResult({ status: 0 });
      }
      if (command === "nvidia-smi") {
        return createSpawnSyncResult({ status: 0, stdout: "NVIDIA RTX 4090\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
        torchProbeCount += 1;
        if (torchProbeCount === 1) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({
              installed: false,
              importError: "No module named 'torch'",
            }),
          });
        }

        return createSpawnSyncResult({
          stdout: JSON.stringify({
            installed: true,
            version: "2.6.0+cpu",
            cudaVersion: null,
            hipVersion: null,
            cudaAvailable: false,
          }),
        });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-network-probe")) {
        networkProbeCount += 1;
        return createSpawnSyncResult({ status: 0, stdout: "ok\n" });
      }
      if (
        command === "python" &&
        args.join(" ") === "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124"
      ) {
        return createSpawnSyncResult({
          status: 1,
          stderr: "ERROR: Could not find a version that satisfies the requirement torch",
        });
      }
      if (
        command === "python" &&
        args.join(" ") === "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu"
      ) {
        return createSpawnSyncResult({ status: 0, stdout: "Successfully installed torch-2.6.0+cpu" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
        if (args[1].includes("expected = \"cuda\"")) {
          return createSpawnSyncResult({ status: 1, stderr: "{\"ok\": false, \"error\": \"Expected CUDA torch build\"}" });
        }

        return createSpawnSyncResult({ status: 0, stdout: "{\"ok\": true, \"backend\": \"cpu\"}" });
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(networkProbeCount).toBe(2);
    expect(
      spawnSyncImplementation.mock.calls.some((call) =>
        Array.isArray(call[1]) && call[1].join(" ") === "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu"),
    ).toBe(true);
  });

  it("installs worker requirements when mandatory worker dependencies are missing", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson() });
      }
      if (command === "python" && args.join(" ") === "-m pip --version") {
        return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access") && args[2] === "/tmp/runtime-worker") {
        return createSpawnSyncResult({ stdout: "1\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
        return createSpawnSyncResult({
          status: 1,
          stderr: "ModuleNotFoundError: No module named 'accelerate'",
        });
      }
      if (command === "python" && args.join(" ") === "-m pip install -r requirements.txt") {
        return createSpawnSyncResult({ status: 0, stdout: "Successfully installed requirements" });
      }
      if (command === "nvidia-smi") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "rocminfo") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
        return createSpawnSyncResult({
          stdout: JSON.stringify({
            installed: true,
            version: "2.6.0+cpu",
            cudaVersion: null,
            hipVersion: null,
            cudaAvailable: false,
          }),
        });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
        return createSpawnSyncResult({ status: 0, stdout: "{\"ok\": true}" });
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(
      spawnSyncImplementation.mock.calls.some((call) =>
        Array.isArray(call[1]) && call[1].join(" ") === "-m pip install -r requirements.txt"),
    ).toBe(true);
  });

  it("fails early when Python version is unsupported", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({
          stdout: createEnvironmentInspectionJson("3.8.19"),
        });
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      })).toThrow("Unsupported Python version");
  });

  it("throws when final CPU verification fails after fallback", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson() });
      }
      if (command === "python" && args.join(" ") === "-m pip --version") {
        return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access") && args[2] === "/tmp/runtime-worker") {
        return createSpawnSyncResult({ stdout: "1\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
        return createSpawnSyncResult({ status: 0 });
      }
      if (command === "nvidia-smi") {
        return createSpawnSyncResult({ status: 0, stdout: "NVIDIA RTX 4090\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
        return createSpawnSyncResult({
          stdout: JSON.stringify({
            installed: false,
            importError: "No module named 'torch'",
          }),
        });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-network-probe")) {
        return createSpawnSyncResult({ status: 0, stdout: "ok\n" });
      }
      if (
        command === "python" &&
        args.join(" ") === "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124"
      ) {
        return createSpawnSyncResult({
          status: 1,
          stderr: "ERROR: CUDA wheel unavailable",
        });
      }
      if (
        command === "python" &&
        args.join(" ") === "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu"
      ) {
        return createSpawnSyncResult({ status: 0, stdout: "Successfully installed torch-2.6.0+cpu" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
        return createSpawnSyncResult({
          status: 1,
          stderr: "{\"ok\": false, \"error\": \"import torch failed\"}",
        });
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      })).toThrow("PyTorch verification failed");
  });

  it("does not fail startup preparation when worker directory is read-only", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson() });
      }
      if (command === "python" && args.join(" ") === "-m pip --version") {
        return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access") && args[2] === "/tmp/runtime-worker") {
        return createSpawnSyncResult({ stdout: "0\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
        return createSpawnSyncResult({ status: 0 });
      }
      if (command === "nvidia-smi") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "rocminfo") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
        return createSpawnSyncResult({
          stdout: JSON.stringify({
            installed: true,
            version: "2.6.0+cpu",
            cudaVersion: null,
            hipVersion: null,
            cudaAvailable: false,
          }),
        });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
        return createSpawnSyncResult({ status: 0, stdout: "{\"ok\": true, \"backend\": \"cpu\"}" });
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      })).not.toThrow();
  });
});
