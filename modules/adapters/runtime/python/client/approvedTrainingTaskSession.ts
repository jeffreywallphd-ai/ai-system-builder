/** Private original installed-runtime channel. No native producer is supplied here. */
import type {ApprovedLocalModelTrainingPort, ApprovedLocalTrainingControl, ApprovedLocalTrainingDefinition,
  ApprovedLocalTrainingSession, ApprovedLocalTrainingStagedInput} from "../../../../application/ports/model";
import type {RuntimeTaskRecord} from "../../../../contracts/runtime";
import {TaskType} from "../../../../contracts/runtime";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {capturePassiveModelData} from "./modelDownloadManifest";
import {mapTaskStatusResponse} from "../protocol/pythonRuntimeHttpProtocol";

export const ORIGINAL_TRAINING_CAPABILITY = "train-model.original-session-v1";
export interface OriginalTrainingProfile {readonly profileId: string; readonly profileFingerprint: string}
export interface OriginalTrainingIdentity extends OriginalTrainingProfile {readonly runtimeId: string; readonly workerStartedAt: string}
export interface OriginalTrainingChannel {
  readonly identity: OriginalTrainingIdentity;
  readonly assertCurrent: () => void;
  send(endpoint: string, body: unknown, beforeDispatch?: () => void): Promise<unknown>;
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
  captureChannel: () => Promise<OriginalTrainingChannel>;
  reserve: (requestId: string) => (() => void) | undefined;
}): ApprovedLocalModelTrainingPort {
  const capture = options.captureChannel, reserve = options.reserve;
  return Object.freeze({createSession(raw: ApprovedLocalTrainingDefinition, rawControl: ApprovedLocalTrainingControl) {
    const definition = copy(raw), isCurrent = rawControl.isCurrent, allowed = rawControl.stillAllowed;
    const current = () => {need(isCurrent.call(rawControl) === true);};
    current();
    const release = reserve(definition.requestId);
    if (!release) return undefined;
    let phase: "bound" | "preparing" | "ready" | "issuing" | "accepted" | "unconfirmed" | "settled" = "bound";
    let channel: OriginalTrainingChannel | undefined, binding: Record<string, unknown> | undefined;
    let operations = 0, cancelAttempted = false, closeAttempted = false, closing = false;
    let cached: RuntimeTaskRecord | undefined, cancellation: boolean | undefined;
    const permission = async () => {current(); need(await allowed.call(rawControl) === true); current();};
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
          await permission(); const original = await capture(); current();
          const identity = copy(original.identity), assertCurrent = original.assertCurrent, sendOriginal = original.send;
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
        if (phase === "settled") {need(!!cached); return copy(cached!);}
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
        if (phase === "settled") return {requestId: definition.requestId, status: cached?.status ?? "cancelled", cancelled: cancellation === true};
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
        if (operations || closeAttempted || closing) return false;
        if (phase === "bound") {phase = "settled"; release(); return true;}
        if (!binding) return false; // Lost preparation cannot adopt a record by ID.
        closing = true; operations++;
        try {
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
          need(operations === 1);
          phase = "settled"; release(); return true;
        } catch {phase = "unconfirmed"; return false;}
        finally {operations--; closing = false;}
      },
    });
    return session;
  }});
}
