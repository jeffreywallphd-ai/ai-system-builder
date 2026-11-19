/** Private owned transport, not original actor/plan permission or Model storage. */
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {capturePassiveModelData} from "./modelDownloadManifest";
import {ModelSourceRecipient, type CapturedModelSourceBinding} from "./modelSourceRecipient";
import type {ModelSourceIdentityProbe} from "./modelSourceIdentity";

export const MODEL_SOURCE_SESSION_CAPABILITY = "ensure-model-download.source-session-v1";
const fail = () => new Error("The original model download job could not be confirmed.");
type SourcePhase = "prepared" | "running" | "awaiting-receiver" | "acknowledging" | "acknowledged" | "released" | "failed" | "uncertain" | "cancelled";
export interface ModelSourceTaskStatus {
  readonly requestId: string; readonly phase: SourcePhase; readonly cleanupPending: boolean;
  readonly receiverSettlementPending: boolean; readonly startAcknowledgementUnconfirmed: boolean;
  readonly binding: CapturedModelSourceBinding; readonly receivedBytes: number | null; readonly totalBytes: number;
  readonly errorCode?: string;
  readonly receipt?: {readonly task_id: string; readonly handoff_id: string; readonly model_id: string; readonly revision: string;
    readonly manifest_digest: string; readonly recipient_witness: string; readonly file_count: number; readonly size_bytes: number; readonly receipt_digest: string};
}
export interface CapturedModelSourceTask {
  readonly requestId: string; readonly workspaceId: string; readonly binding: CapturedModelSourceBinding;
  read(): Promise<ModelSourceTaskStatus>;
  acknowledge(phase: "receiver-observed" | "receiver-settled"): Promise<ModelSourceTaskStatus>;
  cancel(): Promise<{readonly cancelled: boolean; readonly source: ModelSourceTaskStatus}>;
}
export interface ModelSourceTaskSession {
  readonly identityProbe: ModelSourceIdentityProbe;
  start(receiver: unknown, workspaceId: string): Promise<{readonly kind: "accepted"; readonly task: CapturedModelSourceTask} | {readonly kind: "unconfirmed"}>;
}
type Transport = (endpoint: string, init: RequestInit, assertReceiver?: () => void) => Promise<{readonly ok: boolean; readonly payload: unknown}>;
const bindingKeys = ["version", "taskId", "acquisitionId", "handoffId", "modelId", "revision", "manifestDigest"] as const;
const sameBinding = (raw: unknown, expected: CapturedModelSourceBinding) => {
  const value = readStrictPassiveRecord(raw, bindingKeys);
  if (Object.keys(value).length !== bindingKeys.length || bindingKeys.some(key => value[key] !== expected[key])) throw fail();
};
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
function sourceStatus(raw: unknown, binding: CapturedModelSourceBinding, expectedBytes: number, expectedFiles: number): ModelSourceTaskStatus {
  try {
    const value = readStrictPassiveRecord(capturePassiveModelData(raw), ["requestId", "phase", "cleanupPending", "receiverSettlementPending",
      "startAcknowledgementUnconfirmed", "binding", "receivedBytes", "totalBytes", "errorCode", "receipt"]);
    sameBinding(value.binding, binding);
    const phase = value.phase;
    if (value.requestId !== binding.taskId || !["prepared", "running", "awaiting-receiver", "acknowledging", "acknowledged", "released", "failed", "uncertain", "cancelled"].includes(phase as string) ||
        typeof value.cleanupPending !== "boolean" || typeof value.receiverSettlementPending !== "boolean" ||
        typeof value.startAcknowledgementUnconfirmed !== "boolean" || value.totalBytes !== expectedBytes ||
        (value.receivedBytes !== null && (!Number.isSafeInteger(value.receivedBytes) || (value.receivedBytes as number) < 0 ||
          (value.receivedBytes as number) > expectedBytes))) throw fail();
    if (value.cleanupPending !== ["running", "awaiting-receiver", "acknowledging", "uncertain"].includes(phase as string) ||
        value.receiverSettlementPending !== (phase === "acknowledged") ||
        (["prepared", "cancelled"].includes(phase as string) && value.receivedBytes !== 0)) throw fail();
    if (value.errorCode !== undefined && (typeof value.errorCode !== "string" || !/^[a-z][a-z0-9_]{0,95}$/.test(value.errorCode))) throw fail();
    let receipt: ModelSourceTaskStatus["receipt"];
    if (value.receipt !== undefined) {
      const r = readStrictPassiveRecord(value.receipt, ["task_id", "handoff_id", "model_id", "revision", "manifest_digest", "recipient_witness", "file_count", "size_bytes", "receipt_digest"]);
      if (Object.keys(r).length !== 9 || r.task_id !== binding.taskId || r.handoff_id !== binding.handoffId || r.model_id !== binding.modelId ||
          r.revision !== binding.revision || r.manifest_digest !== binding.manifestDigest || !digest(r.recipient_witness) || !digest(r.receipt_digest) ||
          r.file_count !== expectedFiles || r.size_bytes !== expectedBytes) throw fail();
      receipt = r as unknown as ModelSourceTaskStatus["receipt"];
    }
    if ((["awaiting-receiver", "acknowledging", "acknowledged", "released"].includes(phase as string) && !receipt) ||
        (["prepared", "running", "failed", "cancelled"].includes(phase as string) && receipt)) throw fail();
    return capturePassiveModelData({...value, binding, ...(receipt ? {receipt} : {})}) as unknown as ModelSourceTaskStatus;
  } catch {throw fail();}
}
function acceptedStart(raw: unknown, binding: CapturedModelSourceBinding, workspaceId: string, runtimeId: string): boolean {
  try {
    const value = readStrictPassiveRecord(capturePassiveModelData(raw), ["requestId", "taskType", "accepted", "status", "startedAt", "updatedAt", "metadata"]);
    const metadata = readStrictPassiveRecord(value.metadata, ["runtimeId", "workspaceId"]);
    return value.requestId === binding.taskId && value.taskType === "ensure-model-download" && value.accepted === true &&
      ["queued", "running"].includes(value.status as string) && metadata.runtimeId === runtimeId && metadata.workspaceId === workspaceId;
  } catch {return false;}
}

