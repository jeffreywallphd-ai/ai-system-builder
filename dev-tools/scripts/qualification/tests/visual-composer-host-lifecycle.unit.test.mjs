import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  createBoundedProcessOutput,
  createVisualComposerHostLaunchPlan,
  stopVisualComposerOwnedProcess,
  waitForVisualComposerEndpoint,
} from "../visual-composer/visual-composer-host-lifecycle.mjs";
import { buildPackagedDesktopFromCurrentWorktree } from "../visual-composer/visual-composer-global-setup.mjs";

test("visual composer host plan isolates roots, security, ports, and direct child commands", () => {
  const repoRoot = path.resolve("C:/work/ai-system-builder");
  const plan = createVisualComposerHostLaunchPlan({
    repoRoot,
    runId: "qualification-run",
    serverPort: 45_001,
    thinClientPort: 45_002,
    runtimePort: 45_003,
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
  assert.ok(plan.server.args.includes("--import"));
  assert.ok(plan.thinClient.args.includes("--strictPort"));
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
