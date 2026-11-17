import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBoundedProcessOutput,
  createVisualComposerHostLaunchPlan,
  stopVisualComposerOwnedProcess,
  waitForVisualComposerEndpoint,
} from "../visual-composer/visual-composer-host-lifecycle.mjs";
import { buildPackagedDesktopFromCurrentWorktree, preparePackagedDesktopQualificationIdentity } from "../visual-composer/visual-composer-global-setup.mjs";
import { resolveVisualComposerQualificationEnvironment } from "../visual-composer/visual-composer-qualification-environment.mjs";
import { createProvidedDatasetHostLaunchPlan } from "../visual-composer/provided-dataset-host-launch-plan.mjs";

test("visual composer host plan isolates roots, security, ports, and direct child commands", () => {
  const repoRoot = path.resolve("C:/work/ai-system-builder");
  const plan = createVisualComposerHostLaunchPlan({
    repoRoot,
    runId: "qualification-run",
    serverPort: 45_001,
    thinClientPort: 45_002,
    runtimePort: 45_003,
    serverRuntimePort: 45_004,
    environment: {
      PATH: "configured-path",
      DEPLOYMENT_SHAPE: "managed-single",
      DATABASE_URL: "postgres://should-not-be-inherited",
    },
  });

  assert.equal(plan.serverOrigin.origin, "http://127.0.0.1:45001");
  assert.equal(plan.thinClientOrigin.origin, "http://127.0.0.1:45002");
  assert.equal(plan.runtimeOrigin.origin, "http://127.0.0.1:45003");
  assert.equal(plan.server.command, process.execPath);
  assert.equal(plan.thinClient.command, process.execPath);
  assert.match(
    plan.desktop.executablePath.replaceAll("\\", "/"),
    /out\/ai-system-builder-win32-x64\/ai-system-builder\.exe$/,
  );
  assert.deepEqual(plan.desktop.args, [
    `--user-data-dir=${plan.paths.desktopDataRoot}`,
    "--disable-gpu",
  ]);
  assert.equal(
    plan.desktop.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,
    plan.paths.desktopDataRoot,
  );
  assert.equal(
    plan.desktop.env.PYTHON_RUNTIME_BASE_URL,
    "http://127.0.0.1:45003",
  );
  assert.equal(plan.desktop.env.PYTHON_RUNTIME_COMMAND, process.execPath);
  assert.match(
    plan.desktop.env.PYTHON_RUNTIME_ARGS,
    /controlled-conversation-runtime-worker\.mjs$/,
  );
  assert.equal(plan.desktop.env.PYTHON_RUNTIME_WORKER_DIR, repoRoot);
  assert.equal(plan.desktop.seed.env.ELECTRON_RUN_AS_NODE, "1");
  assert.match(
    plan.desktop.seed.args.at(-1).replaceAll("\\", "/"),
    /visual-composer-desktop-seed\.ts$/,
  );
  assert.equal(plan.server.env.SERVER_STORAGE_ROOT, plan.paths.thinStorageRoot);
  assert.equal(plan.server.env.SERVER_RUNTIME_ROOT, plan.paths.thinRuntimeRoot);
  assert.equal(plan.server.env.AI_SYSTEM_BUILDER_SECURITY_MODE, "disabled-dev");
  assert.equal(
    plan.server.env.AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE,
    "dedicated",
  );
  assert.equal(
    plan.server.env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID,
    "qualification.local",
  );
  assert.equal(
    plan.thinClient.env.AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET,
    plan.serverOrigin.origin,
  );
  assert.equal(plan.server.env.DEPLOYMENT_SHAPE, undefined);
  assert.equal(plan.server.env.DATABASE_URL, undefined);
  assert.equal(plan.server.env.PYTHON_RUNTIME_BASE_URL, "http://127.0.0.1:45004");
  assert.equal(plan.server.env.PYTHON_RUNTIME_COMMAND, process.execPath);
  assert.equal(plan.server.env.HF_HUB_CACHE, path.join(plan.paths.thinRuntimeRoot, "controlled-model-cache"));
  assert.equal(plan.desktop.env.HF_HUB_CACHE, path.join(plan.paths.desktopDataRoot, "controlled-model-cache"));
  assert.ok(plan.server.args.includes("--import"));
  assert.ok(plan.thinClient.args.includes("--strictPort"));
});

test("visual composer rejects collisions with either authenticated runtime listener", () => {
  for (const runtime of ["runtimePort", "serverRuntimePort"]) {
    assert.throws(() => createVisualComposerHostLaunchPlan({ serverPort: 45_001, [runtime]: 45_001 }), /ports must be different/);
  }
});

