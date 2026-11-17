import fs from "node:fs";
import path from "node:path";
import {
  preparePythonRuntimeEnvironment, readPythonRuntimePreparationDiagnostic,
  MAX_PREPARATION_COMMAND_OBSERVATIONS,
  type PythonRuntimePreparationObserver,
  type PythonRuntimePreparationDiagnostic,
} from "../../../../modules/adapters/runtime/python";

const FAILURE = "Qualification dependency observation is unavailable.";
const RECORD_BYTES = 1024;
const RECORDS = 4 * MAX_PREPARATION_COMMAND_OBSERVATIONS;
const FIXED_ARGS = ["-I", "-B", "../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py"];
type DirectoryPin = { path: string; dev: bigint; ino: bigint; birth: bigint };
export interface ProvidedRuntimePreparationJournal {
  readonly cache: string;
  readonly observe: PythonRuntimePreparationObserver;
  status(): Readonly<{ available: boolean; records: number; bytes: number; closeAcknowledgementMissing: boolean }>;
}
const issued = new WeakMap<ProvidedRuntimePreparationJournal, { repoRoot: string; sourceRevision: string; assertCurrent(): void }>();

function need(value: unknown): asserts value { if (!value) throw new Error(FAILURE); }
function io(value: string): string {
  // Keep the volume root absolute. Node's extended-path lstat can otherwise
  // reduce it to the drive-relative spelling "C:" on Windows.
  return process.platform === "win32" && value !== path.parse(value).root ? path.toNamespacedPath(value) : value;
}
function canonical(value: string): string {
  const actual = fs.realpathSync.native(io(value));
  return process.platform === "win32" && actual.startsWith("\\\\?\\") ? actual.slice(4) : actual;
}
function directory(value: string): DirectoryPin {
  const info = fs.lstatSync(io(value), { bigint: true });
  need(info.isDirectory() && !info.isSymbolicLink() && info.ino > 0n && canonical(value) === value);
  return { path: value, dev: info.dev, ino: info.ino, birth: info.birthtimeNs };
}
function same(left: DirectoryPin, right: DirectoryPin): boolean {
  return left.path === right.path && left.dev === right.dev && left.ino === right.ino && left.birth === right.birth;
}

/** Synthetic controlled-test records only; never protected production storage. */
export function createProvidedRuntimePreparationObserver(options: {
  readonly repoRoot: string; readonly runtimeRoot: string; readonly sequence: 1 | 2; readonly sourceRevision: string;
}): ProvidedRuntimePreparationJournal {
  try {
    const { repoRoot, runtimeRoot, sequence, sourceRevision } = options;
    need(process.env.NODE_ENV !== "production" && [1, 2].includes(sequence));
    need(typeof sourceRevision === "string" && /^source\.[a-f0-9]{64}$/.test(sourceRevision));
    need(path.isAbsolute(repoRoot) && path.resolve(repoRoot) === repoRoot && path.isAbsolute(runtimeRoot) && path.resolve(runtimeRoot) === runtimeRoot);
    if (process.platform === "win32") need(/^[A-Za-z]:\\/.test(repoRoot));
    const relative = path.relative(repoRoot, runtimeRoot).split(path.sep);
    need(relative.length === 6 && relative.slice(0, 4).join("/") === "artifacts/qualification/visual-composer/d" && /^[a-f0-9]{16}$/.test(relative[4]!) && relative[5] === "thin-runtime");
    const ancestry: string[] = [];
    for (let item = runtimeRoot; ; item = path.dirname(item)) {
      need(ancestry.length < 64);
      ancestry.push(item);
      if (path.dirname(item) === item) break;
    }
    const pins = ancestry.reverse().map(directory);
    const cache = path.join(runtimeRoot, `provided-server-cache-${sequence}`);
    // Exclusive creation is essential: never inspect/adopt an earlier cache.
    fs.mkdirSync(io(cache), { mode: 0o700 });
    pins.push(directory(cache));
    const assertCurrent = () => { need(!failed); for (const pin of pins) need(same(pin, directory(pin.path))); };
    let failed = false, busy = false, records = 0, bytes = 0;
    let uncertainDescriptor: number | undefined;
    const progress: Record<"context" | "worker", {
      sequence: number; pending: boolean; threw: boolean;
      stage?: PythonRuntimePreparationDiagnostic["stage"];
      backend?: PythonRuntimePreparationDiagnostic["data"]["backend"];
    }> = {
      context: { sequence: 0, pending: false, threw: false },
      worker: { sequence: 0, pending: false, threw: false },
    };
    let workerStarted = false;
    const observe: PythonRuntimePreparationObserver = value => {
      let entered = false;
      try {
        need(!failed && !busy);
        busy = true;
        entered = true;
        const event = readPythonRuntimePreparationDiagnostic(value);
        need(!failed && event && event.operation !== "model-training");
        const operation = event.operation;
        const state = progress[operation];
        const { sequence: number, phase } = event.data;
        need(!state.threw && (operation !== "context" || !workerStarted));
        if (phase === "entered") {
          need(!state.pending && number === state.sequence + 1);
          // Trace ordering only. The real preparer still decides readiness.
          if (operation === "worker") need(progress.context.sequence > 0 && !progress.context.pending && !progress.context.threw);
        } else need(state.pending && number === state.sequence && event.stage === state.stage && event.data.backend === state.backend);
        const body = Buffer.from(JSON.stringify({ schemaVersion: "provided-runtime-preparation-step-v1", sourceRevision,
          composition: "controlled-real-adapter-preparation", nativeAuthority: false, observation: event }) + "\n");
        need(body.length <= RECORD_BYTES && records < RECORDS && bytes + body.length <= RECORDS * RECORD_BYTES);
        assertCurrent();
        const destination = path.join(cache, `qualification-preparation-${operation}-${String(number).padStart(2, "0")}-${phase}.json`);
        let descriptor: number | undefined;
        let written = false, closed = false;
        try {
          descriptor = fs.openSync(io(destination), "wx", 0o600);
          need(!failed);
          const initial = fs.fstatSync(descriptor, { bigint: true });
          need(initial.isFile() && initial.nlink === 1n && initial.size === 0n);
          let offset = 0;
          while (offset < body.length) {
            need(!failed);
            const count = fs.writeSync(descriptor, body, offset, body.length - offset, null);
            need(Number.isInteger(count) && count > 0 && count <= body.length - offset);
            offset += count;
          }
          fs.fsyncSync(descriptor);
          const final = fs.fstatSync(descriptor, { bigint: true });
          const leaf = fs.lstatSync(io(destination), { bigint: true });
          need(final.isFile() && final.nlink === 1n && final.size === BigInt(body.length) &&
            final.dev === initial.dev && final.ino === initial.ino && final.birthtimeNs === initial.birthtimeNs &&
            leaf.isFile() && !leaf.isSymbolicLink() && leaf.nlink === 1n && leaf.dev === final.dev && leaf.ino === final.ino && leaf.size === final.size);
          assertCurrent();
          written = true;
        } finally {
          if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); closed = true; }
            catch { uncertainDescriptor = descriptor; failed = true; }
          }
        }
        need(!failed && written && closed);
        records++;
        bytes += body.length;
        state.sequence = number;
        state.pending = phase === "entered";
        state.threw = phase === "threw";
        state.stage = event.stage;
        state.backend = event.data.backend;
        if (operation === "worker") workerStarted = true;
      } catch {
        failed = true;
        // Keep partial bytes and an uncertain descriptor. Never retry its close,
        // reuse the name, remove a file, or turn this journal into native proof.
        throw new Error(FAILURE);
      } finally {
        if (entered) busy = false;
      }
    };
    const journal: ProvidedRuntimePreparationJournal = Object.freeze({ cache, observe,
      status: () => Object.freeze({ available: !failed, records, bytes, closeAcknowledgementMissing: uncertainDescriptor !== undefined }),
    });
    issued.set(journal, { repoRoot, sourceRevision, assertCurrent });
    return journal;
  } catch {
    throw new Error(FAILURE);
  }
}

