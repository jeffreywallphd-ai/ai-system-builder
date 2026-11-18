import type {ApplicationRequestContext} from "../../ports";
import {readHeadlessDatasetTaskReviewValue, type HeadlessDatasetTaskReviewRequest} from "../../../contracts/headless";

/** Review only a host-proven accepted task. Never materialize or approve it. */
export class ReadHeadlessDatasetTaskReviewUseCase {
  constructor(private readonly readAccepted: (request: HeadlessDatasetTaskReviewRequest, context: ApplicationRequestContext,
    clientId: string) => Promise<string | undefined>,
  private readonly readReview: (taskId: string, context: ApplicationRequestContext) => Promise<unknown>) {}

  async execute(request: HeadlessDatasetTaskReviewRequest, authority: {readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly stillAllowed: () => Promise<boolean>}) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    const {context, clientId, stillAllowed} = authority;
    if (!context.organizationId || !context.principalId || context.workspaceId !== request.input.workspaceId) return forbidden;
    try {
      if (!await stillAllowed()) return forbidden;
      const taskId = await this.readAccepted(request, context, clientId);
      if (!await stillAllowed() || !taskId) return forbidden;
      const raw = await this.readReview(taskId, context);
      if (!await stillAllowed()) return forbidden;
      const value = readHeadlessDatasetTaskReviewValue(raw, {kind: "task", taskId});
      return value ? {ok: true, operation: request.operation, value} as const : unavailable;
    } catch {try {return await stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}}
  }
}