test("packaged qualification builds the current worktree with a fixed npm script", () => {
  const plan = createVisualComposerHostLaunchPlan({
    repoRoot: path.resolve("C:/work/ai-system-builder"),
    runId: "package-current-worktree",
  });
  const calls = [];
  buildPackagedDesktopFromCurrentWorktree(plan, {
    platform: "win32",
    nodeExecutable: "C:\\tools\\node.exe",
    npmExecPath: "C:\\tools\\npm-cli.js",
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "C:\\tools\\node.exe");
  assert.deepEqual(calls[0].args, ["C:\\tools\\npm-cli.js", "run", "package"]);
  assert.equal(calls[0].options.cwd, plan.repoRoot);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.timeout, 300_000);
});

test("packaged qualification rejects an unbounded npm command source", () => {
  const plan = createVisualComposerHostLaunchPlan({
    repoRoot: path.resolve("C:/work/ai-system-builder"),
    runId: "package-reject-relative-npm",
  });
  let spawned = false;
  assert.throws(
    () =>
      buildPackagedDesktopFromCurrentWorktree(plan, {
        platform: "win32",
        npmExecPath: "npm-cli.js",
        spawnProcess: () => {
          spawned = true;
          return { status: 0 };
        },
      }),
    /absolute npm executable path/,
  );
  assert.equal(spawned, false);
});

test("visual composer readiness retries transient failures and rejects non-loopback targets", async () => {
  const statuses = [new Error("not ready"), 503, 200];
  let now = 0;
  const status = await waitForVisualComposerEndpoint(
    "http://127.0.0.1:45001/health/live",
    {
      timeoutMs: 1_000,
      now: () => now,
      sleep: async (duration) => {
        now += duration;
      },
      request: async () => {
        const result = statuses.shift();
        if (result instanceof Error) throw result;
        return result;
      },
    },
  );
  assert.equal(status, 200);
  await assert.rejects(
    waitForVisualComposerEndpoint("https://example.test", {
      timeoutMs: 1,
      request: async () => 200,
    }),
    /loopback HTTP origins/,
  );
});

test("visual composer process output is bounded to the newest diagnostics", () => {
  const output = createBoundedProcessOutput(10);
  output.append("123456");
  output.append("789abcdef");
  assert.equal(output.read(), "6789abcdef");
});

test("visual composer shutdown terminates only the owned Windows process tree", async () => {
  const child = new EventEmitter();
  child.pid = 4_321;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    throw new Error("tree terminator should be used");
  };
  const terminated = [];
  const stopping = stopVisualComposerOwnedProcess(child, {
    platform: "win32",
    shutdownTimeoutMs: 100,
    terminateWindowsTree: (pid) => {
      terminated.push(pid);
      child.exitCode = 0;
      child.emit("exit", 0, null);
    },
  });
  await stopping;
  assert.deepEqual(terminated, [4_321]);
});

const environmentKeys = [
  "VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID",
  "VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION", "VISUAL_COMPOSER_DESKTOP_EXECUTABLE",
  "VISUAL_COMPOSER_DESKTOP_DATA_ROOT", "VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE",
  "PYTHON_RUNTIME_BASE_URL", "PYTHON_RUNTIME_HOST", "PYTHON_RUNTIME_PORT",
  "PYTHON_RUNTIME_COMMAND", "PYTHON_RUNTIME_ARGS", "PYTHON_RUNTIME_WORKER_DIR",
  "PYTHON_RUNTIME_STARTUP_TIMEOUT_MS",
];
const bindingSource = `source.${"a".repeat(64)}`;
function bindingPlan(provided = false) {
  const options = { repoRoot: path.resolve("C:/work/ai-system-builder"), runId: "serial-bindings",
    serverPort: 45_001, thinClientPort: 45_002, runtimePort: 45_003, serverRuntimePort: 45_004,
    environment: { PATH: "synthetic-path", HF_TOKEN: "synthetic-do-not-forward", DATABASE_URL: "synthetic-do-not-forward" } };
  return provided ? createProvidedDatasetHostLaunchPlan({ ...options,
    pythonExecutable: path.resolve("C:/runtime/python.exe"), sourceRevision: bindingSource }) : createVisualComposerHostLaunchPlan(options);
}

