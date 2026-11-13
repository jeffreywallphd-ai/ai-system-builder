import type { ConversationSessionRecord } from "../../../contracts/conversations";
import type { ExecutionApprovalRecord } from "../../../contracts/execution-runs";
import type { ExecutionAttemptRepositoryPort, ExecutionEventRepositoryPort, ExecutionRunRepositoryPort } from "../execution-runs";
import type { ConversationMessageRepositoryPort } from "./conversation-message-repository.port";
import type { ConversationTurnRepositoryPort } from "./conversation-turn-repository.port";

export type InitialConversationTurnWrites = {
  readonly messageRepository: Pick<ConversationMessageRepositoryPort, "saveConversationMessage">;
  readonly turnRepository: Pick<ConversationTurnRepositoryPort, "saveConversationTurn" | "getConversationTurnById" | "updateConversationTurn">;
  readonly executionRunRepository: Pick<ExecutionRunRepositoryPort, "saveExecutionRun" | "getExecutionRunById" | "updateExecutionRun">;
  readonly executionAttemptRepository: Pick<ExecutionAttemptRepositoryPort, "saveExecutionAttempt" | "getExecutionAttemptById" | "updateExecutionAttempt">;
  readonly executionEventRepository: Pick<ExecutionEventRepositoryPort, "appendExecutionEvent">;
};

export interface DelegatedConversationTurnAdmissionPort {
  /** Read both exact saved snapshots after async policy checks, without writes. */
  isStillCurrent(input: {
    readonly session: ConversationSessionRecord;
    readonly approval: ExecutionApprovalRecord;
    readonly isCurrent: () => boolean;
  }): Promise<boolean>;
  /** Compare and reserve within one owned transaction. The callback performs repository writes only. */
  admit(input: {
    readonly session: ConversationSessionRecord;
    readonly approval: ExecutionApprovalRecord;
    readonly turnId: ConversationSessionRecord["turnIds"][number];
    readonly operationId: string;
    readonly updatedAt: string;
    readonly isCurrent: () => boolean;
    readonly writeInitialRecords: (repositories: InitialConversationTurnWrites) => Promise<void>;
  }): Promise<ConversationSessionRecord | undefined>;
}
