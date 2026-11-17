import type { ConversationSessionRepositoryPort, ConversationTurnRepositoryPort } from "../../ports/conversations";
import type { ExecutionRunRepositoryPort } from "../../ports/execution-runs";
import { normalizeConversationSessionId, normalizeConversationTurnId, normalizeConversationTurnStatus } from "../../../contracts/conversations";
import { isExecutionRunStatus, normalizeExecutionRunId } from "../../../contracts/execution-runs";
import { hasKnownPassiveCredential } from "../../../contracts/shared";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";

const denied = { ok: false, code: "headless.forbidden" } as const;
const missing = { ok: false, code: "headless.not-found" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

export class HeadlessConversationStatusUseCase {
  public constructor(private readonly repositories: {
    readonly sessions: Pick<ConversationSessionRepositoryPort, "getConversationSessionById">;
    readonly turns: Pick<ConversationTurnRepositoryPort, "getConversationTurnById">;
    readonly runs: Pick<ExecutionRunRepositoryPort, "getExecutionRunById">;
  }) {}

  /** No task start/cancel port. Match the same saved turn and run used by the UI. */
  public async read(workspaceId: WorkspaceId, rawSessionId: string, rawTurnId: string, canRead: () => Promise<boolean>) {
    const allowed = async () => { try { return await canRead(); } catch { return false; } };
    if (!isWorkspaceId(workspaceId) || !await allowed()) return denied;
    try {
      if (!safeId(rawSessionId) || !safeId(rawTurnId)) return missing;
      const sessionId = normalizeConversationSessionId(rawSessionId);
      const turnId = normalizeConversationTurnId(rawTurnId);
      if (sessionId !== rawSessionId || turnId !== rawTurnId) return missing;
      const session = await this.repositories.sessions.getConversationSessionById(workspaceId, sessionId);
      if (!await allowed()) return denied;
      if (!session || session.id !== sessionId || session.workspaceId !== workspaceId || session.status === "archived") return missing;
      const turn = await this.repositories.turns.getConversationTurnById(workspaceId, turnId);
      if (!await allowed()) return denied;
      if (!turn || turn.id !== turnId || turn.workspaceId !== workspaceId || turn.conversationSessionId !== sessionId ||
          turn.sourceExecutionPlanId !== session.sourceExecutionPlanId) return missing;
      if (normalizeConversationTurnStatus(turn.status) !== turn.status) return unavailable;
      if (!turn.executionRunId) return { ok: true, value: { sessionId, turnId, turnStatus: turn.status, run: null } } as const;
      if (!safeId(turn.executionRunId) || normalizeExecutionRunId(turn.executionRunId) !== turn.executionRunId) return unavailable;
      const run = await this.repositories.runs.getExecutionRunById(workspaceId, turn.executionRunId);
      if (!await allowed()) return denied;
      if (!run || run.id !== turn.executionRunId || run.workspaceId !== workspaceId ||
          run.sourceExecutionPlanId !== session.sourceExecutionPlanId || run.sourceContextKind !== "conversation-turn" ||
          run.sourceContextId !== turnId || !isExecutionRunStatus(run.status)) return unavailable;
      return { ok: true, value: { sessionId, turnId, turnStatus: turn.status, run: { runId: run.id, status: run.status } } } as const;
    } catch { return unavailable; }
  }
}

function safeId(value: string) {
  return typeof value === "string" && value.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/.test(value) &&
    !/[\r\n]/.test(value) && !value.includes("..") && !hasKnownPassiveCredential(value);
}
