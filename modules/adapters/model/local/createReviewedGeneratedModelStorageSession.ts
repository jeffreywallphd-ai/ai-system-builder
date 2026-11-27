import {createHash} from "node:crypto";
import {constants, type BigIntStats} from "node:fs";
import {lstat, mkdir, open, readdir, realpath, rmdir, statfs, unlink, type FileHandle} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {types} from "node:util";
import type {ApplicationRequestContext} from "../../../application/ports";
import type {ReviewedGeneratedModelControl, ReviewedGeneratedModelRequest, ReviewedGeneratedModelStorageSession,
  ReviewedGeneratedModelResult} from "../../../application/ports/model";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";

export interface ReviewedGeneratedModelStorageOptions {
  readonly rootDirectory: string;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: number;
  readonly maximumDurationMs: number;
  readonly minimumFreeBytes: number;
}
export interface ReviewedGeneratedModelCopyHooks {
  beforeEffect(): Promise<void>;
  check(): void;
  effect<T>(action: () => Promise<T>): Promise<T>;
  opened(handle: FileHandle): void;
  closed(handle: FileHandle): void;
  remember(target: string, stats: BigIntStats): void;
  readonly expectedSha256: string;
}
type Copier = (source: string, canonicalSource: string, inspected: BigIntStats, target: string,
  hooks?: ReviewedGeneratedModelCopyHooks) => Promise<void>;
const unavailable = () => new Error("Reviewed model storage is unavailable.");
function need(value: unknown): asserts value {if (value !== true) throw unavailable();}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, low: number, high: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= low && v <= high;
function record(value: unknown, keys: readonly string[]) {
  need(!!value && typeof value === "object" && !types.isProxy(value));
  return readStrictPassiveRecord(value, keys);
}
function absolute(value: unknown): string {
  need(typeof value === "string" && value.length > 0 && value.length <= 32760 && !/[\x00-\x1f\x7f]/.test(value) &&
    path.isAbsolute(value) && path.normalize(value) === value && path.parse(value).root !== value && !value.startsWith("\\\\") && !value.startsWith("//"));
  return value;
}
function fileFacts(value: BigIntStats) {
  need(value.isFile() && !value.isSymbolicLink() && value.ino > 0n && value.nlink === 1n && value.size >= 0n);
  return Object.freeze({dev: value.dev, ino: value.ino, mode: value.mode, nlink: value.nlink,
    size: value.size, mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs});
}
type FileFacts = ReturnType<typeof fileFacts>;
const same = (a: FileFacts, b: FileFacts) => Object.keys(a).every(k => a[k as keyof FileFacts] === b[k as keyof FileFacts]);
function directoryFacts(value: BigIntStats) {
  need(value.isDirectory() && !value.isSymbolicLink() && value.ino > 0n);
  return Object.freeze({dev: value.dev, ino: value.ino, mode: value.mode});
}
type DirectoryFacts = ReturnType<typeof directoryFacts>;
const sameDirectory = (a: DirectoryFacts, b: DirectoryFacts) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const samePath = (a: string, b: string) => path.relative(a, b) === "";
const inside = (root: string, child: string) => {const r = path.relative(root, child); return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);};

/** Private configured adapter factory. No filesystem operations occur here.
 * Original source/consent and registry ownership remain application duties. */
