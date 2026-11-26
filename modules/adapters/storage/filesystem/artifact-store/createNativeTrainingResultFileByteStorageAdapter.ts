/** Private logical bridge over trusted preloaded bindings, never Native attestation.
 * No loader or default host composition. Business/worker/global cleanup authority
 * remains the qualifying coordinator's responsibility. */
import {types} from "node:util";
import type {ApplicationRequestContext} from "../../../../application/ports/application-request-context";
import type {TrainingResultFileByteStoragePort} from "../../../../application/ports/model";
import {isOrganizationId} from "../../../../contracts/organization";
import {isWorkspaceId} from "../../../../contracts/workspace";
import {createContractError, readStrictPassiveRecord} from "../../../../contracts/shared";
import {createStoreArtifactFailureResult, createStoreArtifactSuccessResult} from "../../../../contracts/storage";
import {captureTrainingResultInventory} from "./trainingResultInventory";
import {verifiedPublicationStream} from "./verifiedPublicationStream";

const methods = ["createStore", "prepare", "append", "finishFile", "fence", "inspect", "openReader", "read", "closeReader", "discard"] as const;
const keys = ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"] as const;
const PromiseType = Promise, promisePrototype = Promise.prototype;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const unavailable = () => new Error("Private training publication is unavailable.");
function need(value: unknown): asserts value {if (value !== true) throw unavailable();}
function record(value: unknown, allowed: readonly string[]) {
  need(!!value && typeof value === "object" && !types.isProxy(value)); return readStrictPassiveRecord(value, allowed);
}
function integer(value: unknown, min: number, max: number): number {
  need(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function context(value: unknown) {
  try {
    const row = record(value, keys);
    need(Object.values(row).every(value => value === undefined || typeof value === "string" && value.length > 0 && value.length <= 256));
    need(isWorkspaceId(row.workspaceId));
    need(isOrganizationId(row.organizationId) && typeof row.principalId === "string" && row.principalId.length > 0);
    return Object.freeze(row) as Readonly<ApplicationRequestContext>;
  } catch {throw unavailable();}
}
function captureSource(value: unknown): AsyncIterable<Uint8Array> {
  need(!!value && typeof value === "object" && !types.isProxy(value));
  let at: object | null = value;
  for (let depth = 0; at && depth < 8; depth++, at = Object.getPrototypeOf(at)) {
    need(!types.isProxy(at)); const field = Object.getOwnPropertyDescriptor(at, Symbol.asyncIterator);
    if (field) {
      need("value" in field && typeof field.value === "function" && !types.isProxy(field.value));
      const iterate = field.value; return {[Symbol.asyncIterator]: () => Reflect.apply(iterate, value, [])};
    }
  }
  throw unavailable();
}
function observe(value: unknown) {
  need(types.isPromise(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === promisePrototype
    && Object.getOwnPropertyDescriptor(value, "constructor") === undefined
    && Object.getOwnPropertyDescriptor(promisePrototype, "constructor")?.value === PromiseType);
  const observed = (async () => {try {return {ok: true, value: await value};} catch {return {ok: false, value: undefined};}})();
  need(Object.getOwnPropertyDescriptor(value, "then") === undefined); return observed;
}

/** Native bindings are an installation-owned dependency, not client input.
 * Freezing/capturing them establishes local dispatch only, never their provenance.
 * No public route/barrel exposes this factory. */
function createOriginalPublication(options: {
  readonly nativeApi: unknown; readonly parentDirectory: string; readonly publicationId: string; readonly scopeDigest: string;
  readonly maximumFiles: number; readonly maximumFileBytes: number; readonly maximumTotalBytes: number;
  readonly maximumMetadataBytes: number; readonly maximumOperationMs: number; readonly context: ApplicationRequestContext;
}) {
  const supplied = record(options, ["nativeApi", "parentDirectory", "publicationId", "scopeDigest", "maximumFiles",
    "maximumFileBytes", "maximumTotalBytes", "maximumMetadataBytes", "maximumOperationMs", "context"]);
  need(Object.keys(supplied).length === 10);
  const actor = context(supplied.context), publicationId = supplied.publicationId;
  need(typeof publicationId === "string" && /^[a-f0-9]{32}$/.test(publicationId));
  need(typeof supplied.parentDirectory === "string" && supplied.parentDirectory.length > 0 && supplied.parentDirectory.length < 32700);
  need(typeof supplied.scopeDigest === "string" && /^[a-f0-9]{64}$/.test(supplied.scopeDigest));
  const maximumFiles = integer(supplied.maximumFiles, 1, 256), maximumTotalBytes = integer(supplied.maximumTotalBytes, 1, Number.MAX_SAFE_INTEGER);
  const maximumFileBytes = integer(supplied.maximumFileBytes, 1, maximumTotalBytes);
  const maximumMetadataBytes = integer(supplied.maximumMetadataBytes, 4096, 1024 * 1024);
  const maximumOperationMs = integer(supplied.maximumOperationMs, 1, 120000);
  const api = supplied.nativeApi;
  need(!!api && typeof api === "object" && !types.isProxy(api) && Object.getPrototypeOf(api) === Object.prototype && Object.isFrozen(api));
  const fields = Reflect.ownKeys(api); need(fields.length === methods.length && fields.every(key => typeof key === "string" && methods.includes(key as typeof methods[number])));
  const captured = Object.create(null) as Record<typeof methods[number], Function>;
  for (const name of methods) {
    const field = Object.getOwnPropertyDescriptor(api, name);
    // Node-API's frozen exports are intentionally non-enumerable.
    need(!!field && "value" in field && typeof field.value === "function" && !types.isProxy(field.value)); captured[name] = field.value;
  }
  Object.freeze(captured);
  const invoke = (name: typeof methods[number], args: unknown[]) => Reflect.apply(captured[name], api, args);
  const synchronous = (name: typeof methods[number], args: unknown[]) => {
    const value = invoke(name, args);
    if (types.isPromise(value)) {try {void observe(value);} catch {/* Unknown synchronous result. */} throw unavailable();}
    return value;
  };
  let store: unknown;
  try {store = synchronous("createStore", [supplied.parentDirectory, publicationId, supplied.scopeDigest,
    maximumFiles, maximumFileBytes, maximumTotalBytes, maximumMetadataBytes, maximumOperationMs]);}
  catch {throw unavailable();}
  const opaque = (value: unknown) => need(!!value && typeof value === "object" && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.isFrozen(value) && Reflect.ownKeys(value).length === 0);
  opaque(store);
  let fenced = false, unknownOperation = false, publicationUnconfirmed = false, capturedRetirement = false;
  let preparing = false, prepareAttempted = false, writing = false, reader: object | undefined, discardIssued = false;
  let phase: "open" | "checking" | "writing" | "unconfirmed" = "open", attempted = 0, acknowledged = 0, declared = 0;
  let inventory: ReturnType<typeof captureTrainingResultInventory> | undefined;
  const pending = new Set<object>();
  const nativeState = (): Readonly<Record<string, unknown>> => {
    try {
    const row = record(synchronous("inspect", [store]), ["pending", "fenced", "uncertain", "prepared", "closed", "completedFiles", "readers", "stage", "diagnostics"]);
    need(Object.keys(row).length === 9 && [row.pending, row.fenced, row.uncertain, row.prepared, row.closed].every(value => typeof value === "boolean"));
    integer(row.completedFiles, 0, maximumFiles); integer(row.readers, 0, 1); integer(row.stage, 0, 14);
    const diagnostics = record(row.diagnostics, ["sealStep", "nativeStatus", "permissionBits", "permissionControl", "grantedAccess"]);
    need(Object.keys(diagnostics).length === 5);
    for (const [key, max] of [["sealStep", 6], ["nativeStatus", 0xffffffff], ["permissionBits", 15], ["permissionControl", 0x150c], ["grantedAccess", 0xffffffff]] as const)
      integer(diagnostics[key], 0, max);
    need(((diagnostics.permissionControl as number) & ~0x150c) === 0);
    return Object.freeze({...row, diagnostics: Object.freeze(diagnostics)});
    } catch {unknownOperation = true; throw unavailable();}
  };
  const initial = nativeState();
  need(!initial.pending && !initial.fenced && !initial.uncertain && !initial.prepared && !initial.closed && initial.completedFiles === 0 && initial.readers === 0);
  const match = (value: ApplicationRequestContext, publication = false) => {
    const row = context(value);
    need((publication ? keys : ["workspaceId", "organizationId", "principalId"] as const).every(key => row[key] === actor[key])); return row;
  };
  const original = async (name: typeof methods[number], args: unknown[]) => {
    need(pending.size === 0); const token = {}; pending.add(token);
    let observed: ReturnType<typeof observe>;
    try {observed = observe(invoke(name, args));} catch {unknownOperation = true; throw unavailable();}
    const result = await observed; pending.delete(token);
    if (!result.ok) throw unavailable();
    if (name !== "read" && result.value !== true) {unknownOperation = true; throw unavailable();}
    return result.value;
  };
  const fence = () => {
    if (fenced) {need(!unknownOperation); return;}
    fenced = true;
    try {need(synchronous("fence", [store]) === true); need(nativeState().fenced === true);}
    catch {unknownOperation = true; throw unavailable();}
  };
  const writable = () => {
    const state = nativeState(); need(!fenced && !unknownOperation && !state.fenced && !state.closed && !state.uncertain);
  };
  const fail = () => {publicationUnconfirmed = true; phase = "unconfirmed"; try {fence();} catch {/* Retain the unknown owner. */}};
  const storage = Object.freeze<TrainingResultFileByteStoragePort>({
    captureIoRetirement(input, suppliedContext) {
      const requested = record(input, ["publicationId"]); match(suppliedContext, true);
      need(Object.keys(requested).length === 1 && requested.publicationId === publicationId && !capturedRetirement && !prepareAttempted && !fenced);
      capturedRetirement = true;
      return Object.freeze({fencePublication() {fence();}, inspect() {
        let state: ReturnType<typeof nativeState> | undefined;
        try {state = nativeState();} catch {unknownOperation = true;}
        const active = preparing || writing || pending.size > 0 || state?.pending === true;
        const uncertain = unknownOperation || !state || state.uncertain === true;
        return Object.freeze({schema: "training-result-file-io-retirement-v1" as const, publicationId, publicationFenced: fenced,
          phase: uncertain ? "unconfirmed" as const : !fenced ? "open" as const : active ? "pending" as const : "closed" as const,
          fileCount: attempted, pendingOperations: pending.size + (preparing || writing ? 1 : 0), publicationUnconfirmed: publicationUnconfirmed || uncertain, declaredPayloadBytes: declared});
      }});
    },
    inspectPublication() {return Object.freeze({phase, attemptedFileCount: attempted, acknowledgedFileCount: acknowledged, declaredPayloadBytes: declared});},
    async preparePublication(input, suppliedContext) {
      match(suppliedContext, true); writable(); need(!prepareAttempted && phase === "open");
      prepareAttempted = true; preparing = true; phase = "checking";
      try {
        inventory = captureTrainingResultInventory(input, {maximumFiles, maximumFileBytes, maximumTotalBytes});
        need(inventory.publicationId === publicationId);
        need(await original("prepare", [store, inventory.encoded]) === true); writable();
        const state = nativeState(); need(state.prepared === true && state.pending === false && state.completedFiles === 0);
        phase = "open";
      } catch {fail(); throw unavailable();} finally {preparing = false;}
    },
    async publishResultFile(input, suppliedContext) {
      let accepted = false;
      try {
        const suppliedActor = match(suppliedContext, true); writable(); need(!!inventory && phase === "open" && !preparing && !writing);
        const row = record(input, ["fileIndex", "mediaType", "content", "expectedSizeBytes", "expectedSha256"]);
        need(Object.keys(row).length === 5 && row.fileIndex === acknowledged);
        const expected = inventory.files[acknowledged]; need(!!expected && row.mediaType === expected.mediaType
          && row.expectedSizeBytes === expected.expectedSizeBytes && row.expectedSha256 === expected.expectedSha256);
        const source = captureSource(row.content);
        const bounded = async function* () {for await (const part of source) {
          writable(); need(types.isUint8Array(part) && !types.isProxy(part));
          integer(byteLength.call(part), 1, 8192); yield part;
        }};
        const verified = verifiedPublicationStream({content: bounded(), maximumBytes: expected.expectedSizeBytes,
          expectedSizeBytes: expected.expectedSizeBytes, expectedSha256: expected.expectedSha256}, maximumFileBytes);
        accepted = true; writing = true; phase = "writing"; attempted++; declared += expected.expectedSizeBytes;
        for await (const part of verified.content) {
          writable(); const owned = Buffer.alloc(byteLength.call(part)); Uint8Array.prototype.set.call(owned, part);
          need(await original("append", [store, expected.fileIndex, owned]) === true); writable();
        }
        writable(); const complete = verified.result();
        need(await original("finishFile", [store, expected.fileIndex]) === true); writable();
        need(nativeState().completedFiles === acknowledged + 1); acknowledged++; phase = "open";
        return createStoreArtifactSuccessResult({key: `workspaces/${actor.workspaceId}/artifacts/training-results/${publicationId}/${expected.fileIndex}`,
          mediaType: expected.mediaType, sizeBytes: complete.sizeBytes, checksum: {algorithm: "sha256", value: complete.digest.slice(7)}}, suppliedActor);
      } catch {
        if (accepted) fail();
        return createStoreArtifactFailureResult(createContractError("unavailable", "Training result file storage could not be confirmed. The owning task must retain its data and reservation."), actor);
      } finally {if (accepted) writing = false;}
    },
  });
  // Local original-handle capabilities only. A qualifying coordinator must
  // independently gate reads/cleanup; these return no global credit or approval.
  const owner = Object.freeze({fencePublication: fence, inspect() {return Object.freeze({...nativeState(), publicationId, unknownOperation});},
    inspectFinalizedFiles(suppliedContext: ApplicationRequestContext) {
      match(suppliedContext);
      need(fenced && !preparing && !writing && !unknownOperation && !publicationUnconfirmed && pending.size === 0
        && !reader && !!inventory && acknowledged === inventory.files.length);
      const state = nativeState();
      need(state.fenced === true && state.prepared === true && !state.pending && !state.closed && !state.uncertain
        && state.readers === 0 && state.completedFiles === inventory.files.length);
      // File ACKs are not the receiver's final delivery ACK, task success,
      // worker retirement or review/Save authority. Never disclose encoded.
      return Object.freeze({schema: "training-result-finalized-files-v1" as const, publicationId,
        totalBytes: inventory.totalBytes, files: Object.freeze(inventory.files.map(file => Object.freeze({...file,
          key: `workspaces/${actor.workspaceId}/artifacts/training-results/${publicationId}/${file.fileIndex}`})))});
    },
    openReader(fileIndex: number, suppliedContext: ApplicationRequestContext) {
      match(suppliedContext); need(fenced && !preparing && !writing && !unknownOperation && pending.size === 0 && !reader && !!inventory && acknowledged === inventory.files.length);
      integer(fileIndex, 0, inventory.files.length - 1);
      const state = nativeState(); need(!state.pending && !state.closed && !state.uncertain && state.readers === 0 && state.completedFiles === inventory.files.length);
      let originalReader: unknown;
      try {originalReader = synchronous("openReader", [store, fileIndex]); opaque(originalReader);} catch {unknownOperation = true; throw unavailable();}
      const token = {}; reader = token; let closed = false;
      return Object.freeze({async read(maximumBytes = 8192): Promise<Buffer> {
        need(!closed && reader === token && !unknownOperation && pending.size === 0); integer(maximumBytes, 1, 8192);
        try {
          const value = await original("read", [originalReader, maximumBytes]);
          need(!types.isProxy(value) && Buffer.isBuffer(value)); const length = integer(byteLength.call(value), 0, maximumBytes);
          const owned = Buffer.alloc(length); Uint8Array.prototype.set.call(owned, value); return owned;
        } catch {unknownOperation = true; throw unavailable();}
      }, close() {
        need(!closed && reader === token && !unknownOperation && pending.size === 0);
        try {need(synchronous("closeReader", [originalReader]) === true); closed = true; reader = undefined;}
        catch {unknownOperation = true; throw unavailable();}
      }});
    },
    async discard(suppliedContext: ApplicationRequestContext): Promise<void> {
      match(suppliedContext); need(fenced && !preparing && !writing && !unknownOperation && pending.size === 0 && !reader && !discardIssued);
      const state = nativeState(); need(!state.pending && !state.uncertain && state.readers === 0 && !state.closed);
      discardIssued = true;
      try {need(await original("discard", [store]) === true); const after = nativeState(); need(after.closed === true && after.pending === false);}
      catch {unknownOperation = true; throw unavailable();}
    }});
  return Object.freeze({storage, originalOwner: owner});
}

export function createNativeTrainingResultFileByteStorageAdapter(options: Parameters<typeof createOriginalPublication>[0]) {
  try {return createOriginalPublication(options);} catch {throw unavailable();}
}
