import type {
  AssistantResponseRepositoryPort,
  ConversationSessionRepositoryPort,
  ConversationTurnRepositoryPort,
} from "../../ports/conversations";
import type {
  ExecutionApprovalRepositoryPort,
  ExecutionRunRepositoryPort,
  ExecutionRuntimeReferenceRepositoryPort,
} from "../../ports/execution-runs";
import { createWorkspaceId } from "../../../contracts/workspace";
import type {
  ConversationSessionRecord,
  ConversationTurnRecord,
} from "../../../contracts/conversations";
import type {
  ConversationSessionAvailabilityReadModel,
  ConversationSessionDetailReadModel,
  ConversationSessionListItemReadModel,
} from "./conversation-read-model-types";
import { ConversationSessionSourceSummaryService } from "./conversation-session-source-summary.service";
import { ConversationSessionApprovalValidityService } from "../../use-cases/conversations";
import type {
  ConversationalRuntimeAdapterSelectionService,
  ConversationalRuntimeGuardService,
} from "../conversational-execution";

export type ConversationSessionHostCapabilities = {
  submitTurn: "supported" | "unsupported" | "unavailable";
  cancelTurn: "unsupported" | "supported";
  retryTurn: "unsupported" | "supported";
  streaming: false;
};

export class ConversationSessionReadModelService {
  public constructor(
    private readonly sessionRepository: ConversationSessionRepositoryPort,
    private readonly turnRepository: ConversationTurnRepositoryPort,
    private readonly responseRepository: AssistantResponseRepositoryPort,
    private readonly runRepository: ExecutionRunRepositoryPort,
    private readonly availability?: {
      approvalRepository: ExecutionApprovalRepositoryPort;
      runtimeReferenceRepository: ExecutionRuntimeReferenceRepositoryPort;
      approvalValidityService: ConversationSessionApprovalValidityService;
      adapterSelectionService?: ConversationalRuntimeAdapterSelectionService;
      runtimeGuardService?: ConversationalRuntimeGuardService;
      hostCapabilities?: ConversationSessionHostCapabilities;
    },
    private readonly sourceSummary = new ConversationSessionSourceSummaryService(),
  ) {}

  private approvalStatus(
    v?: string,
  ): ConversationSessionListItemReadModel["approvalStatus"] {
    if (v === "approved" || v === "granted") return "approved";
    if (v === "invalidated" || v === "revoked" || v === "expired")
      return "approval-invalidated";
    if (!v || v === "pending") return "approval-required";
    return "unknown";
  }

  private runtimeStatus(
    v?: string,
  ): ConversationSessionListItemReadModel["runtimeStatus"] {
    if (v === "supported" || v === "available-by-readiness") return "ready";
    if (v === "unsupported") return "unsupported";
    if (v === "needs-setup") return "needs-setup";
    if (
      v === "unavailable" ||
      v === "blocked" ||
      v === "stale" ||
      v === "invalid"
    )
      return "unavailable";
    return "unknown";
  }

  private actions(
    s: ConversationSessionRecord,
    availability: ConversationSessionAvailabilityReadModel,
  ): ConversationSessionListItemReadModel["actions"] {
    const approved =
      this.approvalStatus(s.executionApprovalStatus) === "approved";
    return {
      mayOpen: s.status !== "archived",
      mayApprove: !approved && s.status === "awaiting-approval",
      maySubmitMessage: availability.setupStatus === "ready",
      mayClose: s.status === "active",
      mayArchive: s.status === "closed",
      mayCancel: availability.cancellation.available,
      mayRetry: availability.retry.available,
    };
  }

