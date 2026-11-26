/** Private original installed-runtime channel. No native producer is supplied here. */
import type {ApprovedLocalModelTrainingPort, ApprovedLocalTrainingControl, ApprovedLocalTrainingDefinition,
  ApprovedLocalTrainingSession, ApprovedLocalTrainingStagedInput, ApprovedLocalTrainingModelReader,
  ApprovedLocalTrainingModelSelection} from "../../../../application/ports/model";
import type {RuntimeTaskRecord} from "../../../../contracts/runtime";
import {TaskType} from "../../../../contracts/runtime";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {capturePassiveModelData} from "./modelDownloadManifest";
import {mapTaskStatusResponse} from "../protocol/pythonRuntimeHttpProtocol";
import {types} from "node:util";
import {createOriginalTrainingOutputReceiver, type OriginalTrainingOutputStorage} from "./originalTrainingOutputReceiver";

export const ORIGINAL_TRAINING_CAPABILITY = "train-model.original-session-v1";
export interface OriginalTrainingProfile {readonly profileId: string; readonly profileFingerprint: string}
export interface OriginalTrainingIdentity extends OriginalTrainingProfile {readonly runtimeId: string; readonly workerStartedAt: string}
export interface OriginalTrainingChannel {
  readonly identity: OriginalTrainingIdentity;
  readonly assertCurrent: () => void;
  send(endpoint: string, body: unknown, beforeDispatch?: () => void): Promise<unknown>;
}
/** The foundation must add the exact supervisor owner; HTTP cannot create it. */
export interface OriginalTrainingOwnedChannel extends OriginalTrainingChannel {
  retireOriginalWorker(): Promise<boolean>;
  /** Must acknowledge synchronously with undefined, not an async void Promise. */
  releaseUnusedWorker(): void;
}
/** Original in-process reservation identity, never a wire authorization record. */
export interface OriginalTrainingCapture {
  readonly definition: ApprovedLocalTrainingDefinition;
  assertCurrent(): void;
  assertAllowed(): Promise<void>;
}
/** Trusted host composition only. This never supplies Native capacity or custody. */
export interface OriginalTrainingExitConfiguration {
  readonly retirementProtocol: "original-exit-ready-v1";
  readonly createOutputStorage: (original: OriginalTrainingCapture) => OriginalTrainingOutputStorage;
}
type CaptureSource = {reserved: boolean; stage: "bound" | "preparing" | "closed";
  reader?: () => Promise<ApprovedLocalTrainingModelSelection>; lost: boolean};
const originalSources = new WeakMap<OriginalTrainingCapture, CaptureSource>();

/** Internal binding only. A same-shaped object or serialized request cannot
 * supply this reader. Calling it requires the original reserved prepare phase. */
export function captureOriginalTrainingModelReader(original: OriginalTrainingCapture) {
  const source = originalSources.get(original);
  if (!source) throw unavailable();
  if (!source.reader) return undefined;
  const current = original.assertCurrent.bind(original), allowed = original.assertAllowed.bind(original), read = source.reader;
  const assertCurrent = () => {
    need(originalSources.get(original) === source && source.reserved && source.stage === "preparing" && !source.lost);
    current();
  };
  return Object.freeze({definition: original.definition, assertCurrent, async assertAllowed() {
    assertCurrent(); await allowed(); assertCurrent();
  }, async readModelSelection() {
    assertCurrent();
    try {const result = await read(); assertCurrent(); return result;}
    catch {source.lost = true; throw unavailable();}
  }});
}
const unavailable = () => new Error("The original private training session is unavailable.");
const need = (value: unknown): void => {if (value !== true) throw unavailable();};
const copy = <T>(value: T): T => capturePassiveModelData(value) as T;
// This private profile accepts a fresh current-realm async operation, never an
// arbitrary supplier of prebuilt/subclass/foreign Promise objects. Keep the
// actual intrinsics, not mutable global aliases or user .then/species hooks.
const budgetPromise = Promise, budgetPromisePrototype = Promise.prototype;
const budgetAsyncPrototype = Object.getPrototypeOf(async function originalBudgetProfile() {});
const budgetIsAsync = types.isAsyncFunction, budgetIsGenerator = types.isGeneratorFunction, budgetIsPromise = types.isPromise;
type BudgetObservation = {kind: "completed"; value: unknown} | {kind: "failed"};
const exact = (raw: unknown, keys: readonly string[]) => {
  const value = readStrictPassiveRecord(copy(raw), keys);
  need(Object.keys(value).length === keys.length); return value;
};
export function captureTrainingProfile(raw: OriginalTrainingProfile): OriginalTrainingProfile {
  const value = exact(raw, ["profileId", "profileFingerprint"]);
  need(typeof value.profileId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value.profileId) &&
    typeof value.profileFingerprint === "string" && /^sha256:[a-f0-9]{64}$/.test(value.profileFingerprint));
  return Object.freeze(value) as unknown as OriginalTrainingProfile;
}

