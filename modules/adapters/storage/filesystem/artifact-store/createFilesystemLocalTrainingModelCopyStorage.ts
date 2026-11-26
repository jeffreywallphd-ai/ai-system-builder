/** Private trusted-local adapter. No hostile-process, Native or quota claim. */
import {constants} from "node:fs";
import {lstat, mkdtemp, open, readdir, realpath, rmdir, statfs} from "node:fs/promises";
import path from "node:path";
import {types} from "node:util";
import type {ApplicationRequestContext} from "../../../../application/ports/application-request-context";
import type {BoundedLocalTrainingModelCopyStoragePort, BoundedLocalTrainingModelSource} from "../../../../application/ports/model";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {isWorkspaceId, type WorkspaceId} from "../../../../contracts/workspace";
import {createContainedFileStreamLifetime, inspectContainedFileStreamLifetime, writeContainedFileStream,
  deleteContainedFile, type ContainedFileStreamLifetime} from "../../../filesystem-security";
import {verifiedPublicationStream} from "./verifiedPublicationStream";

const PromiseType = Promise, promisePrototype = Promise.prototype;
const unavailable = () => new Error("Bounded local training storage is unavailable.");
function need(value: unknown): asserts value {if (value !== true) throw unavailable();}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const names = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "vocab.json", "merges.txt", "tokenizer.model", "model.safetensors"]);
const contextKeys = ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"] as const;
function record(raw: unknown, keys: readonly string[]) {
  need(!!raw && typeof raw === "object" && !types.isProxy(raw));
  return readStrictPassiveRecord(raw, keys);
}
function array(raw: unknown, maximum: number): unknown[] {
  need(Array.isArray(raw) && !types.isProxy(raw) && Object.getPrototypeOf(raw) === Array.prototype &&
    raw.length > 0 && raw.length <= maximum && Reflect.ownKeys(raw).length === raw.length + 1);
  const result: unknown[] = [];
  for (let index = 0; index < raw.length; index++) {
    const item = Object.getOwnPropertyDescriptor(raw, String(index));
    need(!!item && "value" in item && item.enumerable === true); result.push(item.value);
  }
  return result;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
}
function locator(value: unknown): value is string {
  return text(value) && path.isAbsolute(value) && path.resolve(value) === value &&
    path.parse(value).root !== value && !/^[\\/]{2}/.test(value);
}
function context(raw: ApplicationRequestContext) {
  const value = record(raw, contextKeys);
  need(Object.values(value).every(x => x === undefined || text(x) && x.length <= 256 && x.trim() === x));
  need(isWorkspaceId(value.workspaceId) && text(value.requestId) && text(value.principalId) && text(value.organizationId));
  return Object.freeze(value);
}
type Facts = {dev: bigint; ino: bigint; mode: bigint; nlink: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint};
function facts(value: Facts, directory = false): Facts {
  need(value.ino > 0n && value.size >= 0n && (value.mode & 0o170000n) === (directory ? 0o40000n : 0o100000n));
  if (!directory) need(value.nlink === 1n);
  return Object.freeze(Object.fromEntries(["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]
    .map(key => [key, value[key as keyof Facts]]))) as Facts;
}
const sameIdentity = (a: Facts, b: Facts) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameFile = (a: Facts, b: Facts) => sameIdentity(a, b) && a.nlink === b.nlink && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** Trusted host composition captures the source snapshot and authority before IO.
 * The backend is replaceable; selecting it never downgrades a strict request. */
export function createFilesystemLocalTrainingModelCopyStorage(options: {
  rootDirectory: string;
  allowedSourceRoots: readonly string[];
  source: BoundedLocalTrainingModelSource;
  context: ApplicationRequestContext;
  limits: {maximumFiles: number; maximumFileBytes: number; maximumTotalBytes: number;
    maximumDurationMs: number; minimumFreeBytes: number; bufferBytes: number};
  control: {assertCurrent(): void; assertAllowed(): Promise<void>; assertCleanupAllowed(): Promise<void>};
}): BoundedLocalTrainingModelCopyStoragePort {
  const settings = record(options, ["rootDirectory", "allowedSourceRoots", "source", "context", "limits", "control"]);
  need(Object.keys(settings).length === 6 && locator(settings.rootDirectory));
  const rootDirectory = settings.rootDirectory;
  const allowedRoots = Object.freeze(array(settings.allowedSourceRoots, 16).map(root => {need(locator(root)); return root;}));
  const scope = context(settings.context as ApplicationRequestContext);
  const limits = record(settings.limits, ["maximumFiles", "maximumFileBytes", "maximumTotalBytes", "maximumDurationMs", "minimumFreeBytes", "bufferBytes"]);
  need(Object.keys(limits).length === 6 && Object.values(limits).every(positive) && (limits.maximumFiles as number) <= 256 &&
    (limits.maximumFileBytes as number) <= (limits.maximumTotalBytes as number) && (limits.maximumDurationMs as number) <= 86_400_000 &&
    (limits.bufferBytes as number) >= 4096 && (limits.bufferBytes as number) <= 1_048_576 &&
    (limits.minimumFreeBytes as number) <= Number.MAX_SAFE_INTEGER - (limits.maximumTotalBytes as number));
  const maximumMs = limits.maximumDurationMs as number, bufferBytes = limits.bufferBytes as number;
  const source = record(settings.source, ["modelRecordId", "modelUpdatedAt", "logicalPath", "files"]);
  need(Object.keys(source).length === 4 && text(source.modelRecordId) && text(source.modelUpdatedAt) && locator(source.logicalPath));
  const sourceDirectory = source.logicalPath;
  const destinationRelative = path.relative(sourceDirectory, rootDirectory);
  need(destinationRelative === ".." || destinationRelative.startsWith(".." + path.sep) || path.isAbsolute(destinationRelative));
  need(allowedRoots.some(root => {const relative = path.relative(root, sourceDirectory);
    return relative === "" || !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);}));
  let total = 0;
  const seen = new Set<string>();
  const files = Object.freeze(array(source.files, limits.maximumFiles as number).map(raw => {
    const file = record(raw, ["name", "sizeBytes", "sha256"]);
    need(Object.keys(file).length === 3 && typeof file.name === "string" && names.has(file.name) && !seen.has(file.name) &&
      positive(file.sizeBytes) && file.sizeBytes <= (limits.maximumFileBytes as number) &&
      file.sizeBytes <= (limits.maximumTotalBytes as number) - total && typeof file.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(file.sha256));
    seen.add(file.name); total += file.sizeBytes;
    return Object.freeze({name: file.name, sizeBytes: file.sizeBytes, sha256: file.sha256});
  }));
  need(["config.json", "tokenizer.json", "model.safetensors"].every(name => seen.has(name)));
  const control = record(settings.control, ["assertCurrent", "assertAllowed", "assertCleanupAllowed"]);
  need(Object.keys(control).length === 3 && Object.values(control).every(method => typeof method === "function" && !types.isProxy(method)));
  const current = () => {need(Reflect.apply(control.assertCurrent as Function, settings.control, []) === undefined);};
  const allowed = () => Reflect.apply(control.assertAllowed as Function, settings.control, []) as Promise<void>;
  const cleanupAllowed = () => Reflect.apply(control.assertCleanupAllowed as Function, settings.control, []) as Promise<void>;
  let phase: "bound" | "preparing" | "ready" | "unconfirmed" | "discarded" = "bound", fenced = false, uncertain = false;
  let flight: Promise<void> | undefined, flightFinished = false, freshDirectory: string | undefined, directoryFacts: Facts | undefined;
  let cleanupFlight: Promise<boolean> | undefined;
  let preparationDeadline = 0, cleanupAttempted = false;
  type Pending = {original?: unknown; observation?: Promise<{ok: boolean; value: unknown}>};
  const pending = new Set<Pending>(), sourceOwners: {handle?: Awaited<ReturnType<typeof open>>; closed: boolean}[] = [];
  const destinations: {name: string; lifetime: ContainedFileStreamLifetime; identity?: Facts}[] = [];
  const sameContext = (supplied: ApplicationRequestContext) => {
    const value = context(supplied); need(contextKeys.every(key => value[key] === scope[key]));
  };
  const track = async <T>(action: () => Promise<T>, unknownOnReject = false): Promise<T> => {
    need(pending.size < 16); const token: Pending = {}; pending.add(token);
    try {
      const original = action(); token.original = original; // Retain before any observation validation.
      need(types.isPromise(original) && !types.isProxy(original) && Object.getPrototypeOf(original) === promisePrototype
        && Object.getOwnPropertyDescriptor(original, "constructor") === undefined
        && Object.getOwnPropertyDescriptor(promisePrototype, "constructor")?.value === PromiseType);
      // Same-intrinsic await observes native settlement without reading an own
      // then hook or a supplied species. Box the result, including rejection.
      // Attach before refusing own-then metadata so late rejection is handled.
      token.observation = (async () => {
        try {return {ok: true, value: await original};}
        catch {return {ok: false, value: undefined};}
        finally {pending.delete(token);}
      })();
      need(Object.getOwnPropertyDescriptor(original, "then") === undefined);
    } catch {uncertain = true; throw unavailable();} // Unknown originals remain owned; no finally credit.
    const result = await token.observation!;
    if (!result.ok) {if (unknownOnReject) uncertain = true; throw unavailable();}
    return result.value as T;
  };
  const check = () => {need(!fenced && !uncertain && phase === "preparing" && Date.now() < preparationDeadline); current();};
  const authorize = async () => {check(); need(await track(allowed) === undefined); check();};
  const directory = async (name: string) => {
    need(await track(() => realpath(name)) === name);
    let cursor = name;
    while (path.dirname(cursor) !== cursor) {
      check(); const entry = await track(() => lstat(cursor, {bigint: true}));
      need(!entry.isSymbolicLink()); facts(entry, true); cursor = path.dirname(cursor);
    }
  };
  const headroom = async (remaining: number) => {
    check(); const volume = await track(() => statfs(rootDirectory, {bigint: true}));
    need(volume.bsize > 0n && volume.bavail >= 0n && volume.bavail * volume.bsize >= BigInt(remaining) + BigInt(limits.minimumFreeBytes as number)); check();
  };
  const destinationClosed = () => destinations.every(row => inspectContainedFileStreamLifetime(row.lifetime).phase === "closed");
  const ioClosed = () => flightFinished && pending.size === 0 && !uncertain && sourceOwners.every(row => row.closed) && destinationClosed();
  const run = async () => {
    await authorize(); await directory(rootDirectory); await directory(sourceDirectory); await headroom(total);
    check(); freshDirectory = await track(() => mkdtemp(path.join(rootDirectory, "training-model-")), true);
    directoryFacts = facts(await track(() => lstat(freshDirectory!, {bigint: true})), true); check();
    let copied = 0;
    for (const file of files) {
      await authorize(); await headroom(total - copied);
      const sourcePath = path.join(sourceDirectory, file.name), before = facts(await track(() => lstat(sourcePath, {bigint: true})));
      need(before.size === BigInt(file.sizeBytes)); check();
      const owner: {handle?: Awaited<ReturnType<typeof open>>; closed: boolean} = {closed: false}; sourceOwners.push(owner);
      owner.handle = await track(() => open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), true);
      const handle = owner.handle, read = handle.read.bind(handle), inspect = handle.stat.bind(handle), close = handle.close.bind(handle);
      try {
        need(sameFile(before, facts(await track(() => inspect({bigint: true}))))); check();
        const bytes = async function* () {
          const buffer = Buffer.alloc(bufferBytes); let offset = 0;
          for (;;) {
            check(); const amount = Math.min(buffer.length, file.sizeBytes - offset + 1);
            const result = await track(() => read(buffer, 0, amount, offset)); check();
            need(Number.isSafeInteger(result.bytesRead) && result.bytesRead >= 0 && result.bytesRead <= amount && result.buffer === buffer);
            if (result.bytesRead === 0) break;
            need(result.bytesRead <= file.sizeBytes - offset); offset += result.bytesRead;
            yield buffer.subarray(0, result.bytesRead);
          }
          need(offset === file.sizeBytes && sameFile(before, facts(await track(() => inspect({bigint: true})))));
          need(sameFile(before, facts(await track(() => lstat(sourcePath, {bigint: true}))))); check();
        };
        const verified = verifiedPublicationStream({content: bytes(), maximumBytes: file.sizeBytes,
          expectedSizeBytes: file.sizeBytes, expectedSha256: file.sha256}, limits.maximumFileBytes as number);
        const target = {name: file.name, lifetime: createContainedFileStreamLifetime(), identity: undefined as Facts | undefined}; destinations.push(target);
        const result = await track(() => writeContainedFileStream({rootDirectory: freshDirectory!, key: file.name,
          content: verified.content, maximumBytes: file.sizeBytes, overwrite: false}, target.lifetime));
        need(verified.result().sizeBytes === file.sizeBytes && result.sizeBytes === file.sizeBytes);
        target.identity = facts(await track(() => lstat(result.absolutePath, {bigint: true}))); check();
        copied += file.sizeBytes;
      } finally {
        await track(close, true); owner.closed = true;
      }
    }
    await authorize(); need(copied === total && destinationClosed()); phase = "ready";
  };
  const observe = async <T>(original: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {return await Promise.race([original, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {fenced = true; phase = "unconfirmed"; reject(unavailable());}, maximumMs);
    })]);} finally {if (timer) clearTimeout(timer);}
  };
  return Object.freeze({profile: "bounded-local-v1" as const,
    identity: Object.freeze({requestId: scope.requestId as string, workspaceId: scope.workspaceId as WorkspaceId,
      modelRecordId: source.modelRecordId as string, modelUpdatedAt: source.modelUpdatedAt as string}),
    prepare(supplied: ApplicationRequestContext) {
      sameContext(supplied); need(phase === "bound" && !fenced && !flight); phase = "preparing"; preparationDeadline = Date.now() + maximumMs;
      flight = Promise.resolve().then(run).catch(() => {fenced = true; phase = "unconfirmed"; throw unavailable();}).finally(() => {flightFinished = true;});
      return observe(flight);
    },
    async modelDirectory(supplied: ApplicationRequestContext) {
      sameContext(supplied); need(phase === "ready" && !fenced && ioClosed());
      try {
        current();
        need(await observe(track(allowed)) === undefined); need(phase === "ready" && !fenced && ioClosed()); current(); return freshDirectory!;
      } catch {fenced = true; throw unavailable();}
    },
    fence() {fenced = true;},
    inspect() {return Object.freeze({phase, fenced, pendingOperations: pending.size,
      sourceHandlesOpen: sourceOwners.filter(row => !row.closed).length, destinationIoClosed: destinationClosed(),
      fileCount: destinations.filter(row => !!row.identity).length, declaredBytes: total, preparationFinished: flightFinished,
      physicalQuotaEnforced: false as const});},
    async discard(supplied: ApplicationRequestContext) {
      sameContext(supplied);
      if (phase === "discarded") return true;
      if (!fenced || phase !== "ready" || !ioClosed() || cleanupAttempted || !freshDirectory || !directoryFacts) return false;
      cleanupAttempted = true; // Before the first callback, await or reentrant call.
      const cleanupCurrent = () => {need(fenced && phase === "ready" && !uncertain);};
      cleanupFlight = (async () => {
        need(await track(cleanupAllowed) === undefined); cleanupCurrent(); need(ioClosed());
        need(sameIdentity(directoryFacts!, facts(await track(() => lstat(freshDirectory!, {bigint: true})), true))); cleanupCurrent();
        const entries = await track(() => readdir(freshDirectory!)); cleanupCurrent();
        need(entries.length === files.length && entries.every(name => seen.has(name)));
        for (const row of destinations) {
          need(!!row.identity && sameFile(row.identity, facts(await track(() => lstat(path.join(freshDirectory!, row.name), {bigint: true})))));
          cleanupCurrent();
        }
        for (const row of destinations) {
          cleanupCurrent();
          need((await track(() => deleteContainedFile({rootDirectory: freshDirectory!, key: row.name}), true)).deleted === true);
          cleanupCurrent();
        }
        await track(() => rmdir(freshDirectory!), true); cleanupCurrent(); phase = "discarded"; return true;
      })().catch(() => {phase = "unconfirmed"; return false;});
      try {return await observe(cleanupFlight);} catch {return false;}
    },
  });
}
