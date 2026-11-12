import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

const desktopSystemVariables = new Set([
  "appdata", "comspec", "homedrive", "homepath", "localappdata", "path", "pathext", "programdata", "programfiles",
  "systemdrive", "systemroot", "temp", "tmp", "userprofile", "windir",
]);

export function pickFormDesktopSystemEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(input).filter(([key]) => desktopSystemVariables.has(key.toLowerCase())));
}

const cases = ["authoring", "intake", "questionnaire", "native"] as const;

export function prepareFormDesktopProfile(testCase: typeof cases[number]) {
  const root = process.cwd();
  assert.ok(cases.includes(testCase), "The Form Desktop case must be known.");
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  assert.ok(runId && /^[a-z0-9-]{20,80}$/.test(runId), "The Form Desktop test requires the owned run identity.");
  const fence = path.resolve(root, "artifacts", "qualification", "visual-composer", "d");
  // Match the Visual Composer host's run-specific desktop root. This test
  // loader also runs under CommonJS in the packaged Playwright command.
  const runKey = createHash("sha256").update(runId).digest("hex").slice(0, 16);
  const base = path.join(fence, runKey, "desktop");
  assert.equal(process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT, base, "The Form Desktop profile must match the active run.");
  const relative = path.relative(fence, base);
  assert.ok(relative && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..");
  assert.equal(realpathSync(base), path.resolve(base), "The Form Desktop profile cannot use a redirected path.");
  const dataRoot = path.join(base, `form-${testCase}`);
  assert.ok(!lstatSync(dataRoot, { throwIfNoEntry: false }), "The Form Desktop profile must be fresh.");
  mkdirSync(dataRoot);
  assert.equal(realpathSync(dataRoot), dataRoot);
  const executablePath = path.join(root, "out", "ai-system-builder-win32-x64", "ai-system-builder.exe");
  const electronNode = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const qualification = path.join(root, "dev-tools", "scripts", "qualification", "visual-composer");
  const workerPort = "43172"; // Standard Desktop port owned by the Visual Composer fixture.
  const env = { ...pickFormDesktopSystemEnvironment(process.env), VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot,
    HF_HUB_CACHE: path.join(dataRoot, "controlled-model-cache"), PYTHON_RUNTIME_BASE_URL: `http://127.0.0.1:${workerPort}`,
    PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: workerPort, PYTHON_RUNTIME_COMMAND: process.execPath,
    PYTHON_RUNTIME_ARGS: "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
    PYTHON_RUNTIME_WORKER_DIR: root, PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: "15000" };
  const seed = spawnSync(electronNode, ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
    path.join(qualification, "visual-composer-desktop-seed.ts")], {
    cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, encoding: "utf8", timeout: 30_000,
  });
  assert.equal(seed.status, 0, "The isolated Form Desktop identity must be seeded before launch.");
  return { dataRoot, env, executablePath };
}
