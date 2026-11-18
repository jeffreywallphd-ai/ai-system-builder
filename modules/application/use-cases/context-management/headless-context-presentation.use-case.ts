import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {hasKnownPassiveCredential} from "../../../contracts/shared";
import {isUiContextPresentationIntent, readUiPresentationIntent, readUiPresentationDetail,
  readHeadlessContextSavedValue, readHeadlessContextTaskValue,
  type UiContextPresentationIntent, type UiPresentationDetail} from "../../../contracts/headless";

/** Fixed interactive metadata only. Current window/artifact authority stays with the host. */
export class ReadHeadlessContextPresentationUseCase {
  constructor(private readonly dependencies: {
    readonly readSaved: (contextId: string, context: ApplicationRequestContext) => Promise<unknown>;
    /** Must prove exact accepted host/actor ownership before cached processor access. */
    readonly readAcceptedTask: (taskId: string, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) => Promise<unknown>;
  }) {}

  async execute(raw: UiContextPresentationIntent, rawContext: ApplicationRequestContext,
    stillAllowed: () => Promise<boolean>): Promise<UiPresentationDetail | undefined> {
    const intent = readUiPresentationIntent(raw), context = Object.freeze({...rawContext});
    if (!intent || !isUiContextPresentationIntent(intent) || !isOrganizationId(context.organizationId) ||
        !isWorkspaceId(context.workspaceId) || !context.principalId || context.principalId.length > 160 ||
        hasKnownPassiveCredential(context.principalId)) return;
    try {
      if (intent.action === "show-context-artifact" && intent.reference.workspaceId !== context.workspaceId) return;
      if (!await stillAllowed()) return;
      if (intent.action === "show-context-task") {
        const task = readHeadlessContextTaskValue(await this.dependencies.readAcceptedTask(intent.taskId, context, stillAllowed),
          {kind: "task", taskId: intent.taskId});
        if (!task || !await stillAllowed()) return;
        return readUiPresentationDetail({title: "Context task", summary: task.review
          ? `Review required. Sources: ${task.review.sourceCount}. Chunks: ${task.review.chunkCount}. Size: ${task.review.sizeBytes} bytes. Approve saving separately.`
          : `Task status: ${task.state}.`});
      }
      const ref = intent.reference;
      const saved = readHeadlessContextSavedValue(await this.dependencies.readSaved(ref.contextId, context), context.workspaceId, ref.contextId);
      if (!saved || !await stillAllowed() || saved.reference.taskId !== ref.taskId || saved.reference.kind !== ref.kind ||
          saved.reference.artifactDigest !== ref.artifactDigest) return;
      return readUiPresentationDetail({title: ref.kind === "rag-database" ? "Saved RAG database" : "Saved context pack",
        summary: `Sources: ${saved.sourceCount}. Chunks: ${saved.chunkCount}. Size: ${saved.sizeBytes} bytes. File availability has not been checked.`});
    } catch {return;}
  }
}
