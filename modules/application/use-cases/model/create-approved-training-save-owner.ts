import {types} from "node:util";
import path from "node:path";
import type {ApplicationRequestContext} from "../../ports";
import type {ApprovedLocalTrainingControl, ApprovedLocalTrainingCandidateReview, ApprovedLocalTrainingSaveRequest,
  ApprovedLocalTrainingSaveSession, ApprovedLocalTrainingSavePreparation, GeneratedModelStoragePort,
  ReviewedGeneratedModelControl, ReviewedGeneratedModelStorageSession} from "../../ports/model";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {hasKnownPassiveCredential, readStrictPassiveRecord, copyBoundedPassiveData} from "../../../contracts/shared";

const unavailable = () => new Error("The original training Save is unavailable.");
function need(value: unknown): asserts value {if (value !== true) throw unavailable();}
function record(value: unknown, keys: readonly string[]) {need(!!value && typeof value === "object" && !types.isProxy(value)); return readStrictPassiveRecord(value, keys);}
function capture<T extends (...args: any[]) => any>(owner: object, key: string): T {
  const row = record(owner, Reflect.ownKeys(owner).filter((k): k is string => typeof k === "string"));
  const fn = row[key]; need(typeof fn === "function" && !types.isProxy(fn));
  return ((...args: unknown[]) => Reflect.apply(fn, owner, args)) as T;
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const native = (p: unknown): p is Promise<unknown> => types.isPromise(p) && !types.isProxy(p) && Object.getPrototypeOf(p) === Promise.prototype &&
  !Object.getOwnPropertyDescriptor(p, "then") && !Object.getOwnPropertyDescriptor(p, "constructor");
const NativePromise = Promise, nativePrototype = Promise.prototype, intrinsicThen = Promise.prototype.then;
const nativeSpecies = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species);
/** Observe only an ordinary native Promise with a verified intrinsic species
 * path. Never call its own then/constructor hooks, assimilate a thenable, mutate
 * the original or install a process-wide rejection handler. */
function observeNative(value: unknown, settled: () => void): Promise<{ok: boolean; value?: unknown}> | undefined {
  if (!types.isPromise(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== nativePrototype) return;
  const own = Object.getOwnPropertyDescriptor(value, "constructor"), inherited = Object.getOwnPropertyDescriptor(nativePrototype, "constructor"),
    species = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species);
  if (own && (!("value" in own) || own.value !== undefined && own.value !== NativePromise) ||
      !inherited || !("value" in inherited) || inherited.value !== NativePromise || !species ||
      species.get !== nativeSpecies?.get || species.set !== nativeSpecies?.set || species.value !== nativeSpecies?.value) return;
  let observer: Promise<{ok: boolean; value?: unknown}> | undefined;
  let attached = false;
  try {
    observer = new NativePromise(resolve => {
      try {
        Reflect.apply(intrinsicThen, value, [
          (result: unknown) => {settled(); resolve({ok: true, value: result});},
          () => {settled(); resolve({ok: false});},
        ]);
        attached = true;
      } catch {resolve({ok: false});}
    });
  } catch {return;}
  return attached ? observer : undefined;
}
function freeze<T>(v: T): T {if (v && typeof v === "object") {for (const c of Object.values(v)) freeze(c); Object.freeze(v);} return v;}
const copy = <T,>(v: T): T => copyBoundedPassiveData(v) as T;

/** Original application closures only. No public request can configure these
 * callbacks, a source path or a storage provider. Construction does no IO. */
