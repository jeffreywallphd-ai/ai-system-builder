import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, isHeadlessHostIncarnationId, readHeadlessContextTaskRequest,
  readHeadlessContextTaskValue, type HeadlessContextTaskRequest} from "../../../contracts/headless";

/** Prove a durable accepted association before resolving or polling the Context processor. */
export class ReadHeadlessContextTaskUseCase {
  constructor(private readonly readAccepted: (request: HeadlessContextTaskRequest, context: ApplicationRequestContext,
    clientId: string) => Promise<string | {readonly family: "query"; readonly taskId: string} | undefined>,
  private readonly readTask: (taskId: string, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>,
    family: "generation" | "query", isCurrent: () => boolean, request: HeadlessContextTaskRequest, clientId: string) => Promise<unknown>) {}

  async execute(raw: HeadlessContextTaskRequest, authority: {readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly stillAllowed: () => Promise<boolean>;
    readonly queryStillAllowed?: () => Promise<boolean>; readonly isCurrent?: () => boolean}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    try {
      const copied = copyBoundedPassiveData(raw) as HeadlessContextTaskRequest;
      const parsed = readHeadlessContextTaskRequest(copied, copied.input.hostIncarnationId);
      if (!parsed.ok) return parsed;
      const request = Object.freeze({...parsed.request, input: Object.freeze({...parsed.request.input,
        selection: Object.freeze({...parsed.request.input.selection})})});
      const context = Object.freeze({...authority.context}), {clientId, stillAllowed, queryStillAllowed} = authority;
      const live = authority.isCurrent ?? (() => true);
      const allowed = async (policy: () => Promise<boolean>) => live() && await policy() && live();
      if (!isOrganizationId(context.organizationId) || !context.principalId || context.principalId.length > 160 ||
          hasKnownPassiveCredential(context.principalId) || !isDesktopHeadlessClientId(clientId) ||
          context.workspaceId !== request.input.workspaceId) return forbidden;
      if (!await allowed(stillAllowed) || !live()) return forbidden;
      const accepted = await this.readAccepted(request, context, clientId);
      if (!await allowed(stillAllowed) || !live()) return forbidden;
      let taskId: unknown = accepted, family: "generation" | "query" = "generation";
      if (accepted && typeof accepted === "object") {
        const row = readStrictPassiveRecord(accepted, ["family", "taskId"]);
        if (row.family !== "query") return forbidden;
        taskId = row.taskId; family = "query";
      }
      if (!isHeadlessHostIncarnationId(taskId) ||
          (request.input.selection.kind === "task" && request.input.selection.taskId !== taskId)) return forbidden;
      const policy = family === "query" ? queryStillAllowed : stillAllowed;
      if (!policy || !await allowed(policy) || !live()) return forbidden;
      const rawTask = await this.readTask(taskId, context, () => allowed(policy), family, live, request, clientId);
      if (!await allowed(policy) || !live()) return forbidden;
      const value = readHeadlessContextTaskValue(rawTask, {kind: "task", taskId});
      return value && ("query" in value) === (family === "query") ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {
      try {return (authority.isCurrent?.() ?? true) && await authority.stillAllowed() && (authority.isCurrent?.() ?? true) ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
