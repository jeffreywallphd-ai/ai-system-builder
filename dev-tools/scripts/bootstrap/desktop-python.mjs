import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const artifact = Object.freeze(JSON.parse(readFileSync(new URL("./desktop-python-artifact.json", import.meta.url), "utf8")));
const PREPARED_PYTHON = /^worker-[a-z0-9]{6}$/iu;
const SETUP_TIMEOUT = 6 * 60_000;

export class DesktopPrerequisiteFailure extends Error {}

export function requireCheckoutDirectory(directory) {
  try {
    mkdirSync(directory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (!lstatSync(directory).isDirectory()) {
    throw new DesktopPrerequisiteFailure("Desktop setup requires a normal checkout-owned directory.");
  }
}

export async function withDesktopSetupLock(root, prepare) {
  const local = path.join(root, ".local-codex");
  requireCheckoutDirectory(local);
  const home = path.join(local, "desktop-prerequisites");
  requireCheckoutDirectory(home);
  const lock = path.join(home, "setup.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new DesktopPrerequisiteFailure("Another Desktop setup is running. If setup was interrupted, close any setup processes and remove the empty .local-codex/desktop-prerequisites/setup.lock directory before retrying.");
  }
  try {
    return await prepare(home);
  } finally {
    // The directory itself is the exclusive claim. Never remove its contents.
    rmdirSync(lock);
  }
}

export async function downloadVerifiedPythonArchive(specification, destination, request = fetch) {
  const response = await request(specification.url, { redirect: "error", signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new DesktopPrerequisiteFailure("The approved Python archive could not be downloaded.");
  const hash = createHash("sha512");
  let bytes = 0;
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > specification.bytes) {
        callback(new DesktopPrerequisiteFailure("The Python archive exceeded its approved size."));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(destination, { flags: "wx" }));
  if (bytes !== specification.bytes || hash.digest("hex") !== specification.sha512) {
    throw new DesktopPrerequisiteFailure("The Python archive did not match its approved checksum.");
  }
}

export function windowsPythonArtifact(platform = process.platform, arch = process.arch) {
  return platform === artifact.platform && arch === artifact.arch ? artifact : undefined;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "ignore", timeout: SETUP_TIMEOUT, windowsHide: true });
  return result.status === 0 && !result.error;
}

function portableBinariesMatch(directory, specification) {
  return lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() &&
    Object.entries(specification.binaries).every(([name, expected]) => {
      const file = path.join(directory, name);
      const facts = lstatSync(file, { throwIfNoEntry: false });
      return facts?.isFile() && facts.size <= specification.bytes &&
        createHash("sha256").update(readFileSync(file)).digest("hex") === expected;
    });
}

async function installPortablePython({ home, env, platform, arch }) {
  const specification = windowsPythonArtifact(platform, arch);
  if (!specification) {
    throw new DesktopPrerequisiteFailure("Install a compatible Python 3.10–3.14 interpreter with venv and pip, then retry. Automatic Python setup is available for Windows x64.");
  }
  const base = path.join(home, `cpython-${specification.version}-win-x64`);
  const interpreter = path.join(base, "python.exe");
  if (lstatSync(base, { throwIfNoEntry: false })) {
    if (!portableBinariesMatch(base, specification) ||
        !run(interpreter, ["-I", "-B", "-c", `import sys; raise SystemExit(sys.version_info[:3] != (${specification.version.replaceAll(".", ",")}))`], { env })) {
      throw new DesktopPrerequisiteFailure("The checkout-local Python installation is incomplete. Remove the incomplete owned installation and retry.");
    }
    return interpreter;
  }

  const stage = mkdtempSync(path.join(home, "python-download-"));
  try {
    console.log("Installing the approved portable Python runtime.");
    const archive = path.join(stage, "python.nupkg");
    await downloadVerifiedPythonArchive(specification, archive);
    const tar = path.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe");
    if (!run(tar, ["-xf", archive, "-C", stage, "tools"], { env })) {
      throw new DesktopPrerequisiteFailure("Windows could not extract the verified Python package.");
    }
    const tools = path.join(stage, "tools");
    const candidate = path.join(tools, "python.exe");
    if (!portableBinariesMatch(tools, specification) ||
        !run(candidate, ["-I", "-B", "-m", "pip", "--version"], { env })) {
      throw new DesktopPrerequisiteFailure("The verified Python package did not provide a usable interpreter and pip.");
    }
    renameSync(tools, base);
    return interpreter;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function workerExecutable(directory, platform) {
  return platform === "win32" ? path.join(directory, "Scripts", "python.exe") : path.join(directory, "bin", "python");
}

function readActiveWorker(home, platform, configuredSource) {
  const pointer = path.join(home, "active-worker");
  const facts = lstatSync(pointer, { throwIfNoEntry: false });
  if (!facts) return undefined;
  if (!facts.isFile() || facts.size > 32) throw new DesktopPrerequisiteFailure("The Desktop Python setup record is invalid.");
  const name = readFileSync(pointer, "utf8").trim();
  if (!PREPARED_PYTHON.test(name)) throw new DesktopPrerequisiteFailure("The Desktop Python setup record is invalid.");
  const directory = path.join(home, name);
  const owned = lstatSync(directory, { throwIfNoEntry: false });
  if (!owned?.isDirectory()) return undefined;
  if (configuredSource) {
    const source = path.join(directory, "configured-python");
    const sourceRecord = lstatSync(source, { throwIfNoEntry: false });
    if (!sourceRecord?.isFile() || sourceRecord.size !== 64 ||
        readFileSync(source, "utf8") !== configuredSource) return undefined;
  }
  const executable = workerExecutable(directory, platform);
  return lstatSync(path.dirname(executable), { throwIfNoEntry: false })?.isDirectory() &&
    lstatSync(executable, { throwIfNoEntry: false })?.isFile() ? executable : undefined;
}

export async function prepareDesktopPython({ home, launch, env, platform = process.platform, arch = process.arch }, runtime) {
  const { command, cwd } = launch;
  const check = command => runtime.check({ command, cwd, env });
  const configured = Boolean(env.PYTHON_RUNTIME_COMMAND?.trim());
  const searchPath = Object.entries(env).find(([name]) => /^path$/iu.test(name))?.[1];
  const source = path.isAbsolute(command) ? command : [command, cwd, searchPath];
  const configuredSource = configured ? createHash("sha256").update(JSON.stringify(source)).digest("hex") : undefined;
  const installed = runtime.isPythonCommand(command) ? check(command) : "unsupported";
  if (installed === "ready") return command;
  if (!configured || installed === "incomplete") {
    const existing = readActiveWorker(home, platform, configuredSource);
    if (existing && check(existing) === "ready") return existing;
  }

  let base = command;
  if (installed === "unsupported" || installed === "missing") {
    if (configured) {
      throw new DesktopPrerequisiteFailure("The configured Python command is missing or unsupported. Choose a supported interpreter or remove the override, then retry.");
    }
    base = await installPortablePython({ home, env, platform, arch });
  }
  const directory = mkdtempSync(path.join(home, "worker-"));
  const executable = workerExecutable(directory, platform);
  const pointer = path.join(home, path.basename(directory) + ".active");
  let verified = false;
  try {
    console.log("Preparing the Python worker packages in the checkout.");
    if (!run(base, ["-I", "-B", "-m", "venv", "--copies", directory], { cwd, env })) {
      throw new DesktopPrerequisiteFailure("Python could not create the checkout-local worker environment. Make sure the selected interpreter includes venv and pip.");
    }
    try {
      await runtime.prepare({ command: executable, cwd, env });
    } catch {
      throw new DesktopPrerequisiteFailure("Python could not install the required worker packages. Check package repository access and retry.");
    }
    if (check(executable) !== "ready") throw new DesktopPrerequisiteFailure("The required Python worker dependencies could not be verified.");
    if (configuredSource) writeFileSync(path.join(directory, "configured-python"), configuredSource, { flag: "wx" });
    writeFileSync(pointer, path.basename(directory) + "\n", { flag: "wx" });
    renameSync(pointer, path.join(home, "active-worker"));
    verified = true;
    return executable;
  } finally {
    rmSync(pointer, { force: true });
    if (!verified) rmSync(directory, { recursive: true, force: true });
  }
}