  private async availabilityFor(
    workspaceId: ReturnType<typeof createWorkspaceId>,
    s: ConversationSessionRecord,
    latestTurn?: ConversationTurnRecord,
  ): Promise<{
    availability: ConversationSessionAvailabilityReadModel;
    runtimeStatus: ConversationSessionListItemReadModel["runtimeStatus"];
    approvalStatus: ConversationSessionListItemReadModel["approvalStatus"];
  }> {
    const hostCapabilities = this.availability?.hostCapabilities ?? {
      submitTurn: "unavailable" as const,
      cancelTurn: "unsupported" as const,
      retryTurn: "unsupported" as const,
      streaming: false as const,
    };
    const unavailable = (
      setupStatus: ConversationSessionAvailabilityReadModel["setupStatus"],
      blockerCode?: string,
      blockerMessage?: string,
      runtimeStatus: ConversationSessionListItemReadModel["runtimeStatus"] = "unknown",
    ): {
      availability: ConversationSessionAvailabilityReadModel;
      runtimeStatus: ConversationSessionListItemReadModel["runtimeStatus"];
      approvalStatus: ConversationSessionListItemReadModel["approvalStatus"];
    } => ({
      approvalStatus: this.approvalStatus(s.executionApprovalStatus),
      runtimeStatus,
      availability: {
        setupStatus,
        blockerCode,
        blockerMessage,
        hostSubmitSupport: hostCapabilities.submitTurn,
        cancellation: {
          supported: hostCapabilities.cancelTurn === "supported",
          available: false,
        },
        retry: {
          supported: hostCapabilities.retryTurn === "supported",
          available: false,
          deferred: true,
        },
        streaming: { supported: false, available: false },
      },
    });
    if (!this.availability)
      return unavailable(
        "unavailable",
        "conversation-availability-unwired",
        "Conversation action availability is unavailable.",
      );
    if (
      !["approved", "active"].includes(s.status) ||
      s.archivedAt ||
      s.closedAt
    )
      return unavailable(
        s.status === "awaiting-approval" ? "approval-required" : "blocked",
        "conversation-session-not-eligible",
        "Conversation session is not eligible for message submission.",
      );
    if (hostCapabilities.submitTurn !== "supported")
      return unavailable(
        "unavailable",
        "conversation-submit-unsupported",
        "This host cannot submit conversation turns.",
        hostCapabilities.submitTurn === "unsupported"
          ? "unsupported"
          : "unavailable",
      );
    const activeTurn =
      latestTurn &&
      ["submitted", "generating", "cancel-requested"].includes(
        latestTurn.status,
      );
    if (activeTurn)
      return unavailable(
        "blocked",
        "conversation-turn-active",
        "A conversation turn is already in progress.",
        "ready",
      );
    const approval = s.executionApprovalId
      ? await this.availability.approvalRepository.getExecutionApprovalById(
          workspaceId,
          s.executionApprovalId,
        )
      : undefined;
    const validity =
      await this.availability.approvalValidityService.isValidForInvocation(
        s,
        approval,
      );
    if (!validity.valid) {
      const approvalStatus =
        validity.reason === "approval-required"
          ? "approval-required"
          : "approval-invalidated";
      return {
        ...unavailable(
          validity.reason === "approval-required"
            ? "approval-required"
            : "source-review-required",
          validity.reason,
          "Conversation approval or source review is required.",
        ),
        approvalStatus,
      };
    }
    if (!s.runtimeReferenceId)
      return unavailable(
        "runtime-not-ready",
        "conversation-runtime-reference-missing",
        "Approved runtime reference is missing.",
        "unavailable",
      );
    const runtimeReference =
      await this.availability.runtimeReferenceRepository.getExecutionRuntimeReferenceById(
        workspaceId,
        s.runtimeReferenceId,
      );
    if (
      !runtimeReference ||
      !["supported", "available-by-readiness"].includes(runtimeReference.status)
    )
      return unavailable(
        "runtime-not-ready",
        "runtime-reference-not-active",
        "Approved runtime reference is unavailable.",
        "unavailable",
      );
    if (runtimeReference.capabilityKind !== "text-generation")
      return unavailable(
        "runtime-not-ready",
        "runtime-reference-capability-unsupported",
        "Approved runtime reference is unsupported.",
        "unsupported",
      );
    if (!runtimeReference.selectedModelRecordId)
      return unavailable(
        "runtime-not-ready",
        "runtime-reference-model-binding-missing",
        "Select and publish an available text-generation model.",
        "needs-setup",
      );
    if (
      this.availability.adapterSelectionService &&
      this.availability.runtimeGuardService
    ) {
      if (
        !approval ||
        !s.sourceCompositionPlanId ||
        !s.sourceRuntimeReadinessBindingId ||
        !s.executionApprovalId
      )
        return unavailable(
          "source-review-required",
          "conversation-source-association-missing",
          "Approved conversation source association is incomplete.",
          "unavailable",
        );
      const runtime = {
        runtimeId: runtimeReference.runtimeKind,
        capabilityKind: "text-generation" as const,
        runtimeReferenceId: s.runtimeReferenceId,
        selectedModelRecordId: runtimeReference.selectedModelRecordId,
      };
      const source = {
        workspaceId: s.workspaceId,
        conversationSessionId: s.id,
        sourceExecutionPlanId: s.sourceExecutionPlanId,
        sourceCompositionPlanId: s.sourceCompositionPlanId,
        sourceRuntimeReadinessBindingId: s.sourceRuntimeReadinessBindingId,
        executionApprovalId: s.executionApprovalId,
        runtimeReferenceId: s.runtimeReferenceId,
      } as const;
      const selection = await this.availability.adapterSelectionService.select({
        source,
        runtime,
      });
      if (selection.status !== "supported")
        return unavailable(
          "runtime-not-ready",
          `conversation-runtime-${selection.status}`,
          "Conversation runtime adapter is not ready.",
          selection.status === "unsupported" ? "unsupported" : "unavailable",
        );
      const guard = await this.availability.runtimeGuardService.canInvoke({
        adapterId: selection.adapterId,
        source,
        runtime,
      });
      if (!guard.allowed)
        return unavailable(
          "runtime-not-ready",
          `conversation-runtime-${guard.status}`,
          "Conversation runtime is unavailable or not ready.",
          guard.status === "unsupported"
            ? "unsupported"
            : guard.status === "ready"
              ? "ready"
              : "unavailable",
        );
    }
    return {
      approvalStatus: "approved",
      runtimeStatus: "ready",
      availability: {
        setupStatus: "ready",
        hostSubmitSupport: "supported",
        cancellation: {
          supported: hostCapabilities.cancelTurn === "supported",
          available: false,
        },
        retry: {
          supported: hostCapabilities.retryTurn === "supported",
          available: false,
          deferred: hostCapabilities.retryTurn !== "supported",
        },
        streaming: { supported: false, available: false },
      },
    };
  }

