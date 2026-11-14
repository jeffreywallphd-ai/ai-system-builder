import {
  normalizeConversationMessageId,
  normalizeConversationTurnId,
  normalizeUserVisibleMessageText,
  type ConversationSessionRecord,
  type ConversationFailure,
  type ConversationSuccess,
} from "../../../contracts/conversations";
import { createWorkspaceId } from "../../../contracts/workspace";
import { normalizeExecutionAttemptId, normalizeExecutionEventId, normalizeExecutionRunId, type ExecutionApprovalRecord } from "../../../contracts/execution-runs";
import { ConversationTurnFailureClassificationService } from "./conversation-turn-failure-classification.service";
import type {
  ConversationSessionRepositoryPort,
  ConversationTurnRepositoryPort,
  ConversationMessageRepositoryPort,
  AssistantResponseRepositoryPort,
  ConversationOperationRepositoryPort,
} from "../../ports/conversations";
import type { DelegatedConversationTurnAdmissionPort, InitialConversationTurnWrites } from "../../ports/conversations/delegated-conversation-turn-admission.port";
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
export type DelegatedConversationTurnFence = {
  readonly planId: string;
  readonly planRevision: string;
  readonly snapshotRevision: string;
  readonly validate: (input: {
    readonly phase: "before-record" | "before-runtime";
    readonly workspaceId: string;
    readonly planId: string;
    readonly planRevision: string;
    readonly snapshotRevision: string;
    readonly sessionId: string;
    readonly approvalId: string;
    readonly runtimeReferenceId: string;
    readonly turnId?: string;
  }) => Promise<boolean>;
  readonly isCurrent: () => boolean;
  /** Internal owner notification after durable admission and before runtime dispatch. */
  readonly onAdmitted?: (reference: { readonly turnId: string; readonly runId: string }) => Promise<boolean>;
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
      delegatedTurnAdmission?: DelegatedConversationTurnAdmissionPort;
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
    delegation?: DelegatedConversationTurnFence,
  ): Promise<SubmitConversationTurnResult> {
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    const delegated = delegation && Object.freeze({ ...delegation });
    const delegatedDenied = () => this.fail("conflict", "conversation-delegation-stale", "The delegated conversation target changed.");
    const delegationCurrent = () => {
      try { return delegated?.isCurrent() === true; } catch { return false; }
    };
    if (delegated) {
      if (!this.d.delegatedTurnAdmission || !delegationCurrent()) return delegatedDenied();
      command = { ...command };
    }
    try {
      command.text = normalizeUserVisibleMessageText(command.text);
    } catch {
      const fail = this.fail(
        "validation",
        "conversation-turn-input-invalid",
        "Workspace, session, text, and operation id are required.",
      );
      if (
        !delegated && command.workspaceId &&
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
    if (prior) return delegated ? delegatedDenied() : prior.result as SubmitConversationTurnResult;
    const savedSession = await this.d.sessionRepository.getConversationSessionById(
      workspaceId,
      command.conversationSessionId as any,
    );
    const session = delegated && savedSession ? structuredClone(savedSession) : savedSession;
    if (!session) {
      if (delegated) return delegatedDenied();
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
      if (delegated) return delegatedDenied();
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
    const savedApproval = session.executionApprovalId
      ? await this.d.approvalRepository.getExecutionApprovalById(
          command.workspaceId as any,
          session.executionApprovalId as any,
        )
      : undefined;
    const approval = delegated && savedApproval ? structuredClone(savedApproval) : savedApproval;
    const matchesDelegation = (candidate: ConversationSessionRecord, permission: ExecutionApprovalRecord | undefined) =>
      Boolean(delegated && candidate.workspaceId === command.workspaceId && candidate.id === command.conversationSessionId &&
        (candidate.status === "approved" || candidate.status === "active") && !candidate.closedAt && !candidate.archivedAt &&
        candidate.sourceExecutionPlanId === delegated.planId && delegated.snapshotRevision && permission &&
        permission.id === candidate.executionApprovalId && permission.workspaceId === command.workspaceId &&
        permission.conversationSessionId === candidate.id && permission.sourceExecutionPlanId === delegated.planId &&
        permission.sourcePlanRevision === delegated.planRevision && permission.approvalKind === "conversation-session-execution" &&
        permission.approvalStatus === "granted" && !permission.revokedAt && !permission.invalidatedAt &&
        candidate.runtimeReferenceId && permission.runtimeReferenceId === candidate.runtimeReferenceId);
    const validateDelegated = async (phase: "before-record" | "before-runtime", turnId?: string) => {
      try {
        if (!delegated || !approval || !session.runtimeReferenceId || !delegationCurrent() ||
            !matchesDelegation(session, approval) ||
            !await delegated.validate({
              phase, workspaceId, planId: delegated.planId, planRevision: delegated.planRevision,
              snapshotRevision: delegated.snapshotRevision, sessionId: session.id, approvalId: approval.id,
              runtimeReferenceId: session.runtimeReferenceId, ...(turnId ? { turnId } : {}),
            }) || !delegationCurrent()) return false;
        const latestSession = await this.d.sessionRepository.getConversationSessionById(workspaceId, session.id);
        const latestApproval = await this.d.approvalRepository.getExecutionApprovalById(workspaceId, approval.id);
        if (!latestSession || !latestApproval || !matchesDelegation(latestSession, latestApproval) ||
            latestSession.executionApprovalId !== session.executionApprovalId || latestSession.runtimeReferenceId !== session.runtimeReferenceId ||
            latestSession.sourceCompositionPlanId !== session.sourceCompositionPlanId ||
            latestSession.sourceRuntimeReadinessBindingId !== session.sourceRuntimeReadinessBindingId ||
            latestApproval.updatedAt !== approval.updatedAt || latestApproval.sourceReadinessRevision !== approval.sourceReadinessRevision ||
            (turnId && !latestSession.turnIds.some((id) => id === turnId)) ||
            !(await this.d.approvalValidityService.isValidForInvocation(latestSession, latestApproval)).valid ||
            !delegationCurrent()) return false;
        if (phase === "before-record") return true;
        return await this.d.delegatedTurnAdmission?.isStillCurrent({
          session: latestSession, approval: latestApproval, isCurrent: delegationCurrent,
        }) === true && delegationCurrent();
      } catch { return false; }
    };
    if (delegated && (!await validateDelegated("before-record") || !delegationCurrent())) return delegatedDenied();
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
      if (!delegated) await this.d.operationRepository.saveConversationOperation({
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
    if (delegated && (!await validateDelegated("before-record") || !delegationCurrent())) return delegatedDenied();
    const turnId = normalizeConversationTurnId(this.d.nextId());
    const messageId = normalizeConversationMessageId(this.d.nextId());
    const runId = normalizeExecutionRunId(this.d.nextId());
    const attemptId = normalizeExecutionAttemptId(this.d.nextId());
    const writeInitialRecords = async (repositories: InitialConversationTurnWrites) => {
      await repositories.messageRepository.saveConversationMessage({
        id: messageId,
        workspaceId,
        conversationSessionId: session.id,
        conversationTurnId: turnId,
        role: "user",
        contentKind: "plain-text",
        text: command.text,
        createdAt: now,
      });
      await repositories.turnRepository.saveConversationTurn({
        id: turnId,
        workspaceId,
        conversationSessionId: session.id,
        sourceExecutionPlanId: session.sourceExecutionPlanId,
        userMessageId: messageId,
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
      await repositories.executionRunRepository.saveExecutionRun({
        id: runId,
        workspaceId,
        sourceExecutionPlanId: session.sourceExecutionPlanId,
        sourceCompositionPlanId: session.sourceCompositionPlanId,
        sourceRuntimeReadinessBindingId: session.sourceRuntimeReadinessBindingId,
        sourceContextKind: "conversation-turn",
        sourceContextId: turnId,
        status: "queued",
        attemptIds: [attemptId],
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
          ...(delegated ? [{ at: now, kind: "execution-run-delegated-conversation", actorId: "application" } as const] : []),
        ],
        createdAt: now,
        updatedAt: now,
      });
      await repositories.executionAttemptRepository.saveExecutionAttempt({
        id: attemptId,
        workspaceId,
        executionRunId: runId,
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
      const startedEventId = normalizeExecutionEventId(this.d.nextId());
      await repositories.executionEventRepository.appendExecutionEvent({
        id: startedEventId,
        workspaceId: command.workspaceId,
        executionRunId: runId,
        executionAttemptId: attemptId,
        conversationSessionId: session.id,
        conversationTurnId: turnId as any,
        kind: "run-start-requested",
        category: "lifecycle",
        message: "Run start requested.",
        at: now,
      });
      await repositories.turnRepository.updateConversationTurn({
        ...(await repositories.turnRepository.getConversationTurnById(
          workspaceId,
          turnId,
        ))!,
        executionRunId: runId,
        status: "generating",
        updatedAt: now,
      });
      await repositories.executionRunRepository.updateExecutionRun({
        ...(await repositories.executionRunRepository.getExecutionRunById(
          workspaceId,
          runId,
        ))!,
        status: "running",
        startedAt: now,
        updatedAt: now,
      });
      await repositories.executionAttemptRepository.updateExecutionAttempt({
        ...(await repositories.executionAttemptRepository.getExecutionAttemptById(
          workspaceId,
          attemptId,
        ))!,
        status: "started",
        startedAt: now,
        updatedAt: now,
      });
    };
    let activeSession = session;
    let allowDispatch = true;
    if (delegated) {
      if (!approval) return delegatedDenied();
      const admitted = await this.d.delegatedTurnAdmission?.admit({
        session, approval, turnId, operationId: command.operationId, updatedAt: now,
        isCurrent: delegationCurrent, writeInitialRecords,
      });
      if (!admitted) return delegatedDenied();
      activeSession = admitted;
      if (delegated.onAdmitted) {
        try { allowDispatch = await delegated.onAdmitted({ turnId, runId }) === true; }
        catch { allowDispatch = false; }
      }
      allowDispatch &&= delegationCurrent();
    } else {
      await writeInitialRecords(this.d);
      await this.d.sessionRepository.updateConversationSession({
          ...session,
          status: "active",
          turnIds: session.turnIds.includes(turnId) ? session.turnIds : [...session.turnIds, turnId],
          updatedAt: now,
        });
    }
    const orchestration = !allowDispatch ? { status: "approval-invalidated" } as const : await this.d.orchestrator.invoke({
      workspaceId: command.workspaceId,
      session: activeSession,
      approval,
      runtime,
      userTurnContent: command.text,
      conversationTurnId: turnId,
      executionRunId: runId,
      executionAttemptId: attemptId,
      operationId: command.operationId,
      ...(delegated ? { beforeInvoke: () => validateDelegated("before-runtime", turnId), isInvocationCurrent: delegationCurrent } : {}),
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
