import {createHash} from "node:crypto";
import {types} from "node:util";
import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId} from "../../../contracts/organization";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS, isDesktopHeadlessClientId, readHeadlessContextQueryPreviewRequest,
  readHeadlessContextQueryPreviewValue, type HeadlessContextQueryPreviewRequest} from "../../../contracts/headless";

type Target = Omit<HeadlessContextQueryPreviewRequest["input"], "query">;
type Authority = {readonly context: ApplicationRequestContext; readonly clientId: string;
  readonly isCurrent: () => boolean; readonly stillAllowed: () => Promise<boolean>};
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;

/** Hash synchronously; asynchronous metadata frames never retain caller/question data. */
export class PreviewHeadlessContextQueryUseCase {
  constructor(private readonly readInputs: (target: Pick<Target, "hostIncarnationId" | "workspaceId" | "reference">,
    context: ApplicationRequestContext, isCurrent: () => boolean) => Promise<unknown>) {}

  execute(raw: HeadlessContextQueryPreviewRequest, authority: Authority) {
    try {
      if (types.isProxy(raw)) throw new Error();
      const outer = readStrictPassiveRecord(raw, ["version", "operation", "input"]);
      if (types.isProxy(outer.input)) throw new Error();
      const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "reference", "query", "maximumResults", "embeddingDevice"]);
      if (types.isProxy(input.reference)) throw new Error();
      const parsed = readHeadlessContextQueryPreviewRequest(raw, input.hostIncarnationId as never);
      if (!parsed.ok) return Promise.resolve(parsed);
      const {query, ...copied} = parsed.request.input;
      const target = Object.freeze({...copied, reference: Object.freeze({...copied.reference})});
      const queryDigest = "sha256:" + createHash("sha256").update(query, "utf8").digest("hex");
      return this.preview(target, queryDigest, {context: Object.freeze({...authority.context}), clientId: authority.clientId,
        isCurrent: authority.isCurrent, stillAllowed: authority.stillAllowed});
    } catch {return Promise.resolve({ok: false, code: "headless.invalid-request"} as const);}
  }

  private async preview(target: Target, queryDigest: string, authority: Authority) {
    const {context, clientId, isCurrent, stillAllowed} = authority;
    try {
      if (!isOrganizationId(context.organizationId) || !context.principalId || context.principalId.length > 160 ||
          hasKnownPassiveCredential(context.principalId) || !isDesktopHeadlessClientId(clientId) || context.workspaceId !== target.workspaceId ||
          !isCurrent() || !await stillAllowed() || !isCurrent()) return forbidden;
      const raw = await this.readInputs(Object.freeze({hostIncarnationId: target.hostIncarnationId,
        workspaceId: target.workspaceId, reference: target.reference}), context, isCurrent);
      if (!isCurrent() || !await stillAllowed() || !isCurrent()) return forbidden;
      if (raw === undefined) return {ok: false, code: "headless.not-found"} as const;
      const facts = readStrictPassiveRecord(raw, ["modelRecordId", "modelUpdatedAt", "sourceCount"]);
      const value = readHeadlessContextQueryPreviewValue({...facts, reference: target.reference, queryDigest,
        maximumResults: target.maximumResults, embeddingDevice: target.embeddingDevice,
        maximumQueryCharacters: HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS, runtimeReadiness: "not-checked", byteAvailability: "not-checked",
        approvalRequired: true, output: "citation-summary"}, target, queryDigest);
      if (!isCurrent() || !await stillAllowed() || !isCurrent()) return forbidden;
      return value ? {ok: true, operation: "context.preview-query", value} as const : unavailable;
    } catch {
      try {return isCurrent() && await stillAllowed() && isCurrent() ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
