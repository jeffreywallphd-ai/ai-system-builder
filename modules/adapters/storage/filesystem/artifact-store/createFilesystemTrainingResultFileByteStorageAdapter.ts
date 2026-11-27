import type {ApplicationRequestContext} from "../../../../application/ports";
import {types} from "node:util";
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open, statfs, type FileHandle} from "node:fs/promises";
import path from "node:path";
import type {TrainingResultFileByteStoragePort, TrainingResultFinalizedFiles, TrainingResultFileIoRetirement,
  TrainingResultRetainedFileVerificationPort} from "../../../../application/ports/model";
import type {OrganizationRequestContextProviderPort} from "../../../../application/ports/organization";
import {isOrganizationId} from "../../../../contracts/organization";
import {createContractError, readStrictPassiveRecord} from "../../../../contracts/shared";
import {createStoreArtifactFailureResult, createStoreArtifactSuccessResult} from "../../../../contracts/storage";
import {createWorkspaceId, isWorkspaceId} from "../../../../contracts/workspace";
import {writeContainedFileStream, createContainedFileStreamLifetime, inspectContainedFileStreamLifetime, statContainedFile,
  type ContainedFileStreamLifetime} from "../../../filesystem-security";
import {resolveOrganizationStorageKey} from "../organizationStorageScope";
import {verifiedPublicationStream} from "./verifiedPublicationStream";
import {captureTrainingResultInventory} from "./trainingResultInventory";

function need(value: unknown): asserts value {
  if (value !== true) throw new Error("Private training publication is unavailable.");
}
function positive(value: unknown): value is number {return typeof value === "number" && Number.isSafeInteger(value) && value > 0;}

function captureOrganization(value: unknown) {
  need(!!value && typeof value === "object" && !types.isProxy(value));
  const organization = Object.getOwnPropertyDescriptor(value, "organizationId");
  const principal = Object.getOwnPropertyDescriptor(value, "principalId");
  need(!!organization && "value" in organization && isOrganizationId(organization.value) &&
    !!principal && "value" in principal && typeof principal.value === "string" && principal.value.length > 0);
  return {organizationId: organization.value, principalId: principal.value};
}

function captureStream(source: unknown): AsyncIterable<Uint8Array> {
  need(!!source && (typeof source === "object" || typeof source === "function") && !types.isProxy(source));
  let current = source;
  for (let depth = 0; current && depth < 8; depth++, current = Object.getPrototypeOf(current)) {
    need(!types.isProxy(current));
    const descriptor = Object.getOwnPropertyDescriptor(current, Symbol.asyncIterator);
    if (descriptor) {
      need("value" in descriptor && typeof descriptor.value === "function");
      const iterate = descriptor.value;
      return {[Symbol.asyncIterator]: () => Reflect.apply(iterate, source, [])};
    }
  }
  throw new Error("Private training publication is unavailable.");
}

/** Cooperative byte publication only. Mandatory bounds are not a measured or
 * exclusive reservation. No production producer/Root or metadata is configured.
 * The existing contained writer retains its existing temporary-file semantics. */