/** Only the trusted HTTP client's already-owned capability capture composes this. */
export function createCapturedModelSourceTaskSession(identityProbe: ModelSourceIdentityProbe, transport: Transport): ModelSourceTaskSession {
  const current = identityProbe.assertCurrent;
  const request = async (endpoint: string, body?: unknown, assertReceiver?: () => void) => {
    current(); assertReceiver?.();
    const result = await transport(endpoint, {method: body === undefined ? "GET" : "POST",
      headers: {"content-type": "application/json"}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}, assertReceiver);
    current(); assertReceiver?.(); return result;
  };
  return Object.freeze({identityProbe, async start(receiver: unknown, workspaceId: string) {
    current();
    const binding = ModelSourceRecipient.capturedBinding(receiver);
    const issue = await ModelSourceRecipient.takeTaskRequest(receiver, workspaceId, identityProbe); current();
    let reply;
    try {reply = await ModelSourceRecipient.dispatchTaskRequest(receiver, guard => request("/tasks/start", issue, guard));}
    catch {return {kind: "unconfirmed" as const};}
    if (!reply.ok || !acceptedStart(reply.payload, binding, workspaceId, identityProbe.runtimeId)) return {kind: "unconfirmed" as const};
    const bytes = issue.payload.sourceManifest.source.totalBytes, files = issue.payload.sourceManifest.source.files.length;
    const base = "/tasks/" + binding.taskId + "/model-source";
    const parse = (raw: unknown) => sourceStatus(raw, binding, bytes, files);
    const task: CapturedModelSourceTask = Object.freeze({requestId: binding.taskId, workspaceId, binding,
      async read() {
        try {const reply = await request(base); if (!reply.ok) throw fail(); return parse(reply.payload);} catch {throw fail();}
      },
      async acknowledge(phase: "receiver-observed" | "receiver-settled") {
        try {
          current();
          const body = ModelSourceRecipient.prototype.acknowledgement.call(receiver, phase);
          const reply = await request(base + "/acknowledgement", body);
          if (!reply.ok) throw fail();
          return parse(reply.payload);
        } catch {throw fail();}
      },
      async cancel() {
        try {
          const reply = await request(base + "/cancel", binding); if (!reply.ok) throw fail();
          const value = readStrictPassiveRecord(capturePassiveModelData(reply.payload), ["cancelled", "source"]);
          if (Object.keys(value).length !== 2 || typeof value.cancelled !== "boolean") throw fail();
          const source = parse(value.source);
          if (value.cancelled && source.phase !== "cancelled") throw fail();
          return Object.freeze({cancelled: value.cancelled, source});
        } catch {throw fail();}
      }});
    return {kind: "accepted" as const, task};
  }});
}
