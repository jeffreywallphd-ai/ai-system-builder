/** Private original installed-runtime channel. No native producer is supplied here. */
import type {ApprovedLocalModelTrainingPort, ApprovedLocalTrainingControl, ApprovedLocalTrainingDefinition,
  ApprovedLocalTrainingSession, ApprovedLocalTrainingStagedInput} from "../../../../application/ports/model";
import type {RuntimeTaskRecord} from "../../../../contracts/runtime";
import {TaskType} from "../../../../contracts/runtime";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {capturePassiveModelData} from "./modelDownloadManifest";
import {mapTaskStatusResponse} from "../protocol/pythonRuntimeHttpProtocol";
import {types} from "node:util";

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
const unavailable = () => new Error("The original private training session is unavailable.");
const need = (value: unknown): void => {if (value !== true) throw unavailable();};
const copy = <T>(value: T): T => capturePassiveModelData(value) as T;
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
}): ApprovedLocalModelTrainingPort {
  const capture = options.captureChannel, reserve = options.reserve;
  return Object.freeze({createSession(raw: ApprovedLocalTrainingDefinition, rawControl: ApprovedLocalTrainingControl) {
    const definition = copy(raw), isCurrent = rawControl.isCurrent, allowed = rawControl.stillAllowed;
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
    current();
    const release = reserve.call(options, originalCapture);
    if (!release) return undefined;
    need(typeof release === "function");
    let phase: "bound" | "preparing" | "ready" | "issuing" | "accepted" | "unconfirmed" | "settled" = "bound";
    let channel: OriginalTrainingChannel | undefined, binding: Record<string, unknown> | undefined;
    let operations = 0, cancelAttempted = false, closeAttempted = false, closing = false;
    let remoteRetired = false, retireWorker: (() => Promise<boolean>) | undefined, releaseUnusedWorker: (() => void) | undefined;
    let cached: RuntimeTaskRecord | undefined, cancellation: boolean | undefined;
    const send = async (action: string, input?: unknown, dispatch?: () => void) => {
      need(!!channel && !!binding && phase !== "settled");
      const reply = exact(await channel!.send("/training/original/" + definition.requestId + "/" + action,
        {binding, ...(input === undefined ? {} : {input})}, dispatch),
        ["binding", ...(action === "read" ? ["record"] : action === "start" ? ["kind", "requestId", "workspaceId", "status"] :
          action === "cancel" ? ["cancelled"] : action === "settle" ? ["settled", "retirement"] : ["phase"])]);
      const original = exact(reply.binding, Object.keys(binding!));
      need(Object.keys(binding!).every(key => original[key] === binding![key]));
      return reply;
    };
    const session: ApprovedLocalTrainingSession = Object.freeze({requestId: definition.requestId, workspaceId: definition.workspaceId,
      async prepare() {
        need(phase === "bound"); phase = "preparing"; operations++;
        try {
          await permission(); const original = await capture.call(options, originalCapture); current();
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
          await permission();
          const reply = exact(await channel.send("/training/original/prepare", {identity: channel.identity, definition}, current), ["binding", "phase"]);
          const candidate = exact(reply.binding, ["runtimeId", "workerStartedAt", "profileId", "profileFingerprint", "requestId", "workspaceId", "sessionId"]);
          need(Object.keys(channel.identity).every(key => candidate[key] === channel!.identity[key as keyof OriginalTrainingIdentity]) &&
            candidate.requestId === definition.requestId && candidate.workspaceId === definition.workspaceId &&
            typeof candidate.sessionId === "string" && /^[a-f0-9]{64}$/.test(candidate.sessionId));
          binding = candidate;
          if (reply.phase === "unavailable") {
            // Only the original producer's positive no-effect/settlement reply.
            releaseUnusedWorker();
            phase = "settled"; release(); return "unavailable" as const;
          }
          need(reply.phase === "ready"); phase = "ready"; return "ready" as const;
        } catch {phase = "unconfirmed"; return "unconfirmed" as const;}
        finally {operations--;}
      },
      async start(input: ApprovedLocalTrainingStagedInput, admission: () => boolean) {
        need(phase === "ready" && !closing); phase = "issuing"; operations++;
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
          return {kind: "accepted" as const, requestId: definition.requestId, workspaceId: definition.workspaceId,
            status: reply.status as "queued" | "running"};
        } catch {phase = "unconfirmed"; return {kind: "unconfirmed" as const};}
        finally {operations--;}
      },
      async read() {
        await permission();
        if (phase === "settled" || remoteRetired) {need(!!cached); return copy(cached!);}
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
        await permission();
        if (phase === "settled" || remoteRetired) return {requestId: definition.requestId, status: cached?.status ?? "cancelled", cancelled: cancellation === true};
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
        if (phase === "settled") return true;
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
