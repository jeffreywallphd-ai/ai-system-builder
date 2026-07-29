import { randomUUID } from "node:crypto";

import type {
  ConversationalRuntimeAdapterCatalogPort,
  ConversationalRuntimeGuardPort,
  ConversationTurnInvocationPort,
} from "../../../application/ports/conversational-execution";
import { ConversationTranscriptReadModelService } from "../../../application/services/conversations";
import {
  ConversationTurnInvocationOrchestratorService,
  ConversationalInvocationContextValidationService,
  ConversationalRuntimeAdapterSelectionService,
  ConversationalRuntimeGuardService,
} from "../../../application/services/conversational-execution";
import type {
  SystemPublishedConversationRuntimeAuthority,
  SystemPublishedConversationRuntimeAuthorityService,
  SystemPublishedConversationRuntimeQuery,
} from "../../../application/services/system-deployment";
import {
  ConversationSessionApprovalValidityService,
  SubmitConversationTurnUseCase,
} from "../../../application/use-cases/conversations";
import type { SystemRuntimeRepositorySession } from "../../../adapters/persistence/system-runtime";
import {
  normalizeConversationSessionId,
  normalizeUserVisibleMessageText,
  type ConversationSessionRecord,
} from "../../../contracts/conversations";
import {
  normalizeExecutionApprovalId,
  normalizeExecutionRuntimeReferenceId,
} from "../../../contracts/execution-runs";
import { normalizeExecutionPlanId } from "../../../contracts/execution-plans";
import { normalizeAssetCompositionPlanId } from "../../../contracts/asset-composition";
import { normalizeRuntimeReadinessBindingId } from "../../../contracts/runtime-readiness";
import {
  SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
  SYSTEM_RUNTIME_CONVERSATION_MAX_TRANSCRIPT_TURNS,
  SYSTEM_RUNTIME_CONVERSATION_SCHEMA_VERSION,
  type SubmitSystemRuntimeConversationTurnCommand,
  type SystemRuntimeConversationMessage,
  type SystemRuntimeConversationResult,
  type SystemRuntimeConversationView,
} from "../../../contracts/system-deployment";

const SAFE_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_PROTECTED_HISTORY_TURNS = 20;

export interface SystemPublishedConversationRuntimeSession {
  read(): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>;
  submit(command: SubmitSystemRuntimeConversationTurnCommand): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>;
  close(): Promise<void>;
}

