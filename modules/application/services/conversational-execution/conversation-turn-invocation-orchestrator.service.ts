import {
  normalizeAssistantVisibleResponseText,
  normalizeUserVisibleMessageText,
  type ConversationSessionRecord,
} from "../../../contracts/conversations";
import type { ExecutionApprovalRecord } from "../../../contracts/execution-runs";
import type {
  ApprovedConversationalInvocationSource,
  ConversationInvocationOrchestrationFailureStatus,
  ConversationInvocationOrchestrationResult,
  ConversationTurnInvocationPort,
  ConversationalInvocationContextPort,
  ConversationalInvocationRuntimeReference,
} from "../../ports/conversational-execution";
import type { ConversationSessionApprovalValidityService } from "../../use-cases/conversations";
import { ConversationalInvocationContextValidationService } from "./conversational-invocation-context-validation.service";
import { ConversationalRuntimeAdapterSelectionService } from "./conversational-runtime-adapter-selection.service";
import { ConversationalRuntimeGuardService } from "./conversational-runtime-guard.service";

export type ConversationTurnInvocationOrchestratorDependencies = Readonly<{
  approvalValidityService: Pick<
    ConversationSessionApprovalValidityService,
    "isValidForInvocation"
  >;
  adapterSelectionService: ConversationalRuntimeAdapterSelectionService;
  runtimeGuardService: ConversationalRuntimeGuardService;
  contextPort: ConversationalInvocationContextPort;
  contextValidationService: ConversationalInvocationContextValidationService;
  invocationPort: ConversationTurnInvocationPort;
}>;

export type ConversationTurnInvocationOrchestratorInput = Readonly<{
  workspaceId: string;
  session: ConversationSessionRecord;
  approval?: ExecutionApprovalRecord;
  runtime: ConversationalInvocationRuntimeReference;
  userTurnContent: string;
  conversationTurnId?: string;
  executionRunId?: string;
  executionAttemptId?: string;
  operationId?: string;
}>;

const SESSION_BLOCKING_STATUSES = new Set([
  "stale",
  "blocked",
  "invalid",
  "archived",
  "closed",
]);

const mapApprovalFailure = (
  reason: string | undefined,
): ConversationInvocationOrchestrationFailureStatus => {
  switch (reason) {
    case "approval-required":
    case "approval-invalidated":
    case "source-plan-not-ready":
    case "source-plan-stale":
    case "runtime-readiness-not-acceptable":
      return reason;
    default:
      return "approval-invalidated";
  }
};

const hasRequiredSessionAssociations = (
  input: ConversationTurnInvocationOrchestratorInput,
): boolean =>
  input.workspaceId.trim().length > 0 &&
  input.session.workspaceId === input.workspaceId &&
  Boolean(input.session.id) &&
  Boolean(input.session.sourceExecutionPlanId) &&
  Boolean(input.session.sourceCompositionPlanId) &&
  Boolean(input.session.sourceRuntimeReadinessBindingId) &&
  Boolean(input.session.executionApprovalId) &&
  Boolean(input.session.runtimeReferenceId) &&
  input.session.runtimeReferenceId === input.runtime.runtimeReferenceId &&
  input.runtime.capabilityKind === "text-generation" &&
  typeof input.runtime.runtimeId === "string" &&
  input.runtime.runtimeId.trim().length > 0 &&
  typeof input.runtime.selectedModelRecordId === "string" &&
  input.runtime.selectedModelRecordId.trim().length > 0;

const toApprovedSource = (
  input: ConversationTurnInvocationOrchestratorInput,
  approval: ExecutionApprovalRecord,
): ApprovedConversationalInvocationSource => ({
  workspaceId: input.workspaceId,
  conversationSessionId: input.session.id,
  sourceExecutionPlanId: input.session.sourceExecutionPlanId,
  sourceCompositionPlanId: input.session.sourceCompositionPlanId!,
  sourceRuntimeReadinessBindingId:
    input.session.sourceRuntimeReadinessBindingId!,
  executionApprovalId: approval.id,
  runtimeReferenceId: input.runtime.runtimeReferenceId,
});

