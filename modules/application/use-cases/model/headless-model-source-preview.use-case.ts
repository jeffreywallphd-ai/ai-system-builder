import {createHash} from "node:crypto";
import {types} from "node:util";
import type {ApplicationRequestContext} from "../../ports";
import type {ModelDownloadSourcePort} from "../../ports/model";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {readModelDownloadSource} from "../../../contracts/model";
import {isDesktopHeadlessClientId, readHeadlessModelSourcePreviewRequest, readHeadlessModelSourcePreviewValue,
  type HeadlessHostIncarnationId} from "../../../contracts/headless";

function copiedRequest(raw: unknown) {
  if (types.isProxy(raw)) throw new Error("Invalid source selector.");
  const outer = readStrictPassiveRecord(raw, ["version", "operation", "input"]);
  if (typeof outer.version !== "string" || typeof outer.operation !== "string" || types.isProxy(outer.input))
    throw new Error("Invalid source selector.");
  const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "modelId", "revision"]);
  if (Object.values(input).some(value => typeof value === "function" || typeof value === "object" && value !== null))
    throw new Error("Invalid source selector.");
  return copyBoundedPassiveData({...outer, input});
}
/** An explicit provider metadata read. No download/runtime, approval, task or write owner. */
export class PreviewHeadlessModelSourceUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId; readonly provider: ModelDownloadSourcePort}) {}

  async execute(raw: unknown, authority: {readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly context: ApplicationRequestContext; readonly clientId: string;
    readonly modelSourceRead: true;
    readonly stillAllowed: () => Promise<boolean>; readonly isCurrent: () => boolean}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    let parsed: ReturnType<typeof readHeadlessModelSourcePreviewRequest>;
    try {parsed = readHeadlessModelSourcePreviewRequest(copiedRequest(raw), authority.hostIncarnationId);}
    catch {return {ok: false, code: "headless.invalid-request"} as const;}
    if (!parsed.ok) return parsed;
    try {
      const request = Object.freeze({...parsed.request, input: Object.freeze({...parsed.request.input})});
      const originalContext = authority.context, context = Object.freeze({...originalContext});
      const {clientId, isCurrent, stillAllowed} = authority;
      if (authority.modelSourceRead !== true || !isOrganizationId(context.organizationId) || context.organizationId !== this.dependencies.organizationId ||
          !context.principalId || context.principalId.length > 160 || hasKnownPassiveCredential(context.principalId) ||
          !isDesktopHeadlessClientId(clientId) || context.workspaceId !== request.input.workspaceId) return forbidden;
      const current = () => {
        if (authority.modelSourceRead !== true || authority.context !== originalContext || authority.hostIncarnationId !== request.input.hostIncarnationId ||
            originalContext.organizationId !== context.organizationId || originalContext.principalId !== context.principalId ||
            originalContext.workspaceId !== context.workspaceId || authority.clientId !== clientId) return false;
        try {
          const value: unknown = isCurrent();
          if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
          return value === true && authority.modelSourceRead === true && authority.context === originalContext && authority.hostIncarnationId === request.input.hostIncarnationId && originalContext.organizationId === context.organizationId &&
            originalContext.principalId === context.principalId && originalContext.workspaceId === context.workspaceId && authority.clientId === clientId;
        } catch {return false;}
      };
      const allowed = async () => current() && await stillAllowed() === true && current();
      if (!await allowed() || !current()) return forbidden;
      const target = Object.freeze({provider: "huggingface" as const, modelId: request.input.modelId,
        ...(request.input.revision === undefined ? {} : {revision: request.input.revision})});
      let rawSource: unknown;
      try {rawSource = await this.dependencies.provider.inspectModelDownloadSource(target,
        Object.freeze({isCurrent: current, stillAllowed: allowed, maximumDurationMs: 4_000}));}
      catch {return await allowed() && current() ? unavailable : forbidden;}
      if (!await allowed() || !current()) return forbidden;
      const source = readModelDownloadSource(rawSource, target);
      const manifestDigest = "sha256:" + createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
      const value = readHeadlessModelSourcePreviewValue({workspaceId: request.input.workspaceId, source,
        manifestDigest, downloadApprovalRequired: true}, request.input);
      if (!await allowed() || !current()) return forbidden;
      return value ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {return unavailable;}
  }
}
