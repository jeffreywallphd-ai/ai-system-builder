import type { SpawnSyncReturns } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import {
  ensurePythonRuntimeModelTrainingDependencies,
  ensurePythonRuntimeWorkerDependencies,
  readPythonRuntimeDependencySessionOutcomes,
} from "../ensurePythonRuntimeWorkerDependencies";

function createSpawnSyncResult(
  overrides: Partial<SpawnSyncReturns<string>> = {},
): SpawnSyncReturns<string> {
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

type SpawnHandler = (
  command: string,
  args: readonly string[],
) => SpawnSyncReturns<string>;

function createSpawnSyncImplementation(handler: SpawnHandler) {
  return testDouble.fn((command: string, args?: readonly string[]) =>
    handler(command, Array.isArray(args) ? args : []),
  );
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

const privateMarker = "synthetic-private-install-marker";

function outcomeFixture(failure?: "inspect" | "worker" | "training" | "malformed", fallback = false) {
  let installAttempts = 0;
  return createSpawnSyncImplementation((command, args) => {
    const script = args[1] ?? "";
    if (script.includes("asb:python-env-inspect")) {
      return createSpawnSyncResult({
        status: failure === "inspect" ? null : 0,
        error: failure === "inspect" ? new Error(privateMarker) : undefined,
        stdout: failure === "malformed" ? privateMarker : createEnvironmentInspectionJson(),
        stderr: privateMarker,
      });
    }
    if (command === "nvidia-smi") return createSpawnSyncResult({ status: fallback ? 0 : 1, stdout: privateMarker });
    if (command === "rocminfo") return createSpawnSyncResult({ status: 1, stderr: privateMarker });
    if ((script.includes("asb:worker-dependency-probe") && failure === "worker") ||
        (script.includes("asb:model-training-dependency-probe") && failure === "training")) {
      return createSpawnSyncResult({ status: 1, stderr: privateMarker });
    }
    if (script.includes("asb:torch-install-probe")) {
      return createSpawnSyncResult({ stdout: JSON.stringify({ installed: !fallback, cudaVersion: null, hipVersion: null, cudaAvailable: false, importError: privateMarker }) });
    }
    if (args[0] === "-m" && args.includes("install") && args.includes("--upgrade")) {
      installAttempts += 1;
      return createSpawnSyncResult({ status: installAttempts <= 4 ? 1 : 0, stderr: `Connection reset ${privateMarker}` });
    }
    return createSpawnSyncResult({ stdout: script.includes("os.access") ? "1" : privateMarker, stderr: privateMarker });
  });
}

function assertMinimalOutcomes(value: any) {
  const allowed = ["schemaVersion", "operation", "platform", "success", "detectedBackend", "selectedBackend", "verificationResult", "stages"];
  assert.ok(Object.keys(value).every(key => allowed.includes(key)));
  assert.equal(value.schemaVersion, "python-dependency-outcomes-v1");
  assert.ok(["worker", "model-training"].includes(value.operation));
  assert.ok(["win32", "linux", "darwin", "other"].includes(value.platform));
  assert.equal(typeof value.success, "boolean");
  for (const backend of [value.detectedBackend, value.selectedBackend]) {
    assert.ok(backend === undefined || ["cpu", "cuda", "rocm"].includes(backend));
  }
  if (value.verificationResult) {
    assert.deepEqual(Object.keys(value.verificationResult).sort(), ["backend", "success"]);
    assert.ok(["cpu", "cuda", "rocm"].includes(value.verificationResult.backend));
    assert.equal(typeof value.verificationResult.success, "boolean");
  }
  const stages = new Set();
  for (const stage of value.stages) {
    assert.ok(Object.keys(stage).every(key => ["stage", "backend", "exitCode", "success", "attempts", "failedAttempts"].includes(key)));
    assert.ok(["inspect-environment", "probe-pip", "probe-write-access", "detect-accelerator-nvidia", "detect-accelerator-rocm", "probe-torch", "probe-network", "probe-worker-dependencies", "install-worker-dependencies", "probe-model-training-dependencies", "install-model-training-dependencies", "verify-model-training-dependencies", "install-torch", "verify-torch", "other"].includes(stage.stage));
    assert.ok(stage.backend === undefined || ["cpu", "cuda", "rocm"].includes(stage.backend));
    assert.ok(stage.exitCode === null || Number.isSafeInteger(stage.exitCode) && stage.exitCode >= 0);
    assert.equal(typeof stage.success, "boolean");
    assert.ok(Number.isSafeInteger(stage.attempts) && stage.attempts >= 1);
    assert.ok(Number.isSafeInteger(stage.failedAttempts) && stage.failedAttempts >= 0 && stage.failedAttempts <= stage.attempts);
    const key = `${stage.stage}/${stage.backend}`;
    assert.ok(!stages.has(key), "repeated stages must be grouped");
    stages.add(key);
  }
  assert.ok(!JSON.stringify(value).includes(privateMarker));
}

describe("session-only dependency outcomes", () => {
  function latest(operation = "worker") {
    const value = readPythonRuntimeDependencySessionOutcomes().find(item => item.operation === operation)!;
    assertMinimalOutcomes(value);
    return value;
  }

  it("reports training and unsupported platform outcomes without creating even an explicitly requested file", () => {
    const root = mkdtempSync(join(tmpdir(), "session-install-outcome-"));
    try {
      const diagnosticsFile = join(root, "nested", "outcome.json");
      ensurePythonRuntimeModelTrainingDependencies({ command: "python", diagnosticsFile, spawnSyncImplementation: outcomeFixture() as any });
      assert.equal(latest("model-training").success, true);
      assert.throws(() => ensurePythonRuntimeWorkerDependencies({ command: "python", diagnosticsFile, platform: privateMarker as any, spawnSyncImplementation: outcomeFixture() as any }), /Unsupported host platform/);
      assert.equal(latest().success, false);
      assert.equal(latest().platform, "other");
      assert.deepEqual(latest().stages, []);
      assert.equal(existsSync(join(root, "nested")), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  for (const failure of [undefined, "inspect", "worker", "training", "malformed"] as const) {
    it(`publishes only declared outcomes for ${failure ?? "early success"}`, () => {
      let observed: unknown;
      const run = () => (failure === "training" ? ensurePythonRuntimeModelTrainingDependencies : ensurePythonRuntimeWorkerDependencies)({
        command: `/synthetic/${privateMarker}/python`, cwd: `/synthetic/${privateMarker}`,
        env: { SYNTHETIC_PRIVATE_VALUE: privateMarker },
        onDiagnosticOutcomes: value => { observed = value; },
        spawnSyncImplementation: outcomeFixture(failure) as any,
      });
      if (failure) assert.throws(run);
      else run();
      const value = latest(failure === "training" ? "model-training" : "worker");
      assert.equal(observed, value);
      assert.equal(value.success, !failure);
      if (!failure) assert.deepEqual(value.verificationResult, { success: true, backend: "cpu" });
    });
  }

  it("groups retries, bounds retained operations and freezes every published level", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ensurePythonRuntimeWorkerDependencies({ command: "python", retryCount: 3,
        torchIndexesByBackend: { cpu: `https://${privateMarker}.invalid/cpu`, cuda: `https://${privateMarker}.invalid/cuda` },
        spawnSyncImplementation: outcomeFixture(undefined, true) as any });
    }
    const snapshot = readPythonRuntimeDependencySessionOutcomes();
    assert.equal(snapshot.length, 2);
    assert.equal(new Set(snapshot.map(value => value.operation)).size, 2);
    const value = latest();
    assert.equal(value.success, true);
    assert.equal(value.detectedBackend, "cuda");
    assert.equal(value.selectedBackend, "cpu");
    assert.deepEqual(value.stages.find(s => s.stage === "install-torch" && s.backend === "cuda"),
      { stage: "install-torch", backend: "cuda", exitCode: 1, success: false, attempts: 4, failedAttempts: 4 });
    assert.equal(value.stages.find(s => s.stage === "install-torch" && s.backend === "cpu")!.attempts, 1);
    assert.ok([snapshot, value, value.stages, value.verificationResult, ...value.stages].every(Object.isFrozen));
    assert.throws(() => (value as any).success = false, TypeError);
    assert.throws(() => (value.stages as any).push({}), TypeError);
    assert.throws(() => (value.stages[0] as any).stage = privateMarker, TypeError);
    assert.equal(latest().success, true);
  });

  it("observer failure cannot replace setup success or its original failure", () => {
    for (const failure of [undefined, "inspect"] as const) {
      const run = () => ensurePythonRuntimeWorkerDependencies({ command: "python",
        onDiagnosticOutcomes: () => { throw new Error(privateMarker); },
        spawnSyncImplementation: outcomeFixture(failure) as any });
      if (failure) assert.throws(run, /Failed to inspect Python runtime environment/);
      else assert.doesNotThrow(run);
      assert.equal(latest().success, !failure);
    }
  });

  it("handles asynchronous observer rejection without replacing either setup outcome", async () => {
    for (const failure of [undefined, "inspect"] as const) {
      const run = () => ensurePythonRuntimeWorkerDependencies({ command: "python",
        onDiagnosticOutcomes: async () => { throw new Error(privateMarker); },
        spawnSyncImplementation: outcomeFixture(failure) as any });
      if (failure) assert.throws(run, /Failed to inspect Python runtime environment/);
      else assert.doesNotThrow(run);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(latest().success, !failure);
    }
  });
});

const workerDependencyProbeScript = `
# asb:worker-dependency-probe
import importlib.metadata
import importlib.util
import sys
required = ["accelerate", "docx", "fastapi", "hf_xet", "huggingface_hub", "markdownify", "peft", "pyarrow", "pypdf", "safetensors", "transformers", "uvicorn"]
decoder_supported = (3, 10) <= sys.version_info[:2] < (3, 14)
if decoder_supported:
  required.extend(["jsonschema", "outlines", "outlines_core"])
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
  raise ModuleNotFoundError(f"No module named '{missing[0]}'")
core_expected_versions = {"accelerate": "1.14.0", "peft": "0.15.2", "pyarrow": "25.0.0"}
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
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
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
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({
              ok: true,
              backend: "cpu",
              version: "2.6.0+cpu",
            }),
          });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(
      spawnSyncImplementation.mock.calls.some(
        (call) =>
          Array.isArray(call[1]) &&
          call[1].join(" ") ===
            "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu",
      ),
    ).toBe(false);
  });

  it("publishes session outcomes when an existing matching torch installation returns early", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
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
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({
              ok: true,
              backend: "cpu",
              version: "2.6.0+cpu",
            }),
          });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
    });

    const diagnostics = readPythonRuntimeDependencySessionOutcomes().find(value => value.operation === "worker")!;
    expect(diagnostics.verificationResult).toMatchObject({
      success: true,
      backend: "cpu",
    });
  });

  it("falls back to CPU when CUDA installation fails", () => {
    let torchProbeCount = 0;
    let networkProbeCount = 0;
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({
            status: 0,
            stdout: "NVIDIA RTX 4090\n",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
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
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-network-probe")
        ) {
          networkProbeCount += 1;
          return createSpawnSyncResult({ status: 0, stdout: "ok\n" });
        }
        if (
          command === "python" &&
          args.join(" ") ===
            "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124"
        ) {
          return createSpawnSyncResult({
            status: 1,
            stderr:
              "ERROR: Could not find a version that satisfies the requirement torch",
          });
        }
        if (
          command === "python" &&
          args.join(" ") ===
            "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu"
        ) {
          return createSpawnSyncResult({
            status: 0,
            stdout: "Successfully installed torch-2.6.0+cpu",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          if (args[1].includes('expected = "cuda"')) {
            return createSpawnSyncResult({
              status: 1,
              stderr: '{"ok": false, "error": "Expected CUDA torch build"}',
            });
          }

          return createSpawnSyncResult({
            status: 0,
            stdout: '{"ok": true, "backend": "cpu"}',
          });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(networkProbeCount).toBe(2);
    expect(
      spawnSyncImplementation.mock.calls.some(
        (call) =>
          Array.isArray(call[1]) &&
          call[1].join(" ") ===
            "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu",
      ),
    ).toBe(true);
  });

  it("installs worker requirements when Accelerate for automatic model placement is missing", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({
            status: 1,
            stderr: "ModuleNotFoundError: No module named 'accelerate'",
          });
        }
        if (
          command === "python" &&
          args.join(" ") === "-m pip install -r requirements.txt"
        ) {
          return createSpawnSyncResult({
            status: 0,
            stdout: "Successfully installed requirements",
          });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
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
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({ status: 0, stdout: '{"ok": true}' });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(
      spawnSyncImplementation.mock.calls.some(
        (call) =>
          Array.isArray(call[1]) &&
          call[1].join(" ") === "-m pip install -r requirements.txt",
      ),
    ).toBe(true);
  });

  it("repairs mismatched core and decoder packages on supported Python versions", () => {
    for (const probeFailure of [
      "RuntimeError: Core dependency version mismatch",
      "ModuleNotFoundError: No module named 'outlines'",
      "RuntimeError: Decoder dependency version mismatch",
    ]) {
      const spawnSyncImplementation = createSpawnSyncImplementation(
        (command, args) => {
          if (
            command === "python" &&
            args[0] === "-c" &&
            args[1]?.includes("asb:python-env-inspect")
          ) {
            return createSpawnSyncResult({
              stdout: createEnvironmentInspectionJson("3.12.9"),
            });
          }
          if (command === "python" && args.join(" ") === "-m pip --version") {
            return createSpawnSyncResult({
              stdout:
                "pip 25.0 from /venv/lib/python3.12/site-packages/pip (python 3.12)",
            });
          }
          if (
            command === "python" &&
            args[0] === "-c" &&
            args[1]?.includes("os.access")
          ) {
            return createSpawnSyncResult({ stdout: "1\n" });
          }
          if (
            command === "python" &&
            args[0] === "-c" &&
            args[1] === workerDependencyProbeScript
          ) {
            return createSpawnSyncResult({ status: 1, stderr: probeFailure });
          }
          if (
            command === "python" &&
            args.join(" ") === "-m pip install -r requirements.txt"
          ) {
            return createSpawnSyncResult({
              status: 0,
              stdout: "Installed pinned decoder requirements",
            });
          }
          if (command === "nvidia-smi" || command === "rocminfo") {
            return createSpawnSyncResult({ status: 1, stderr: "not found" });
          }
          if (
            command === "python" &&
            args[0] === "-c" &&
            args[1]?.includes("asb:torch-install-probe")
          ) {
            return createSpawnSyncResult({
              stdout: JSON.stringify({
                installed: true,
                version: "2.6.0+cpu",
                cudaVersion: null,
                hipVersion: null,
              }),
            });
          }
          if (
            command === "python" &&
            args[0] === "-c" &&
            args[1]?.includes("asb:torch-verification")
          ) {
            return createSpawnSyncResult({
              stdout: JSON.stringify({ ok: true, backend: "cpu" }),
            });
          }
          throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        },
      );

      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      });

      expect(
        spawnSyncImplementation.mock.calls.some(
          (call) =>
            Array.isArray(call[1]) &&
            call[1].join(" ") === "-m pip install -r requirements.txt",
        ),
      ).toBe(true);
    }
  });

  it("does not install startup requirements when training-only dependencies are missing", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
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
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({ status: 0, stdout: '{"ok": true}' });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    ensurePythonRuntimeWorkerDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/diag.json",
    });

    expect(
      spawnSyncImplementation.mock.calls.every(
        (call) =>
          !Array.isArray(call[1]) ||
          call[1].join(" ") !== "-m pip install -r requirements.txt",
      ),
    ).toBe(true);
  });

  it("keeps reviewed Parquet, model placement, and LoRA inference dependencies in the core worker requirements", () => {
    const requirementsText = readFileSync(
      join(
        process.cwd(),
        "modules",
        "adapters",
        "runtime",
        "python",
        "worker",
        "requirements.txt",
      ),
      "utf8",
    );

    expect(requirementsText).toContain("pyarrow==25.0.0");
    expect(requirementsText).toContain("accelerate==1.14.0");
    expect(requirementsText).toContain("peft==0.15.2");
    expect(requirementsText).not.toContain("datasets>=");
    expect(requirementsText).not.toContain("diffusers>=");
    expect(requirementsText).not.toContain("peft>=");
    expect(requirementsText).not.toContain("torch>=");
    expect(requirementsText).toContain(
      'outlines==1.3.2; python_version >= "3.10" and python_version < "3.14"',
    );
    expect(requirementsText).toContain(
      'outlines-core==0.2.14; python_version >= "3.10" and python_version < "3.14"',
    );
    expect(requirementsText).toContain(
      'jsonschema==4.26.0; python_version >= "3.10" and python_version < "3.14"',
    );
  });

  it("installs and re-probes exact text-training dependencies on demand", () => {
    let trainingProbeCount = 0;
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson("3.14.1"),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({ stdout: "pip 25.0 (python 3.14)" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access")
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:model-training-dependency-probe")
        ) {
          trainingProbeCount += 1;
          return trainingProbeCount === 1
            ? createSpawnSyncResult({
                status: 1,
                stderr: "ModuleNotFoundError: No module named 'datasets'",
              })
            : createSpawnSyncResult({ status: 0 });
        }
        if (
          command === "python" &&
          args.join(" ") === "-m pip install -r requirements-training-text.txt"
        ) {
          return createSpawnSyncResult({
            stdout: "Successfully installed datasets-5.0.1 peft-0.15.2",
          });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    ensurePythonRuntimeModelTrainingDependencies({
      command: "python",
      cwd: "/tmp/runtime-worker",
      spawnSyncImplementation: spawnSyncImplementation as any,
      diagnosticsFile: "/tmp/training-diag.json",
    });

    expect(trainingProbeCount).toBe(2);
    expect(
      spawnSyncImplementation.mock.calls.some(
        (call) =>
          Array.isArray(call[1]) &&
          call[1].join(" ") ===
            "-m pip install -r requirements-training-text.txt",
      ),
    ).toBe(true);
  });

  it("fails closed when the text-training dependency probe has an unexpected failure", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({ stdout: "pip 25.0 (python 3.11)" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access")
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:model-training-dependency-probe")
        ) {
          return createSpawnSyncResult({
            status: 1,
            stderr: "PermissionError: dependency metadata is unreadable",
          });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    expect(() =>
      ensurePythonRuntimeModelTrainingDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/training-diag.json",
      }),
    ).toThrow("unexpected reason");
    expect(
      spawnSyncImplementation.mock.calls.some(
        (call) =>
          Array.isArray(call[1]) && call[1].join(" ").includes("pip install"),
      ),
    ).toBe(false);
  });

  it("keeps the worker available on Python 3.14 while the optional decoder is unsupported", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson("3.14.1"),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.14/site-packages/pip (python 3.14)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access")
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi" || command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({
              installed: true,
              version: "2.6.0+cpu",
              cudaVersion: null,
              hipVersion: null,
            }),
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({ ok: true, backend: "cpu" }),
          });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      }),
    ).not.toThrow();
    expect(
      spawnSyncImplementation.mock.calls.every(
        (call) =>
          !Array.isArray(call[1]) ||
          call[1].join(" ") !== "-m pip install -r requirements.txt",
      ),
    ).toBe(true);
  });

  it("fails early when Python version is unsupported", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson("3.8.19"),
          });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      }),
    ).toThrow("Unsupported Python version");
  });

  it("includes spawn errors when environment inspection cannot execute", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(() =>
      createSpawnSyncResult({
        status: null,
        error: new Error("spawn python ENOENT"),
      }),
    );

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      }),
    ).toThrow("spawn python ENOENT");
  });

  it("throws when final CPU verification fails after fallback", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "1\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({
            status: 0,
            stdout: "NVIDIA RTX 4090\n",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
          return createSpawnSyncResult({
            stdout: JSON.stringify({
              installed: false,
              importError: "No module named 'torch'",
            }),
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-network-probe")
        ) {
          return createSpawnSyncResult({ status: 0, stdout: "ok\n" });
        }
        if (
          command === "python" &&
          args.join(" ") ===
            "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124"
        ) {
          return createSpawnSyncResult({
            status: 1,
            stderr: "ERROR: CUDA wheel unavailable",
          });
        }
        if (
          command === "python" &&
          args.join(" ") ===
            "-m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cpu"
        ) {
          return createSpawnSyncResult({
            status: 0,
            stdout: "Successfully installed torch-2.6.0+cpu",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({
            status: 1,
            stderr: '{"ok": false, "error": "import torch failed"}',
          });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      }),
    ).toThrow("PyTorch verification failed");
  });

  it("does not fail startup preparation when worker directory is read-only", () => {
    const spawnSyncImplementation = createSpawnSyncImplementation(
      (command, args) => {
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:python-env-inspect")
        ) {
          return createSpawnSyncResult({
            stdout: createEnvironmentInspectionJson(),
          });
        }
        if (command === "python" && args.join(" ") === "-m pip --version") {
          return createSpawnSyncResult({
            stdout:
              "pip 25.0 from /venv/lib/python3.11/site-packages/pip (python 3.11)",
          });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("os.access") &&
          args[2] === "/tmp/runtime-worker"
        ) {
          return createSpawnSyncResult({ stdout: "0\n" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1] === workerDependencyProbeScript
        ) {
          return createSpawnSyncResult({ status: 0 });
        }
        if (command === "nvidia-smi") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (command === "rocminfo") {
          return createSpawnSyncResult({ status: 1, stderr: "not found" });
        }
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-install-probe")
        ) {
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
        if (
          command === "python" &&
          args[0] === "-c" &&
          args[1]?.includes("asb:torch-verification")
        ) {
          return createSpawnSyncResult({
            status: 0,
            stdout: '{"ok": true, "backend": "cpu"}',
          });
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    );

    expect(() =>
      ensurePythonRuntimeWorkerDependencies({
        command: "python",
        cwd: "/tmp/runtime-worker",
        spawnSyncImplementation: spawnSyncImplementation as any,
        diagnosticsFile: "/tmp/diag.json",
      }),
    ).not.toThrow();
  });
});