export function createFilesystemTrainingResultFileByteStorageAdapter(options: {
  readonly rootDirectory: string;
  readonly publicationId: string;
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumFiles: number;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
  readonly trackIoRetirement?: boolean;
}): TrainingResultFileByteStoragePort {
  const {rootDirectory, publicationId, maximumFileBytes, maximumTotalBytes, maximumFiles, organizationContextProvider, trackIoRetirement} = options;
  need(typeof rootDirectory === "string" && rootDirectory.length > 0 &&
    typeof publicationId === "string" && /^[a-f0-9]{32}$/.test(publicationId) &&
    positive(maximumFileBytes) && positive(maximumTotalBytes) && maximumFileBytes <= maximumTotalBytes &&
    positive(maximumFiles) && maximumFiles <= 256 && (trackIoRetirement === undefined || typeof trackIoRetirement === "boolean"));
  const getOrganization = organizationContextProvider?.getCurrentOrganizationContext.bind(organizationContextProvider);
  let phase: "open" | "checking" | "writing" | "unconfirmed" = "open";
  let scope: {workspaceId: string; organizationId: string | undefined} | undefined;
  let declaredPayloadBytes = 0, acknowledgedFileCount = 0;
  const attempted = new Set<number>();
  const lifetimes: ContainedFileStreamLifetime[] = [];
  let publicationFenced = false, retirementCaptured = false;
  let retirementScope: Readonly<ApplicationRequestContext> | undefined;
  const captureContext = (supplied: ApplicationRequestContext) => {
    need(!!supplied && !types.isProxy(supplied));
    const context = readStrictPassiveRecord(supplied, ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"]);
    need(Object.values(context).every(value => value === undefined || typeof value === "string" && value.length > 0 && value.length <= 256));
    createWorkspaceId(context.workspaceId as string);
    need(context.organizationId === undefined || isOrganizationId(context.organizationId));
    return Object.freeze(context) as Readonly<ApplicationRequestContext>;
  };
  return {
    ...(trackIoRetirement === true ? {captureIoRetirement(input: {readonly publicationId: string}, supplied: ApplicationRequestContext) {
      need(!types.isProxy(input)); const request = readStrictPassiveRecord(input, ["publicationId"]);
      need(Object.keys(request).length === 1 && request.publicationId === publicationId &&
        !retirementCaptured && !publicationFenced && phase === "open" && attempted.size === 0);
      const captured = captureContext(supplied); retirementCaptured = true; retirementScope = captured;
      return Object.freeze({fencePublication() {publicationFenced = true;}, inspect() {
        const observations = lifetimes.map(owner => inspectContainedFileStreamLifetime(owner));
        const pendingOperations = observations.reduce((sum, row) => sum + row.pendingOperations, 0);
        const pending = phase === "checking" || phase === "writing" || observations.some(row => row.phase === "active");
        const unknown = observations.some(row => row.phase === "unconfirmed" || row.phase === "unused");
        return Object.freeze({schema: "training-result-file-io-retirement-v1" as const, publicationId,
          publicationFenced, phase: !publicationFenced ? "open" as const : pending ? "pending" as const : unknown ? "unconfirmed" as const : "closed" as const,
          fileCount: lifetimes.length, pendingOperations, publicationUnconfirmed: phase === "unconfirmed", declaredPayloadBytes});
      }});
    }} : {}),
    inspectPublication() {return {phase, attemptedFileCount: attempted.size, acknowledgedFileCount, declaredPayloadBytes};},
    async publishResultFile(input: Parameters<TrainingResultFileByteStoragePort["publishResultFile"]>[0], supplied: ApplicationRequestContext) {
      let context: ApplicationRequestContext = {}, checking = false, issued = false;
      try {
        // Inspect only data descriptors: a request accessor cannot run before
        // the original local admission is reserved.
        need(!types.isProxy(input));
        const request = readStrictPassiveRecord(input, ["fileIndex", "mediaType", "content", "expectedSizeBytes", "expectedSha256"]);
        const {fileIndex, mediaType, content, expectedSizeBytes, expectedSha256} = request;
        need(typeof fileIndex === "number" && Number.isSafeInteger(fileIndex) && fileIndex >= 0 && fileIndex < maximumFiles &&
          (mediaType === "application/json" || mediaType === "application/octet-stream") &&
          positive(expectedSizeBytes) && expectedSizeBytes <= maximumFileBytes &&
          typeof expectedSha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(expectedSha256));
        need(!publicationFenced && phase === "open" && !attempted.has(fileIndex) && expectedSizeBytes <= maximumTotalBytes - declaredPayloadBytes);
        phase = "checking"; checking = true;
        const source = captureStream(content);
        context = trackIoRetirement === true ? captureContext(supplied) : {...supplied};
        need(!retirementScope || ["workspaceId", "organizationId", "principalId", "requestId", "correlationId"].every(key =>
          context[key as keyof ApplicationRequestContext] === retirementScope![key as keyof ApplicationRequestContext]));
        const workspaceId = createWorkspaceId(context.workspaceId!);
        // Freeze caller/provider scope and request scalars before any stream or
        // writer await. Later mutations cannot redirect this private copy.
        const organization = getOrganization ? captureOrganization(getOrganization()) : undefined;
        need(!publicationFenced); // A captured provider callback can request cleanup.
        need(context.organizationId === undefined || isOrganizationId(context.organizationId));
        need(!getOrganization || organization!.organizationId === context.organizationId);
        const organizationId = organization?.organizationId ?? context.organizationId;
        need(!scope || scope.workspaceId === workspaceId && scope.organizationId === organizationId);
        const key = `workspaces/${workspaceId}/artifacts/training-results/${publicationId}/${fileIndex}`;
        const scopedKey = resolveOrganizationStorageKey(key, organization ? {getCurrentOrganizationContext: () => organization} : undefined);
        const verified = verifiedPublicationStream({content: source,
          expectedSizeBytes, expectedSha256, maximumBytes: expectedSizeBytes}, maximumFileBytes);
        scope ??= {workspaceId, organizationId};
        attempted.add(fileIndex); declaredPayloadBytes += expectedSizeBytes;
        phase = "writing"; issued = true;
        const lifetime = trackIoRetirement === true ? createContainedFileStreamLifetime() : undefined;
        if (lifetime) lifetimes.push(lifetime); // Retain before the first writer await.
        const written = await writeContainedFileStream({rootDirectory, key: scopedKey, content: verified.content,
          maximumBytes: expectedSizeBytes, overwrite: false}, lifetime);
        const verifiedResult = verified.result();
        need(written.key === scopedKey && written.sizeBytes === verifiedResult.sizeBytes);
        const result = createStoreArtifactSuccessResult({key, mediaType, sizeBytes: verifiedResult.sizeBytes,
          checksum: {algorithm: "sha256", value: verifiedResult.digest.slice(7)}}, context);
        acknowledgedFileCount++; phase = "open";
        return result;
      } catch {
        // An accepted write may have published before its acknowledgement was
        // lost. Retain all declarations and fence the whole publication. Never
        // overwrite/adopt, repeat a copy or compensate a published target.
        if (issued) phase = "unconfirmed";
        else if (checking) phase = "open";
        return createStoreArtifactFailureResult(createContractError("unavailable",
          "Training result file storage could not be confirmed. The owning task must retain its data and reservation."), context);
      }
    },
  };
}

/** Explicit trusted-local composition over the unchanged contained byte writer.
 * The original owner records acknowledged files, not protected global capacity,
 * current file integrity, receiver completion, worker exit or Save authority. */
export function createFilesystemLocalTrainingResultPublication(options: {
  readonly rootDirectory: string;
  readonly publicationId: string;
  readonly context: ApplicationRequestContext;
  readonly limits: {readonly maximumFiles: number; readonly maximumFileBytes: number;
    readonly maximumTotalBytes: number; readonly minimumFreeBytes: number; readonly maximumDurationMs: number};
  readonly control: {assertCurrent(): void; assertAllowed(): Promise<void>};
}): {readonly storage: TrainingResultFileByteStoragePort; readonly originalOwner: TrainingResultRetainedFileVerificationPort & {
  fencePublication(): void;
  inspectFinalizedFiles(context: ApplicationRequestContext): TrainingResultFinalizedFiles;
}} {
  const record = (raw: unknown, keys: readonly string[]) => {
    need(!!raw && typeof raw === "object" && !types.isProxy(raw));
    const value = readStrictPassiveRecord(raw, keys); need(Object.keys(value).length === keys.length); return value;
  };
  const settings = record(options, ["rootDirectory", "publicationId", "context", "limits", "control"]);
  const {rootDirectory, publicationId} = settings;
  need(typeof rootDirectory === "string" && path.isAbsolute(rootDirectory) && path.resolve(rootDirectory) === rootDirectory &&
    path.parse(rootDirectory).root !== rootDirectory && !/^[\\/]{2}/.test(rootDirectory) &&
    typeof publicationId === "string" && /^[a-f0-9]{32}$/.test(publicationId));
  const scope = readStrictPassiveRecord(settings.context, ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"]);
  need(Object.values(scope).every(value => value === undefined || typeof value === "string" && value.length > 0 && value.length <= 256));
  need(isOrganizationId(scope.organizationId) && typeof scope.principalId === "string" && typeof scope.requestId === "string");
  need(isWorkspaceId(scope.workspaceId)); Object.freeze(scope);
  const match = (supplied: ApplicationRequestContext) => {
    need(!!supplied && !types.isProxy(supplied));
    const actual = readStrictPassiveRecord(supplied, ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"]);
    need(["requestId", "correlationId", "organizationId", "principalId", "workspaceId"].every(key => actual[key] === scope[key]));
  };
  const limits = record(settings.limits, ["maximumFiles", "maximumFileBytes", "maximumTotalBytes", "minimumFreeBytes", "maximumDurationMs"]);
  need(Object.values(limits).every(positive) && (limits.maximumFiles as number) <= 256 &&
    (limits.maximumFileBytes as number) <= (limits.maximumTotalBytes as number) && (limits.maximumDurationMs as number) <= 86_400_000 &&
    (limits.minimumFreeBytes as number) <= Number.MAX_SAFE_INTEGER - (limits.maximumTotalBytes as number));
  const controls = record(settings.control, ["assertCurrent", "assertAllowed"]);
  need(Object.values(controls).every(value => typeof value === "function" && !types.isProxy(value)));
  need(!types.isAsyncFunction(controls.assertCurrent) && !types.isGeneratorFunction(controls.assertCurrent));
  const assertCurrent = controls.assertCurrent as Function, assertAllowed = controls.assertAllowed as Function;
  const organization = Object.freeze({organizationId: scope.organizationId, principalId: scope.principalId});
  const base = createFilesystemTrainingResultFileByteStorageAdapter({rootDirectory, publicationId,
    maximumFiles: limits.maximumFiles as number, maximumFileBytes: limits.maximumFileBytes as number,
    maximumTotalBytes: limits.maximumTotalBytes as number, trackIoRetirement: true,
    organizationContextProvider: {getCurrentOrganizationContext: () => organization}});
  const io = base.captureIoRetirement!({publicationId}, scope);
  let inventory: ReturnType<typeof captureTrainingResultInventory> | undefined;
  let preparing = false, prepareAttempted = false, retirementCaptured = false, fenced = false, uncertain = false;
  // Failed publication is permanent, but is not proof that original IO is
  // still running. Only an invalid/unknown operation contract prevents known
  // original returns and handle closes from establishing execution quiescence.
  let unknownOperation = false;
  let deadline = 0, acknowledged = 0, attempted = 0, declared = 0;
  const pending = new Set<object>();
  const current = () => {
    need(!fenced && !uncertain && deadline > Date.now());
    const result: unknown = Reflect.apply(assertCurrent, settings.control, []);
    if (result !== undefined) unknownOperation = true;
    if (types.isPromise(result) && !types.isProxy(result) && Object.getPrototypeOf(result) === Promise.prototype &&
        !Object.getOwnPropertyDescriptor(result, "constructor")) void (async () => {try {await result;} catch {}})();
    need(result === undefined);
    need(!fenced && !uncertain && deadline > Date.now());
  };
  const track = async <T>(action: () => Promise<T>): Promise<T> => {
    const token: {original?: unknown; observation?: Promise<unknown>} = {}; need(pending.size < 8); pending.add(token);
    let original: Promise<T>;
    try {original = action(); token.original = original; need(types.isPromise(original) && !types.isProxy(original) &&
      Object.getPrototypeOf(original) === Promise.prototype && !Object.getOwnPropertyDescriptor(original, "constructor"));}
    catch {uncertain = true; unknownOperation = true; throw new Error("Private training publication is unavailable.");}
    const observation = (async () => {try {return {ok: true, value: await original};}
      catch {return {ok: false, value: undefined};} finally {pending.delete(token);}})();
    token.observation = observation;
    if (Object.getOwnPropertyDescriptor(original, "then")) {uncertain = true; unknownOperation = true; throw new Error("Private training publication is unavailable.");}
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([observation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {fenced = true; uncertain = true; io.fencePublication();
          reject(new Error("Private training publication is unavailable."));}, Math.max(1, deadline - Date.now()));
      })]);
      need(result.ok); return result.value as T;
    } finally {if (timer) clearTimeout(timer);}
  };
  const allowed = async () => {current(); need(await track(() => Reflect.apply(assertAllowed, settings.control, [])) === undefined); current();};
  const headroom = async (remaining: number) => {
    current(); const volume = await track(() => statfs(rootDirectory, {bigint: true})); current();
    need(volume.bsize > 0n && volume.bavail >= 0n && volume.bavail * volume.bsize >= BigInt(remaining) + BigInt(limits.minimumFreeBytes as number));
  };
  const fence = () => {fenced = true; io.fencePublication();};
  const inspect = () => {
    const state = io.inspect();
    return Object.freeze({...state, phase: unknownOperation ? "unconfirmed" as const : preparing || pending.size ? "pending" as const : state.phase,
      pendingOperations: state.pendingOperations + pending.size, publicationUnconfirmed: state.publicationUnconfirmed || uncertain});
  };
  const storage: TrainingResultFileByteStoragePort = Object.freeze({
    captureIoRetirement(input: {readonly publicationId: string}, supplied: ApplicationRequestContext): TrainingResultFileIoRetirement {
      const request = record(input, ["publicationId"]); match(supplied);
      need(request.publicationId === publicationId && !retirementCaptured && !prepareAttempted && !fenced);
      retirementCaptured = true; return Object.freeze({fencePublication: fence, inspect});
    },
    async preparePublication(input: Parameters<NonNullable<TrainingResultFileByteStoragePort["preparePublication"]>>[0], supplied: ApplicationRequestContext) {
      match(supplied); need(!prepareAttempted && !fenced && !uncertain); prepareAttempted = true;
      preparing = true; deadline = Date.now() + (limits.maximumDurationMs as number);
      try {
        const captured = captureTrainingResultInventory(input, {maximumFiles: limits.maximumFiles as number,
          maximumFileBytes: limits.maximumFileBytes as number, maximumTotalBytes: limits.maximumTotalBytes as number});
        need(captured.publicationId === publicationId); await allowed(); await headroom(captured.totalBytes); current(); inventory = captured;
      } catch {uncertain = true; fence(); throw new Error("Private training publication is unavailable.");}
      finally {preparing = false;}
    },
    inspectPublication() {return Object.freeze({phase: uncertain ? "unconfirmed" as const : preparing || pending.size ? "checking" as const : "open" as const,
      attemptedFileCount: attempted, acknowledgedFileCount: acknowledged, declaredPayloadBytes: declared});},
    async publishResultFile(input: Parameters<TrainingResultFileByteStoragePort["publishResultFile"]>[0], supplied: ApplicationRequestContext) {
      try {
        match(supplied); current(); need(!preparing && pending.size === 0 && !!inventory && attempted === acknowledged);
        const packet = record(input, ["fileIndex", "mediaType", "content", "expectedSizeBytes", "expectedSha256"]);
        const file = inventory.files[acknowledged];
        need(!!file && packet.fileIndex === file.fileIndex && packet.mediaType === file.mediaType &&
          packet.expectedSizeBytes === file.expectedSizeBytes && packet.expectedSha256 === file.expectedSha256);
        const source = captureStream(packet.content); attempted++; declared += file.expectedSizeBytes;
        await allowed(); await headroom(inventory.totalBytes - inventory.files.slice(0, acknowledged).reduce((sum, item) => sum + item.expectedSizeBytes, 0)); current();
        const content = async function* () {for await (const bytes of source) {current(); yield bytes; current();}};
        const result = await track(() => base.publishResultFile({fileIndex: file.fileIndex, mediaType: file.mediaType,
          expectedSizeBytes: file.expectedSizeBytes, expectedSha256: file.expectedSha256, content: content()}, scope)); current();
        need(result.ok); await allowed(); current(); acknowledged++; return result;
      } catch {
        uncertain = true; fence();
        return createStoreArtifactFailureResult(createContractError("unavailable", "Training result file storage could not be confirmed. Retained data requires recovery."), scope);
      }
    },
  });
  const finalized = (supplied: ApplicationRequestContext): TrainingResultFinalizedFiles => {
      match(supplied); const state = inspect();
      need(fenced && !preparing && !uncertain && pending.size === 0 && !!inventory && acknowledged === inventory.files.length &&
        state.phase === "closed" && state.pendingOperations === 0 && !state.publicationUnconfirmed);
      return Object.freeze({schema: "training-result-finalized-files-v1" as const, publicationId, totalBytes: inventory.totalBytes,
        files: Object.freeze(inventory.files.map(file => Object.freeze({...file,
          key: `workspaces/${scope.workspaceId}/artifacts/training-results/${publicationId}/${file.fileIndex}`})))});
  };
  let reading = false, readUnknown = false;
  const readPending = new Set<{original?: unknown; observation?: Promise<unknown>}>(), readHandles = new Set<FileHandle>();
  const unknownReadOwners: unknown[] = [];
  // Retain the original read attempt through an outward deadline. An unknown
  // operation/close remains retained even after its caller has received failure.
  let readAttempt: {original?: Promise<unknown>} | undefined;
  const verifyFinalizedFiles: TrainingResultRetainedFileVerificationPort["verifyFinalizedFiles"] = async (supplied, rawControl) => {
    const snapshot = finalized(supplied);
    const controls = record(rawControl, ["assertCurrent", "assertAllowed"]);
    need(Object.values(controls).every(value => typeof value === "function" && !types.isProxy(value)) &&
      !types.isAsyncFunction(controls.assertCurrent) && !types.isGeneratorFunction(controls.assertCurrent) &&
      !types.isGeneratorFunction(controls.assertAllowed));
    need(!reading && !readUnknown && readPending.size === 0 && readHandles.size === 0 && !readAttempt);
    const current = controls.assertCurrent as Function, allowed = controls.assertAllowed as Function;
    const deadline = Date.now() + (limits.maximumDurationMs as number);
    let expired = false;
    const check = () => {
      need(!expired && !readUnknown && Date.now() < deadline);
      const result: unknown = Reflect.apply(current, rawControl, []);
      if (result !== undefined) {
        readUnknown = true; unknownReadOwners.push(result);
        if (types.isPromise(result) && !types.isProxy(result) && Object.getPrototypeOf(result) === Promise.prototype &&
            !Object.getOwnPropertyDescriptor(result, "constructor")) void (async () => {try {await result;} catch {}})();
      }
      need(result === undefined && !expired && Date.now() < deadline);
    };
    const original = async <T>(action: () => Promise<T>): Promise<T> => {
      const token: {original?: unknown; observation?: Promise<unknown>} = {};
      need(readPending.size < 8); readPending.add(token);
      let operation: Promise<T>;
      try {operation = action(); token.original = operation;
        need(types.isPromise(operation) && !types.isProxy(operation) && Object.getPrototypeOf(operation) === Promise.prototype &&
          !Object.getOwnPropertyDescriptor(operation, "constructor"));}
      catch {readUnknown = true; throw new Error("Private training verification is unavailable.");}
      const observed = (async () => {try {return {ok: true, value: await operation};}
        catch {return {ok: false, value: undefined};} finally {readPending.delete(token);}})();
      token.observation = observed;
      if (Object.getOwnPropertyDescriptor(operation, "then")) {readUnknown = true; throw new Error("Private training verification is unavailable.");}
      const result = await observed; need(result.ok); return result.value as T;
    };
    const permission = async () => {check(); need(await original(() => Reflect.apply(allowed, rawControl, [])) === undefined); check();};
    type Facts = {dev: bigint; ino: bigint; mode: bigint; nlink: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint};
    const facts = (value: Facts, size: number): Facts => {
      need(value.ino > 0n && value.nlink === 1n && value.size === BigInt(size) && (value.mode & 0o170000n) === 0o100000n);
      return Object.freeze(Object.fromEntries(["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]
        .map(key => [key, value[key as keyof Facts]]))) as Facts;
    };
    const same = (left: Facts, right: Facts) => Object.keys(left).every(key => left[key as keyof Facts] === right[key as keyof Facts]);
    reading = true; const attempt: {original?: Promise<unknown>} = {}; readAttempt = attempt;
    const work = (async () => {
      try {
        await permission(); const buffer = Buffer.alloc(65536);
        for (const file of snapshot.files) {
          check();
          const key = resolveOrganizationStorageKey(file.key, {getCurrentOrganizationContext: () => organization});
          const selected = await original(() => statContainedFile({rootDirectory, key})); check();
          const before = facts(await original(() => lstat(selected.absolutePath, {bigint: true})), file.expectedSizeBytes); check();
          const handle = await original(() => open(selected.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)));
          readHandles.add(handle); // Retain a late open before checking its deadline.
          try {
            check(); need(same(before, facts(await original(() => handle.stat({bigint: true})), file.expectedSizeBytes))); check();
            const hash = createHash("sha256"); let total = 0;
            for (;;) {
              check(); const value = await original(() => handle.read(buffer, 0, buffer.length, null)); check();
              need(Number.isSafeInteger(value.bytesRead) && value.bytesRead >= 0 && value.bytesRead <= buffer.length &&
                value.bytesRead <= file.expectedSizeBytes - total);
              if (value.bytesRead === 0) break;
              total += value.bytesRead; hash.update(buffer.subarray(0, value.bytesRead));
            }
            need(total === file.expectedSizeBytes && "sha256:" + hash.digest("hex") === file.expectedSha256);
            const after = facts(await original(() => handle.stat({bigint: true})), file.expectedSizeBytes); check();
            need(same(before, after) && same(before, facts(await original(() => lstat(selected.absolutePath, {bigint: true})), file.expectedSizeBytes))); check();
            const contained = await original(() => statContainedFile({rootDirectory, key})); check();
            need(contained.absolutePath === selected.absolutePath);
          } finally {
            try {need(await original(() => handle.close()) === undefined); readHandles.delete(handle);}
            catch {readUnknown = true; throw new Error("Private training verification is unavailable.");}
          }
          await permission();
        }
        await permission(); need(readPending.size === 0 && readHandles.size === 0 && !readUnknown);
        return Object.freeze({...snapshot, verification: "sha256-current-local-v1" as const,
          manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")});
      } catch {throw new Error("Private training verification is unavailable.");}
      finally {reading = false; if (!readUnknown) readAttempt = undefined;}
    })();
    attempt.original = work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {expired = true; reject(new Error("Private training verification is unavailable."));},
        Math.max(1, deadline - Date.now()));
    })]);} finally {if (timer) clearTimeout(timer);}
  };
  return Object.freeze({storage, originalOwner: Object.freeze({fencePublication: fence, inspectFinalizedFiles: finalized,
    verifyFinalizedFiles, inspectVerification() {return Object.freeze({phase: readUnknown ? "unconfirmed" as const : reading ? "reading" as const : "idle" as const,
      pendingOperations: readPending.size, openFiles: readHandles.size});},
  })});
}
