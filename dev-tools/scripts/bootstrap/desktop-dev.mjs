import { spawn, spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DesktopPrerequisiteFailure,
  prepareDesktopPython,
  requireCheckoutDirectory,
  withDesktopSetupLock,
} from "./desktop-python.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FORGE = "node_modules/@electron-forge/cli/dist/electron-forge.js";
const INSTALL_TIMEOUT = 6 * 60_000;
const PYTHON_PACKAGE_INSTALL_TIMEOUT = 8 * 60_000;
const NATIVE_TOOLCHAIN_PROBE = "await import('vite'); const { transformSync } = await import('esbuild'); transformSync('');";
const ELECTRON_EXECUTABLES = {
  win32: "electron.exe",
  linux: "electron",
  darwin: "Electron.app/Contents/MacOS/Electron",
};
const readJson = file => JSON.parse(readFileSync(file, "utf8"));

function filePresent(file) {
  return lstatSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

export function lockedDesktopPackagesPresent(root) {
  const lock = readJson(path.join(root, "package-lock.json")).packages;
  const declared = readJson(path.join(root, "package.json"));
  const required = Object.keys({ ...declared.dependencies, ...declared.devDependencies });
  if (required.some(name => !lock[`node_modules/${name}`])) return false;

  const directory = realpathSync(root);
  for (const [resource, locked] of Object.entries(lock)) {
    if (!resource.startsWith("node_modules/") && !resource.includes("/node_modules/")) continue;
    const manifest = path.join(directory, resource, "package.json");
    if (!filePresent(manifest)) {
      if (locked.optional) continue;
      return false;
    }
    const expected = locked.link ? lock[locked.resolved]?.version : locked.version;
    const target = locked.link ? path.join(directory, locked.resolved, "package.json") : manifest;
    try {
      if (typeof expected !== "string" || realpathSync(manifest) !== target || readJson(manifest).version !== expected) return false;
    } catch (error) {
      if (error instanceof SyntaxError || error?.code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

function runSetup(root, env, args, timeout = INSTALL_TIMEOUT) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, env, stdio: "ignore", timeout, windowsHide: true,
  });
  return result.status === 0 && !result.error;
}

export function desktopNativeToolchainPresent(root, env) {
  // npm classifies the platform-specific bindings as optional dependencies.
  return runSetup(root, env, ["--input-type=module", "--eval", NATIVE_TOOLCHAIN_PROBE], 15_000);
}

function ensureNpmDependencies(root, env) {
  requireCheckoutDirectory(path.join(root, "node_modules"));
  const ready = () => lockedDesktopPackagesPresent(root) && filePresent(path.join(root, FORGE)) && desktopNativeToolchainPresent(root, env);
  if (ready()) return;
  const cli = env.npm_execpath;
  if (!cli || !path.isAbsolute(cli) || path.basename(cli) !== "npm-cli.js" || !filePresent(cli)) {
    throw new DesktopPrerequisiteFailure("Run npm run dev:desktop from the checkout with Node 24 and npm.");
  }
  console.log("Installing the locked npm dependencies.");
  if (!runSetup(root, env, [cli, "ci", "--include=dev", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"]) || !ready()) {
    throw new DesktopPrerequisiteFailure("The locked npm dependencies could not be prepared. Check npm registry access and retry.");
  }
}

export function desktopSetupEnvironment(env) {
  const setup = {};
  for (const [key, value] of Object.entries(env)) {
    // Use Electron's official distribution and its bundled checksums.
    if (/^(?:npm_config_)?electron_/iu.test(key) || /^(?:force_no_cache|npm_config_arch|npm_config_platform)$/iu.test(key)) continue;
    if (/^ESBUILD_BINARY_PATH$/iu.test(key)) continue;
    if (/^(?:PYTHONHOME|PYTHONPATH|PYTHONUSERBASE|__PYVENV_LAUNCHER__)$/iu.test(key)) continue;
    setup[key] = value;
  }
  return setup;
}

export function pythonPackageSetupEnvironment(env) {
  const setup = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^PIP_/iu.test(key) || /^PIP_NO_INDEX$/iu.test(key)));
  return {
    ...setup,
    PIP_CONFIG_FILE: process.platform === "win32" ? "nul" : devNull,
    PIP_NO_INPUT: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
  };
}

export function desktopElectronPresent(directory, platform) {
  const executable = ELECTRON_EXECUTABLES[platform];
  if (!executable) return false;
  const actualPath = path.join(directory, "path.txt");
  const actualVersion = path.join(directory, "dist", "version");
  return filePresent(actualPath) && filePresent(actualVersion) &&
    readFileSync(actualPath, "utf8") === executable &&
    readFileSync(actualVersion, "utf8").trim().replace(/^v/u, "") === readJson(path.join(directory, "package.json")).version &&
    filePresent(path.join(directory, "dist", executable));
}

function ensureElectron(root, env) {
  if (!ELECTRON_EXECUTABLES[process.platform]) {
    throw new DesktopPrerequisiteFailure("This platform has no approved Desktop Electron distribution.");
  }
  const directory = path.join(root, "node_modules", "electron");
  requireCheckoutDirectory(directory);
  requireCheckoutDirectory(path.join(directory, "dist"));
  const pointer = lstatSync(path.join(directory, "path.txt"), { throwIfNoEntry: false });
  if (pointer && !pointer.isFile()) {
    throw new DesktopPrerequisiteFailure("Electron setup requires its path record to be a normal checkout file.");
  }
  if (desktopElectronPresent(directory, process.platform)) return;
  console.log("Installing the approved Electron binary.");
  if (!runSetup(root, env, [path.join(directory, "install.js")]) || !desktopElectronPresent(directory, process.platform)) {
    throw new DesktopPrerequisiteFailure("The approved Electron binary could not be prepared. Check download access and retry.");
  }
}

async function prepareDevelopment(root, originalEnv) {
  if (Number(process.versions.node.split(".")[0]) !== 24) {
    throw new DesktopPrerequisiteFailure("Desktop development requires Node 24 and npm.");
  }
  const env = desktopSetupEnvironment(originalEnv);
  return withDesktopSetupLock(root, async home => {
    ensureNpmDependencies(root, env);
    ensureElectron(root, env);

    const { require: requireTypeScript } = await import("tsx/cjs/api");
    const { desktopPythonWorkerEntryPresent, resolveDesktopPythonRuntimeLaunch } =
      requireTypeScript("../../../modules/hosts/desktop/composition/desktopPythonRuntimeInstallation.ts", import.meta.url);
    const { desktopPythonProbeEnvironment, shouldPreparePythonRuntimeWorkerDependencies } =
      requireTypeScript("../../../modules/hosts/desktop/composition/desktopPythonRuntimeHelpers.ts", import.meta.url);
    const { checkPythonRuntimeInstallation, ensurePythonRuntimeContextDependencies, ensurePythonRuntimeWorkerDependencies } =
      requireTypeScript("../../../modules/adapters/runtime/python/index.ts", import.meta.url);
    const pythonEnv = desktopPythonProbeEnvironment(env);
    const launch = resolveDesktopPythonRuntimeLaunch(pythonEnv);
    if (!desktopPythonWorkerEntryPresent(launch) || !filePresent(path.join(launch.cwd, "requirements.txt"))) {
      throw new DesktopPrerequisiteFailure("The Python worker files are missing. Restore the checkout and retry.");
    }
    console.log("Checking the required Python worker installation.");
    const command = await prepareDesktopPython({ home, launch, env: pythonPackageSetupEnvironment(pythonEnv) }, {
      check: checkPythonRuntimeInstallation,
      async prepare(options) {
        const setup = { ...options, installTimeoutMs: PYTHON_PACKAGE_INSTALL_TIMEOUT };
        await ensurePythonRuntimeContextDependencies(setup);
        ensurePythonRuntimeWorkerDependencies(setup);
      },
      isPythonCommand: shouldPreparePythonRuntimeWorkerDependencies,
    });
    return { ...pythonEnv, PYTHON_RUNTIME_COMMAND: command, PYTHON_RUNTIME_WORKER_DIR: launch.cwd };
  });
}

async function main() {
  const checkedEnv = await prepareDevelopment(ROOT, process.env);
  const forge = spawn(process.execPath, [path.join(ROOT, FORGE), "start", ...process.argv.slice(2)], {
    cwd: ROOT, env: checkedEnv, stdio: "inherit",
  });
  forge.once("error", () => {
    console.error("Desktop could not start Electron Forge.");
    process.exitCode = 1;
  });
  forge.once("exit", code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof DesktopPrerequisiteFailure
      ? error.message
      : "Desktop prerequisite setup could not finish. Check the checkout and repository access, then retry.");
    process.exitCode = 1;
  });
}