test("pure qualification bindings preserve normal and provided desktop placement without ambient effects", () => {
  for (const provided of [false, true]) {
    const plan = bindingPlan(provided);
    plan.desktop.env.HF_TOKEN = "synthetic-do-not-forward";
    plan.desktop.env.DATABASE_URL = "synthetic-do-not-forward";
    const before = JSON.stringify(plan);
    const ambient = new Map(environmentKeys.map(key => [key, process.env[key]]));
    const bindings = resolveVisualComposerQualificationEnvironment(plan, bindingSource);
    assert.deepEqual(Object.keys(bindings).sort(), [...environmentKeys].sort());
    assert.equal(bindings.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, plan.runId);
    assert.equal(bindings.VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID, `local-${process.platform}-${process.arch}`);
    assert.equal(bindings.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, bindingSource);
    assert.equal(bindings.VISUAL_COMPOSER_DESKTOP_EXECUTABLE, plan.desktop.executablePath);
    assert.equal(bindings.VISUAL_COMPOSER_DESKTOP_DATA_ROOT, plan.paths.desktopDataRoot);
    assert.equal(bindings.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE, plan.desktop.seed.command);
    for (const key of environmentKeys.filter(key => key.startsWith("PYTHON_"))) {
      assert.equal(bindings[key], plan.desktop.env[key]);
    }
    assert.equal(bindings.PYTHON_RUNTIME_BASE_URL, "http://127.0.0.1:45003");
    assert.notEqual(bindings.PYTHON_RUNTIME_BASE_URL, plan.server.env.PYTHON_RUNTIME_BASE_URL);
    if (provided) {
      assert.equal(bindings.PYTHON_RUNTIME_COMMAND, path.resolve("C:/runtime/python.exe"));
      assert.equal(bindings.PYTHON_RUNTIME_ARGS, "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py");
    }
    assert.equal(Object.hasOwn(bindings, "HF_TOKEN"), false);
    assert.equal(Object.hasOwn(bindings, "DATABASE_URL"), false);
    assert.equal(Object.isFrozen(bindings), true);
    assert.throws(() => { bindings.PYTHON_RUNTIME_PORT = "changed"; }, TypeError);
    assert.equal(JSON.stringify(plan), before);
    assert.ok(environmentKeys.every(key => process.env[key] === ambient.get(key)), "The pure helper must not change the ambient environment.");
  }
});

test("pure qualification bindings reject incomplete, oversized and injected values with fixed safe errors", () => {
  const denied = action => assert.throws(action, { message: "Invalid qualification environment bindings." });
  for (const source of [undefined, null, "source.not-a-digest", `source.${"a".repeat(64)}\nsynthetic-private`]) {
    denied(() => resolveVisualComposerQualificationEnvironment(bindingPlan(), source));
  }
  for (const input of [undefined, null, {}, { desktop: {} }]) {
    denied(() => resolveVisualComposerQualificationEnvironment(input, bindingSource));
  }
  for (const key of environmentKeys.filter(key => key.startsWith("PYTHON_"))) {
    for (const value of [undefined, 42, "", "synthetic\0private", "synthetic\r\nprivate", "x".repeat(32_769)]) {
      const plan = bindingPlan(); plan.desktop.env[key] = value;
      const before = JSON.stringify(plan);
      denied(() => resolveVisualComposerQualificationEnvironment(plan, bindingSource));
      assert.equal(JSON.stringify(plan), before);
    }
  }
  for (const mutate of [plan => { delete plan.runId; }, plan => { delete plan.paths.desktopDataRoot; },
    plan => { delete plan.desktop.executablePath; }, plan => { delete plan.desktop.seed.command; }]) {
    const plan = bindingPlan(); mutate(plan);
    denied(() => resolveVisualComposerQualificationEnvironment(plan, bindingSource));
  }
});

test("qualification binding results are independent and preserve exact argument bytes", () => {
  const plan = bindingPlan(true);
  plan.desktop.env.PYTHON_RUNTIME_ARGS = `  ${plan.desktop.env.PYTHON_RUNTIME_ARGS}  `;
  const first = resolveVisualComposerQualificationEnvironment(plan, bindingSource);
  assert.equal(first.PYTHON_RUNTIME_ARGS, plan.desktop.env.PYTHON_RUNTIME_ARGS);
  plan.desktop.env.PYTHON_RUNTIME_PORT = "45005";
  const second = resolveVisualComposerQualificationEnvironment(plan, bindingSource);
  assert.equal(first.PYTHON_RUNTIME_PORT, "45003");
  assert.equal(second.PYTHON_RUNTIME_PORT, "45005");
  assert.notEqual(first, second);
});

