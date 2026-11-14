import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { IpcMainHandlePort, IpcSenderTrustPolicy } from "../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import type { ConversationSessionRepositoryPort, ConversationTurnRepositoryPort } from "../../../application/ports/conversations";
import type { ExecutionRunRepositoryPort } from "../../../application/ports/execution-runs";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { normalizeConversationTurnId } from "../../../contracts/conversations";
import {
  DESKTOP_HEADLESS_CHAT_TASKS_CHANNEL, DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE as unavailable,
  DESKTOP_HEADLESS_CHAT_TASK_LIMIT, readDesktopHeadlessChatTaskRequest, readDesktopHeadlessChatTasks,
  type DesktopHeadlessChatTask, type DesktopHeadlessChatTasks,
} from "../../../contracts/headless/desktop-headless-chat-tasks";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

export function registerDesktopHeadlessTaskList(options: {
  readonly ipcMain: IpcMainHandlePort;
  readonly senderTrust: IpcSenderTrustPolicy;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly documents: StructuredDocumentStore;
  readonly identity: LocalIdentityProfile;
  readonly isOpen: () => boolean;
  readonly runs: Pick<ExecutionRunRepositoryPort, "listExecutionRuns">;
  readonly turns: Pick<ConversationTurnRepositoryPort, "getConversationTurnById">;
  readonly sessions: Pick<ConversationSessionRepositoryPort, "getConversationSessionById">;
}) {
  const { ipcMain, senderTrust, workspaces, documents, identity, isOpen, runs, turns, sessions } = options;
  if (documents.organizationId !== undefined) return;
  const { organizationId } = identity;
  // Status polling uses current policy without emitting an audit event each tick.
  const authorization = composeDesktopWorkspaceAuthorization({ documents, localIdentity: identity });
  let outstanding = 0;
  ipcMain.handle(DESKTOP_HEADLESS_CHAT_TASKS_CHANNEL, async (event, value: unknown): Promise<DesktopHeadlessChatTasks> => {
    const workspaceId = readDesktopHeadlessChatTaskRequest(value);
    const trusted = () => isOpen() && senderTrust.isTrustedSender(event);
    if (!workspaceId || !trusted() || outstanding >= 4) return unavailable;
    const allowed = async () => {
      if (!trusted()) return false;
      const workspace = await workspaces.readWorkspace(workspaceId);
      if (!trusted() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
          workspace.status !== "active") return false;
      await authorization.authorizeWorkspaceOperation({
        workspace, operation: "headless.conversation-tasks.list", requiredScopes: ["workspace:read", "asset:read", "runtime:read"],
      });
      return trusted();
    };

    outstanding++;
    try {
      if (!await allowed()) return unavailable;
      const { runs: recent } = await runs.listExecutionRuns({
        workspaceId, delegatedConversationOnly: true, limit: DESKTOP_HEADLESS_CHAT_TASK_LIMIT,
      });
      if (!trusted() || recent.length > DESKTOP_HEADLESS_CHAT_TASK_LIMIT) return unavailable;
      const tasks: DesktopHeadlessChatTask[] = [];
      for (const run of recent) {
        if (!trusted()) return unavailable;
        if (run.workspaceId !== workspaceId || run.archivedAt || run.status === "archived" ||
            run.sourceContextKind !== "conversation-turn" || !run.sourceContextId || run.sourceContextId.length > 128 ||
            !run.provenance.some((entry) => entry.kind === "execution-run-delegated-conversation" && entry.actorId === "application"))
          continue;
        const turnId = normalizeConversationTurnId(run.sourceContextId);
        if (turnId !== run.sourceContextId) continue;
        const turn = await turns.getConversationTurnById(workspaceId, turnId);
        if (!trusted()) return unavailable;
        if (turn?.id !== turnId || turn.workspaceId !== workspaceId || turn.sourceExecutionPlanId !== run.sourceExecutionPlanId ||
            turn.executionRunId !== run.id) continue;
        const session = await sessions.getConversationSessionById(workspaceId, turn.conversationSessionId);
        if (!trusted()) return unavailable;
        if (session?.id !== turn.conversationSessionId || session.workspaceId !== workspaceId || session.status === "archived" ||
            session.archivedAt || session.sourceExecutionPlanId !== turn.sourceExecutionPlanId ||
            !session.turnIds.includes(turnId)) continue;
        tasks.push({ sessionId: session.id, turnId, runId: run.id, status: run.status });
      }
      if (!await allowed() || !trusted()) return unavailable;
      return readDesktopHeadlessChatTasks({ status: "ready", workspaceId, tasks }, workspaceId);
    } catch { return unavailable; }
    finally { outstanding--; }
  });
}
