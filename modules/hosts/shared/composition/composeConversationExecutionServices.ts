import { randomUUID } from "node:crypto";
import {
  ConversationSessionReadModelService,
  ConversationSessionSourceSummaryService,
  ConversationTranscriptReadModelService,
  ConversationTurnActivityReadModelService,
  type ConversationSessionHostCapabilities,
} from "../../../application/services/conversations";
import {
  ConversationTurnInvocationOrchestratorService,
  ConversationalInvocationContextValidationService,
  ConversationalRuntimeAdapterSelectionService,
  ConversationalRuntimeGuardService,
} from "../../../application/services/conversational-execution";
import {
  ApproveConversationSessionUseCase,
  CancelConversationTurnUseCase,
  ConversationSessionApprovalValidityService,
  ConversationalExecutionPlanEligibilityService,
  ConversationalSourceSystemVerificationService,
  CreateConversationExecutionSessionFromPlanUseCase,
  RetryConversationTurnUseCase,
  SubmitConversationTurnUseCase,
} from "../../../application/use-cases/conversations";
import type {
  ConversationSessionRepositoryPort,
  ConversationTurnRepositoryPort,
  ConversationMessageRepositoryPort,
  AssistantResponseRepositoryPort,
  ConversationOperationRepositoryPort,
} from "../../../application/ports/conversations";
import type {
  ConversationalRuntimeAdapterCatalogPort,
  ConversationalRuntimeGuardPort,
  ConversationTurnInvocationPort,
} from "../../../application/ports/conversational-execution";
import type { AssetCompositionPlanRepositoryPort } from "../../../application/ports/asset-composition";
import type { ExecutionPlanRepositoryPort } from "../../../application/ports/execution-plans";
import type {
  ExecutionApprovalRepositoryPort,
  ExecutionAttemptRepositoryPort,
  ExecutionEventRepositoryPort,
  ExecutionResultRepositoryPort,
  ExecutionRunRepositoryPort,
  ExecutionRuntimeReferenceRepositoryPort,
} from "../../../application/ports/execution-runs";
import type { RuntimeReadinessBindingRepositoryPort } from "../../../application/ports/runtime-readiness";

export interface ComposeConversationExecutionServicesDependencies {
  conversationSessionRepository: ConversationSessionRepositoryPort;
  conversationTurnRepository: ConversationTurnRepositoryPort;
  conversationMessageRepository: ConversationMessageRepositoryPort;
  assistantResponseRepository: AssistantResponseRepositoryPort;
  conversationOperationRepository: ConversationOperationRepositoryPort;
  executionPlanRepository: ExecutionPlanRepositoryPort;
  runtimeReadinessBindingRepository: RuntimeReadinessBindingRepositoryPort;
  assetCompositionPlanRepository: AssetCompositionPlanRepositoryPort;
  executionApprovalRepository: ExecutionApprovalRepositoryPort;
  executionRunRepository: ExecutionRunRepositoryPort;
  executionAttemptRepository: ExecutionAttemptRepositoryPort;
  executionEventRepository: ExecutionEventRepositoryPort;
  executionResultRepository: ExecutionResultRepositoryPort;
  executionRuntimeReferenceRepository: ExecutionRuntimeReferenceRepositoryPort;
  adapterCatalog: ConversationalRuntimeAdapterCatalogPort;
  runtimeGuard: ConversationalRuntimeGuardPort;
  invocationPort: ConversationTurnInvocationPort;
  hostCapabilities: ConversationSessionHostCapabilities;
  now?: () => string;
}

