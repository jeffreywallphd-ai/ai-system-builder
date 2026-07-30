import {
  normalizeUserVisibleMessageText,
  type ConversationFailure,
  type ConversationSuccess,
} from "../../../contracts/conversations";
import { createWorkspaceId } from "../../../contracts/workspace";
import { ConversationTurnFailureClassificationService } from "./conversation-turn-failure-classification.service";
import type {
  ConversationSessionRepositoryPort,
  ConversationTurnRepositoryPort,
  ConversationMessageRepositoryPort,
  AssistantResponseRepositoryPort,
  ConversationOperationRepositoryPort,
} from "../../ports/conversations";
import type {
  ExecutionApprovalRepositoryPort,
  ExecutionAttemptRepositoryPort,
  ExecutionEventRepositoryPort,
  ExecutionResultRepositoryPort,
  ExecutionRunRepositoryPort,
  ExecutionRuntimeReferenceRepositoryPort,
} from "../../ports/execution-runs";
import type {
  ConversationTurnInvocationOrchestratorService,
  ConversationalRuntimeAdapterSelectionService,
  ConversationalRuntimeGuardService,
} from "../../services/conversational-execution";
import { ConversationSessionApprovalValidityService } from "./conversation-session-approval-validity.service";

export type SubmitConversationTurnCommand = {
  workspaceId: string;
  conversationSessionId: string;
  text: string;
  operationId: string;
};
export type SubmitConversationTurnResult =
  | ConversationSuccess<{
      conversationTurnId: string;
      executionRunId: string;
      assistantResponseId?: string;
      status: string;
      assistantResponseText?: string;
    }>
  | ConversationFailure;

