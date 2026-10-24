import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { buildWindowsOcrResource } = require("../build_windows_ocr.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function capture(action) {
  const entries = [];
  const original = console.info;
  console.info = (value) => entries.push(value);
  try { await action(); } finally { console.info = original; }
  return entries;
}

test("unsupported hosts do not launch a build", async () => {
  let called = false;
  for (const [platform, arch] of [["linux", "x64"], ["darwin", "arm64"], ["win32", "arm64"]]) {
    await buildWindowsOcrResource(platform, arch, async () => { called = true; });
  }
  assert.equal(called, false);
});

test("fixed isolated Python form excludes arbitrary arguments and ambient values", async () => {
  let call;
  process.env.AISB_OCR_TEST_NOT_INHERITED = "synthetic-marker";
  const previous = process.env.PYTHON_RUNTIME_COMMAND;
  process.env.PYTHON_RUNTIME_COMMAND = "fixed-python";
  try {
    await buildWindowsOcrResource("win32", "x64", async (...args) => {
      call = args;
      return { stdout: '{"status":"ready","action":"built"}', stderr: "" };
    });
  } finally {
    delete process.env.AISB_OCR_TEST_NOT_INHERITED;
    if (previous === undefined) delete process.env.PYTHON_RUNTIME_COMMAND;
    else process.env.PYTHON_RUNTIME_COMMAND = previous;
  }
  assert.equal(call[0], "fixed-python");
  assert.deepEqual(call[1], ["-I", "-S", "-B", path.join(root, "dev-tools/scripts/native/build_windows_ocr.py"), "--build"]);
  assert.equal(call[2].cwd, root);
  assert.equal(call[2].shell, false);
  assert.equal(call[2].windowsHide, true);
  assert.equal(call[2].timeout, 150_000);
  assert.equal(call[2].maxBuffer, 64 * 1024);
  assert.ok(Object.keys(call[2].env).every((key) => ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"].includes(key)));
  assert.equal(call[2].env.AISB_OCR_TEST_NOT_INHERITED, undefined);
});

test("a verified built or reused resource does not emit a warning", async () => {
  for (const action of ["built", "reused"]) {
    const logs = await capture(() => buildWindowsOcrResource("win32", "x64", async () => ({
      stdout: JSON.stringify({ status: "ready", action }), stderr: "",
    })));
    assert.deepEqual(logs, []);
  }
});

test("missing optional toolchain preserves normal startup with fixed copy", async () => {
  const logs = await capture(() => buildWindowsOcrResource("win32", "x64", async () => ({
    stdout: '{"status":"unavailable","reason":"installed-toolchain-unavailable"}', stderr: "",
  })));
  assert.deepEqual(logs, ["Windows text recognition is unavailable. Standard features remain available."]);
});

test("compiler errors never print private output and do not prevent Standard startup", async () => {
  const logs = await capture(() => buildWindowsOcrResource("win32", "x64", async () => {
    throw Object.assign(new Error("private-marker"), { stdout: "private-output", stderr: "private-error" });
  }));
  assert.deepEqual(logs, ["Windows text recognition could not be built. Standard features remain available."]);
});

test("corrupt, unexpected, excessive or noisy build responses never claim success", async () => {
  for (const response of [
    { stdout: "not-json", stderr: "" },
    { stdout: "null", stderr: "" },
    { stdout: '{"status":"ready","action":"unknown"}', stderr: "" },
    { stdout: '{"status":"ready","action":"built","private":"marker"}', stderr: "" },
    { stdout: '{"status":"unavailable","reason":"unknown"}', stderr: "" },
    { stdout: "x".repeat(4097), stderr: "" },
    { stdout: '{"status":"ready","action":"built"}', stderr: "private-marker" },
  ]) {
    const logs = await capture(() => buildWindowsOcrResource("win32", "x64", async () => response));
    assert.deepEqual(logs, ["Windows text recognition could not be built. Standard features remain available."]);
  }
});

test("the actual Forge hook passes only platform and architecture and preserves both hosts", async () => {
  const calls = [];
  const context = { module: { exports: {} }, __dirname: path.join(root, "apps/desktop"), require(name) {
    if (name === "node:path") return path;
    if (name === "@electron-forge/maker-squirrel") return { MakerSquirrel: class {} };
    if (name === "@electron-forge/maker-zip") return { MakerZIP: class {} };
    if (name === "../../dev-tools/scripts/native/build_windows_ocr.cjs") {
      return { buildWindowsOcrResource: async (...args) => calls.push(args) };
    }
    throw new Error("Unexpected build dependency");
  } };
  vm.runInNewContext(readFileSync(path.join(root, "apps/desktop/forge.config.js"), "utf8"), context);
  const config = context.module.exports;
  await config.hooks.generateAssets({ private: "ignored" }, "win32", "x64");
  assert.deepEqual(calls, [["win32", "x64"]]);
  assert.equal(config.packagerConfig.extraResource[0], path.join(root, "modules/adapters/runtime/python/worker"));
  assert.equal(config.plugins[0].name, "@electron-forge/plugin-vite");
  assert.equal(config.plugins[0].config.build.length, 3);
  assert.equal(config.plugins[0].config.renderer.length, 2);
  assert.equal(config.plugins[0].config.concurrent, 1);
});