export function createApprovedTrainingSaveOwner(options: {
  readonly taskId: string; readonly context: ApplicationRequestContext;
  readonly isOriginalCurrent: () => boolean; readonly stillOriginalAllowed: () => Promise<boolean>;
  readonly review: (control: ApprovedLocalTrainingControl) => Promise<ApprovedLocalTrainingCandidateReview>;
  readonly sourceDirectory: () => Promise<string>;
  readonly createStorage: NonNullable<GeneratedModelStoragePort["createReviewedSession"]>;
}) {
  const {taskId, isOriginalCurrent, stillOriginalAllowed, review, sourceDirectory, createStorage} = options;
  const context = copy(options.context);
  const workspaceId = context.workspaceId;
  need(uuid(taskId) && isOrganizationId(context.organizationId) && isWorkspaceId(workspaceId) &&
    typeof context.principalId === "string" && !!context.principalId && [isOriginalCurrent, stillOriginalAllowed, review, sourceDirectory, createStorage].every(f => typeof f === "function" && !types.isProxy(f)));
  let bound = false;
  return (raw: ApprovedLocalTrainingSaveRequest, rawControl: ReviewedGeneratedModelControl): ApprovedLocalTrainingSaveSession | undefined => {
    if (bound) return;
    try {
      const input = record(raw, ["saveId", "candidateDigest", "name"]);
      need(Object.keys(input).length === 3 && uuid(input.saveId) && digest(input.candidateDigest) &&
        typeof input.name === "string" && input.name.trim() === input.name && input.name.length > 0 && input.name.length <= 120 &&
        !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(input.name) && ![".", ".."].includes(input.name) && !hasKnownPassiveCredential(input.name) &&
        !/\b(?:token|secret|password|api[_-]?key|authorization)\s*[:=]/i.test(input.name));
      need(Object.keys(record(rawControl, ["isCurrent", "stillAllowed", "mayDiscard"])).length === 3);
      const callerCurrent = capture<() => boolean>(rawControl, "isCurrent"), callerAllowed = capture<() => Promise<boolean>>(rawControl, "stillAllowed"),
        cleanupAllowed = capture<() => Promise<boolean>>(rawControl, "mayDiscard");
      const request = freeze({...input}) as unknown as ApprovedLocalTrainingSaveRequest;
      let phase: ReturnType<ApprovedLocalTrainingSaveSession["inspect"]>["phase"] = "bound", fenced = false, unknown = false, finished = true;
      const pending = new Set<object>(), retained: unknown[] = [];
      let storage: ReviewedGeneratedModelStorageSession | undefined, storageWrite: (() => ReturnType<ReviewedGeneratedModelStorageSession["write"]>) | undefined,
        storageInspect: (() => unknown) | undefined, storageFence: (() => unknown) | undefined, storageDiscard: (() => Promise<boolean>) | undefined;
      let fenceAttempted = false;
      const synchronous = (value: unknown) => {
        if (types.isPromise(value) && !types.isProxy(value)) {
          const token: {original: unknown; observation?: unknown} = {original: value}; pending.add(token); retained.push(token);
          token.observation = observeNative(value, () => pending.delete(token)); unknown = true; phase = "unconfirmed"; throw unavailable();
        }
        return value;
      };
      const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
        const token: {original?: unknown; observation?: Promise<unknown>} = {}; pending.add(token);
        let original: unknown;
        try {original = operation(); token.original = original;}
        catch {unknown = true; throw unavailable();}
        const observation = observeNative(original, () => pending.delete(token)); token.observation = observation;
        if (!observation || !native(original)) {unknown = true; throw unavailable();}
        const result = await observation; if (!result.ok) throw unavailable(); return result.value as T;
      };
      const check = () => {
        need(!fenced && !unknown); const original = synchronous(isOriginalCurrent()), caller = synchronous(callerCurrent());
        for (const value of [original, caller]) if (typeof value !== "boolean") {
          unknown = true; retained.push(value);
        }
        need(original === true && caller === true && !fenced && !unknown);
      };
      const allowed = async () => {check(); need(await invoke(stillOriginalAllowed) === true); check(); need(await invoke(callerAllowed) === true); check();};
      const current = () => {try {check(); return true;} catch {return false;}};
      const permissionControl = Object.freeze({isCurrent: current,
        stillAllowed: async () => {try {await allowed(); return true;} catch {return false;}}});
      const inspectCopy = (): ReturnType<ReviewedGeneratedModelStorageSession["inspect"]> | undefined => {
        if (!storageInspect) return;
        if (unknown) throw unavailable();
        try {
          const value = synchronous(storageInspect()), r = record(value, ["phase", "fenced", "pendingOperations", "openFiles", "ioClosed", "declaredPayloadBytes", "physicalQuotaEnforced"]);
          need(Object.keys(r).length === 7 && ["bound", "writing", "ready", "failed", "discarding", "discarded", "unconfirmed"].includes(r.phase as string) &&
            typeof r.fenced === "boolean" && typeof r.ioClosed === "boolean" && r.physicalQuotaEnforced === false &&
            [r.pendingOperations, r.openFiles, r.declaredPayloadBytes].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) &&
            (r.ioClosed !== true || r.pendingOperations === 0 && r.openFiles === 0 && r.phase !== "writing" && r.phase !== "discarding"));
          return Object.freeze({...r}) as ReturnType<ReviewedGeneratedModelStorageSession["inspect"]>;
        } catch {unknown = true; phase = "unconfirmed"; throw unavailable();}
      };
      const closed = () => finished && !unknown && pending.size === 0 && (!storage || inspectCopy()?.ioClosed === true);
      const fenceCopy = () => {
        if (!storageFence || fenceAttempted) return; fenceAttempted = true;
        try {need(synchronous(storageFence()) === undefined);} catch {unknown = true; phase = "unconfirmed";}
      };
      const fence = () => {fenced = true; fenceCopy();};
      const session: ApprovedLocalTrainingSaveSession = Object.freeze({
        fence,
        isCurrent() {try {return phase === "ready" && current() && inspectCopy()?.phase === "ready" && inspectCopy()?.fenced === false && closed();} catch {return false;}},
        inspect() {let ioClosed = false; try {ioClosed = closed();} catch {unknown = true; phase = "unconfirmed";}
          return Object.freeze({phase, fenced, pendingOperations: pending.size, ioClosed});},
        async write(): Promise<ApprovedLocalTrainingSavePreparation> {
          need(phase === "bound" && !fenced); phase = "preparing"; finished = false;
          try {
            await allowed(); check();
            const candidate = freeze(copy(await invoke(() => review(permissionControl))));
            need(candidate.kind === "ready" && candidate.requestId === taskId && candidate.workspaceId === context.workspaceId && candidate.candidateDigest === request.candidateDigest);
            await allowed(); check(); const source = await invoke(sourceDirectory); check();
            need(typeof source === "string" && path.isAbsolute(source) && path.normalize(source) === source && path.parse(source).root !== source);
            const files = candidate.retainedFiles.files.filter(f => f.role === "candidate").map(({name, expectedSizeBytes, expectedSha256}) => ({name, expectedSizeBytes, expectedSha256}));
            need(files.length >= 3 && candidate.history.candidate.artifactForm !== null && ["full-model", "adapter"].includes(candidate.history.candidate.artifactForm));
            await allowed(); check();
            storage = createStorage({taskId, saveId: request.saveId, candidateDigest: request.candidateDigest, sourceDirectory: source,
              artifactForm: candidate.history.candidate.artifactForm as "full-model" | "adapter", files}, {...context, requestId: request.saveId},
              Object.freeze({...permissionControl, mayDiscard: () => invoke(cleanupAllowed)}));
            synchronous(storage);
            need(!!storage); // Retain the original returned owner before reflection.
            const row = record(storage, ["storageProfile", "write", "fence", "inspect", "discard"]); need(Object.keys(row).length === 5 && row.storageProfile === "bounded-local-v1");
            storageFence = capture(storage, "fence"); storageInspect = capture(storage, "inspect"); storageDiscard = capture(storage, "discard"); storageWrite = capture(storage, "write");
            check(); const result = copy(await invoke(storageWrite)); check();
            const stored = record(result, ["storageProfile", "localPath", "candidateDigest", "fileCount", "totalBytes"]);
            need(Object.keys(stored).length === 5 && stored.storageProfile === "bounded-local-v1" && stored.candidateDigest === request.candidateDigest && stored.fileCount === files.length &&
              stored.totalBytes === files.reduce((n, f) => n + f.expectedSizeBytes, 0) && typeof stored.localPath === "string" && path.isAbsolute(stored.localPath) &&
              path.normalize(stored.localPath) === stored.localPath && path.parse(stored.localPath).root !== stored.localPath && stored.localPath !== source &&
              inspectCopy()?.phase === "ready" && inspectCopy()?.fenced === false && inspectCopy()?.ioClosed === true);
            await allowed(); check();
            phase = "ready";
            return freeze({schema: "approved-training-save-preparation-v1", taskId, workspaceId, saveId: request.saveId,
              name: request.name, candidate, storage: result});
          } catch {
            try {fenceCopy(); if (storage && (!storageInspect || inspectCopy()?.ioClosed !== true)) unknown = true;} catch {unknown = true;}
            phase = unknown ? "unconfirmed" : "failed"; throw unavailable();
          } finally {finished = true;}
        },
        async discard() {
          try {
            fence(); if (phase === "discarded") return true;
            if (!closed() || phase === "preparing" || phase === "unconfirmed") return false;
            if (!storage) {phase = "discarded"; return true;}
            need(!!storageDiscard); const removed = await invoke(storageDiscard);
            if (removed !== true || !closed()) return false;
            phase = "discarded"; return true;
          } catch {phase = "unconfirmed"; unknown = true; return false;}
        }});
      bound = true; return session;
    } catch {return;}
  };
}
