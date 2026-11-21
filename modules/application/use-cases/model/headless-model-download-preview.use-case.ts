import {createHash} from "node:crypto";
import {types} from "node:util";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, readHeadlessModelDownloadPlanRequest, readHeadlessModelSourcePreviewValue,
  type HeadlessModelDownloadPlanRequest} from "../../../contracts/headless";
import type {PreviewHeadlessModelSourceUseCase} from "./headless-model-source-preview.use-case";

type Authority = Parameters<PreviewHeadlessModelSourceUseCase["execute"]>[1];
function passive(raw: unknown): unknown {
  let nodes = 0;
  function inspect(value: unknown, depth = 0) {
    if (++nodes > 4096 || depth > 12) throw new Error("Model proposal exceeds its bound.");
    if (!value || typeof value !== "object") return;
    if (types.isProxy(value)) throw new Error("Active model proposal is unavailable.");
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("Active model proposal is unavailable.");
    const keys = Reflect.ownKeys(value);
    if (keys.length > (Array.isArray(value) ? 1025 : 128)) throw new Error("Model proposal exceeds its bound.");
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field || !("value" in field)) throw new Error("Active model proposal is unavailable.");
      inspect(field.value, depth + 1);
    }
  }
  inspect(raw); return copyBoundedPassiveData(raw);
}
/** Bounded Node ingress for passive Model workflow data, with no active hooks. */
export {passive as copyHeadlessModelWorkflowData};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}

/** Metadata preparation only. Hosts must call it before their owned proposal
 * transaction, bind its data there, and separately obtain exact transfer approval.
 * It has no transaction, filesystem, runtime, task or registry dependency. */
export class PrepareHeadlessModelDownloadPlanUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId;
    readonly sourcePreview: Pick<PreviewHeadlessModelSourceUseCase, "execute">}) {}

  async execute(raw: unknown, authority: Authority) {
    const invalid = {ok: false, code: "headless.invalid-request"} as const;
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    let request: HeadlessModelDownloadPlanRequest;
    let captured: Record<string, unknown>;
    try {
      if (types.isProxy(authority)) return forbidden;
      captured = readStrictPassiveRecord(authority, ["hostIncarnationId", "context", "clientId", "modelSourceRead", "isCurrent", "stillAllowed"]);
      if (types.isProxy(captured.context)) return forbidden;
      const decoded = readHeadlessModelDownloadPlanRequest(passive(raw), captured.hostIncarnationId as Authority["hostIncarnationId"]);
      if (!decoded.ok) return decoded;
      request = freeze(decoded.request);
    } catch {return invalid;}
    try {
      const originalContext = captured.context as Authority["context"];
      const actor = readStrictPassiveRecord(originalContext, ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"]);
      const context = Object.freeze({organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: actor.workspaceId});
      const {isCurrent, stillAllowed, clientId} = captured as unknown as Authority;
      if (typeof isCurrent !== "function" || types.isProxy(isCurrent) || typeof stillAllowed !== "function" || types.isProxy(stillAllowed) ||
          !isOrganizationId(context.organizationId) || context.organizationId !== this.dependencies.organizationId ||
          typeof context.principalId !== "string" || !context.principalId || context.principalId.length > 160 || hasKnownPassiveCredential(context.principalId) ||
          context.workspaceId !== request.input.workspaceId || !isDesktopHeadlessClientId(clientId) || captured.modelSourceRead !== true) return forbidden;
      const current = () => {
        try {
          const result: unknown = isCurrent();
          if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
          const actual = readStrictPassiveRecord(authority, ["hostIncarnationId", "context", "clientId", "modelSourceRead", "isCurrent", "stillAllowed"]);
          const actor = readStrictPassiveRecord(originalContext, ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"]);
          return result === true && actual.context === originalContext && actual.modelSourceRead === true &&
            actual.clientId === clientId && actual.hostIncarnationId === request.input.hostIncarnationId &&
            actor.organizationId === context.organizationId && actor.principalId === context.principalId && actor.workspaceId === context.workspaceId;
        } catch {return false;}
      };
      if (!current() || await stillAllowed() !== true || !current()) return forbidden;
      const selected = request.input.sourceManifest.source;
      const result = passive(await this.dependencies.sourcePreview.execute({version: request.version, operation: "models.preview-source",
        input: {hostIncarnationId: request.input.hostIncarnationId, workspaceId: request.input.workspaceId,
          modelId: selected.modelId, revision: selected.revision}}, {
        hostIncarnationId: request.input.hostIncarnationId, context: context as Authority["context"], clientId, modelSourceRead: true,
        isCurrent: current, stillAllowed,
      }));
      if (!current() || await stillAllowed() !== true || !current()) return forbidden;
      const response = readStrictPassiveRecord(result, ["ok", "operation", "value", "code"]);
      if (response.ok !== true || response.operation !== "models.preview-source" || "code" in response) return unavailable;
      const preview = readHeadlessModelSourcePreviewValue(response.value, {hostIncarnationId: request.input.hostIncarnationId,
        workspaceId: request.input.workspaceId, modelId: selected.modelId, revision: selected.revision});
      if (!preview || preview.manifestDigest !== "sha256:" + createHash("sha256").update(JSON.stringify(preview.source)).digest("hex")) return unavailable;
      if (preview.manifestDigest !== request.input.sourceManifest.manifestDigest ||
          JSON.stringify(preview.source) !== JSON.stringify(selected)) return {ok: false, code: "headless.stale"} as const;
      if (!current() || await stillAllowed() !== true || !current()) return forbidden;
      return {ok: true, prepared: freeze({request, sourceManifest: {source: preview.source, manifestDigest: preview.manifestDigest},
        temporaryStorageEstimateBytes: selected.totalBytes * 2, downloadApprovalRequired: true as const,
        fileTransferAccess: "public-without-credentials" as const,
        bytesVerification: "not-checked" as const, runtimeReadiness: "not-checked" as const})} as const;
    } catch {return unavailable;}
  }
}
