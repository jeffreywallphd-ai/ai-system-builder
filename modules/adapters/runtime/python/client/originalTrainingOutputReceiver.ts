/** Private cooperative receive path. Bounds are declarations, not capacity or Native custody proof. */
import {types} from "node:util";
import {performance} from "node:perf_hooks";
import type {ApplicationRequestContext} from "../../../../application/ports/application-request-context";
import type {ApprovedLocalTrainingDefinition, TrainingResultFileByteStoragePort} from "../../../../application/ports/model";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {capturePassiveModelData} from "./modelDownloadManifest";

export interface OriginalTrainingOutputStorage {
  readonly storage: TrainingResultFileByteStoragePort;
  readonly context: ApplicationRequestContext;
  readonly publicationId: string;
  readonly maximumFiles: number;
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumDurationMs: number;
}
const unavailable = () => new Error("Private training output could not be confirmed.");
const need = (value: unknown): void => {if (value !== true) throw unavailable();};
/** Synchronous cleanup capabilities cannot acknowledge through a Promise.
 * Consume native rejection only; never inspect/assimilate an arbitrary thenable. */
const synchronous = (value: unknown): unknown => {
  if (types.isPromise(value)) {
    void Promise.prototype.then.call(value, undefined, () => {});
    throw unavailable();
  }
  return value;
};
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
/** Private wire data admits 8 KiB base64 segments. The generic metadata copier
 * intentionally caps individual strings at 2 KiB and must remain unchanged. */
function captureOutput(input: unknown): unknown {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  const charge = (value: string) => {bytes += Buffer.byteLength(value, "utf8"); need(bytes <= 128 * 1024);};
  const visit = (value: unknown, depth: number): unknown => {
    need(++nodes <= 4096 && depth <= 12);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {need(Number.isSafeInteger(value)); return value;}
    if (typeof value === "string") {need(value.length <= 10_924); charge(value); return value;}
    need(!!value && typeof value === "object" && !types.isProxy(value));
    const object = value as object, array = Array.isArray(object);
    need(!ancestors.has(object) && Object.getPrototypeOf(object) === (array ? Array.prototype : Object.prototype));
    const keys = Reflect.ownKeys(object); need(keys.length <= (array ? 257 : 128));
    ancestors.add(object);
    try {
      const output: any = array ? [] : {};
      if (array) need(keys.length === (object as unknown[]).length + 1 && (object as unknown[]).length <= 256);
      for (const key of keys) {
        if (array && key === "length") continue;
        need(typeof key === "string" && key.length <= 80 && !["__proto__", "prototype", "constructor"].includes(key as string));
        if (array) need(/^(0|[1-9][0-9]*)$/.test(key as string) && Number(key) < (object as unknown[]).length);
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        need(!!descriptor && "value" in descriptor && descriptor.enumerable === true);
        charge(key as string); output[key] = visit(descriptor!.value, depth + 1);
      }
      return Object.freeze(output);
    } finally {ancestors.delete(object);}
  };
  return visit(input, 0);
}
const exact = (value: unknown, keys: readonly string[]) => {
  const row = readStrictPassiveRecord(captureOutput(value), keys);
  need(Object.keys(row).length === keys.length); return row;
};
const names = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "model.safetensors",
  "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"]);
type File = Readonly<{fileIndex: number; groupIndex: number; name: string; sizeBytes: number; sha256: string; role: string}>;

/** Called synchronously by the session before its first startup await. Only
 * trusted composition supplies storage; wire frames can never select it. */