/** Private production-rejected composition; the default dependency is real. */
export function createProvidedRuntimePreparationPreparer(options: {
  readonly repoRoot: string; readonly sourceRevision: string;
  readonly pythonExecutable: string; readonly journal: ProvidedRuntimePreparationJournal;
}, prepare = preparePythonRuntimeEnvironment) {
  const { repoRoot, sourceRevision, pythonExecutable, journal } = options;
  const binding = issued.get(journal);
  const worker = path.join(repoRoot, "out/ai-system-builder-win32-x64/resources/worker");
  need(process.env.NODE_ENV !== "production" && binding?.repoRoot === repoRoot && binding.sourceRevision === sourceRevision && typeof prepare === "function");
  need(path.isAbsolute(pythonExecutable) && path.resolve(pythonExecutable) === pythonExecutable &&
    ["python", "python.exe"].includes(path.basename(pythonExecutable).toLowerCase()) && !/[\0\r\n]/.test(pythonExecutable));
  return async (context: { command: string; args: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv }): Promise<void> => {
    let captured!: { command: string; args: readonly string[]; cwd?: string; env: NodeJS.ProcessEnv };
    try {
      const { command, args, cwd, env } = context;
      need(Array.isArray(args) && env && typeof env === "object");
      captured = Object.freeze({ command, args: Object.freeze([...args]), cwd, env: Object.freeze({ ...env }) });
      need(captured.env.NODE_ENV !== "production");
      binding.assertCurrent();
      need(captured.command === pythonExecutable && captured.cwd === worker &&
        captured.args.length === FIXED_ARGS.length && captured.args.every((value, index) => value === FIXED_ARGS[index]));
      directory(worker);
      const environment = captured.env;
      need(environment.HF_HUB_CACHE === journal.cache && environment.PYTHON_RUNTIME_QUALIFICATION_SCENARIO === "dataset-profile" &&
        environment.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION === sourceRevision && environment.PYTHON_RUNTIME_HOST === "127.0.0.1" &&
        typeof environment.PYTHON_RUNTIME_PORT === "string" && /^[1-9][0-9]{3,4}$/.test(environment.PYTHON_RUNTIME_PORT) && Number(environment.PYTHON_RUNTIME_PORT) >= 1024 && Number(environment.PYTHON_RUNTIME_PORT) <= 65535 &&
        ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX"].every(key => environment[key] === "1"));
    } catch { throw new Error(FAILURE); }
    // Launch credentials are rotated by the original foundation AFTER setup.
    // This callback neither requires nor records a pre-launch bearer token.
    await prepare({ command: captured.command, cwd: captured.cwd, env: captured.env, onDiagnosticStage: journal.observe });
  };
}
