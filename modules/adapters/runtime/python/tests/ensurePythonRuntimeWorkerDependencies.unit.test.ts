import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const workerDependencyProbeScript = `
# asb:worker-dependency-probe
import importlib.metadata
import importlib.util
import sys
required = ["accelerate", "docx", "fastapi", "hf_xet", "huggingface_hub", "markdownify", "pyarrow", "pypdf", "safetensors", "transformers", "uvicorn"]
decoder_supported = (3, 10) <= sys.version_info[:2] < (3, 14)
if decoder_supported:
  required.extend(["jsonschema", "outlines", "outlines_core"])
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
  raise ModuleNotFoundError(f"No module named '{missing[0]}'")
core_expected_versions = {"accelerate": "1.14.0", "pyarrow": "25.0.0"}
core_mismatched = [name for name, expected in core_expected_versions.items() if importlib.metadata.version(name) != expected]
if core_mismatched:
  raise RuntimeError("Core dependency version mismatch")
if decoder_supported:
  expected_versions = {"jsonschema": "4.26.0", "outlines": "1.3.2", "outlines-core": "0.2.14"}
  mismatched = [name for name, expected in expected_versions.items() if importlib.metadata.version(name) != expected]
  if mismatched:
    raise RuntimeError("Decoder dependency version mismatch")
`.trim();

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

  it("writes diagnostics when an existing matching torch installation returns early", () => {
    const diagnosticsFile = join(mkdtempSync(join(tmpdir(), "python-runtime-diag-")), "diag.json");
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
          stdout: JSON.stringify({ installed: true, version: "2.6.0+cpu", cudaVersion: null, hipVersion: null, cudaAvailable: false }),
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
      diagnosticsFile,
    });

    const diagnostics = JSON.parse(readFileSync(diagnosticsFile, "utf8")) as { verificationResult?: { success?: boolean; backend?: string } };
    expect(diagnostics.verificationResult).toMatchObject({ success: true, backend: "cpu" });
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

  it("installs worker requirements when Accelerate for automatic model placement is missing", () => {
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

  it("repairs mismatched core and decoder packages on supported Python versions", () => {
    for (const probeFailure of [
      "RuntimeError: Core dependency version mismatch",
      "ModuleNotFoundError: No module named 'outlines'",
      "RuntimeError: Decoder dependency version mismatch",
    ]) {
      const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
        if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
          return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson("3.12.9") });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.12/site-packages/pip (python 3.12)" });
        }
        if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access")) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
          return createSpawnSyncResult({ status: 1, stderr: probeFailure });
        }
        if (command === "python" && args.join(" ") === "-m pip install -r requirements.txt") {
          return createSpawnSyncResult({ status: 0, stdout: "Installed pinned decoder requirements" });
        }
        if (command === "nvidia-smi" || command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({ installed: true, version: "2.6.0+cpu", cudaVersion: null, hipVersion: null }),
          });
        }
        if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
          return createSpawnSyncResult({ stdout: JSON.stringify({ ok: true, backend: "cpu" }) });
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
    }
  });

  it("does not install startup requirements when training-only dependencies are missing", () => {
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
      spawnSyncImplementation.mock.calls.every((call) =>
        !Array.isArray(call[1]) || call[1].join(" ") !== "-m pip install -r requirements.txt"),
    ).toBe(true);
  });

  it("keeps patched Parquet and automatic model placement in the core worker requirements", () => {
    const requirementsText = readFileSync(
      join(process.cwd(), "modules", "adapters", "runtime", "python", "worker", "requirements.txt"),
      "utf8",
    );

    expect(requirementsText).toContain("pyarrow==25.0.0");
    expect(requirementsText).toContain("accelerate==1.14.0");
    expect(requirementsText).not.toContain("datasets>=");
    expect(requirementsText).not.toContain("diffusers>=");
    expect(requirementsText).not.toContain("peft>=");
    expect(requirementsText).not.toContain("torch>=");
    expect(requirementsText).toContain('outlines==1.3.2; python_version >= "3.10" and python_version < "3.14"');
    expect(requirementsText).toContain('outlines-core==0.2.14; python_version >= "3.10" and python_version < "3.14"');
    expect(requirementsText).toContain('jsonschema==4.26.0; python_version >= "3.10" and python_version < "3.14"');
  });

  it("keeps the worker available on Python 3.14 while the optional decoder is unsupported", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation((command, args) => {
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:python-env-inspect")) {
        return createSpawnSyncResult({ stdout: createEnvironmentInspectionJson("3.14.1") });
      }
      if (command === "python" && args.join(" ") === "-m pip --version") {
        return createSpawnSyncResult({ stdout: "pip 25.0 from /venv/lib/python3.14/site-packages/pip (python 3.14)" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("os.access")) {
        return createSpawnSyncResult({ stdout: "1\n" });
      }
      if (command === "python" && args[0] === "-c" && args[1] === workerDependencyProbeScript) {
        return createSpawnSyncResult({ status: 0 });
      }
      if (command === "nvidia-smi" || command === "rocminfo") {
        return createSpawnSyncResult({ status: 1, stderr: "not found" });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-install-probe")) {
        return createSpawnSyncResult({
          stdout: JSON.stringify({ installed: true, version: "2.6.0+cpu", cudaVersion: null, hipVersion: null }),
        });
      }
      if (command === "python" && args[0] === "-c" && args[1]?.includes("asb:torch-verification")) {
        return createSpawnSyncResult({ stdout: JSON.stringify({ ok: true, backend: "cpu" }) });
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
    expect(
      spawnSyncImplementation.mock.calls.every((call) =>
        !Array.isArray(call[1]) || call[1].join(" ") !== "-m pip install -r requirements.txt"),
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

  it("includes spawn errors when environment inspection cannot execute", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(() =>
      createSpawnSyncResult({
        status: null,
        error: new Error("spawn python ENOENT"),
      }));

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      })).toThrow("spawn python ENOENT");
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