export function composeSystemPublishedConversationRuntime(options: {
  readonly authority: Pick<SystemPublishedConversationRuntimeAuthorityService, "resolve">;
  readonly runtimeRepositorySessions: {
    open(instance: SystemPublishedConversationRuntimeAuthority["runtimeInstance"]): Promise<SystemRuntimeRepositorySession>;
  };
  readonly adapterCatalog: ConversationalRuntimeAdapterCatalogPort;
  readonly runtimeGuard: ConversationalRuntimeGuardPort;
  readonly invocationPort: ConversationTurnInvocationPort;
  readonly now?: () => string;
}) {
  return {
    async open(query: SystemPublishedConversationRuntimeQuery): Promise<SystemPublishedConversationRuntimeSession> {
      const resolved = await options.authority.resolve(query);
      if (resolved.status !== "ready") return unavailableSession(resolved.message);
      const initialAuthority = resolved.authority;
      let repositories: SystemRuntimeRepositorySession;
      try {
        repositories = await options.runtimeRepositorySessions.open(initialAuthority.runtimeInstance);
      } catch {
        return unavailableSession("The published system data session is unavailable.");
      }

      const ids = runtimeIds(initialAuthority);
      const now = options.now ?? (() => new Date().toISOString());
      const ensured = await ensureSessionRecords(repositories, initialAuthority, ids, now()).catch(() => false);
      if (!ensured) {
        await repositories.close().catch(() => undefined);
        return unavailableSession("The published conversation session is unavailable.");
      }

      const validity = new ConversationSessionApprovalValidityService();
      const adapterSelection = new ConversationalRuntimeAdapterSelectionService(options.adapterCatalog);
      const runtimeGuard = new ConversationalRuntimeGuardService(options.runtimeGuard);
      const transcript = new ConversationTranscriptReadModelService(
        repositories.conversationTurnRepository,
        repositories.conversationMessageRepository,
        repositories.assistantResponseRepository,
      );
      let closed = false;
      let submitting = false;

      const resolveCurrentAuthority = async () => {
        const current = await options.authority.resolve(query);
        return current.status === "ready" && sameAuthority(initialAuthority, current.authority)
          ? current.authority
          : undefined;
      };

      const invocationPort: ConversationTurnInvocationPort = {
        async invokeConversationTurn(request) {
          const current = await resolveCurrentAuthority();
          if (!current || request.runtime.selectedModelRecordId !== current.resourceBinding.modelRecordId) {
            return { status: "blocked" };
          }
          return options.invocationPort.invokeConversationTurn(request);
        },
      };

      const orchestrator = new ConversationTurnInvocationOrchestratorService({
        approvalValidityService: validity,
        adapterSelectionService: adapterSelection,
        runtimeGuardService: runtimeGuard,
        contextValidationService: new ConversationalInvocationContextValidationService(),
        contextPort: {
          async prepareProtectedInvocationContext(request) {
            if (!(await resolveCurrentAuthority())) return { status: "blocked" };
            const history = await readProtectedHistory(
              repositories,
              initialAuthority.workspaceId,
              ids.sessionId,
              request.conversationTurnId,
            );
            return {
              status: "prepared" as const,
              context: {
                contextKind: "protected-conversational-invocation" as const,
                source: request.source,
                runtime: request.runtime,
                userTurnContent: request.userTurnContent,
                history,
              },
            };
          },
        },
        invocationPort,
      });

      const submitTurn = new SubmitConversationTurnUseCase({
        sessionRepository: repositories.conversationSessionRepository,
        turnRepository: repositories.conversationTurnRepository,
        messageRepository: repositories.conversationMessageRepository,
        assistantResponseRepository: repositories.assistantResponseRepository,
        operationRepository: repositories.conversationOperationRepository,
        executionRunRepository: repositories.executionRunRepository,
        executionAttemptRepository: repositories.executionAttemptRepository,
        executionEventRepository: repositories.executionEventRepository,
        executionResultRepository: repositories.executionResultRepository,
        runtimeReferenceRepository: repositories.executionRuntimeReferenceRepository,
        approvalRepository: repositories.executionApprovalRepository,
        approvalValidityService: validity,
        adapterSelectionService: adapterSelection,
        runtimeGuardService: runtimeGuard,
        orchestrator,
        nextId: () => `ce.${randomUUID()}`,
        now,
      });

      const read = async (): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>> => {
        if (closed || !(await resolveCurrentAuthority())) {
          return failure("runtime-unavailable", "The published system is no longer available.");
        }
        const result = await transcript.readTranscript({
          workspaceId: initialAuthority.workspaceId,
          conversationSessionId: ids.sessionId,
        });
        if (!result.ok) return failure("runtime-unavailable", "The conversation history is unavailable.");
        const messages = result.turns
          .slice(-SYSTEM_RUNTIME_CONVERSATION_MAX_TRANSCRIPT_TURNS)
          .flatMap((turn): SystemRuntimeConversationMessage[] => {
            const projected: SystemRuntimeConversationMessage[] = [];
            if (turn.userMessage) projected.push({
              id: String(turn.userMessage.id),
              role: "user",
              text: turn.userMessage.text,
              createdAt: turn.userMessage.createdAt,
            });
            if (turn.assistantResponse) projected.push({
              id: String(turn.assistantResponse.id),
              role: "assistant",
              text: turn.assistantResponse.text,
              createdAt: turn.assistantResponse.createdAt,
            });
            return projected;
          });
        return {
          ok: true,
          value: {
            schemaVersion: SYSTEM_RUNTIME_CONVERSATION_SCHEMA_VERSION,
            title: initialAuthority.systemLabel,
            state: submitting ? "submitting" : "ready",
            messages,
            maxInputCharacters: SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
            canSubmit: !submitting,
          },
        };
      };

      return {
        read,
        async submit(command) {
          if (closed) return failure("runtime-unavailable", "The published system is no longer available.");
          if (submitting) return failure("runtime-busy", "Wait for the current response before sending another message.");
          let text: string;
          try {
            text = normalizeUserVisibleMessageText(command.text);
          } catch {
            return failure("invalid-request", `Enter between 1 and ${SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS} characters.`);
          }
          if (!SAFE_OPERATION_ID.test(command.operationId)) {
            return failure("invalid-request", "The conversation request is invalid.");
          }
          if (!(await resolveCurrentAuthority())) {
            return failure("runtime-conflict", "The published system changed and must be restarted.");
          }
          submitting = true;
          try {
            const result = await submitTurn.execute({
              workspaceId: initialAuthority.workspaceId,
              conversationSessionId: ids.sessionId,
              text,
              operationId: command.operationId,
            });
            if (result.kind !== "success") {
              return failure("turn-failed", "The assistant could not complete this message. Try again.");
            }
          } catch {
            return failure("turn-failed", "The assistant could not complete this message. Try again.");
          } finally {
            submitting = false;
          }
          return read();
        },
        async close() {
          if (closed) return;
          closed = true;
          await repositories.close();
        },
      };
    },
  };
}

