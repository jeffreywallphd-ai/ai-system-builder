import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, readHeadlessContextSavedRequest, readHeadlessContextSavedValue,
  type HeadlessContextSavedRequest} from "../../../contracts/headless";

/** Saved workspace metadata only. No task adoption, byte read or runtime owner. */
export class ReadHeadlessContextSavedUseCase {
  constructor(private readonly readSaved: (request: HeadlessContextSavedRequest, context: ApplicationRequestContext) => Promise<unknown>) {}
  async execute(raw: HeadlessContextSavedRequest, authority: {readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly stillAllowed: () => Promise<boolean>}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    try {
      const copied = copyBoundedPassiveData(raw) as HeadlessContextSavedRequest;
      const parsed = readHeadlessContextSavedRequest(copied, copied.input.hostIncarnationId);
      if (!parsed.ok) return parsed;
      const request = Object.freeze({...parsed.request, input: Object.freeze({...parsed.request.input})});
      const context = Object.freeze({...authority.context}), {clientId, stillAllowed} = authority;
      if (!isOrganizationId(context.organizationId) || !context.principalId || context.principalId.length > 160 ||
          hasKnownPassiveCredential(context.principalId) || !isDesktopHeadlessClientId(clientId) ||
          context.workspaceId !== request.input.workspaceId || !await stillAllowed()) return forbidden;
      const rawValue = await this.readSaved(request, context);
      if (!await stillAllowed()) return forbidden;
      if (rawValue === undefined) return {ok: false, code: "headless.not-found"} as const;
      const value = readHeadlessContextSavedValue(rawValue, request.input.workspaceId, request.input.contextId);
      return value ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {
      try {return await authority.stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
