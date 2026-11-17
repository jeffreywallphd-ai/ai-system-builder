import type {ApplicationRequestContext} from "../../ports";
import {readHeadlessDatasetTaskStatusValue, type HeadlessDatasetTaskStatusRequest} from "../../../contracts/headless";

/** The host proves the durable accepted association before the owning processor is resolved. */
export class ReadHeadlessDatasetTaskStatusUseCase {
  constructor(private readonly readAccepted: (request: HeadlessDatasetTaskStatusRequest, context: ApplicationRequestContext,
    clientId: string) => Promise<string | undefined>,
  private readonly readStatus: (taskId: string, context: ApplicationRequestContext) => Promise<unknown>) {}

  async execute(request: HeadlessDatasetTaskStatusRequest, authority: {readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly stillAllowed: () => Promise<boolean>}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    const {context, clientId, stillAllowed} = authority;
    if (!context.organizationId || !context.principalId || context.workspaceId !== request.input.workspaceId) return forbidden;
    try {
      if (!await stillAllowed()) return forbidden;
      const taskId = await this.readAccepted(request, context, clientId);
      if (!await stillAllowed()) return forbidden;
      if (!taskId) return forbidden;
      const raw = await this.readStatus(taskId, context);
      if (!await stillAllowed()) return forbidden;
      const value = readHeadlessDatasetTaskStatusValue(raw, {kind: "task", taskId});
      return value ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {try {return await stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}}
  }
}
