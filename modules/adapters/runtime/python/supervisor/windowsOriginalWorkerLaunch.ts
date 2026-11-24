/** Private fixed controller for the SAME installed Python worker. No Root opts in. */
import {spawn, type ChildProcess, type SpawnOptions} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {lstat, realpath} from "node:fs/promises";
import path from "node:path";
import {PassThrough} from "node:stream";
import {types} from "node:util";
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../../../../contracts/shared";

export interface WindowsOriginalWorkerResourceProfile {
  readonly schema: "windows-original-worker-job-v1";
  readonly profileId: string;
  readonly processMemoryBytes: number;
  readonly jobMemoryBytes: number;
  readonly maximumActiveProcesses: number;
  readonly maximumDurationMs: number;
  readonly observationMs: number;
}
export interface ManagedOriginalPythonWorker {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly profileDigest: string;
  prepare(): Promise<void>;
  resume(): Promise<void>;
  assertCurrent(): void;
  retireOriginal(): Promise<boolean>;
  onUnavailable(listener: () => void): void;
  onRetired(listener: () => void): void;
}
const unavailable = () => new Error("The original managed Python worker is unavailable.");
function need(value: unknown): asserts value {if (value !== true) throw unavailable();}
const profileKeys = ["schema", "profileId", "processMemoryBytes", "jobMemoryBytes", "maximumActiveProcesses", "maximumDurationMs", "observationMs"];
export function captureOriginalWorkerResourceProfile(raw: WindowsOriginalWorkerResourceProfile): WindowsOriginalWorkerResourceProfile {
  const value = readStrictPassiveRecord(copyBoundedPassiveData(raw), profileKeys);
  need(Object.keys(value).length === profileKeys.length && value.schema === "windows-original-worker-job-v1" &&
    typeof value.profileId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.profileId));
  const integer = (key: string, low: number, high: number) => {
    const item = value[key]; need(Number.isSafeInteger(item) && (item as number) >= low && (item as number) <= high); return item as number;
  };
  const processMemory = integer("processMemoryBytes", 1, Number.MAX_SAFE_INTEGER);
  integer("jobMemoryBytes", processMemory, Number.MAX_SAFE_INTEGER);
  integer("maximumActiveProcesses", 1, 32); integer("maximumDurationMs", 1, 86_400_000); integer("observationMs", 1, 5_000);
  return Object.freeze(value) as unknown as WindowsOriginalWorkerResourceProfile;
}
export function originalWorkerResourceDigest(profile: WindowsOriginalWorkerResourceProfile): string {
  const copied = captureOriginalWorkerResourceProfile(profile);
  const canonical = Object.fromEntries(Object.entries(copied).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Synchronous original binding. Native construction starts only in prepare(). */
export function createWindowsOriginalWorkerLaunch(options: {
  readonly command: string; readonly cwd: string; readonly environment: NodeJS.ProcessEnv;
  readonly profile: WindowsOriginalWorkerResourceProfile; readonly assertHostCurrent: () => void;
  /** Separate async permission check after preflight, before controller creation. */
  readonly assertStartupAllowed?: () => Promise<void>;
  readonly nativePlatform?: () => {platform: NodeJS.Platform; arch: string};
  readonly spawnImplementation?: typeof spawn;
}): ManagedOriginalPythonWorker {
  const profile = captureOriginalWorkerResourceProfile(options.profile), digest = originalWorkerResourceDigest(profile);
  const command = options.command, cwd = options.cwd, environment = {...options.environment};
  const hostCurrent = options.assertHostCurrent, launch = options.spawnImplementation ?? spawn;
  const allowedProperty = Object.getOwnPropertyDescriptor(options, "assertStartupAllowed");
  need(allowedProperty !== undefined || !("assertStartupAllowed" in options));
  need(allowedProperty === undefined || "value" in allowedProperty && typeof allowedProperty.value === "function");
  const startupAllowed = allowedProperty?.value as (() => Promise<void>) | undefined;
  need(typeof command === "string" && path.isAbsolute(command) && typeof cwd === "string" && path.isAbsolute(cwd) && typeof hostCurrent === "function");
  need(!/^(?:\\\\|\/\/)/.test(command) && !/^(?:\\\\|\/\/)/.test(cwd) && !command.includes("\0") && !cwd.includes("\0"));
  const inspectPlatform = options.nativePlatform ?? (() => ({platform: process.platform, arch: process.arch}));
  const platformResult: unknown = Reflect.apply(inspectPlatform, options, []);
  if (types.isPromise(platformResult)) void Promise.prototype.then.call(platformResult, undefined, () => {});
  const platformFacts = readStrictPassiveRecord(platformResult, ["platform", "arch"]);
  need(Object.keys(platformFacts).length === 2 && platformFacts.platform === "win32" && platformFacts.arch === "x64");
  const currentHost = () => {
    const result: unknown = Reflect.apply(hostCurrent, options, []);
    if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
    need(result === undefined);
  };
  const nonce = randomBytes(32).toString("hex");
  const output = new PassThrough({highWaterMark: 16_384}), errorOutput = new PassThrough({highWaterMark: 16_384});
  const unavailableListeners = new Set<() => void>(), retiredListeners = new Set<() => void>();
  let controller: ChildProcess | undefined, controllerClosed = false, controllerExited = false, nativeRetired = false, uncertain = false, integrityLost = false;
  let suspendedAcknowledged = false, runningAcknowledged = false;
  let launchAttempted = false, bootAttempted = false, preparationReturned = false, noConstruction = false, stopCommandAttempted = false;
  let phase: "bound" | "preparing" | "suspended" | "resuming" | "running" | "retiring" | "retired" = "bound";
  let resumeAttempted = false, stopAttempted = false, wireBytes = 0, workerBytes = 0, buffer = Buffer.alloc(0);
  let prepareFlight: Promise<void> | undefined, resumeFlight: Promise<void> | undefined, retirementFlight: Promise<boolean> | undefined;
  let sendOriginal: ((value: string) => void) | undefined;
  const waiters = new Set<() => void>();
  const notify = () => {for (const listener of [...waiters]) listener();};
  const notifyUnavailable = (lostIntegrity = false) => {
    if (lostIntegrity) integrityLost = true;
    if (!uncertain) {
      uncertain = true;
      for (const listener of unavailableListeners) {try {listener();} catch { /* Passive diagnostics. */ }}
    }
    notify();
  };
  output.on("error", () => notifyUnavailable(true));
  errorOutput.on("error", () => notifyUnavailable(true));
  const final = () => {
    if ((noConstruction || nativeRetired && controllerClosed) && !integrityLost) {
      phase = "retired";
      for (const listener of retiredListeners) {try {listener();} catch { /* Passive diagnostics. */ }}
      retiredListeners.clear(); notify();
    }
  };
  const isRetired = () => phase === "retired";
  const acknowledgeNoConstruction = () => {
    if (stopAttempted && preparationReturned && (!launchAttempted || !bootAttempted && controllerClosed)) {
      noConstruction = true; final();
    }
  };
  const wait = (ready: () => boolean, milliseconds: number, retiring = false): Promise<boolean> => {
    if (ready()) return Promise.resolve(true);
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const changed = () => {
        if (ready() || integrityLost || (!retiring && uncertain) || controllerClosed) {clearTimeout(timer); waiters.delete(changed); resolve(ready());}
      };
      waiters.add(changed);
      timer = setTimeout(() => {waiters.delete(changed); resolve(ready());}, milliseconds);
      changed();
    });
  };
  const send = (action: "resume" | "stop") => {
    need(!!sendOriginal && !controllerClosed);
    sendOriginal!(JSON.stringify({schema: "windows-original-worker-command-v1", nonce, profileDigest: digest, action}) + "\n");
  };
  const acceptFrame = (line: Buffer) => {
    let value: Record<string, unknown>;
    try {
      const text = line.toString("utf8"), parsed = JSON.parse(text);
      // The fixed controller emits canonical ASCII JSON. This also refuses
      // duplicate keys, alternate escapes and invalid UTF-8 before interpretation.
      need(JSON.stringify(parsed) === text && Buffer.from(text).equals(line));
      value = readStrictPassiveRecord(parsed, ["schema", "nonce", "profileDigest", "kind", "lane", "data"]);
      need(value.schema === "windows-original-worker-control-v1" && value.nonce === nonce && value.profileDigest === digest);
      if (value.kind === "worker-output") {
        need(Object.keys(value).length === 6 && (value.lane === "stdout" || value.lane === "stderr") &&
          typeof value.data === "string" && value.data.length <= 10_924 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data));
        need(phase === "resuming" || phase === "running" || phase === "retiring");
        const bytes = Buffer.from(value.data, "base64"); need(bytes.toString("base64") === value.data && bytes.length <= 8192);
        workerBytes += bytes.length; need(workerBytes <= 1024 * 1024);
        const destination = value.lane === "stdout" ? output : errorOutput;
        need(destination.write(bytes) === true); return;
      }
      need(Object.keys(value).length === 4);
      if (value.kind === "suspended") {
        need(!suspendedAcknowledged && (phase === "preparing" || phase === "retiring")); suspendedAcknowledged = true;
        if (phase === "preparing") phase = "suspended";
      }
      else if (value.kind === "running") {
        need(!runningAcknowledged && resumeAttempted && (phase === "resuming" || phase === "retiring")); runningAcknowledged = true;
        if (phase === "resuming") phase = "running";
      }
      else if (value.kind === "retired") {need(!nativeRetired && phase !== "bound" && phase !== "preparing"); nativeRetired = true; phase = "retiring"; final();}
      else if (value.kind === "uncertain") {notifyUnavailable();}
      else throw unavailable();
      notify();
    } catch {notifyUnavailable(true);}
  };
  const receive = (chunk: unknown) => {
    if (integrityLost || controllerClosed) return;
    try {
      need(Buffer.isBuffer(chunk) && chunk.length <= 65_536);
      wireBytes += chunk.length; need(wireBytes <= 2 * 1024 * 1024);
      buffer = Buffer.concat([buffer, chunk]); need(buffer.length <= 131_072);
      let end: number;
      while ((end = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        need(line.length > 0 && line.length <= 65_536); acceptFrame(line);
        if (integrityLost) break;
      }
      need(buffer.length <= 65_536);
    } catch {notifyUnavailable(true);}
  };
  const owner: ManagedOriginalPythonWorker = Object.freeze({stdout: output, stderr: errorOutput, profileDigest: digest,
    onUnavailable(listener: () => void) {need(typeof listener === "function" && unavailableListeners.size < 8); unavailableListeners.add(listener);},
    onRetired(listener: () => void) {need(typeof listener === "function" && retiredListeners.size < 8); retiredListeners.add(listener);},
    assertCurrent() {currentHost(); need(!uncertain && !controllerExited && !controllerClosed && !nativeRetired && !stopAttempted && (phase === "suspended" || phase === "resuming" || phase === "running"));},
    async prepare() {
      need(phase === "bound" && !prepareFlight); phase = "preparing";
      const operation = Promise.resolve().then(async () => {
        currentHost(); need(!stopAttempted);
        const helper = path.join(cwd, "native", "windows_original_worker_launch.py"), entry = path.join(cwd, "main.py");
        const reads = await Promise.allSettled([
          lstat(cwd), lstat(helper), lstat(entry), realpath(cwd), realpath(helper), realpath(entry)]);
        need(reads.every(read => read.status === "fulfilled"));
        const [rootFacts, helperFacts, entryFacts, rootReal, helperReal, entryReal] = reads.map(read =>
          (read as PromiseFulfilledResult<any>).value);
        currentHost(); need(!stopAttempted);
        need(rootFacts.isDirectory() && !rootFacts.isSymbolicLink() && helperFacts.isFile() && !helperFacts.isSymbolicLink()
          && entryFacts.isFile() && !entryFacts.isSymbolicLink() && path.relative(rootReal, helperReal) === path.join("native", "windows_original_worker_launch.py")
          && path.relative(rootReal, entryReal) === "main.py");
        const env = Object.fromEntries(Object.entries(environment).filter((row): row is [string, string] => row[1] !== undefined));
        const boot = JSON.stringify({schema: "windows-original-worker-launch-v1", nonce, profile, profileDigest: digest, environment: env}) + "\n";
        need(Buffer.byteLength(boot) <= 65_536);
        if (startupAllowed) need(await Reflect.apply(startupAllowed, options, []) === undefined);
        currentHost(); need(!stopAttempted); launchAttempted = true;
        // The controller must remain stdlib-only before the app Job exists.
        // The app has its separate launch without -S, preserving installed SDKs.
        const child = controller = launch(command, ["-I", "-S", "-B", "-u", helperReal], {cwd: rootReal, env: environment, stdio: "pipe", windowsHide: true} satisfies SpawnOptions);
        const stdin = child.stdin, stdout = child.stdout, stderr = child.stderr;
        need(!!stdin && !!stdout && !!stderr);
        const write = stdin.write.bind(stdin);
        sendOriginal = value => {need(write(value) === true);};
        stdout.on("data", receive);
        stderr.on("data", () => notifyUnavailable(true)); // Never expose controller-native diagnostics.
        child.once("error", () => notifyUnavailable(true));
        child.once("exit", () => {controllerExited = true; notifyUnavailable();});
        child.once("close", () => {
          controllerClosed = true;
          if (buffer.length || bootAttempted && !nativeRetired) notifyUnavailable(true);
          output.end(); errorOutput.end(); acknowledgeNoConstruction(); final(); notify();
        });
        if (stopAttempted) {stdin.end(); throw unavailable();}
        bootAttempted = true; sendOriginal(boot);
        need(await wait(() => suspendedAcknowledged, profile.observationMs)); currentHost(); owner.assertCurrent();
      });
      prepareFlight = operation;
      try {await operation;} catch {notifyUnavailable(); throw unavailable();}
      finally {preparationReturned = true; acknowledgeNoConstruction(); notify();}
    },
    async resume() {
      need(preparationReturned && phase === "suspended" && !resumeAttempted && !resumeFlight);
      resumeAttempted = true; phase = "resuming";
      const operation = Promise.resolve().then(async () => {
        owner.assertCurrent(); currentHost(); send("resume");
        need(await wait(() => phase === "running", profile.observationMs)); owner.assertCurrent();
      });
      resumeFlight = operation;
      try {await operation;} catch {notifyUnavailable(); throw unavailable();}
    },
    retireOriginal() {
      if (isRetired()) return Promise.resolve(true);
      if (retirementFlight) return retirementFlight;
      if (!stopAttempted) {
        stopAttempted = true; phase = "retiring";
      }
      if (!prepareFlight && !launchAttempted) preparationReturned = true;
      acknowledgeNoConstruction();
      if (isRetired()) return Promise.resolve(true);
      if (controller && sendOriginal && bootAttempted && !controllerClosed && !stopCommandAttempted) {
        stopCommandAttempted = true;
        try {send("stop");} catch {notifyUnavailable();}
      }
      const operation = wait(isRetired, profile.observationMs, true);
      retirementFlight = operation;
      void operation.finally(() => {if (retirementFlight === operation) retirementFlight = undefined;});
      return operation;
    },
  });
  return owner;
}
