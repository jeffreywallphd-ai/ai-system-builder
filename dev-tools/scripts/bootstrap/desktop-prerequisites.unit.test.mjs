import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { desktopElectronPresent, desktopNativeToolchainPresent, desktopSetupEnvironment, lockedDesktopPackagesPresent, pythonPackageSetupEnvironment } from "./desktop-dev.mjs";
import { downloadVerifiedPythonArchive, prepareDesktopPython, windowsPythonArtifact, withDesktopSetupLock } from "./desktop-python.mjs";

async function withCheckout(check) {
  const root = mkdtempSync(path.join(os.tmpdir(), "asb-desktop-setup-"));
  try {
    return await check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("verification requires the locked npm versions and the matching Electron distribution", () => withCheckout(root => {
  const pkg = { dependencies: { electron: "42.11.18" } };
  const lock = { packages: {
    "node_modules/electron": { version: "42.11.18" },
    "node_modules/electron/node_modules/@electron/get": { version: "5.1.0" },
    "node_modules/other-host": { version: "1.0.0", optional: true, os: [`!${process.platform}`] },
    "node_modules/current-host": { version: "1.0.0", optional: true, cpu: [process.arch] },
    "node_modules/optional-feature": { version: "1.0.0", optional: true },
  } };
  writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));

  assert.equal(lockedDesktopPackagesPresent(root), false);

  const electron = path.join(root, "node_modules", "electron");
  const dist = path.join(electron, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(electron, "package.json"), JSON.stringify({ version: "42.11.18" }));
  assert.equal(lockedDesktopPackagesPresent(root), false);
  const transitive = path.join(electron, "node_modules", "@electron", "get");
  mkdirSync(transitive, { recursive: true });
  writeFileSync(path.join(transitive, "package.json"), "invalid json");
  assert.equal(lockedDesktopPackagesPresent(root), false);
  writeFileSync(path.join(transitive, "package.json"), JSON.stringify({ version: "5.1.0" }));
  assert.equal(lockedDesktopPackagesPresent(root), true);
  const binary = path.join(root, "node_modules", "current-host");
  mkdirSync(binary);
  writeFileSync(path.join(binary, "package.json"), JSON.stringify({ version: "2.0.0" }));
  assert.equal(lockedDesktopPackagesPresent(root), false);
  writeFileSync(path.join(binary, "package.json"), JSON.stringify({ version: "1.0.0" }));
  assert.equal(lockedDesktopPackagesPresent(root), true);
  writeFileSync(path.join(transitive, "package.json"), JSON.stringify({ version: "4.0.0" }));
  assert.equal(lockedDesktopPackagesPresent(root), false);
  writeFileSync(path.join(transitive, "package.json"), JSON.stringify({ version: "5.1.0" }));
  assert.equal(desktopElectronPresent(electron, "win32"), false);
  writeFileSync(path.join(electron, "path.txt"), "../unowned.exe");
  writeFileSync(path.join(dist, "version"), "v42.11.18");
  writeFileSync(path.join(dist, "electron.exe"), "synthetic");
  assert.equal(desktopElectronPresent(electron, "win32"), false);
  writeFileSync(path.join(electron, "path.txt"), "electron.exe");
  assert.equal(desktopElectronPresent(electron, "win32"), true);
  writeFileSync(path.join(electron, "package.json"), JSON.stringify({ version: "42.11.17" }));
  assert.equal(lockedDesktopPackagesPresent(root), false);
  assert.equal(desktopElectronPresent(electron, "win32"), false);
}));

test("requires Vite and esbuild to load their native dependencies before Forge", () => withCheckout(root => {
  const vite = path.join(root, "node_modules", "vite");
  const esbuild = path.join(root, "node_modules", "esbuild");
  for (const directory of [vite, esbuild]) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), '{"exports":"./index.mjs"}');
  }
  writeFileSync(path.join(vite, "index.mjs"), "import './native.mjs';");
  writeFileSync(path.join(esbuild, "index.mjs"), "export function transformSync() {}");
  assert.equal(desktopNativeToolchainPresent(root, process.env), false);
  writeFileSync(path.join(vite, "native.mjs"), "export {};");
  assert.equal(desktopNativeToolchainPresent(root, process.env), true);
}));

test("setup cannot inherit mirrored installers, alternatives to bundled checksums, or extra pip requirements", () => {
  const common = {
    Electron_MIRROR: "private", npm_config_electron_use_remote_checksums: "1",
    ELECTRON_OVERRIDE_DIST_PATH: "foreign", npm_config_arch: "foreign", Esbuild_Binary_Path: "foreign", Path: "path", PYTHONPATH: "foreign",
  };
  assert.deepEqual(desktopSetupEnvironment(common), { Path: "path" });
  assert.deepEqual(pythonPackageSetupEnvironment({
    Path: "path", PIP_REQUIREMENT: "foreign", pip_index_url: "foreign",
    PIP_CONFIG_FILE: "foreign", PIP_TRUSTED_HOST: "foreign", PIP_NO_INDEX: "1",
  }), {
    Path: "path", PIP_NO_INDEX: "1", PIP_CONFIG_FILE: process.platform === "win32" ? "nul" : os.devNull,
    PIP_NO_INPUT: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1",
  });
});

