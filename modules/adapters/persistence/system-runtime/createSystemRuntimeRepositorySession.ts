import type {
  AssistantResponseRepositoryPort,
  ConversationMessageRepositoryPort,
  ConversationOperationRepositoryPort,
  ConversationSessionRepositoryPort,
  ConversationTurnRepositoryPort,
} from "../../../application/ports/conversations";
import type {
  ExecutionApprovalRepositoryPort,
  ExecutionAttemptRepositoryPort,
  ExecutionEventRepositoryPort,
  ExecutionResultRepositoryPort,
  ExecutionRunRepositoryPort,
  ExecutionRuntimeReferenceRepositoryPort,
} from "../../../application/ports/execution-runs";
import type { SystemDataRepositoryPort } from "../../../application/ports/system-data";
import type {
  SystemRuntimeInstance,
  SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";
import { createLocalConversationRepositoryAdapters } from "../conversations";
import { createLocalExecutionRunRepositoryAdapters } from "../execution-runs";
import { createStructuredSystemDataRepository } from "../system-data";
import type { SystemRuntimeStructuredDataSessionProvider } from "./system-runtime-structured-data-session";

export interface SystemRuntimeRepositorySession {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly conversationSessionRepository: ConversationSessionRepositoryPort;
  readonly conversationTurnRepository: ConversationTurnRepositoryPort;
  readonly conversationMessageRepository: ConversationMessageRepositoryPort;
  readonly assistantResponseRepository: AssistantResponseRepositoryPort;
  readonly conversationOperationRepository: ConversationOperationRepositoryPort;
  readonly executionRunRepository: ExecutionRunRepositoryPort;
  readonly executionAttemptRepository: ExecutionAttemptRepositoryPort;
  readonly executionEventRepository: ExecutionEventRepositoryPort;
  readonly executionResultRepository: ExecutionResultRepositoryPort;
  readonly executionApprovalRepository: ExecutionApprovalRepositoryPort;
  readonly executionRuntimeReferenceRepository: ExecutionRuntimeReferenceRepositoryPort;
  readonly systemDataRepository: SystemDataRepositoryPort;
  close(): Promise<void>;
}

export function createSystemRuntimeRepositorySessionFactory(
  provider: SystemRuntimeStructuredDataSessionProvider,
) {
  return {
    async open(
      instance: SystemRuntimeInstance,
    ): Promise<SystemRuntimeRepositorySession> {
      if (
        instance.status === "deleted" ||
        instance.status === "deleting" ||
        instance.status === "failed"
      ) {
        throw safeSessionError(
          "runtime-repositories.lifecycle-conflict",
          "Runtime repositories are unavailable for this lifecycle state.",
        );
      }
      const session = await provider.acquire(instance);
      if (session.runtimeInstanceId !== instance.runtimeInstanceId) {
        await provider.release(session.runtimeInstanceId).catch(() => undefined);
        throw safeSessionError(
          "runtime-repositories.identity-mismatch",
          "The runtime repository session identity is invalid.",
        );
      }
      const documents = session.documents.forOrganization(
        instance.organizationId,
      );
      const conversations = createLocalConversationRepositoryAdapters({
        rootDir: ".",
        documents,
      });
      const execution = createLocalExecutionRunRepositoryAdapters({
        rootDir: ".",
        documents,
      });
      return {
        runtimeInstanceId: instance.runtimeInstanceId,
        ...conversations,
        executionRunRepository: execution.executionRunRepository,
        executionAttemptRepository: execution.executionAttemptRepository,
        executionEventRepository: execution.executionEventRepository,
        executionResultRepository: execution.executionResultRepository,
        executionApprovalRepository: execution.executionApprovalRepository,
        executionRuntimeReferenceRepository:
          execution.executionRuntimeReferenceRepository,
        systemDataRepository: createStructuredSystemDataRepository(documents),
        close: () => provider.release(instance.runtimeInstanceId),
      };
    },
  };
}

function safeSessionError(
  code: string,
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = "SystemRuntimeRepositorySessionError";
  error.code = code;
  error.stack = undefined;
  return error;
}
