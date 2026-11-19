/** One private acquisition, retained by the existing accepted Model Task owner. */
import {createHash} from "node:crypto";
import {constants, type BigIntStats, type Dir} from "node:fs";
import {lstat, open, opendir, realpath, type FileHandle} from "node:fs/promises";
import path from "node:path";
import {types, isDeepStrictEqual} from "node:util";
import type {ApprovedModelSourceDownloadRequest, ApprovedModelSourceDownloadControl, CompletedModelDownload,
  GeneratedModelStoragePort} from "../../../../application/ports/model";
import type {InstalledRuntimeTaskStart} from "../../../../application/ports/runtime";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import {isWorkspaceId} from "../../../../contracts/workspace";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {captureManifestExpectation, capturePassiveModelData} from "./modelDownloadManifest";
import {prepareModelSourceRecipient, type ModelSourceRecipient} from "./modelSourceRecipient";
import type {CapturedModelSourceTask, ModelSourceTaskSession, ModelSourceTaskStatus} from "./modelSourceTaskSession";

const fail = () => new Error("The original model acquisition could not be confirmed.");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino > 0n && a.ino === b.ino;
const sameFile = (a: BigIntStats, b: BigIntStats) => same(a, b) && a.size === b.size && a.nlink === b.nlink && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
export function captureApprovedModelSourceRequest(raw: unknown): ApprovedModelSourceDownloadRequest {
  try {
    const value = readStrictPassiveRecord(capturePassiveModelData(raw), ["requestId", "workspaceId", "sourceManifest", "maximumDurationSeconds", "allowedOrigins"]);
    if (Object.keys(value).length !== 5 || !uuid(value.requestId) || !isWorkspaceId(value.workspaceId) ||
        !Number.isSafeInteger(value.maximumDurationSeconds) || (value.maximumDurationSeconds as number) < 1 ||
        (value.maximumDurationSeconds as number) > 3600 || !Array.isArray(value.allowedOrigins) ||
        value.allowedOrigins.length < 1 || value.allowedOrigins.length > 4) throw fail();
    const origins = value.allowedOrigins.map(origin => {
      if (typeof origin !== "string" || origin.length > 300 || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(origin) ||
          new URL(origin).hostname.includes("..") || new URL(origin).hostname.length > 253) throw fail();
      return origin;
    });
    if (!origins.includes("https://huggingface.co") || new Set(origins).size !== origins.length) throw fail();
    return capturePassiveModelData({...value, sourceManifest: captureManifestExpectation(value.sourceManifest), allowedOrigins: origins}) as unknown as ApprovedModelSourceDownloadRequest;
  } catch {throw fail();}
}
export function captureModelSourceControl(raw: ApprovedModelSourceDownloadControl): ApprovedModelSourceDownloadControl {
  try {
    if (types.isProxy(raw)) throw fail();
    const value = readStrictPassiveRecord(raw, ["isCurrent", "stillAllowed"]);
    if (Object.keys(value).length !== 2 || typeof value.isCurrent !== "function" || typeof value.stillAllowed !== "function") throw fail();
    return Object.freeze({isCurrent: value.isCurrent, stillAllowed: value.stillAllowed}) as ApprovedModelSourceDownloadControl;
  } catch {throw fail();}
}
export interface ModelSourceAcquisition {
  readonly retainsCustody: boolean;
  peek(): RuntimeTaskRecord;
  start(): Promise<InstalledRuntimeTaskStart>;
  read(): Promise<RuntimeTaskRecord>;
  cancel(): Promise<{readonly cancelled: boolean; readonly record: RuntimeTaskRecord}>;
  completed(): CompletedModelDownload | undefined;
}