export function composeConversationExecutionServices(
  d: ComposeConversationExecutionServicesDependencies,
) {
  const eligibilityService =
    new ConversationalExecutionPlanEligibilityService();
  const sourceVerificationService =
    new ConversationalSourceSystemVerificationService();
  const approvalValidityService =
    new ConversationSessionApprovalValidityService({
      executionPlanRepository: d.executionPlanRepository,
      runtimeReadinessRepository: d.runtimeReadinessBindingRepository,
      assetCompositionPlanRepository: d.assetCompositionPlanRepository,
      eligibilityService,
      sourceVerificationService,
    });
  const adapterSelectionService =
    new ConversationalRuntimeAdapterSelectionService(d.adapterCatalog);
  const runtimeGuardService = new ConversationalRuntimeGuardService(
    d.runtimeGuard,
  );
  const sourceSummary = new ConversationSessionSourceSummaryService({
    executionPlanRepository: d.executionPlanRepository,
    assetCompositionPlanRepository: d.assetCompositionPlanRepository,
    sourceVerificationService,
  });
  const readSessions = new ConversationSessionReadModelService(
    d.conversationSessionRepository,
    d.conversationTurnRepository,
    d.assistantResponseRepository,
    d.executionRunRepository,
    {
      approvalRepository: d.executionApprovalRepository,
      runtimeReferenceRepository: d.executionRuntimeReferenceRepository,
      approvalValidityService,
      adapterSelectionService,
      runtimeGuardService,
      hostCapabilities: d.hostCapabilities,
    },
    sourceSummary,
  );

  const orchestrator = new ConversationTurnInvocationOrchestratorService({
    approvalValidityService,
    adapterSelectionService,
    runtimeGuardService,
    contextValidationService:
      new ConversationalInvocationContextValidationService(),
    contextPort: {
      async prepareProtectedInvocationContext(request) {
        return {
          status: "prepared" as const,
          context: {
            contextKind: "protected-conversational-invocation" as const,
            source: request.source,
            runtime: request.runtime,
            userTurnContent: request.userTurnContent,
          },
        };
      },
    },
    invocationPort: d.invocationPort,
  });

  const submitTurn = new SubmitConversationTurnUseCase({
    sessionRepository: d.conversationSessionRepository,
    turnRepository: d.conversationTurnRepository,
    messageRepository: d.conversationMessageRepository,
    assistantResponseRepository: d.assistantResponseRepository,
    operationRepository: d.conversationOperationRepository,
    executionRunRepository: d.executionRunRepository,
    executionAttemptRepository: d.executionAttemptRepository,
    executionEventRepository: d.executionEventRepository,
    executionResultRepository: d.executionResultRepository,
    runtimeReferenceRepository: d.executionRuntimeReferenceRepository,
    approvalRepository: d.executionApprovalRepository,
    approvalValidityService,
    adapterSelectionService,
    runtimeGuardService,
    orchestrator,
    nextId: () => `ce.${randomUUID()}`,
    now: d.now,
  });

  return {
    create: new CreateConversationExecutionSessionFromPlanUseCase({
      sessionRepository: d.conversationSessionRepository,
      executionPlanRepository: d.executionPlanRepository,
      runtimeReadinessRepository: d.runtimeReadinessBindingRepository,
      assetCompositionPlanRepository: d.assetCompositionPlanRepository,
      eligibilityService,
      sourceVerificationService,
      nextConversationSessionId: () => `cs.${randomUUID()}`,
      now: d.now,
    }),
    approve: new ApproveConversationSessionUseCase({
      sessionRepository: d.conversationSessionRepository,
      approvalRepository: d.executionApprovalRepository,
      executionRuntimeReferenceRepository:
        d.executionRuntimeReferenceRepository,
      executionPlanRepository: d.executionPlanRepository,
      runtimeReadinessRepository: d.runtimeReadinessBindingRepository,
      assetCompositionPlanRepository: d.assetCompositionPlanRepository,
      eligibilityService,
      sourceVerificationService,
      nextApprovalId: () => `ea.${randomUUID()}`,
      nextRuntimeReferenceId: () => `err.${randomUUID()}`,
      now: d.now,
    }),
    submitTurn,
    cancelTurn: new CancelConversationTurnUseCase({
      turnRepository: d.conversationTurnRepository,
      executionRunRepository: d.executionRunRepository,
      operationRepository: d.conversationOperationRepository,
      now: d.now,
    }),
    retryTurn: new RetryConversationTurnUseCase({
      turnRepository: d.conversationTurnRepository,
      operationRepository: d.conversationOperationRepository,
      submitUseCase: submitTurn,
      now: d.now,
    }),
    readSessions,
    readTranscript: new ConversationTranscriptReadModelService(
      d.conversationTurnRepository,
      d.conversationMessageRepository,
      d.assistantResponseRepository,
    ),
    readActivity: new ConversationTurnActivityReadModelService(
      d.conversationTurnRepository,
      d.assistantResponseRepository,
      d.executionRunRepository,
      d.executionAttemptRepository,
      d.executionEventRepository,
    ),
  };
}
