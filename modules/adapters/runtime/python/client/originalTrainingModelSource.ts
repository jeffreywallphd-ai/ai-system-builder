/** Private observed bytes for preparation. Never native custody or readiness. */
import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open, opendir, realpath} from "node:fs/promises";
import path from "node:path";
import {types} from "node:util";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {captureOriginalTrainingModelReader, type OriginalTrainingCapture} from "./approvedTrainingTaskSession";
import {capturePassiveModelData} from "./modelDownloadManifest";

export interface OriginalTrainingModelObservationPolicy {
  readonly allowedRootDirectories: readonly string[];
  readonly maximumTotalBytes: number;
  readonly maximumDurationMs: number;
  readonly bufferBytes: number;
}
export interface ObservedOriginalTrainingModelSource {
  readonly modelRecordId: string;
  readonly modelUpdatedAt: string;
  readonly logicalPath: string;
  readonly files: readonly {readonly name: string; readonly sizeBytes: number; readonly sha256: string}[];
}
export interface OriginalTrainingModelObservation {
  observe(): Promise<ObservedOriginalTrainingModelSource>;
  /** Own returned IO only; no storage credit, worker or global task release. */
  isSettled(): boolean;
  retire(): Promise<boolean>;
}
type SourceIO = Pick<typeof import("node:fs/promises"), "lstat" | "open" | "opendir" | "realpath">;
const sourceIO: SourceIO = {lstat, open, opendir, realpath};
// Keep the existing initial native flat-copy profile. Do not reuse the generic
// lister, which intentionally supports a different recursive/symlink profile.
const safeNames = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "vocab.json", "merges.txt", "tokenizer.model", "model.safetensors"]);
const requiredNames = ["config.json", "tokenizer.json", "model.safetensors"];
const unavailable = () => new Error("The original training Model source could not be observed safely.");
function need(value: unknown): asserts value {if (value !== true) throw unavailable();}
function data(raw: unknown, keys: readonly string[]) {
  const row = readStrictPassiveRecord(capturePassiveModelData(raw), keys);
  need(Object.keys(row).length === keys.length); return row;
}
function local(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && path.isAbsolute(value) &&
    !/^[\\/]{2}|[\x00-\x1f\x7f]/.test(value) && path.resolve(value) === value && path.parse(value).root !== value;
}
function method(receiver: unknown, name: string): (...args: any[]) => any {
  need(!!receiver && typeof receiver === "object" && !types.isProxy(receiver));
  let prototype: object | null = receiver as object;
  for (let depth = 0; prototype && depth < 8; depth++, prototype = Object.getPrototypeOf(prototype)) {
    need(!types.isProxy(prototype));
    const property = Object.getOwnPropertyDescriptor(prototype, name);
    if (property) {
      need("value" in property && typeof property.value === "function" && !types.isProxy(property.value));
      const original = property.value; return (...args: any[]) => Reflect.apply(original, receiver, args);
    }
  }
  throw unavailable();
}
type Facts = {dev: bigint; ino: bigint; mode: bigint; nlink: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint};
function facts(raw: unknown, kind: "file" | "directory"): Facts {
  need(!!raw && typeof raw === "object" && !types.isProxy(raw));
  const keys = ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"] as const;
  const result = {} as Facts;
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(raw, key);
    need(!!property && "value" in property && typeof property.value === "bigint"); result[key] = property.value;
  }
  need(result.ino > 0n && result.size >= 0n && (result.mode & 0o170000n) === (kind === "file" ? 0o100000n : 0o40000n));
  if (kind === "file") need(result.nlink === 1n);
  return Object.freeze(result);
}
const sameIdentity = (a: Facts, b: Facts) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameFile = (a: Facts, b: Facts) => sameIdentity(a, b) && a.nlink === b.nlink && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function readCount(raw: unknown, buffer: Buffer, minimum: number, maximum: number): number {
  need(!!raw && typeof raw === "object" && !types.isProxy(raw) && Reflect.ownKeys(raw).length === 2);
  const count = Object.getOwnPropertyDescriptor(raw, "bytesRead"), returned = Object.getOwnPropertyDescriptor(raw, "buffer");
  need(!!count && "value" in count && Number.isSafeInteger(count.value) && count.value >= minimum && count.value <= maximum &&
    !!returned && "value" in returned && returned.value === buffer);
  return count.value as number;
}
type Owned = {raw: unknown; close?: () => Promise<unknown>; read?: (...args: any[]) => Promise<any>;
  stat?: (...args: any[]) => Promise<any>; closeAttempted: boolean; closed: boolean};