export function createOriginalTrainingOutputReceiver(options: {
  configuration: OriginalTrainingOutputStorage;
  definition: ApprovedLocalTrainingDefinition;
  assertCurrent(): void;
  assertAllowed(): Promise<void>;
  read(): Promise<unknown>;
  acknowledge(sequence: number): Promise<unknown>;
}) {
  const raw = options.configuration;
  need(!!raw && !types.isProxy(raw));
  const configuration = readStrictPassiveRecord(raw, ["storage", "context", "publicationId", "maximumFiles",
    "maximumFileBytes", "maximumTotalBytes", "maximumDurationMs"]);
  need(Object.keys(configuration).length === 7);
  const {storage, publicationId, maximumFiles, maximumFileBytes, maximumTotalBytes, maximumDurationMs} = configuration;
  need(!!storage && typeof storage === "object" && !types.isProxy(storage));
  const port = readStrictPassiveRecord(storage, ["publishResultFile", "inspectPublication", "captureIoRetirement"]);
  const publish = port.publishResultFile;
  need(typeof publish === "function" && !types.isProxy(publish) && typeof port.inspectPublication === "function" &&
    typeof publicationId === "string" && /^[a-f0-9]{32}$/.test(publicationId) &&
    positive(maximumFiles) && maximumFiles <= 256 && positive(maximumFileBytes) && positive(maximumTotalBytes) &&
    maximumFileBytes <= maximumTotalBytes && positive(maximumDurationMs) && maximumDurationMs <= 86_400_000);
  const context = readStrictPassiveRecord(capturePassiveModelData(configuration.context),
    ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"]);
  need(Object.values(context).every(value => value === undefined || typeof value === "string" && value.length > 0 && value.length <= 256));
  const definition = capturePassiveModelData(options.definition);
  need(context.workspaceId === definition.workspaceId && context.organizationId === definition.owner.organizationId &&
    context.principalId === definition.owner.principalId && (context.requestId === undefined || context.requestId === definition.requestId));
  Object.freeze(context);
  const current = options.assertCurrent, allowed = options.assertAllowed, read = options.read, acknowledge = options.acknowledge;
  let phase: "bound" | "receiving" | "complete" | "unconfirmed" = "bound", aborted = false, lastAck = 0;
  let deadline = 0, flight: Promise<void> | undefined, flightFinished = false, unknownOperation = false;
  let issuedOperations = 0, returnedOperations = 0;
  const pendingOperations = new Set<object>();
  // Register before dispatch. Only the original promise's intrinsic settlement
  // retires an operation; a raced observer, abort or iterator return cannot.
  const track = <T>(operation: () => Promise<T>): Promise<T> => {
    need(pendingOperations.size < 8 && issuedOperations < Number.MAX_SAFE_INTEGER);
    const token = {}; pendingOperations.add(token); issuedOperations++;
    try {
      const pending = operation(); need(types.isPromise(pending) && !types.isProxy(pending));
      return new Promise<T>((resolve, reject) => {
        const returned = () => {pendingOperations.delete(token); returnedOperations++;};
        try {void Promise.prototype.then.call(pending,
          (value: T) => {returned(); resolve(value);}, (error: unknown) => {returned(); reject(error);});}
        catch (error) {unknownOperation = true; reject(error);}
      });
    } catch (error) {unknownOperation = true; throw error;}
  };
  let fenceStorage: (() => void) | undefined, inspectStorage: (() => unknown) | undefined, storageFenceAttempted = false;
  if (port.captureIoRetirement !== undefined) {
    need(typeof port.captureIoRetirement === "function" && !types.isProxy(port.captureIoRetirement));
    const capability = synchronous(Reflect.apply(port.captureIoRetirement as Function, storage, [{publicationId}, context]));
    need(!!capability && typeof capability === "object" && !types.isProxy(capability));
    const methods = readStrictPassiveRecord(capability, ["fencePublication", "inspect"]);
    need(Object.keys(methods).length === 2 && [methods.fencePublication, methods.inspect].every(method =>
      typeof method === "function" && !types.isProxy(method)));
    const fence = methods.fencePublication as Function, inspect = methods.inspect as Function;
    fenceStorage = () => {need(synchronous(Reflect.apply(fence, capability, [])) === undefined);};
    inspectStorage = () => synchronous(Reflect.apply(inspect, capability, []));
  }
  const abort = () => {
    aborted = true; if (phase !== "complete") phase = "unconfirmed";
    if (!storageFenceAttempted) {
      storageFenceAttempted = true; // Before callback/reentry or an unknown result.
      try {fenceStorage?.();} catch {unknownOperation = true;}
    }
  };
  const inspectIoRetirement = () => {
    type StoragePhase = "unavailable" | "open" | "pending" | "closed" | "unconfirmed";
    let storagePhase: StoragePhase = "unavailable";
    let publicationUnconfirmed = true;
    if (inspectStorage) {
      try {
        const row = readStrictPassiveRecord(inspectStorage(), ["schema", "publicationId", "publicationFenced", "phase",
          "fileCount", "pendingOperations", "publicationUnconfirmed", "declaredPayloadBytes"]);
        need(Object.keys(row).length === 8 && row.schema === "training-result-file-io-retirement-v1" && row.publicationId === publicationId &&
          typeof row.publicationFenced === "boolean" && typeof row.publicationUnconfirmed === "boolean" &&
          ["open", "pending", "closed", "unconfirmed"].includes(row.phase as string) &&
          [row.fileCount, row.pendingOperations, row.declaredPayloadBytes].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) &&
          (row.fileCount as number) <= (maximumFiles as number) && (row.declaredPayloadBytes as number) <= (maximumTotalBytes as number));
        storagePhase = row.phase as StoragePhase;
        // No borrowed capability can claim closed before its publication fence.
        need(storagePhase !== "closed" || row.publicationFenced === true && row.pendingOperations === 0);
        publicationUnconfirmed = row.publicationUnconfirmed as boolean;
      } catch {storagePhase = "unconfirmed"; unknownOperation = true;}
    }
    const drainFinished = !flight || flightFinished;
    const closed = aborted && drainFinished && pendingOperations.size === 0 && !unknownOperation && storagePhase === "closed";
    return Object.freeze({schema: "original-training-output-io-retirement-v1" as const, publicationId,
      phase: closed ? "closed" as const : unknownOperation || storagePhase === "unconfirmed" || storagePhase === "unavailable" ? "unconfirmed" as const :
        !drainFinished || pendingOperations.size > 0 || storagePhase === "pending" ? "pending" as const : "open" as const,
      publicationFenced: aborted, drainFinished, pendingOperations: pendingOperations.size, issuedOperations, returnedOperations,
      storagePhase, publicationUnconfirmed});
  };
  const passive = () => {need(!aborted && phase === "receiving" && performance.now() < deadline);};
  const check = () => {passive(); current(); passive();};
  const guard = async () => {check(); await track(allowed); check();};
  // A deadline fences effects. It never proves the underlying IO has stopped.
  const effect = async <T>(operation: () => Promise<T>): Promise<T> => {
    await guard(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      check(); // A resolved guard creates a microtask boundary before physical dispatch.
      const pending = track(operation);
      // A synchronous currentness failure must not orphan an already rejected IO promise.
      void Promise.prototype.then.call(pending, undefined, () => {}); check();
      const result = await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable()), Math.max(1, deadline - performance.now()));
      })]);
      await guard(); return result;
    } finally {if (timer) clearTimeout(timer);}
  };
  const nextFrame = async () => {
    for (;;) {
      const output = exact(await effect(read), ["phase", "acknowledged", "frame"]);
      need(Buffer.byteLength(JSON.stringify(output), "utf8") <= 128 * 1024 && output.acknowledged === lastAck &&
        ["unbound", "bound", "active", "complete"].includes(output.phase as string));
      if (output.frame === null) {
        need(output.phase !== "complete"); await effect(() => new Promise<void>(resolve => setTimeout(resolve, 10))); continue;
      }
      need(output.phase === "active");
      const frame = captureOutput(output.frame) as Record<string, unknown>;
      need(Buffer.byteLength(JSON.stringify(frame), "utf8") <= 64 * 1024 && frame.schema === "original-training-output-delivery-v1" &&
        positive(frame.sequence) && frame.sequence === lastAck + 1);
      return frame;
    }
  };
  const ack = async (frame: Record<string, unknown>) => {
    const result = await effect(() => acknowledge(frame.sequence as number));
    need(result === true); lastAck = frame.sequence as number;
  };
  const frameShape = (frame: Record<string, unknown>, kind: string, fields: string[]) => {
    const row = exact(frame, ["schema", "sequence", "kind", ...fields]); need(row.kind === kind); return row;
  };
  const manifest = (frame: Record<string, unknown>) => {
    const row = frameShape(frame, "manifest", ["taskId", "files", "totalBytes"]);
    need(row.taskId === definition.requestId && Array.isArray(row.files) && row.files.length > 0 && row.files.length <= (maximumFiles as number));
    let sum = 0, group = 0, candidate = false;
    const seen = new Set<string>();
    const files = (row.files as unknown[]).map((rawFile, index) => {
      const file = exact(rawFile, ["fileIndex", "groupIndex", "name", "sizeBytes", "sha256", "role"]);
      need(file.fileIndex === index && typeof file.groupIndex === "number" && Number.isSafeInteger(file.groupIndex) &&
        (file.groupIndex === group || file.groupIndex === group + 1 && index > 0) &&
        typeof file.name === "string" && names.has(file.name) && positive(file.sizeBytes) && file.sizeBytes <= (maximumFileBytes as number) &&
        file.sizeBytes <= (maximumTotalBytes as number) - sum && typeof file.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(file.sha256) &&
        (file.role === "checkpoint" || file.role === "candidate"));
      if (index === 0) need(file.groupIndex === 0);
      if (file.groupIndex !== group) {need(!candidate); group = file.groupIndex as number;}
      if (candidate) need(file.role === "candidate");
      if (file.role === "candidate") candidate = true;
      else need(!candidate);
      const key = `${group}/${file.name}`; need(!seen.has(key)); seen.add(key); sum += file.sizeBytes as number;
      return file as unknown as File;
    });
    // All rows in the final group are candidate files; earlier groups are checkpoints.
    need(candidate && files.every(file => file.role === (file.groupIndex === group ? "candidate" : "checkpoint")) && row.totalBytes === sum);
    return {files, totalBytes: sum};
  };
  const receive = async () => {
    const header = await nextFrame(), declared = manifest(header); await ack(header);
    for (const file of declared.files) {
      let offset = 0, eof: Record<string, unknown> | undefined, iterated = false, busy = false;
      const stream = async function* () {
        for (;;) {
          const frame = await nextFrame();
          if (frame.kind === "file-eof") {
            const row = frameShape(frame, "file-eof", ["fileIndex", "sizeBytes"]);
            need(row.fileIndex === file.fileIndex && row.sizeBytes === file.sizeBytes && offset === file.sizeBytes);
            eof = frame; return;
          }
          const row = frameShape(frame, "data", ["fileIndex", "offset", "data"]);
          need(row.fileIndex === file.fileIndex && row.offset === offset && typeof row.data === "string" &&
            row.data.length > 0 && row.data.length <= 10_924 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data));
          const bytes = Buffer.from(row.data as string, "base64");
          need(bytes.length > 0 && bytes.length <= 8192 && bytes.toString("base64") === row.data && bytes.length <= file.sizeBytes - offset);
          offset += bytes.length; yield bytes;
          // Resumption proves consumption, not publication. EOF is ACKed separately.
          await ack(frame);
        }
      }();
      const content: AsyncIterable<Uint8Array> = Object.freeze({[Symbol.asyncIterator]() {
        if (iterated) {aborted = true; throw unavailable();}
        iterated = true;
        return {async next() {
          if (busy) {aborted = true; throw unavailable();}
          busy = true;
          try {check(); return await track(() => stream.next());} finally {busy = false;}
        }, async return() {abort(); return {done: true as const, value: undefined};}};
      }});
      const mediaType = file.name.endsWith(".json") ? "application/json" as const : "application/octet-stream" as const;
      const rawResult = await effect(() => Reflect.apply(publish as Function, storage, [{fileIndex: file.fileIndex, mediaType,
        content, expectedSizeBytes: file.sizeBytes, expectedSha256: file.sha256}, context]));
      const result = readStrictPassiveRecord(capturePassiveModelData(rawResult), ["ok", "value", "requestId", "correlationId"]);
      need(result.ok === true && !!eof && !busy && result.requestId === context.requestId && result.correlationId === context.correlationId);
      const stored = readStrictPassiveRecord(result.value, ["key", "mediaType", "sizeBytes", "checksum", "metadata"]);
      const checksum = exact(stored.checksum, ["algorithm", "value"]);
      need(stored.key === `workspaces/${definition.workspaceId}/artifacts/training-results/${publicationId}/${file.fileIndex}` &&
        stored.mediaType === mediaType && stored.sizeBytes === file.sizeBytes && checksum.algorithm === "sha256" && checksum.value === file.sha256.slice(7));
      await ack(eof!);
    }
    const end = await nextFrame(), complete = frameShape(end, "streams-complete", ["fileCount", "totalBytes", "provisional"]);
    need(complete.fileCount === declared.files.length && complete.totalBytes === declared.totalBytes && complete.provisional === true);
    await ack(end); check(); phase = "complete";
  };
  return Object.freeze({
    start() {
      need(phase === "bound" && !flight && !aborted); phase = "receiving"; deadline = performance.now() + (maximumDurationMs as number);
      // Latch before any callback, read, permission or writer can reenter.
      flight = Promise.resolve().then(receive).catch(() => {phase = "unconfirmed"; abort();}).finally(() => {flightFinished = true;});
    },
    abort,
    isComplete() {return phase === "complete";},
    // Local observation only. No worker/Job retirement, retry, credit or Save.
    inspectIoRetirement,
  });
}