export class SubmitConversationTurnUseCase {
  public constructor(
    private readonly d: {
      sessionRepository: ConversationSessionRepositoryPort;
      turnRepository: ConversationTurnRepositoryPort;
      messageRepository: ConversationMessageRepositoryPort;
      assistantResponseRepository: AssistantResponseRepositoryPort;
      operationRepository: ConversationOperationRepositoryPort;
      executionRunRepository: ExecutionRunRepositoryPort;
      executionAttemptRepository: ExecutionAttemptRepositoryPort;
      executionEventRepository: ExecutionEventRepositoryPort;
      executionResultRepository: ExecutionResultRepositoryPort;
      runtimeReferenceRepository: ExecutionRuntimeReferenceRepositoryPort;
      approvalRepository: ExecutionApprovalRepositoryPort;
      approvalValidityService: ConversationSessionApprovalValidityService;
      adapterSelectionService: ConversationalRuntimeAdapterSelectionService;
      runtimeGuardService: ConversationalRuntimeGuardService;
      orchestrator: ConversationTurnInvocationOrchestratorService;
      failureClassificationService?: ConversationTurnFailureClassificationService;
      nextId: () => string;
      now?: () => string;
    },
  ) {}
  public async execute(
    command: SubmitConversationTurnCommand,
  ): Promise<SubmitConversationTurnResult> {
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      command.text = normalizeUserVisibleMessageText(command.text);
    } catch {
      const fail = this.fail(
        "validation",
        "conversation-turn-input-invalid",
        "Workspace, session, text, and operation id are required.",
      );
      if (
        command.workspaceId &&
        command.conversationSessionId &&
        command.operationId
      )
        await this.d.operationRepository.saveConversationOperation({
          workspaceId: command.workspaceId,
          conversationSessionId: command.conversationSessionId,
          operationId: command.operationId,
          status: "failed",
          result: fail,
          createdAt: now,
          updatedAt: now,
        });
      return fail;
    }
    if (
      !command.workspaceId ||
      !command.conversationSessionId ||
      !command.operationId
    )
      return this.fail(
        "validation",
        "conversation-turn-input-invalid",
        "Workspace, session, text, and operation id are required.",
      );
    const workspaceId = createWorkspaceId(command.workspaceId);
    const prior = await this.d.operationRepository.getConversationOperationById(
      command.workspaceId,
      command.conversationSessionId,
      command.operationId,
    );
    if (prior) return prior.result as SubmitConversationTurnResult;
    const session = await this.d.sessionRepository.getConversationSessionById(
      workspaceId,
      command.conversationSessionId as any,
    );
    if (!session) {
      const fail = this.fail(
        "not-found",
        "conversation-session-not-found",
        "Conversation session was not found.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    if (
      !["approved", "active"].includes(session.status) ||
      session.archivedAt ||
      session.closedAt
    ) {
      const fail = this.fail(
        "conflict",
        "conversation-session-not-eligible",
        "Conversation session is not eligible for turn submission.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    const approval = session.executionApprovalId
      ? await this.d.approvalRepository.getExecutionApprovalById(
          command.workspaceId as any,
          session.executionApprovalId as any,
        )
      : undefined;
    const validity = await this.d.approvalValidityService.isValidForInvocation(
      session,
      approval,
    );
    if (!validity.valid) {
      const fail = this.fail(
        "conflict",
        "conversation-session-approval-invalid",
        "Conversation session approval is no longer valid for invocation.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    if (!session.runtimeReferenceId) {
      const fail = this.fail(
        "conflict",
        "conversation-session-runtime-reference-missing",
        "Conversation session is missing an approved runtime reference.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    const runtimeReference =
      await this.d.runtimeReferenceRepository.getExecutionRuntimeReferenceById(
        command.workspaceId as any,
        session.runtimeReferenceId as any,
      );
    if (!runtimeReference || runtimeReference.status !== "supported") {
      const fail = this.fail(
        "runtime-not-ready",
        "runtime-reference-not-eligible",
        "Conversation runtime reference is not eligible for invocation.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    if (runtimeReference.capabilityKind !== "text-generation") {
      const fail = this.fail(
        "runtime-not-ready",
        "runtime-reference-capability-unsupported",
        "Conversation runtime reference capability is unsupported.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    if (!runtimeReference.selectedModelRecordId) {
      const fail = this.fail(
        "runtime-not-ready",
        "runtime-reference-model-binding-missing",
        "Conversation runtime model selection is unavailable.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    if (
      !approval ||
      !session.sourceCompositionPlanId ||
      !session.sourceRuntimeReadinessBindingId ||
      !session.executionApprovalId
    ) {
      const fail = this.fail(
        "conflict",
        "conversation-session-source-association-missing",
        "Conversation session is missing an approved source association.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    const runtime = {
      runtimeId: runtimeReference.runtimeKind,
      capabilityKind: runtimeReference.capabilityKind,
      runtimeReferenceId: session.runtimeReferenceId,
      selectedModelRecordId: runtimeReference.selectedModelRecordId,
    } as const;
    const source = {
      workspaceId: command.workspaceId,
      conversationSessionId: session.id,
      sourceExecutionPlanId: session.sourceExecutionPlanId,
      sourceCompositionPlanId: session.sourceCompositionPlanId,
      sourceRuntimeReadinessBindingId: session.sourceRuntimeReadinessBindingId,
      executionApprovalId: session.executionApprovalId,
      runtimeReferenceId: session.runtimeReferenceId,
    } as const;
    const selection = await this.d.adapterSelectionService.select({
      source,
      runtime,
    });
    if (selection.status !== "supported") {
      const fail = this.fail(
        "runtime-not-ready",
        "conversation-runtime-unsupported",
        "Conversation runtime adapter is unsupported for the approved runtime reference.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    const guard = await this.d.runtimeGuardService.canInvoke({
      adapterId: selection.adapterId,
      source,
      runtime,
    });
    if (!guard.allowed) {
      const fail = this.fail(
        "runtime-not-ready",
        "conversation-runtime-not-ready",
        "Conversation runtime is unavailable or not ready.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    const turnId = this.d.nextId();
    const messageId = this.d.nextId();
    const runId = this.d.nextId();
    const attemptId = this.d.nextId();
    await this.d.messageRepository.saveConversationMessage({
      id: messageId as any,
      workspaceId: command.workspaceId as any,
      conversationSessionId: session.id,
      conversationTurnId: turnId as any,
      role: "user",
      contentKind: "plain-text",
      text: command.text,
      createdAt: now,
    });
    await this.d.turnRepository.saveConversationTurn({
      id: turnId as any,
      workspaceId,
      conversationSessionId: session.id,
      sourceExecutionPlanId: session.sourceExecutionPlanId,
      userMessageId: messageId as any,
      status: "submitted",
      sequence: session.turnIds.length + 1,
      blockers: [],
      diagnostics: [],
      provenance: [
        { at: now, kind: "conversation-turn-created", actorId: "application" },
      ],
      createdAt: now,
      updatedAt: now,
    });
    await this.d.executionRunRepository.saveExecutionRun({
      id: runId as any,
      workspaceId,
      sourceExecutionPlanId: session.sourceExecutionPlanId,
      sourceCompositionPlanId: session.sourceCompositionPlanId,
      sourceRuntimeReadinessBindingId: session.sourceRuntimeReadinessBindingId,
      sourceContextKind: "conversation-turn",
      sourceContextId: turnId,
      status: "queued",
      attemptIds: [attemptId as any],
      eventIds: [],
      resultIds: [],
      blockers: [],
      diagnostics: [],
      provenance: [
        {
          at: now,
          kind: "execution-run-start-requested",
          actorId: "application",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    await this.d.executionAttemptRepository.saveExecutionAttempt({
      id: attemptId as any,
      workspaceId,
      executionRunId: runId as any,
      attemptNumber: 1,
      runtimeReferenceId:
        session.runtimeReferenceId ?? "runtime-reference-missing",
      status: "pending",
      blockers: [],
      diagnostics: [],
      provenance: [
        {
          at: now,
          kind: "execution-run-attempt-created",
          actorId: "application",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    const startedEventId = this.d.nextId();
    await this.d.executionEventRepository.appendExecutionEvent({
      id: startedEventId as any,
      workspaceId: command.workspaceId,
      executionRunId: runId as any,
      executionAttemptId: attemptId as any,
      conversationSessionId: session.id,
      conversationTurnId: turnId as any,
      kind: "run-start-requested",
      category: "lifecycle",
      message: "Run start requested.",
      at: now,
    });
    await this.d.turnRepository.updateConversationTurn({
      ...(await this.d.turnRepository.getConversationTurnById(
        workspaceId,
        turnId as any,
      ))!,
      executionRunId: runId as any,
      status: "generating",
      updatedAt: now,
    });
    await this.d.executionRunRepository.updateExecutionRun({
      ...(await this.d.executionRunRepository.getExecutionRunById(
        workspaceId,
        runId as any,
      ))!,
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
    await this.d.executionAttemptRepository.updateExecutionAttempt({
      ...(await this.d.executionAttemptRepository.getExecutionAttemptById(
        workspaceId,
        attemptId as any,
      ))!,
      status: "started",
      startedAt: now,
      updatedAt: now,
    });
    await this.d.sessionRepository.updateConversationSession({
      ...session,
      status: "active",
      turnIds: session.turnIds.includes(turnId as any)
        ? session.turnIds
        : [...session.turnIds, turnId as any],
      updatedAt: now,
    });
    const orchestration = await this.d.orchestrator.invoke({
      workspaceId: command.workspaceId,
      session,
      approval,
      runtime,
      userTurnContent: command.text,
      conversationTurnId: turnId,
      executionRunId: runId,
      executionAttemptId: attemptId,
      operationId: command.operationId,
    });
    if (orchestration.status !== "completed") {
      await this.d.turnRepository.updateConversationTurn({
        ...(await this.d.turnRepository.getConversationTurnById(
          workspaceId,
          turnId as any,
        ))!,
        status: "failed",
        updatedAt: now,
        completedAt: now,
      });
      const failureClassification = (
        this.d.failureClassificationService ??
        new ConversationTurnFailureClassificationService()
      ).classify(orchestration.status);
      await this.d.executionAttemptRepository.updateExecutionAttempt({
        ...(await this.d.executionAttemptRepository.getExecutionAttemptById(
          workspaceId,
          attemptId as any,
        ))!,
        status: orchestration.status === "timed-out" ? "timed-out" : "failed",
        updatedAt: now,
        completedAt: now,
        failureClassification,
      });
      await this.d.executionRunRepository.updateExecutionRun({
        ...(await this.d.executionRunRepository.getExecutionRunById(
          workspaceId,
          runId as any,
        ))!,
        status: "failed",
        updatedAt: now,
        completedAt: now,
      });
      const fail = this.fail(
        "blocked",
        "conversation-turn-invocation-failed",
        "Conversation invocation failed.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    const resultId = this.d.nextId();
    const assistantId = this.d.nextId();
    const assistantResponseText = orchestration.assistantResponseText ?? "";
    let recordingFailureCode:
      "response-recording-failed" | "result-recording-failed" | undefined;
    try {
      await this.d.assistantResponseRepository.saveAssistantResponse({
        id: assistantId as any,
        workspaceId,
        conversationSessionId: session.id,
        conversationTurnId: turnId as any,
        executionRunId: runId as any,
        executionResultId: resultId as any,
        role: "assistant",
        contentKind: "plain-text",
        text: assistantResponseText,
        status: "completed",
        createdAt: now,
        completedAt: now,
      });
    } catch {
      recordingFailureCode = "response-recording-failed";
    }
    if (!recordingFailureCode) {
      try {
        await this.d.executionResultRepository.saveExecutionResult({
          id: resultId as any,
          workspaceId,
          executionRunId: runId as any,
          executionAttemptId: attemptId as any,
          kind: "assistant-response",
          status: "completed",
          assistantResponseId: assistantId,
          conversationTurnId: turnId,
          summary: "Assistant response available.",
          createdAt: now,
          completedAt: now,
          blockers: [],
          diagnostics: [],
          provenance: [
            {
              at: now,
              kind: "execution-run-result-recorded",
              actorId: "application",
            },
          ],
        });
      } catch {
        recordingFailureCode = "result-recording-failed";
      }
    }
    if (recordingFailureCode) {
      await this.d.turnRepository.updateConversationTurn({
        ...(await this.d.turnRepository.getConversationTurnById(
          workspaceId,
          turnId as any,
        ))!,
        status: "failed",
        updatedAt: now,
        completedAt: now,
      });
      await this.d.executionAttemptRepository.updateExecutionAttempt({
        ...(await this.d.executionAttemptRepository.getExecutionAttemptById(
          workspaceId,
          attemptId as any,
        ))!,
        status: "failed",
        updatedAt: now,
        completedAt: now,
        failureClassification: recordingFailureCode,
      });
      await this.d.executionRunRepository.updateExecutionRun({
        ...(await this.d.executionRunRepository.getExecutionRunById(
          workspaceId,
          runId as any,
        ))!,
        status: "failed",
        updatedAt: now,
        completedAt: now,
      });
      const fail = this.fail(
        "internal",
        recordingFailureCode === "response-recording-failed"
          ? "conversation-turn-response-recording-failed"
          : "conversation-turn-result-recording-failed",
        "Conversation response recording failed.",
      );
      await this.d.operationRepository.saveConversationOperation({
        workspaceId: command.workspaceId,
        conversationSessionId: command.conversationSessionId,
        operationId: command.operationId,
        status: "failed",
        result: fail,
        createdAt: now,
        updatedAt: now,
      });
      return fail;
    }
    await this.d.turnRepository.updateConversationTurn({
      ...(await this.d.turnRepository.getConversationTurnById(
        workspaceId,
        turnId as any,
      ))!,
      assistantResponseId: assistantId as any,
      status: "succeeded",
      updatedAt: now,
      completedAt: now,
    });
    await this.d.executionAttemptRepository.updateExecutionAttempt({
      ...(await this.d.executionAttemptRepository.getExecutionAttemptById(
        workspaceId,
        attemptId as any,
      ))!,
      status: "succeeded",
      resultId: resultId as any,
      updatedAt: now,
      completedAt: now,
    });
    await this.d.executionRunRepository.updateExecutionRun({
      ...(await this.d.executionRunRepository.getExecutionRunById(
        workspaceId,
        runId as any,
      ))!,
      status: "succeeded",
      resultIds: [resultId as any],
      updatedAt: now,
      completedAt: now,
    });
    const ok: SubmitConversationTurnResult = {
      kind: "success",
      value: {
        conversationTurnId: turnId,
        executionRunId: runId,
        assistantResponseId: assistantId,
        assistantResponseText,
        status: "succeeded",
      },
    };
    await this.d.operationRepository.saveConversationOperation({
      workspaceId: command.workspaceId,
      conversationSessionId: command.conversationSessionId,
      operationId: command.operationId,
      status: "accepted",
      result: ok,
      createdAt: now,
      updatedAt: now,
    });
    return ok;
  }
  private fail(
    kind: ConversationFailure["failureKind"],
    code: string,
    message: string,
  ): ConversationFailure {
    return {
      kind: "failure",
      failureKind: kind,
      diagnostics: [{ code, message }],
    };
  }
}