async function ensureSessionRecords(
  repositories: SystemRuntimeRepositorySession,
  authority: SystemPublishedConversationRuntimeAuthority,
  ids: ReturnType<typeof runtimeIds>,
  at: string,
): Promise<boolean> {
  const runtimeReference = await repositories.executionRuntimeReferenceRepository.getExecutionRuntimeReferenceById(
    authority.workspaceId,
    ids.runtimeReferenceId,
  );
  if (runtimeReference && runtimeReference.selectedModelRecordId !== authority.resourceBinding.modelRecordId) return false;
  if (!runtimeReference) {
    await repositories.executionRuntimeReferenceRepository.saveExecutionRuntimeReference({
      id: ids.runtimeReferenceId,
      workspaceId: authority.workspaceId,
      sourceExecutionPlanAdapterReferenceId: ids.adapterReferenceId,
      sourceRuntimeReadinessBindingId: ids.readinessBindingId,
      capabilityKind: "text-generation",
      runtimeKind: "python-sidecar",
      selectedModelRecordId: authority.resourceBinding.modelRecordId,
      label: "Published conversation runtime",
      status: "supported",
      blockers: [],
      diagnostics: [],
    });
  }

  const approval = await repositories.executionApprovalRepository.getExecutionApprovalById(
    authority.workspaceId,
    ids.approvalId,
  );
  if (
    approval &&
    (approval.approvalStatus !== "granted" ||
      approval.runtimeReferenceId !== ids.runtimeReferenceId ||
      approval.sourcePlanRevision !== authority.authorityRevision)
  ) return false;
  if (!approval) {
    await repositories.executionApprovalRepository.saveExecutionApproval({
      id: ids.approvalId,
      workspaceId: authority.workspaceId,
      sourceExecutionPlanId: ids.executionPlanId,
      conversationSessionId: ids.sessionId,
      approvalKind: "conversation-session-execution",
      approvalStatus: "granted",
      label: "Published system runtime approval",
      runtimeReferenceId: ids.runtimeReferenceId,
      sourcePlanRevision: authority.authorityRevision,
      sourceReadinessRevision: authority.authorityRevision,
      createdAt: at,
      updatedAt: at,
      grantedAt: at,
      provenance: [{ at, kind: "execution-run-approval-requested", actorId: "application" }],
      blockers: [],
      diagnostics: [],
    });
  }

  const existing = await repositories.conversationSessionRepository.getConversationSessionById(
    authority.workspaceId,
    ids.sessionId,
  );
  if (existing) {
    return (
      ["approved", "active"].includes(existing.status) &&
      existing.sourceExecutionPlanId === ids.executionPlanId &&
      existing.sourceCompositionPlanId === ids.compositionPlanId &&
      existing.sourceRuntimeReadinessBindingId === ids.readinessBindingId &&
      existing.executionApprovalId === ids.approvalId &&
      existing.runtimeReferenceId === ids.runtimeReferenceId
    );
  }
  const session: ConversationSessionRecord = {
    id: ids.sessionId,
    workspaceId: authority.workspaceId,
    sourceExecutionPlanId: ids.executionPlanId,
    sourceCompositionPlanId: ids.compositionPlanId,
    sourceRuntimeReadinessBindingId: ids.readinessBindingId,
    status: "approved",
    systemLabel: authority.systemLabel,
    systemSummary: "Published conversation system",
    executionApprovalId: ids.approvalId,
    executionApprovalStatus: "granted",
    runtimeReferenceId: ids.runtimeReferenceId,
    turnIds: [],
    blockers: [],
    diagnostics: [],
    provenance: [
      { at, kind: "conversation-session-created", actorId: "application" },
      { at, kind: "conversation-session-approved", actorId: "application" },
    ],
    createdAt: at,
    updatedAt: at,
  };
  await repositories.conversationSessionRepository.saveConversationSession(session);
  return true;
}