export function createReviewedGeneratedModelStorageFactory(rawOptions: ReviewedGeneratedModelStorageOptions, copyFile: Copier) {
  const settings = record(rawOptions, ["rootDirectory", "maximumFiles", "maximumTotalBytes", "maximumDurationMs", "minimumFreeBytes"]);
  const root = absolute(settings.rootDirectory);
  need(Object.keys(settings).length === 5 && integer(settings.maximumFiles, 3, 256) &&
    integer(settings.maximumTotalBytes, 1, 100 * 1024 ** 3) && integer(settings.maximumDurationMs, 1, 3600000) &&
    integer(settings.minimumFreeBytes, 0, 100 * 1024 ** 3) && typeof copyFile === "function" && !types.isProxy(copyFile));
  const maximumFiles = settings.maximumFiles, maximumBytes = settings.maximumTotalBytes,
    duration = settings.maximumDurationMs, minimumFree = settings.minimumFreeBytes;
  return (raw: ReviewedGeneratedModelRequest, rawContext: ApplicationRequestContext,
    owner: ReviewedGeneratedModelControl): ReviewedGeneratedModelStorageSession | undefined => {
    try {
      const request = record(raw, ["taskId", "saveId", "candidateDigest", "sourceDirectory", "artifactForm", "files"]);
      const context = record(rawContext, ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"]);
      need(Object.keys(request).length === 6 && uuid(request.taskId) && uuid(request.saveId) && digest(request.candidateDigest) &&
        context.requestId === request.saveId && isOrganizationId(context.organizationId) && isWorkspaceId(context.workspaceId) &&
        typeof context.principalId === "string" && context.principalId.length > 0 && context.principalId.length <= 160 &&
        context.principalId === context.principalId.trim() && !/[\x00-\x1f\x7f]/.test(context.principalId) && !hasKnownPassiveCredential(context.principalId) &&
        (context.correlationId === undefined || typeof context.correlationId === "string" && context.correlationId.length <= 256) &&
        (request.artifactForm === "full-model" || request.artifactForm === "adapter"));
      const source = absolute(request.sourceDirectory);
      need(!samePath(root, source) && !inside(root, source) && !inside(source, root));
      const names = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
        "added_tokens.json", "vocab.json", "merges.txt", "model.safetensors", "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"]);
      need(!!request.files && typeof request.files === "object" && !types.isProxy(request.files) && Array.isArray(request.files) &&
        Object.getPrototypeOf(request.files) === Array.prototype && request.files.length >= 3 && request.files.length <= maximumFiles &&
        Reflect.ownKeys(request.files).length === request.files.length + 1);
      let totalBytes = 0; const selected = new Set<string>();
      const files = Array.from({length: request.files.length}, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(request.files, String(index));
        need(!!descriptor && "value" in descriptor && descriptor.enumerable);
        const f = record(descriptor.value, ["name", "expectedSizeBytes", "expectedSha256"]);
        need(Object.keys(f).length === 3 && typeof f.name === "string" && names.has(f.name) && !selected.has(f.name) &&
          integer(f.expectedSizeBytes, 1, maximumBytes - totalBytes) && digest(f.expectedSha256));
        selected.add(f.name); totalBytes += f.expectedSizeBytes;
        return Object.freeze({name: f.name, expectedSizeBytes: f.expectedSizeBytes, expectedSha256: f.expectedSha256});
      });
      const adapter = request.artifactForm === "adapter";
      need((adapter ? ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"] : ["config.json", "model.safetensors", "tokenizer.json"]).every(n => selected.has(n)) &&
        !(adapter ? ["config.json", "model.safetensors"] : ["adapter_config.json", "adapter_model.safetensors"]).some(n => selected.has(n)));
      need(!!owner && typeof owner === "object" && !types.isProxy(owner));
      const functions = Object.fromEntries(["isCurrent", "stillAllowed", "mayDiscard"].map(key => {
        const d = Object.getOwnPropertyDescriptor(owner, key); need(!!d && "value" in d && typeof d.value === "function" && !types.isProxy(d.value));
        return [key, d.value as Function];
      }));
      const target = path.join(root, ".model-copy-" + createHash("sha256").update(JSON.stringify([context.organizationId, context.workspaceId, request.saveId])).digest("hex").slice(0, 32));
      let phase: ReturnType<ReviewedGeneratedModelStorageSession["inspect"]>["phase"] = "bound", fenced = false, unknown = false,
        creationAttempted = false, knownNoCreation = false, finished = true, deadline = 0;
      let parent: DirectoryFacts | undefined, sourceRoot: DirectoryFacts | undefined, leaf: DirectoryFacts | undefined;
      const pending = new Set<object>(), retained: unknown[] = [], handles = new Set<FileHandle>(), owned = new Map<string, FileFacts>();
      const closed = () => finished && !unknown && pending.size === 0 && handles.size === 0;
      const native = (p: unknown): p is Promise<unknown> => types.isPromise(p) && !types.isProxy(p) &&
        Object.getPrototypeOf(p) === Promise.prototype && !Object.getOwnPropertyDescriptor(p, "constructor") && !Object.getOwnPropertyDescriptor(p, "then");
      const effect = async <T>(action: () => Promise<T>): Promise<T> => {
        const token: {original?: unknown; observation?: Promise<unknown>} = {}; pending.add(token); need(pending.size <= 16);
        let operation: Promise<T>;
        try {operation = action(); token.original = operation; if (!native(operation)) {unknown = true; throw unavailable();}}
        catch {unknown = true; throw unavailable();}
        const observation = (async () => {try {return await operation;} finally {pending.delete(token);}})(); token.observation = observation;
        return observation;
      };
      const check = () => {
        need(!fenced && !unknown && performance.now() < deadline);
        const result: unknown = Reflect.apply(functions.isCurrent!, owner, []);
        if (typeof result !== "boolean") {unknown = true; retained.push(result); if (native(result)) void (async () => {try {await result;} catch {}})();}
        need(result === true && !fenced && !unknown && performance.now() < deadline);
      };
      const permission = async () => {check(); need(await effect(() => Reflect.apply(functions.stillAllowed!, owner, [])) === true); check();};
      const inspectDirectory = async (name: string, requireCurrent = true) => {
        if (requireCurrent) check();
        const a = directoryFacts(await effect(() => lstat(name, {bigint: true})));
        if (requireCurrent) check();
        need(samePath(await effect(() => realpath(name)), name));
        if (requireCurrent) check();
        need(sameDirectory(a, directoryFacts(await effect(() => lstat(name, {bigint: true}))))); return a;
      };
      const directoriesCurrent = async () => {
        need(!!parent && !!sourceRoot && !!leaf && sameDirectory(parent, await inspectDirectory(root)) &&
          sameDirectory(sourceRoot, await inspectDirectory(source)) && sameDirectory(leaf, await inspectDirectory(target)));
      };
      const closeHandle = async (handle: FileHandle) => {await effect(() => handle.close()); handles.delete(handle);};
      const verifyCopy = async (name: string, expected: typeof files[number]) => {
        const f = owned.get(name); need(!!f); check();
        const h = await effect(() => open(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))); handles.add(h);
        try {
          check(); need(same(f, fileFacts(await effect(() => h.stat({bigint: true})))));
          const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(expected.expectedSizeBytes, 1024 ** 2)); let count = 0;
          while (count < expected.expectedSizeBytes) {
            await permission(); check();
            const r = await effect(() => h.read(buffer, 0, Math.min(buffer.length, expected.expectedSizeBytes - count), null)); check();
            need(integer(r.bytesRead, 1, Math.min(buffer.length, expected.expectedSizeBytes - count)));
            count += r.bytesRead; hash.update(buffer.subarray(0, r.bytesRead));
          }
          need("sha256:" + hash.digest("hex") === expected.expectedSha256 && same(f, fileFacts(await effect(() => h.stat({bigint: true})))));
          need(same(f, fileFacts(await effect(() => lstat(name, {bigint: true}))))); check();
        } finally {await closeHandle(h);}
      };
      return Object.freeze({storageProfile: "bounded-local-v1" as const,
        fence() {fenced = true;},
        inspect() {return Object.freeze({phase, fenced, pendingOperations: pending.size, openFiles: handles.size, ioClosed: closed(),
          declaredPayloadBytes: creationAttempted && !knownNoCreation && phase !== "discarded" ? totalBytes : 0, physicalQuotaEnforced: false as const});},
        async write(): Promise<ReviewedGeneratedModelResult> {
          need(phase === "bound" && !fenced); phase = "writing"; finished = false; deadline = performance.now() + duration;
          try {
            await permission(); check(); parent = await inspectDirectory(root); sourceRoot = await inspectDirectory(source); check();
            const space = await effect(() => statfs(root, {bigint: true})); check();
            need(space.bsize > 0n && space.bavail >= 0n && space.bsize * space.bavail >= BigInt(totalBytes + minimumFree));
            await permission(); check(); creationAttempted = true;
            try {await effect(() => mkdir(target, {mode: 0o700}));} catch (error) {
              if ((error as NodeJS.ErrnoException).code === "EEXIST") knownNoCreation = true; throw error;
            }
            leaf = await inspectDirectory(target); check();
            for (const file of files) {
              await permission(); check(); await directoriesCurrent(); check();
              const originalPath = path.join(source, file.name), destination = path.join(target, file.name);
              const before = await effect(() => lstat(originalPath, {bigint: true}));
              need(fileFacts(before).size === BigInt(file.expectedSizeBytes) && samePath(await effect(() => realpath(originalPath)), originalPath)); check();
              await copyFile(originalPath, originalPath, before, destination, {effect, beforeEffect: permission, check,
                opened(handle) {handles.add(handle);}, closed(handle) {handles.delete(handle);},
                remember(name, stats) {owned.set(name, fileFacts(stats));}, expectedSha256: file.expectedSha256});
              check(); await verifyCopy(destination, file);
            }
            await permission(); check(); await directoriesCurrent(); check();
            const entries = await effect(() => readdir(target)); need(entries.length === files.length && entries.every(n => selected.has(n))); check();
            need(pending.size === 0 && handles.size === 0 && !unknown); phase = "ready";
            return Object.freeze({storageProfile: "bounded-local-v1", localPath: target, candidateDigest: request.candidateDigest as string,
              fileCount: files.length, totalBytes});
          } catch {phase = unknown || handles.size > 0 ? "unconfirmed" : "failed"; throw unavailable();}
          finally {finished = true;}
        },
        async discard() {
          fenced = true;
          if (phase === "discarded") return true;
          if (!closed() || phase === "writing" || phase === "discarding" || phase === "unconfirmed") return false;
          if (!creationAttempted || knownNoCreation) {phase = "discarded"; return true;}
          if (!leaf || !parent) return false;
          const previous = phase; phase = "discarding";
          try {
            if (await effect(() => Reflect.apply(functions.mayDiscard!, owner, [])) !== true) {phase = previous; return false;}
            need(inside(root, target) && sameDirectory(parent, await inspectDirectory(root, false)) && sameDirectory(leaf, await inspectDirectory(target, false)));
            const entries = await effect(() => readdir(target));
            need(entries.length === owned.size && entries.every(n => owned.has(path.join(target, n))));
            for (const name of entries) need(same(owned.get(path.join(target, name))!, fileFacts(await effect(() => lstat(path.join(target, name), {bigint: true})))));
            for (const name of entries) {
              need(await effect(() => Reflect.apply(functions.mayDiscard!, owner, [])) === true);
              const full = path.join(target, name); need(inside(target, full) && same(owned.get(full)!, fileFacts(await effect(() => lstat(full, {bigint: true})))));
              await effect(() => unlink(full)); owned.delete(full);
            }
            need(sameDirectory(leaf, await inspectDirectory(target, false))); await effect(() => rmdir(target)); phase = "discarded"; return true;
          } catch {phase = "unconfirmed"; return false;}
        }});
    } catch {return;}
  };
}