/** Capture before ANY startup/capture/HTTP await. The reservation is released
 * only by permanent original retirement; unknown outcomes retain it. */
export function createOriginalTrainingPort(options: {
  captureChannel: (original: OriginalTrainingCapture) => Promise<OriginalTrainingOwnedChannel>;
  reserve: (original: OriginalTrainingCapture) => (() => void) | undefined;
  /** Unbound current-realm native async function only. Completion orders effects; it is not
   * Native capacity/readiness or permission to release retained disk debits. */
  prepareStorageBudget?: (original: OriginalTrainingCapture) => Promise<void>;
  /** Trusted private composition only; no default host or wire-supplied storage. */
  createOutputStorage?: (original: OriginalTrainingCapture) => OriginalTrainingOutputStorage;
  retirementProtocol?: "original-exit-ready-v1";
}): ApprovedLocalModelTrainingPort {
  need(!types.isProxy(options));
  const capturedOptions = readStrictPassiveRecord(options, ["captureChannel", "reserve", "createOutputStorage", "retirementProtocol", "prepareStorageBudget"]);
  const capture = options.captureChannel, reserve = options.reserve, outputFactory = capturedOptions.createOutputStorage;
  const prepareStorageBudget = capturedOptions.prepareStorageBudget;
  need(prepareStorageBudget === undefined || typeof prepareStorageBudget === "function" && !types.isProxy(prepareStorageBudget)
    && budgetIsAsync(prepareStorageBudget) && !budgetIsGenerator(prepareStorageBudget)
    && Object.getPrototypeOf(prepareStorageBudget) === budgetAsyncPrototype);
  need(outputFactory === undefined || typeof outputFactory === "function" && !types.isProxy(outputFactory));
  const exitReady = capturedOptions.retirementProtocol === "original-exit-ready-v1";
  need(capturedOptions.retirementProtocol === undefined || exitReady);
  need(!exitReady || typeof outputFactory === "function");
  return Object.freeze({createSession(raw: ApprovedLocalTrainingDefinition, rawControl: ApprovedLocalTrainingControl,
    rawSource?: ApprovedLocalTrainingModelReader) {
    const definition = copy(raw), isCurrent = rawControl.isCurrent, allowed = rawControl.stillAllowed;
    let sourceRead: ApprovedLocalTrainingModelReader["read"] | undefined;
    if (rawSource !== undefined) {
      need(!types.isProxy(rawSource));
      const source = readStrictPassiveRecord(rawSource, ["read"]);
      need(Object.keys(source).length === 1 && typeof source.read === "function" && !types.isProxy(source.read));
      sourceRead = source.read as ApprovedLocalTrainingModelReader["read"];
    }
    need(typeof isCurrent === "function" && typeof allowed === "function");
    let admissionLost = false;
    const current = () => {
      need(!admissionLost);
      try {
        const result: unknown = isCurrent.call(rawControl);
        if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
        need(result === true);
      } catch {admissionLost = true; throw unavailable();}
    };
    const permission = async () => {
      current();
      try {need(await allowed.call(rawControl) === true); current();}
      catch {admissionLost = true; throw unavailable();}
    };
    const originalCapture: OriginalTrainingCapture = Object.freeze({definition, assertCurrent: current, assertAllowed: permission});
    const source: CaptureSource = {reserved: false, stage: "bound", lost: false};
    if (sourceRead) {
      const read = sourceRead, receiver = rawSource!;
      source.reader = async () => {
        need(source.reserved && source.stage === "preparing" && !source.lost);
        await permission();
        const observed = copy(await Reflect.apply(read, receiver, []));
        await permission();
        const row = exact(observed, ["modelRecordId", "modelUpdatedAt", "localModelReference"]);
        need(row.modelRecordId === definition.request.baseModel.modelRecordId && row.modelUpdatedAt === definition.modelUpdatedAt &&
          typeof row.localModelReference === "string" && row.localModelReference === definition.request.baseModel.localPath);
        return Object.freeze(row) as unknown as ApprovedLocalTrainingModelSelection;
      };
    }
    originalSources.set(originalCapture, source);
    current();
    const originalRelease = reserve.call(options, originalCapture);
    if (!originalRelease) {source.stage = "closed"; return undefined;}
    need(typeof originalRelease === "function"); source.reserved = true;
    let releaseAttempted = false;
    const release = () => {
      if (exitReady) {need(!releaseAttempted); releaseAttempted = true;}
      const result: unknown = originalRelease();
      if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
      need(result === undefined); source.reserved = false; source.stage = "closed";
    };
    let phase: "bound" | "preparing" | "ready" | "issuing" | "accepted" | "unconfirmed" | "settled" = "bound";
    let channel: OriginalTrainingChannel | undefined, binding: Record<string, unknown> | undefined;
    let operations = 0, cancelAttempted = false, closeAttempted = false, closing = false;
    let remoteRetired = false, retireWorker: (() => Promise<boolean>) | undefined, releaseUnusedWorker: (() => void) | undefined;
    let cached: RuntimeTaskRecord | undefined, cancellation: boolean | undefined;
    let output: ReturnType<typeof createOriginalTrainingOutputReceiver> | undefined;
    let outputSetupUnknown = false, outputStarted = false, outputAborted = false;
    let storageBudgetSetupUnknown = false, storageBudgetWithdrawn = false;
    let storageBudgetOperation: Promise<unknown> | undefined, storageBudgetObservation: Promise<BudgetObservation> | undefined;
    let parentFenced = false;
    const abortOutput = () => {if (outputFactory) {outputAborted = true; output?.abort();}};
    const send = async (action: string, input?: unknown, dispatch?: () => void) => {
      need(!!channel && !!binding && phase !== "settled");
      need(!exitReady || !parentFenced || action === "exit-ready");
      const rawReply = await channel!.send("/training/original/" + definition.requestId + "/" + action,
        {binding, ...(input === undefined ? {} : action === "output-ack" ? {sequence: input} : {input})}, dispatch);
      need(!!rawReply && typeof rawReply === "object" && !types.isProxy(rawReply));
      const keys = ["binding", ...(action === "read" ? ["record"] : action === "start" ? ["kind", "requestId", "workspaceId", "status"] :
          action === "cancel" ? ["cancelled"] : action === "settle" ? ["settled", "retirement"] :
            action === "exit-ready" ? ["schema", "ready", "retirement"] :
            action === "output-read" ? ["output"] : action === "output-ack" ? ["acknowledged"] : ["phase"])];
      // The concrete private receiver validates bounded wire bytes itself;
      // ordinary metadata keeps its existing 2 KiB scalar copier unchanged.
      const reply = action === "output-read" ? readStrictPassiveRecord(rawReply, keys) : exact(rawReply, keys);
      need(Object.keys(reply).length === keys.length);
      const original = exact(reply.binding, Object.keys(binding!));
      need(Object.keys(binding!).every(key => original[key] === binding![key]));
      return reply;
    };
    const parentIoClosed = () => !!output && !outputSetupUnknown && output.inspectIoRetirement().phase === "closed";
    const settleExitReady = async () => {
      if (phase === "settled") return true;
      if (releaseAttempted) return false; // An unknown accepted release cannot be repeated or healed.
      if (operations || closing || !remoteRetired && closeAttempted || outputSetupUnknown || storageBudgetSetupUnknown) return false;
      if (phase === "bound") {
        // No factory, startup or other IO was dispatched. Fence before release reentry.
        closing = true; parentFenced = true; phase = "unconfirmed";
        try {release(); phase = "settled"; return true;} catch {return false;}
        finally {closing = false;}
      }
      if (!binding) return false;
      closing = true; operations++;
      try {
        if (!parentFenced) {
          const result = mapTaskStatusResponse((await send("read")).record);
          need(result.requestId === definition.requestId && result.taskType === "train-model" && result.status !== "unknown" &&
            result.metadata?.workspaceId === definition.workspaceId);
          cached = copy({...result, taskType: TaskType.MODEL_TRAINING, workspaceId: definition.workspaceId,
            progress: result.progress ? {details: result.progress} : undefined,
            status: result.status as RuntimeTaskRecord["status"], concurrencyClass: "gpu-exclusive"} as RuntimeTaskRecord);
          if (!cancelAttempted && phase !== "accepted") {
            cancelAttempted = true; const cancelled = await send("cancel"); need(typeof cancelled.cancelled === "boolean");
            cancellation = cancelled.cancelled as boolean;
          }
          if (phase === "accepted" && !["succeeded", "failed", "cancelled"].includes(result.status)) return false;
          // A successful task must finish its original receive flight before fencing.
          if (result.status === "succeeded" && !output?.isComplete()) return false;
          parentFenced = true; // Before any synchronous storage callback can reenter.
          abortOutput();
        }
        if (!parentIoClosed()) return false;
        if (!remoteRetired) {
          closeAttempted = true; // Unknown dispatch/reply cannot issue another readiness request.
          const ready = await send("exit-ready");
          need(ready.schema === "original-training-exit-ready-v1");
          if (ready.ready === false && ready.retirement === "pending") {closeAttempted = false; return false;}
          need(ready.ready === true && ready.retirement === "ready");
          remoteRetired = true; // No HTTP work remains, even during pending original worker exit.
        }
        if (!parentIoClosed()) return false;
        need(!!retireWorker);
        const retired = await retireWorker!();
        need(retired === true || retired === false);
        if (!retired || !parentIoClosed()) return false;
        need(operations === 1);
        // This releases the existing execution slot only. All disk/result charges remain retained.
        release(); phase = "settled"; return true;
      } catch {phase = "unconfirmed"; return false;}
      finally {operations--; closing = false;}
    };
    const session: ApprovedLocalTrainingSession = Object.freeze({requestId: definition.requestId, workspaceId: definition.workspaceId,
      async prepare() {
        need(phase === "bound"); phase = "preparing"; source.stage = "preparing"; operations++;
        try {
          if (prepareStorageBudget) {
            await permission(); need(!storageBudgetWithdrawn && !closing);
            // The original returned session already owns the operation before
            // the trusted function can issue asynchronous storage admission.
            storageBudgetSetupUnknown = true;
            const pending: unknown = Reflect.apply(prepareStorageBudget as Function, options, [originalCapture]);
            need(budgetIsPromise(pending)); storageBudgetOperation = pending as Promise<unknown>;
            need(Object.getPrototypeOf(pending) === budgetPromisePrototype
              && Object.getOwnPropertyDescriptor(pending, "constructor") === undefined
              && Object.getOwnPropertyDescriptor(budgetPromisePrototype, "constructor")?.value === budgetPromise);
            // Observe the real operation BEFORE denying an own-then hook.
            // Same-intrinsic await uses the internal reaction, without reading
            // that hook or a supplied species. Catch and discard private reasons.
            storageBudgetObservation = (async (): Promise<BudgetObservation> => {
              try {return {kind: "completed", value: await storageBudgetOperation};}
              catch {return {kind: "failed"};}
            })();
            need(Object.getOwnPropertyDescriptor(pending, "then") === undefined);
            const completed = await storageBudgetObservation;
            need(completed.kind === "completed" && completed.value === undefined); current(); await permission();
            need(!storageBudgetWithdrawn && !closing && phase === "preparing");
            storageBudgetSetupUnknown = false;
          }
          if (outputFactory) {
            // The returned session already owns retirement before composition can reenter.
            outputSetupUnknown = true; need(!outputAborted);
            const configuration = Reflect.apply(outputFactory as Function, options, [originalCapture]);
            if (types.isPromise(configuration)) void Promise.prototype.then.call(configuration, undefined, () => {});
            need(!types.isPromise(configuration) && !outputAborted && phase === "preparing");
            output = createOriginalTrainingOutputReceiver({configuration, definition,
              assertCurrent() {current(); need(!outputAborted && !!channel); channel!.assertCurrent();}, assertAllowed: permission,
              read: async () => (await send("output-read")).output,
              acknowledge: async sequence => (await send("output-ack", sequence)).acknowledged});
            if (exitReady) need(output.inspectIoRetirement().storagePhase === "open");
            need(!outputAborted); current(); outputSetupUnknown = false;
          }
          await permission(); need(!storageBudgetWithdrawn);
          const original = await capture.call(options, originalCapture); current();
          const identity = copy(original.identity), assertCurrent = original.assertCurrent, sendOriginal = original.send;
          const retireOriginalWorker = original.retireOriginalWorker, releaseOriginalUnused = original.releaseUnusedWorker;
          need(typeof retireOriginalWorker === "function" && typeof releaseOriginalUnused === "function");
          retireWorker = () => retireOriginalWorker.call(original);
          releaseUnusedWorker = () => {
            const result: unknown = releaseOriginalUnused.call(original);
            if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
            need(result === undefined); // A void type alone also admits async/value callbacks.
          };
          channel = Object.freeze({identity, assertCurrent: () => assertCurrent.call(original),
            send: (endpoint: string, body: unknown, dispatch?: () => void) => sendOriginal.call(original, endpoint, body, dispatch)});
          channel.assertCurrent();
          need(!storageBudgetWithdrawn);
          await permission();
          const reply = exact(await channel.send("/training/original/prepare", {identity: channel.identity, definition}, current), ["binding", "phase"]);
          const candidate = exact(reply.binding, ["runtimeId", "workerStartedAt", "profileId", "profileFingerprint", "requestId", "workspaceId", "sessionId"]);
          need(Object.keys(channel.identity).every(key => candidate[key] === channel!.identity[key as keyof OriginalTrainingIdentity]) &&
            candidate.requestId === definition.requestId && candidate.workspaceId === definition.workspaceId &&
            typeof candidate.sessionId === "string" && /^[a-f0-9]{64}$/.test(candidate.sessionId));
          binding = candidate;
          if (reply.phase === "unavailable") {
            // Only the original producer's positive no-effect/settlement reply.
            if (exitReady) {parentFenced = true; abortOutput(); need(parentIoClosed());}
            releaseUnusedWorker();
            if (exitReady) {need(parentIoClosed()); release(); phase = "settled"; return "unavailable" as const;}
            phase = "settled"; release(); return "unavailable" as const;
          }
          need(reply.phase === "ready"); phase = "ready"; return "ready" as const;
        } catch {phase = "unconfirmed"; return "unconfirmed" as const;}
        finally {source.stage = "closed"; operations--;}
      },
      async start(input: ApprovedLocalTrainingStagedInput, admission: () => boolean) {
        need(phase === "ready" && !closing && !parentFenced); phase = "issuing"; operations++;
        const startCurrent = () => {current(); need(admission() === true);};
        try {
          const staged = copy(input); await permission(); startCurrent();
          need((await send("seal", staged, startCurrent)).phase === "ready");
          // A lost seal acknowledgement is never followed by a second seal/start.
          await permission(); startCurrent();
          const reply = await send("start", undefined, startCurrent);
          need(reply.kind === "accepted" && reply.requestId === definition.requestId && reply.workspaceId === definition.workspaceId &&
            (reply.status === "queued" || reply.status === "running"));
          phase = "accepted";
          if (output) {outputStarted = true; output.start();}
          return {kind: "accepted" as const, requestId: definition.requestId, workspaceId: definition.workspaceId,
            status: reply.status as "queued" | "running"};
        } catch {phase = "unconfirmed"; return {kind: "unconfirmed" as const};}
        finally {operations--;}
      },
      async read() {
        await permission();
        if (phase === "settled" || remoteRetired || parentFenced) {need(!!cached); return copy(cached!);}
        need(!closing);
        operations++;
        try {
          const response = mapTaskStatusResponse((await send("read")).record);
          need(response.requestId === definition.requestId && response.taskType === "train-model" &&
            response.status !== "unknown" && response.metadata?.workspaceId === definition.workspaceId);
          cached = copy({...response, taskType: TaskType.MODEL_TRAINING, workspaceId: definition.workspaceId,
            progress: response.progress ? {details: response.progress} : undefined,
            status: response.status as RuntimeTaskRecord["status"], concurrencyClass: "gpu-exclusive"} as RuntimeTaskRecord);
          return copy(cached);
        } finally {operations--;}
      },
      async cancel() {
        // Local fencing requires no current business permission and proves no IO settlement.
        if (prepareStorageBudget && phase === "preparing" && !channel) storageBudgetWithdrawn = true;
        abortOutput();
        await permission();
        if (phase === "settled" || remoteRetired || parentFenced) return {requestId: definition.requestId, status: cached?.status ?? "cancelled", cancelled: cancellation === true};
        need(!closing);
        if (!cancelAttempted) {
          cancelAttempted = true; operations++;
          try {const reply = await send("cancel"); need(typeof reply.cancelled === "boolean"); cancellation = reply.cancelled as boolean;}
          finally {operations--;}
        }
        need(cancellation !== undefined);
        return {requestId: definition.requestId, status: cached?.status ?? "running", cancelled: cancellation!};
      },
      async settle() {
        if (exitReady) return settleExitReady();
        if (phase === "settled") return true;
        if (storageBudgetSetupUnknown || outputSetupUnknown || outputStarted && !output?.isComplete()) return false;
        if (operations || (!remoteRetired && closeAttempted) || closing) return false;
        if (phase === "bound") {phase = "settled"; release(); return true;}
        if (!binding) return false; // Lost preparation cannot adopt a record by ID.
        closing = true; operations++;
        try {
          if (!remoteRetired) {
            // Observe original metadata before permanent retirement; no reads afterward.
            const result = mapTaskStatusResponse((await send("read")).record);
            need(result.requestId === definition.requestId && result.taskType === "train-model" && result.status !== "unknown" &&
              result.metadata?.workspaceId === definition.workspaceId);
            cached = copy({...result, taskType: TaskType.MODEL_TRAINING, workspaceId: definition.workspaceId,
              progress: result.progress ? {details: result.progress} : undefined,
              status: result.status as RuntimeTaskRecord["status"], concurrencyClass: "gpu-exclusive"} as RuntimeTaskRecord);
            if (!cancelAttempted && phase !== "accepted") {
              cancelAttempted = true; const cancelled = await send("cancel"); need(typeof cancelled.cancelled === "boolean");
              cancellation = cancelled.cancelled as boolean;
            }
            if (phase === "accepted" && !["succeeded", "failed", "cancelled"].includes(result.status)) return false;
            closeAttempted = true;
            const retirement = await send("settle");
            if (retirement.settled === false && retirement.retirement === "pending") {closeAttempted = false; return false;}
            need(retirement.settled === true && retirement.retirement === "settled");
            // No further remote reads or effects, even if local close is uncertain.
            remoteRetired = true;
          }
          need(!!retireWorker && await retireWorker() === true);
          need(operations === 1);
          phase = "settled"; release(); return true;
        } catch {phase = "unconfirmed"; return false;}
        finally {operations--; closing = false;}
      },
    });
    return session;
  }});
}