async function readProtectedHistory(
  repositories: SystemRuntimeRepositorySession,
  workspaceId: string,
  sessionId: string,
  excludedTurnId?: string,
) {
  const turns = await repositories.conversationTurnRepository.listConversationTurnsBySession(
    workspaceId as never,
    sessionId as never,
  );
  const selected = [...turns]
    .filter((turn) => String(turn.id) !== excludedTurnId)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-MAX_PROTECTED_HISTORY_TURNS);
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of selected) {
    const messages = await repositories.conversationMessageRepository.listConversationMessagesByTurn(
      workspaceId as never,
      turn.id,
    );
    const user = messages.find((message) => message.role === "user");
    if (user) history.push({ role: "user", content: user.text });
    const responses = await repositories.assistantResponseRepository.listAssistantResponsesByTurn(
      workspaceId as never,
      turn.id,
    );
    const assistant = responses.find((response) => response.status === "completed");
    if (assistant) history.push({ role: "assistant", content: assistant.text });
  }
  return history;
}

function runtimeIds(authority: SystemPublishedConversationRuntimeAuthority) {
  const digest = authority.releaseDigest.slice("sha256:".length);
  return {
    executionPlanId: normalizeExecutionPlanId(`published-plan.${digest}`),
    compositionPlanId: normalizeAssetCompositionPlanId(`published-composition.${digest}`),
    readinessBindingId: normalizeRuntimeReadinessBindingId(`published-readiness.${digest}`),
    sessionId: normalizeConversationSessionId(`published-session.${digest}`),
    approvalId: normalizeExecutionApprovalId(`published-approval.${digest}`),
    runtimeReferenceId: normalizeExecutionRuntimeReferenceId(`published-runtime.${digest}`),
    adapterReferenceId: `published-adapter.${digest}`,
  };
}

function sameAuthority(
  initial: SystemPublishedConversationRuntimeAuthority,
  current: SystemPublishedConversationRuntimeAuthority,
): boolean {
  return (
    initial.deployment.deploymentId === current.deployment.deploymentId &&
    initial.run.runId === current.run.runId &&
    initial.runtimeInstance.runtimeInstanceId === current.runtimeInstance.runtimeInstanceId &&
    initial.releaseId === current.releaseId &&
    initial.releaseDigest === current.releaseDigest &&
    initial.authorityRevision === current.authorityRevision &&
    initial.resourceBinding.modelRecordId === current.resourceBinding.modelRecordId &&
    initial.resourceBinding.modelRevisionDigest === current.resourceBinding.modelRevisionDigest &&
    initial.interactionBinding.composerInstanceId === current.interactionBinding.composerInstanceId &&
    initial.interactionBinding.historyInstanceId === current.interactionBinding.historyInstanceId
  );
}

function unavailableSession(message: string): SystemPublishedConversationRuntimeSession {
  const result = failure<SystemRuntimeConversationView>("runtime-unavailable", message);
  return {
    async read() { return result; },
    async submit() { return result; },
    async close() {},
  };
}

function failure<T>(
  code: Extract<SystemRuntimeConversationResult<T>, { ok: false }>["error"]["code"],
  message: string,
): SystemRuntimeConversationResult<T> {
  return { ok: false, error: { code, message } };
}