test("allowlisted platform acquisition verifies both the exact byte length and digest", () => withCheckout(async root => {
  const approved = windowsPythonArtifact("win32", "x64");
  assert.equal(approved.supplier, "Python Software Foundation");
  assert.equal(approved.version, "3.14.10");
  assert.match(approved.sha512, /^[0-9a-f]{128}$/u);
  assert.equal(windowsPythonArtifact("win32", "arm64"), undefined);
  assert.equal(windowsPythonArtifact("linux", "x64"), undefined);

  const body = "synthetic archive body";
  const specification = { url: approved.url, bytes: Buffer.byteLength(body), sha512: createHash("sha512").update(body).digest("hex") };
  const response = content => async (url, options) => {
    assert.equal(url, approved.url);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return new Response(content);
  };
  await downloadVerifiedPythonArchive(specification, path.join(root, "verified"), response(body));
  assert.equal(readFileSync(path.join(root, "verified"), "utf8"), body);
  await assert.rejects(() => downloadVerifiedPythonArchive(specification, path.join(root, "checksum"), response(body.toUpperCase())), /approved checksum/);
  await assert.rejects(() => downloadVerifiedPythonArchive(specification, path.join(root, "length"), response(body + "extra")), /approved size/);
  await assert.rejects(() => downloadVerifiedPythonArchive(specification, path.join(root, "interrupted"), async () => { throw new Error("synthetic transport interruption"); }), /synthetic transport interruption/);
  assert.equal(existsSync(path.join(root, "interrupted")), false);
}));

test("a setup error retires only the active lock and allows another invocation to retry", () => withCheckout(async root => {
  let failSetup;
  const first = withDesktopSetupLock(root, () => new Promise((_resolve, reject) => { failSetup = reject; }));
  await assert.rejects(() => withDesktopSetupLock(root, () => { assert.fail("second setup must not run"); }), /Another Desktop setup is running/);
  failSetup(new Error("synthetic interruption"));
  await assert.rejects(first, /synthetic interruption/);
  await withDesktopSetupLock(root, home => {
    assert.ok(existsSync(path.join(home, "setup.lock")));
  });
}));

test("does not write setup contents through a redirected checkout-private directory", () => withCheckout(async root => {
  const { symlinkSync } = await import("node:fs");
  const foreign = path.join(root, "foreign");
  mkdirSync(foreign);
  symlinkSync(foreign, path.join(root, ".local-codex"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => withDesktopSetupLock(root, () => { assert.fail("redirected setup must not run"); }), /normal checkout-owned directory/);
  assert.equal(existsSync(path.join(foreign, "desktop-prerequisites")), false);
}));

test("uses an already verified installation and refuses a foreign or unapproved replacement", () => withCheckout(async home => {
  const launch = { command: "python", cwd: home };
  const settings = { home, launch, env: {}, platform: "win32", arch: "x64" };
  const runtime = { check: () => "ready", isPythonCommand: () => true, prepare: () => assert.fail("no install for a verified runtime") };
  assert.equal(await prepareDesktopPython(settings, runtime), "python");

  const missing = { ...runtime, check: () => "missing" };
  await assert.rejects(() => prepareDesktopPython({ ...settings, platform: "linux" }, missing), /Install a compatible Python/);
  await assert.rejects(() => prepareDesktopPython({ ...settings, env: { PYTHON_RUNTIME_COMMAND: "python" } }, missing), /configured Python command/);
  mkdirSync(path.join(home, "cpython-3.14.10-win-x64"));
  writeFileSync(path.join(home, "cpython-3.14.10-win-x64", "python.exe"), "synthetic foreign executable");
  await assert.rejects(() => prepareDesktopPython(settings, missing), /checkout-local Python installation is incomplete/);
}));

test("the next launch verifies the published worker again and does not accept traversal in its record", () => withCheckout(async home => {
  const worker = path.join(home, "worker-ABC123", "Scripts");
  mkdirSync(worker, { recursive: true });
  const executable = path.join(worker, "python.exe");
  writeFileSync(executable, "synthetic published interpreter");
  writeFileSync(path.join(home, "active-worker"), "worker-ABC123\n");
  const settings = { home, launch: { cwd: home, command: "python" }, env: {}, platform: "win32", arch: "x64" };
  const runtime = {
    check: ({ command }) => command === executable ? "ready" : "missing",
    isPythonCommand: () => true,
    prepare: () => assert.fail("no installer for a verified runtime"),
  };
  assert.equal(await prepareDesktopPython(settings, runtime), executable);
  assert.equal(await prepareDesktopPython(settings, runtime), executable);
  const configuredSource = createHash("sha256").update(JSON.stringify(["python", home, undefined])).digest("hex");
  writeFileSync(path.join(worker, "..", "configured-python"), configuredSource);
  const explicit = { ...settings, env: { PYTHON_RUNTIME_COMMAND: "python" } };
  assert.equal(await prepareDesktopPython(explicit, { ...runtime, check: ({ command }) => command === executable ? "ready" : "incomplete" }), executable);
  await assert.rejects(() => prepareDesktopPython(explicit, runtime), /configured Python command/);
  writeFileSync(path.join(home, "active-worker"), "../outside\n");
  await assert.rejects(() => prepareDesktopPython(settings, runtime), /setup record is invalid/);
}));