/** The caller reserves its existing Task slot before constructing this owner. */
export function createModelSourceAcquisition(options: {
  readonly request: ApprovedModelSourceDownloadRequest; readonly control: ApprovedModelSourceDownloadControl;
  readonly cacheRoot: string; readonly session: ModelSourceTaskSession; readonly storage: GeneratedModelStoragePort;
}): ModelSourceAcquisition {
  const request = captureApprovedModelSourceRequest(options.request), control = captureModelSourceControl(options.control);
  const cacheRoot = path.resolve(options.cacheRoot), session = options.session;
  const store = options.storage.storeGeneratedModel.bind(options.storage);
  let receiver: ModelSourceRecipient | undefined, task: CapturedModelSourceTask | undefined;
  let issued = false, released = false, terminal = false, unknown = false;
  let status: RuntimeTaskRecord["status"] = "queued", received: number | undefined;
  let completion: CompletedModelDownload | undefined, flight: Promise<RuntimeTaskRecord> | undefined;
  let cancellation: Promise<{readonly cancelled: boolean; readonly record: RuntimeTaskRecord}> | undefined;
  let observedReceipt: ModelSourceTaskStatus["receipt"], ackAttempted = false, senderClean = false;
  let stored: CompletedModelDownload | undefined, receiverRetired = false;
  let failure = false, physicalSettled = false, completionDenied = false;
  const queuedAt = new Date().toISOString(); let updatedAt = queuedAt;
  // Unknown closes retain actual resources with this original owner; no retry.
  const files = new Set<FileHandle>(), directories = new Set<Dir>();
  const current = () => {
    const result: unknown = control.isCurrent();
    if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
    if (result !== true || unknown || receiver?.phase === "uncertain") throw fail();
    session.identityProbe.assertCurrent();
  };
  const allowed = async () => {current(); const result = await control.stillAllowed(); current(); if (result !== true) throw fail();};
  const record = (): RuntimeTaskRecord => ({requestId: request.requestId, workspaceId: request.workspaceId,
    taskType: TaskType.MODEL_DOWNLOAD, status, concurrencyClass: "io", queuedAt, updatedAt,
    ...(status === "queued" ? {} : {startedAt: queuedAt}), ...(terminal ? {completedAt: updatedAt} : {}),
    progress: {current: received, total: request.sourceManifest.source.totalBytes, unit: "bytes",
      ...(received === undefined ? {} : {percent: 100 * received / request.sourceManifest.source.totalBytes})},
    ...(completion ? {data: {provider: "transformers", modelId: completion.modelId, downloaded: true, fromCache: false}} : {}),
    ...(failure ? {error: {code: completionDenied ? "model_source_completion_denied" : unknown ? "model_source_acquisition_unconfirmed" : "model_source_download_failed",
      message: completionDenied ? "Model files were stored, but permission to complete this download is no longer available." :
        unknown ? "Model download needs attention. Its previous files remain protected." : "The model download did not complete.",
      retryable: released && !completionDenied}} : {}), metadata: {workspaceId: request.workspaceId}});
  const uncertain = () => {
    if (physicalSettled) {completionDenied = true; released = true; terminal = true; status = "failed";}
    else {unknown = true; receiver?.retainUncertainty(); status = "unknown";}
    failure = true; updatedAt = new Date().toISOString();
  };

  async function verifyStored(localPath: string, reportedModel: unknown): Promise<string> {
    current();
    const source = request.sourceManifest.source;
    const expected = path.join(cacheRoot, "models--" + source.modelId.replace("/", "--"), "snapshots", source.revision);
    if (typeof localPath !== "string" || localPath !== expected || reportedModel !== source.modelId) throw fail();
    const identities = new Map<string, BigIntStats>();
    let directory = cacheRoot;
    for (const segment of [null, "models--" + source.modelId.replace("/", "--"), "snapshots", source.revision]) {
      if (segment) directory = path.join(directory, segment);
      current(); const facts = await lstat(directory, {bigint: true}); current();
      if (!facts.isDirectory() || facts.isSymbolicLink() || facts.ino <= 0n || await realpath(directory) !== directory) throw fail();
      current(); identities.set(directory, facts);
    }
    const roots = async () => {
      for (const [name, before] of identities) {
        current(); const after = await lstat(name, {bigint: true}); current();
        if (!after.isDirectory() || after.isSymbolicLink() || !same(before, after) || await realpath(name) !== name) throw fail();
        current();
      }
    };
    const inventory = async () => {
      await roots(); const directory = await opendir(expected); directories.add(directory);
      try {
        const names = new Set(source.files.map(value => value.path));
        for (;;) {
          current(); const entry = await directory.read(); current(); if (entry === null) break;
          if (!names.delete(entry.name)) throw fail();
        }
        if (names.size) throw fail();
      } finally {await directory.close(); directories.delete(directory); current();}
    };
    await inventory(); const verified = new Map<string, BigIntStats>();
    for (const selected of source.files) {
      await roots(); const filename = path.join(expected, selected.path);
      current(); const before = await lstat(filename, {bigint: true}); current();
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(selected.sizeBytes)) throw fail();
      const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); files.add(handle);
      try {
        current(); const initial = await handle.stat({bigint: true}); current(); if (!sameFile(before, initial)) throw fail();
        const hash = createHash(selected.integrity.algorithm === "sha256" ? "sha256" : "sha1");
        if (selected.integrity.algorithm === "git-blob-sha1") hash.update(`blob ${selected.sizeBytes}\0`);
        const buffer = Buffer.alloc(64 * 1024); let bytes = 0;
        while (bytes < selected.sizeBytes) {
          current(); const read = await handle.read(buffer, 0, Math.min(buffer.length, selected.sizeBytes - bytes), bytes); current();
          if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 1 || read.bytesRead > selected.sizeBytes - bytes) throw fail();
          bytes += read.bytesRead; hash.update(buffer.subarray(0, read.bytesRead));
        }
        current(); const eof = await handle.read(buffer, 0, 1, bytes); current();
        const after = await handle.stat({bigint: true}); current();
        if (eof.bytesRead !== 0 || !sameFile(initial, after) || hash.digest("hex") !== selected.integrity.digest) throw fail();
      } finally {await handle.close(); files.delete(handle); current();}
      const after = await lstat(filename, {bigint: true}); current(); if (!sameFile(before, after)) throw fail();
      verified.set(filename, before);
    }
    await inventory();
    for (const [name, before] of verified) {
      await roots(); const after = await lstat(name, {bigint: true}); current();
      if (!after.isFile() || after.isSymbolicLink() || !sameFile(before, after)) throw fail();
    }
    await roots(); return expected;
  }
  async function advance(): Promise<RuntimeTaskRecord> {
    if (terminal || unknown || !task) return record();
    current(); let observed: ModelSourceTaskStatus;
    try {observed = await task.read();}
    catch {current(); return record();} // Captured read-only observation may be repeated; never redispatch.
    current();
    received = observed.receivedBytes ?? undefined; updatedAt = new Date().toISOString();
    if (observedReceipt && !isDeepStrictEqual(observed.receipt, observedReceipt)) throw fail();
    if (["prepared", "running"].includes(observed.phase)) return record();
    if (["failed", "cancelled"].includes(observed.phase) && !observed.cleanupPending && !observed.startAcknowledgementUnconfirmed) {
      await task.retireEmptyReceiver(); current(); released = true; terminal = true;
      status = observed.phase === "cancelled" ? "cancelled" : "failed"; failure = status === "failed"; return record();
    }
    if (!receiver || !observed.receipt) throw fail();
    if (!observedReceipt) {
      if (observed.phase !== "awaiting-receiver") throw fail();
      await receiver.observeReceipt(observed.receipt); current(); observedReceipt = observed.receipt;
    }
    if (!senderClean) {
      if (observed.phase === "acknowledging" && ackAttempted) return record();
      if (observed.phase === "awaiting-receiver") {
        ackAttempted = true;
        try {observed = await task.acknowledge("receiver-observed");}
        catch {current(); return record();} // Exact ACK replay is saved-state observation, not repeated unlink.
        current();
        if (!isDeepStrictEqual(observed.receipt, observedReceipt)) throw fail();
        if (observed.phase === "acknowledging") return record();
      }
      if (observed.phase !== "acknowledged" || !ackAttempted) throw fail();
      await receiver.confirmSenderCleanup(); current(); senderClean = true;
    }
    if (observed.phase !== "acknowledged" && !(receiverRetired && observed.phase === "released")) throw fail();
    if (!stored) stored = await receiver.consume(async sourceDirectory => {
      // Check business permission in the same continuation as the storage call.
      current(); if (await control.stillAllowed() !== true) throw fail(); current();
      const result = await store(Object.freeze({sourceDirectory, outputModelName: request.sourceManifest.source.modelId.split("/")[1]!,
        repository: request.sourceManifest.source.modelId, runId: request.sourceManifest.source.revision}));
      current();
      const value = readStrictPassiveRecord(capturePassiveModelData(result), ["localPath", "modelId"]);
      if (typeof value.localPath !== "string") throw fail();
      await allowed(); const localPath = await verifyStored(value.localPath, value.modelId); await allowed();
      return Object.freeze({provider: "transformers" as const, modelId: request.sourceManifest.source.modelId,
        revision: request.sourceManifest.source.revision, verifiedManifestDigest: request.sourceManifest.manifestDigest,
        downloaded: true, fromCache: false, localPath});
    });
    current();
    if (!receiverRetired) {await receiver.retire(); current(); receiverRetired = true;}
    let settled: ModelSourceTaskStatus;
    try {settled = await task.acknowledge("receiver-settled");}
    catch {current(); return record();}
    if (settled.phase !== "released" || receiver.cleanupPending) throw fail();
    // Positive cleanup facts stay closed even if business permission is then
    // withdrawn. They never grant completion/registration or another import.
    physicalSettled = true; released = true;
    current(); if (await control.stillAllowed() !== true) throw fail(); current();
    completion = stored; released = true; terminal = true; status = "succeeded";
    received = request.sourceManifest.source.totalBytes; updatedAt = new Date().toISOString(); return record();
  }
  const owner: ModelSourceAcquisition = Object.freeze({get retainsCustody() {return !released;},
    peek: record,
    async start(): Promise<InstalledRuntimeTaskStart> {
      if (issued) return {kind: "unavailable"}; issued = true;
      try {
        await allowed();
        receiver = await prepareModelSourceRecipient({cacheRoot, taskId: request.requestId, manifest: request.sourceManifest,
          maximumDurationSeconds: request.maximumDurationSeconds, allowedOrigins: request.allowedOrigins,
          identityProbe: session.identityProbe, isCurrent: () => {current(); return true;}, isBusinessAllowed: control.stillAllowed,
          captureCustodian(value) {receiver = value;}});
        const result = await session.start(receiver, request.workspaceId); current();
        if (result.kind !== "accepted") {uncertain(); return {kind: "unconfirmed"};}
        task = result.task; status = "running"; updatedAt = new Date().toISOString();
        return {kind: "accepted", value: {requestId: request.requestId, status: "running"}};
      } catch {
        if (receiver) {uncertain(); return {kind: "unconfirmed"};}
        released = true; terminal = true; status = "failed"; failure = true; return {kind: "unavailable"};
      }
    },
    async read() {
      if (cancellation) return record();
      if (flight) return flight;
      const operation = advance().catch(() => {uncertain(); return record();}); flight = operation;
      try {return await operation;} finally {if (flight === operation) flight = undefined;}
    },
    async cancel() {
      if (cancellation) return cancellation;
      if (terminal || unknown || !task || flight) return {cancelled: status === "cancelled", record: record()};
      const original = task;
      const operation = (async () => {
        try {
          current(); const result = await original.cancel(); current();
          if (result.cancelled) {await original.retireEmptyReceiver(); current(); released = true; terminal = true; status = "cancelled"; updatedAt = new Date().toISOString();}
          return {cancelled: result.cancelled, record: record()};
        } catch {uncertain(); return {cancelled: false, record: record()};}
      })();
      cancellation = operation;
      try {return await operation;} finally {if (cancellation === operation) cancellation = undefined;}
    },
    completed() {return completion ? {...completion} : undefined;},
  });
  return owner;
}