function withSeedFixture(run) {
  const parent = realpathSync(os.tmpdir());
  const root = mkdtempSync(path.join(parent, "desktop-qualification-seed-"));
  const executablePath = path.join(root, "synthetic-app.exe");
  const seedExecutable = path.join(root, "synthetic-seed.exe");
  // These inert files are never executed. Every test injects its own runner.
  writeFileSync(executablePath, "", { flag: "wx" });
  writeFileSync(seedExecutable, "", { flag: "wx" });
  try {
    return run({ root, executablePath, seedExecutable });
  } finally {
    assert.equal(path.dirname(root), parent);
    assert.equal(realpathSync(root), root);
    let entries = 0;
    const regularTree = (folder, depth = 0) => {
      assert.ok(depth <= 10);
      for (const name of readdirSync(folder)) {
        const file = path.join(folder, name), info = lstatSync(file);
        assert.ok(++entries <= 16 && !info.isSymbolicLink());
        assert.equal(realpathSync(file), file);
        if (info.isDirectory()) regularTree(file, depth + 1);
        else assert.ok(info.isFile() && info.size === 0 && [executablePath, seedExecutable].includes(file));
      }
    };
    regularTree(root);
    rmSync(root, { recursive: true });
  }
}

function seedPlan(fixture, provided = false) {
  const options = { repoRoot: fixture.root, runId: "single-desktop-seed",
    desktopExecutablePath: fixture.executablePath, electronNodeExecutablePath: fixture.seedExecutable,
    environment: { PATH: "synthetic-path", NODE_OPTIONS: "--max-old-space-size=256" } };
  return provided ? createProvidedDatasetHostLaunchPlan({ ...options,
    pythonExecutable: path.join(fixture.root, "python.exe"), sourceRevision: bindingSource }) : createVisualComposerHostLaunchPlan(options);
}

test("standalone desktop identity preparation preserves exact normal and provided seed commands", () => {
  withSeedFixture(fixture => {
    for (const provided of [false, true]) {
      const plan = seedPlan(fixture, provided), before = JSON.stringify(plan);
      const ambient = JSON.stringify(process.env), calls = [];
      preparePackagedDesktopQualificationIdentity(plan, { platform: "win32", spawnProcess: (...args) => {
        calls.push(args); return { status: 0 };
      } });
      assert.deepEqual(calls, [[plan.desktop.seed.command, plan.desktop.seed.args, {
        cwd: plan.desktop.seed.cwd, env: plan.desktop.seed.env,
        windowsHide: true, encoding: "utf8", timeout: 30_000,
      }]]);
      assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, "1");
      assert.ok(existsSync(plan.paths.desktopDataRoot));
      assert.equal(existsSync(plan.paths.thinRuntimeRoot), false);
      assert.equal(existsSync(plan.paths.thinStorageRoot), false);
      assert.equal(JSON.stringify(plan), before);
      assert.equal(JSON.stringify(process.env), ambient);
    }
  });
});

test("standalone desktop identity preparation rejects unsupported platforms before allocation", () => {
  withSeedFixture(fixture => {
    const plan = seedPlan(fixture);
    let calls = 0;
    assert.throws(() => preparePackagedDesktopQualificationIdentity(plan, {
      platform: "linux", spawnProcess: () => { calls += 1; throw new Error("must not run"); },
    }), /currently requires Windows/);
    assert.equal(calls, 0);
    assert.equal(existsSync(plan.paths.desktopDataRoot), false);
  });
});

test("standalone desktop identity preparation rejects either missing executable before allocation", () => {
  for (const missing of ["executablePath", "seedExecutable"]) {
    withSeedFixture(fixture => {
      const plan = seedPlan(fixture); rmSync(fixture[missing]);
      let calls = 0;
      assert.throws(() => preparePackagedDesktopQualificationIdentity(plan, {
        platform: "win32", spawnProcess: () => { calls += 1; throw new Error("must not run"); },
      }), error => /executable is unavailable/.test(error.message) && !error.message.includes(fixture.root));
      assert.equal(calls, 0);
      assert.equal(existsSync(plan.paths.desktopDataRoot), false);
    });
  }
});

test("standalone desktop identity preparation keeps nonzero and timeout failures bounded and redacted", () => {
  for (const status of [1, null]) {
    withSeedFixture(fixture => {
      const plan = seedPlan(fixture), before = JSON.stringify(plan);
      let calls = 0;
      assert.throws(() => preparePackagedDesktopQualificationIdentity(plan, {
        platform: "win32", spawnProcess: () => {
          calls += 1;
          return { status, error: new Error(`token=synthetic-secret ${fixture.root}`),
            stderr: `password=synthetic-password\r\n${fixture.root} ${"x".repeat(2_000)}` };
        },
      }), error => error.message.startsWith("Unable to seed packaged desktop identity.") &&
        error.message.length <= 900 && !error.message.includes(fixture.root) &&
        !error.message.includes("synthetic-secret") && !error.message.includes("synthetic-password") &&
        !/[\r\n\t]/.test(error.message));
      assert.equal(calls, 1);
      assert.equal(JSON.stringify(plan), before);
    });
  }
});