/**
 * Coordinates one in-memory invocation only. Persistence, lifecycle recording,
 * cancellation, retry, and transport exposure remain outside this service.
 */
export class ConversationTurnInvocationOrchestratorService {
  public constructor(
    private readonly dependencies: ConversationTurnInvocationOrchestratorDependencies,
  ) {}

  public async invoke(
    input: ConversationTurnInvocationOrchestratorInput,
  ): Promise<ConversationInvocationOrchestrationResult> {
    if (!hasRequiredSessionAssociations(input)) {
      return { status: "invalid-request" };
    }

    try {
      normalizeUserVisibleMessageText(input.userTurnContent);
    } catch {
      return { status: "invalid-request" };
    }

    if (
      SESSION_BLOCKING_STATUSES.has(input.session.status) ||
      input.session.archivedAt ||
      input.session.closedAt
    ) {
      return { status: "session-not-eligible" };
    }

    let validity: Awaited<
      ReturnType<
        ConversationTurnInvocationOrchestratorDependencies["approvalValidityService"]["isValidForInvocation"]
      >
    >;
    try {
      validity =
        await this.dependencies.approvalValidityService.isValidForInvocation(
          input.session,
          input.approval,
        );
    } catch {
      return { status: "internal-unavailable" };
    }
    if (!validity.valid) {
      return { status: mapApprovalFailure(validity.reason) };
    }
    if (!input.approval) {
      return { status: "approval-invalidated" };
    }

    const source = toApprovedSource(input, input.approval);
    const selection = await this.dependencies.adapterSelectionService.select({
      source,
      runtime: input.runtime,
    });
    if (selection.status !== "supported") {
      return { status: selection.status };
    }

    const guard = await this.dependencies.runtimeGuardService.canInvoke({
      adapterId: selection.adapterId,
      source,
      runtime: input.runtime,
    });
    if (!guard.allowed) {
      return {
        status:
          guard.status === "ready" ? "internal-unavailable" : guard.status,
      };
    }

    let preparation: Awaited<
      ReturnType<
        ConversationalInvocationContextPort["prepareProtectedInvocationContext"]
      >
    >;
    try {
      preparation =
        await this.dependencies.contextPort.prepareProtectedInvocationContext({
          source,
          runtime: input.runtime,
          userTurnContent: input.userTurnContent,
          conversationTurnId: input.conversationTurnId,
          executionRunId: input.executionRunId,
          executionAttemptId: input.executionAttemptId,
          operationId: input.operationId,
        });
    } catch {
      return { status: "internal-unavailable" };
    }
    if (preparation.status !== "prepared") {
      if (preparation.status === "invalid") {
        return { status: "invalid-invocation-context" };
      }
      return { status: preparation.status };
    }

    const contextValidation =
      this.dependencies.contextValidationService.validate(preparation.context, {
        source,
        runtime: input.runtime,
      });
    if (!contextValidation.valid) {
      return {
        status: "invalid-invocation-context",
        reason: contextValidation.reason,
      };
    }

    let outcome: Awaited<
      ReturnType<ConversationTurnInvocationPort["invokeConversationTurn"]>
    >;
    try {
      outcome = await this.dependencies.invocationPort.invokeConversationTurn({
        source,
        runtime: input.runtime,
        context: preparation.context,
        conversationTurnId: input.conversationTurnId,
        executionRunId: input.executionRunId,
        executionAttemptId: input.executionAttemptId,
        operationId: input.operationId,
      });
    } catch {
      return { status: "internal-unavailable" };
    }

    if (outcome.status === "completed") {
      try {
        return {
          status: "completed",
          assistantResponseText: normalizeAssistantVisibleResponseText(
            outcome.assistantResponseText,
          ),
        };
      } catch {
        return { status: "failed", reason: "invalid-assistant-response" };
      }
    }
    if (outcome.status === "failed") {
      return { status: "failed", reason: outcome.code };
    }
    return { status: outcome.status };
  }
}
