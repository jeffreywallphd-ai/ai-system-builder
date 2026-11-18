import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, isHeadlessHostIncarnationId, readHeadlessContextTaskRequest,
  readHeadlessContextTaskValue, type HeadlessContextTaskRequest} from "../../../contracts/headless";

/** Prove a durable accepted association before resolving or polling the Context processor. */
export class ReadHeadlessContextTaskUseCase {
  constructor(private readonly readAccepted: (request: HeadlessContextTaskRequest, context: ApplicationRequestContext,
    clientId: string) => Promise<string | undefined>,
  private readonly readTask: (taskId: string, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) => Promise<unknown>) {}

  async execute(raw: HeadlessContextTaskRequest, authority: {readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly stillAllowed: () => Promise<boolean>}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    try {
      const copied = copyBoundedPassiveData(raw) as HeadlessContextTaskRequest;
      const parsed = readHeadlessContextTaskRequest(copied, copied.input.hostIncarnationId);
      if (!parsed.ok) return parsed;
      const request = Object.freeze({...parsed.request, input: Object.freeze({...parsed.request.input,
        selection: Object.freeze({...parsed.request.input.selection})})});
      const context = Object.freeze({...authority.context}), {clientId, stillAllowed} = authority;
      if (!isOrganizationId(context.organizationId) || !context.principalId || context.principalId.length > 160 ||
          hasKnownPassiveCredential(context.principalId) || !isDesktopHeadlessClientId(clientId) ||
          context.workspaceId !== request.input.workspaceId) return forbidden;
      if (!await stillAllowed()) return forbidden;
      const taskId = await this.readAccepted(request, context, clientId);
      if (!await stillAllowed()) return forbidden;
      if (!isHeadlessHostIncarnationId(taskId) ||
          (request.input.selection.kind === "task" && request.input.selection.taskId !== taskId)) return forbidden;
      const rawTask = await this.readTask(taskId, context, stillAllowed);
      if (!await stillAllowed()) return forbidden;
      const value = readHeadlessContextTaskValue(rawTask, {kind: "task", taskId});
      return value ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {
      try {return await authority.stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