const observationContext = new AsyncLocalStorage<object>();
const observedOwners = new WeakMap<ObservedOriginalTrainingModelSource, {original: OriginalTrainingCapture; owner: OriginalTrainingModelObservation}>();

/** A private association, not a grant to copy/load/retain these mutable files. */
export function assertOriginalTrainingModelObservation(original: OriginalTrainingCapture, observed: ObservedOriginalTrainingModelSource): void {
  const binding = observedOwners.get(observed);
  need(binding?.original === original && binding.owner.isSettled());
}

/** Boot-only trusted policy. Constructing/binding opens no files. The separate
 * IO dependency is an inert test seam, never part of serializable configuration. */
export function createOriginalTrainingModelSourceFactory(rawPolicy: OriginalTrainingModelObservationPolicy, io: SourceIO = sourceIO) {
  const row = data(rawPolicy, ["allowedRootDirectories", "maximumTotalBytes", "maximumDurationMs", "bufferBytes"]);
  need(Array.isArray(row.allowedRootDirectories) && row.allowedRootDirectories.length >= 1 && row.allowedRootDirectories.length <= 8);
  const roots = Object.freeze(row.allowedRootDirectories.map(root => {need(local(root)); return root;}));
  need(new Set(roots).size === roots.length);
  const integer = (key: string, high: number) => {const value = row[key]; need(Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= high); return value as number;};
  const maximum = integer("maximumTotalBytes", Number.MAX_SAFE_INTEGER), duration = integer("maximumDurationMs", 86_400_000);
  const capacity = integer("bufferBytes", 65_536);
  const fs = {lstat: method(io, "lstat"), realpath: method(io, "realpath"), open: method(io, "open"), opendir: method(io, "opendir")};
  return Object.freeze({bind(original: OriginalTrainingCapture): OriginalTrainingModelObservation | undefined {
    const admission = captureOriginalTrainingModelReader(original);
    if (!admission) return undefined;
    const definition = admission.definition, logicalPath = definition.request.baseModel.localPath;
    need(local(logicalPath));
    const current = admission.assertCurrent.bind(admission), allowed = admission.assertAllowed.bind(admission), readModel = admission.readModelSelection.bind(admission);
    const scope = Object.freeze({});
    const owned = new Set<Owned>(), pending = new Set<object>(), uncertain = new Set<object>();
    let flight: Promise<ObservedOriginalTrainingModelSource> | undefined;
    let phase: "bound" | "observing" | "observed" | "failed" | "retired" = "bound", stopped = false, running = false;
    let deadline = 0;
    const check = () => {need(!stopped && phase === "observing" && Date.now() < deadline); current(); need(!stopped && Date.now() < deadline);};
    const permit = async () => {check(); await allowed(); check();};
    const call = async (name: string, operation: (...args: any[]) => any, args: unknown[]) => {
      const slot: {name: string; args: unknown[]; promise?: Promise<unknown>; value?: unknown; returned: boolean} = {name, args, returned: false};
      pending.add(slot);
      try {
        const result: unknown = operation(...args); slot.value = result;
        need(types.isPromise(result)); slot.promise = result;
        const value = await result; slot.value = value; slot.returned = true; return value as any;
      } catch {uncertain.add(slot); throw unavailable();}
      finally {pending.delete(slot);}
    };
    const claim = (raw: unknown, kind: "file" | "directory") => {
      const resource: Owned = {raw, closeAttempted: false, closed: false}; owned.add(resource);
      // Retain the raw returned object before reading any method or callback.
      resource.close = method(raw, "close"); resource.read = method(raw, "read");
      if (kind === "file") resource.stat = method(raw, "stat");
      return resource;
    };
    const close = async (resource: Owned) => {
      if (resource.closed) return;
      need(!resource.closeAttempted && !!resource.close); resource.closeAttempted = true;
      const result = await call("close", resource.close!, []); need(result === undefined); resource.closed = true;
    };
    const stat = async (name: string, kind: "file" | "directory") => {
      await permit(); const value = facts(await call("lstat", fs.lstat, [name, {bigint: true}]), kind); await permit(); return value;
    };
    const canonical = async (name: string) => {
      await permit(); const result = await call("realpath", fs.realpath, [name]); await permit(); need(result === name);
    };
    const inside = (root: string, target: string) => {
      const relative = path.relative(root, target); return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
    };
    const operation = async (): Promise<ObservedOriginalTrainingModelSource> => {
      let failed = false;
      try {
        await permit(); const selected = await readModel(); await permit();
        need(selected.modelRecordId === definition.request.baseModel.modelRecordId && selected.modelUpdatedAt === definition.modelUpdatedAt &&
          selected.localModelReference === logicalPath);
        const configured = roots.find(root => inside(root, logicalPath)); need(!!configured);
        const relative = path.relative(configured, logicalPath), segments = relative ? relative.split(path.sep) : [];
        need(segments.length <= 64 && segments.every(part => part && part !== "." && part !== ".."));
        const paths = [configured]; for (const segment of segments) paths.push(path.join(paths[paths.length - 1]!, segment));
        const rootFacts = new Map<string, Facts>();
        for (const name of paths) {rootFacts.set(name, await stat(name, "directory")); await canonical(name);}
        const rootsCurrent = async () => {
          for (const [name, before] of rootFacts) {need(sameIdentity(before, await stat(name, "directory"))); await canonical(name);}
        };
        const inventory = async () => {
          await rootsCurrent(); await permit();
          const directory = claim(await call("opendir", fs.opendir, [logicalPath]), "directory");
          const names: string[] = [], folded = new Set<string>();
          try {
            for (;;) {
              await permit(); const item = await call("directory.read", directory.read!, []); await permit();
              if (item === null) break;
              need(!!item && typeof item === "object" && !types.isProxy(item));
              const property = Object.getOwnPropertyDescriptor(item, "name");
              need(!!property && "value" in property && typeof property.value === "string");
              const name = property.value as string;
              need(names.length < 32 && safeNames.has(name) && !folded.has(name.toLowerCase()));
              names.push(name); folded.add(name.toLowerCase());
            }
          } finally {await close(directory);}
          need(requiredNames.every(name => folded.has(name))); return names.sort();
        };
        const names = await inventory(), records: {name: string; sizeBytes: number; sha256: string; before: Facts; handle: Owned}[] = [];
        let total = 0, inspected = 0n; const buffer = Buffer.alloc(capacity);
        // The graph-size bound permits exactly two data passes. Re-reading
        // catches tested same-size changes that stat timestamps can miss; it
        // still cannot establish continuous immutable native custody.
        const hashExact = async (handle: Owned, size: number) => {
          const hash = createHash("sha256"); let bytes = 0;
          while (bytes < size) {
            await permit(); const length = Math.min(buffer.length, size - bytes);
            const reply = await call("file.read", handle.read!, [buffer, 0, length, bytes]);
            const read = readCount(reply, buffer, 1, length);
            inspected += BigInt(read); need(inspected <= 2n * BigInt(maximum));
            bytes += read; hash.update(buffer.subarray(0, read)); await permit();
          }
          await permit(); const eof = await call("file.read", handle.read!, [buffer, 0, 1, bytes]);
          need(readCount(eof, buffer, 0, 0) === 0); await permit(); return hash.digest("hex");
        };
        for (const name of names) {
          const filename = path.join(logicalPath, name), before = await stat(filename, "file");
          need(before.size > 0n && before.size <= BigInt(maximum)); total += Number(before.size); need(Number.isSafeInteger(total) && total <= maximum);
          await permit(); const handle = claim(await call("open", fs.open, [filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)]), "file");
          await permit(); const opened = facts(await call("file.stat", handle.stat!, [{bigint: true}]), "file"); await permit(); need(sameFile(before, opened));
          const sha256 = await hashExact(handle, Number(before.size));
          const after = facts(await call("file.stat", handle.stat!, [{bigint: true}]), "file"); await permit();
          need(sameFile(opened, after) && sameFile(before, await stat(filename, "file")));
          records.push({name, sizeBytes: Number(before.size), sha256, before, handle});
        }
        const verify = async (rehash = false) => {
          await rootsCurrent(); need(JSON.stringify(await inventory()) === JSON.stringify(names));
          for (const record of records) {
            if (rehash) need(await hashExact(record.handle, record.sizeBytes) === record.sha256);
            await permit(); const observed = facts(await call("file.stat", record.handle.stat!, [{bigint: true}]), "file"); await permit();
            need(sameFile(record.before, observed) && sameFile(record.before, await stat(path.join(logicalPath, record.name), "file")));
          }
          need(JSON.stringify(await inventory()) === JSON.stringify(names));
        };
        await verify();
        const latest = await readModel(); await permit();
        need(latest.modelRecordId === selected.modelRecordId && latest.modelUpdatedAt === selected.modelUpdatedAt &&
          latest.localModelReference === selected.localModelReference);
        await verify(true);
        // No pending loader or source file capability is published. All actual
        // observation IO closes before the private metadata result is returned.
        for (const resource of owned) await close(resource);
        await permit(); need(pending.size === 0 && uncertain.size === 0 && [...owned].every(resource => resource.closed));
        // The saved selection can change during either the second hash pass or
        // an original close. Make its full authorized reread the final source
        // observation, after every file operation and close has returned.
        const finalSelection = await readModel(); await permit();
        need(finalSelection.modelRecordId === selected.modelRecordId && finalSelection.modelUpdatedAt === selected.modelUpdatedAt &&
          finalSelection.localModelReference === selected.localModelReference);
        const result: ObservedOriginalTrainingModelSource = Object.freeze({modelRecordId: selected.modelRecordId,
          modelUpdatedAt: selected.modelUpdatedAt, logicalPath, files: Object.freeze(records.map(({name, sizeBytes, sha256}) => Object.freeze({name, sizeBytes, sha256})))});
        observedOwners.set(result, {original, owner}); phase = "observed"; return result;
      } catch {failed = true; stopped = true; phase = "failed"; throw unavailable();}
      finally {
        // Cleanup remains bound to original returned objects and needs no renewed
        // Model permission. Unknown closes are never repeated or called settled.
        for (const resource of owned) {
          if (!resource.closed && !resource.closeAttempted && resource.close) {
            try {await close(resource);} catch {failed = true; stopped = true; phase = "failed";}
          }
        }
        if (failed) phase = "failed";
      }
    };
    const owner: OriginalTrainingModelObservation = Object.freeze({
      observe() {
        if (observationContext.getStore() === scope) return Promise.reject(unavailable());
        if (flight) return flight;
        if (phase !== "bound" || stopped) return Promise.reject(unavailable());
        phase = "observing"; running = true; deadline = Date.now() + duration;
        let timer: ReturnType<typeof setTimeout>;
        // Publish the original flight before Model/FS callbacks can reenter.
        const original = Promise.resolve().then(() => observationContext.run(scope, operation));
        const expired = new Promise<never>((_resolve, reject) => {timer = setTimeout(() => {stopped = true; phase = "failed"; reject(unavailable());}, duration);});
        flight = Promise.race([original, expired]);
        void original.then(() => {running = false; clearTimeout(timer);}, () => {running = false; clearTimeout(timer);});
        return flight;
      },
      isSettled() {return !running && pending.size === 0 && uncertain.size === 0 && [...owned].every(resource => resource.closed);},
      async retire() {stopped = true; if (!owner.isSettled()) return false; phase = "retired"; return true;},
    });
    return owner;
  }});
}
