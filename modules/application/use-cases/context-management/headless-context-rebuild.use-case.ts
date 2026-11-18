import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, readHeadlessContextRebuildRequest, readHeadlessContextRebuildValue,
  type HeadlessContextRebuildRequest} from "../../../contracts/headless";

/** Recorded build metadata only. A new effect still needs a separate exact approval. */
export class ReadHeadlessContextRebuildUseCase {
  constructor(private readonly readInputs: (request: HeadlessContextRebuildRequest, context: ApplicationRequestContext,
    isCurrent: () => boolean) => Promise<unknown>) {}

  async execute(raw: HeadlessContextRebuildRequest, authority: {readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly isCurrent: () => boolean; readonly stillAllowed: () => Promise<boolean>}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    try {
      const copied = copyBoundedPassiveData(raw) as HeadlessContextRebuildRequest;
      const parsed = readHeadlessContextRebuildRequest(copied, copied.input.hostIncarnationId);
      if (!parsed.ok) return parsed;
      const request = Object.freeze({...parsed.request, input: Object.freeze({...parsed.request.input,
        reference: Object.freeze({...parsed.request.input.reference})})});
      const context = Object.freeze({...authority.context}), {clientId, isCurrent, stillAllowed} = authority;
      if (!isOrganizationId(context.organizationId) || !context.principalId || context.principalId.length > 160 ||
          hasKnownPassiveCredential(context.principalId) || !isDesktopHeadlessClientId(clientId) ||
          context.workspaceId !== request.input.workspaceId || !isCurrent() || !await stillAllowed()) return forbidden;
      const rawValue = await this.readInputs(request, context, isCurrent);
      if (!isCurrent() || !await stillAllowed()) return forbidden;
      if (rawValue === undefined) return {ok: false, code: "headless.not-found"} as const;
      const value = readHeadlessContextRebuildValue(rawValue, request.input);
      if (!isCurrent() || !await stillAllowed()) return forbidden;
      return value ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {
      try {return authority.isCurrent() && await authority.stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