  private async toItem(
    workspaceId: ReturnType<typeof createWorkspaceId>,
    s: ConversationSessionRecord,
  ): Promise<ConversationSessionListItemReadModel> {
    const latestTurn =
      await this.turnRepository.getLatestConversationTurnBySession(
        workspaceId,
        s.id,
      );
    const latestActivityAt = latestTurn?.updatedAt ?? s.updatedAt;
    const responses = latestTurn
      ? await this.responseRepository.listAssistantResponsesByTurn(
          workspaceId,
          latestTurn.id,
        )
      : [];
    const current = await this.availabilityFor(workspaceId, s, latestTurn);
    return {
      conversationSessionId: s.id,
      sessionLabel: s.systemLabel,
      sourceExecutionPlanId: s.sourceExecutionPlanId,
      sourceCompositionPlanId: s.sourceCompositionPlanId,
      sessionStatus: s.status,
      approvalStatus: current.approvalStatus,
      runtimeStatus: current.runtimeStatus,
      turnCount: s.turnIds.length,
      latestAssistantResponseAvailable: responses.some(
        (r) => r.status === "completed",
      ),
      latestActivityAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      closedAt: s.closedAt,
      archivedAt: s.archivedAt,
      actions: this.actions(s, current.availability),
      availability: current.availability,
    };
  }

  public async listConversationSessions(request: {
    workspaceId: string;
    includeArchived?: boolean;
    status?: ConversationSessionRecord["status"];
    sourceExecutionPlanId?: string;
    cursor?: string;
    limit?: number;
  }) {
    const workspaceId = createWorkspaceId(request.workspaceId);
    const { sessions, nextCursor } =
      await this.sessionRepository.listConversationSessions({
        workspaceId,
        status: request.status,
        includeArchived: request.includeArchived,
        sourceExecutionPlanId: request.sourceExecutionPlanId,
        cursor: request.cursor,
        limit: request.limit,
      });
    const items = await Promise.all(
      sessions.map((s) => this.toItem(workspaceId, s)),
    );
    return { items, nextCursor };
  }

  public async readDetail(request: {
    workspaceId: string;
    conversationSessionId: string;
  }): Promise<ConversationSessionDetailReadModel | undefined> {
    const workspaceId = createWorkspaceId(request.workspaceId);
    const session = await this.sessionRepository.getConversationSessionById(
      workspaceId,
      request.conversationSessionId as never,
    );
    if (!session) return undefined;
    const item = await this.toItem(workspaceId, session);
    const latestTurn =
      await this.turnRepository.getLatestConversationTurnBySession(
        workspaceId,
        session.id,
      );
    const latestRun = latestTurn?.executionRunId
      ? await this.runRepository.getExecutionRunById(
          workspaceId,
          latestTurn.executionRunId,
        )
      : undefined;
    return {
      ...item,
      source: await this.sourceSummary.summarize(session),
      latestTurnId: latestTurn?.id,
      latestTurnStatus: latestTurn?.status,
      latestRunStatus: latestRun?.status,
    };
  }
}
