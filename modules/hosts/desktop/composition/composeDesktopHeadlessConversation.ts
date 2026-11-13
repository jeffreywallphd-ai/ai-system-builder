import { createStructuredHeadlessTurnReservation } from "../../../adapters/persistence/system-builder/createStructuredHeadlessTurnReservation";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { DesktopHeadlessAuthoringWireGrant } from "../../../adapters/transport/headless-loopback";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import type { DelegatedConversationTurnFence, SubmitConversationTurnUseCase } from "../../../application/use-cases/conversations/submit-conversation-turn.use-case";
import { HeadlessApprovedConversationDispatchUseCase } from "../../../application/use-cases/system-run-workflow/headless-approved-conversation-dispatch.use-case";
import type { HeadlessWorkflowMetadataUseCase } from "../../../application/use-cases/system-run-workflow/headless-workflow-metadata.use-case";
import { normalizeConversationSessionId } from "../../../contracts/conversations";
import type { HeadlessApprovedTurnInput, HeadlessApprovedTurnResult, HeadlessHostIncarnationId } from "../../../contracts/headless";
import type { LocalIdentityProfile, OrganizationRole } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ConversationSessionRepositoryPort } from "../../../application/ports/conversations";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

const MAX_DESKTOP_TURNS = 2;
const DRAIN_LIMIT_MS = 5_000;
const PROFILE = "builtin.workflow.conversation@1.0.0";
const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" } as const;
const lookupScopes = ["workspace:read", "asset:read", "runtime:read"] as const;
const dispatchScopes = [...lookupScopes, "asset:write"] as const;

type Authority = {
  readonly grant: DesktopHeadlessAuthoringWireGrant;
  readonly currentGrant: () => Promise<DesktopHeadlessAuthoringWireGrant | undefined>;
  readonly fingerprint: (value: string) => string;
};

/** Desktop composition owns execution; the transport can supply only verified registration and a fixed command. */
export function composeDesktopHeadlessConversation(dependencies: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platformDocuments: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly workflows: Pick<HeadlessWorkflowMetadataUseCase, "prepare">;
  readonly sessions: Pick<ConversationSessionRepositoryPort, "getConversationSessionById">;
  readonly submit: Pick<SubmitConversationTurnUseCase, "execute">;
  readonly readRole: () => Promise<OrganizationRole | undefined>;
  readonly isOpen: () => boolean;
}) {
  const { hostIncarnationId, identity, platformDocuments, rootDirectory, workspaces, authorization, workflows,
    sessions, submit, readRole, isOpen } = dependencies;
  const tasks = new Map<string, Promise<void>>();
  let open = true;
  const isAccepting = () => open && isOpen();

  async function authorized(id: WorkspaceId, mode: "observe" | "dispatch",
    repository = workspaces, authorizer = authorization) {
    if (!isAccepting()) return false;
    try {
      const workspace = await repository.readWorkspace(id);
      if (!workspace || workspace.workspaceId !== id || workspace.organizationId !== identity.organizationId ||
          workspace.status !== "active") return false;
      await authorizer.authorizeWorkspaceOperation({
        workspace, operation: `headless.conversation.${mode}`, requiredScopes: mode === "dispatch" ? dispatchScopes : lookupScopes,
      });
      return isAccepting();
    } catch { return false; }
  }

  const reservations = createStructuredHeadlessTurnReservation({
    documents: platformDocuments,
    async authorize(owner, scope, mode) {
      if (scope.organizationId !== identity.organizationId || scope.principalId !== identity.principalId) return false;
      return authorized(scope.workspaceId, mode,
        createLocalWorkspaceRepository({ rootDirectory, documents: owner.forOrganization(identity.organizationId) }),
        composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }));
    },
  });

  return {
    hostIncarnationId,
    canRunConversation: (workspaceId: WorkspaceId) => authorized(workspaceId, "dispatch"),
    async execute(input: HeadlessApprovedTurnInput, authority: Authority): Promise<HeadlessApprovedTurnResult> {
      const { workspaceId, planId, planRevision, snapshotRevision, sessionId } = input;
      const { grant, currentGrant, fingerprint } = authority;
      const exactSessionId = normalizeConversationSessionId(sessionId);
      const ownerKey = JSON.stringify([workspaceId, exactSessionId]);
      const matches = (value: DesktopHeadlessAuthoringWireGrant | undefined) =>
        isAccepting() && value?.conversation === true && value.organizationId === identity.organizationId &&
        value.principalId === identity.principalId && value.registeredClientId === grant.registeredClientId &&
        value.workspaceIds.includes(workspaceId) && value.isCurrent?.() === true;
      const current = () => matches(grant);
      const live = async (mode: "observe" | "dispatch") => current() && await authorized(workspaceId, mode) &&
        matches(await currentGrant());
      const readSession = async () => {
        const session = await sessions.getConversationSessionById(workspaceId, exactSessionId);
        return session?.workspaceId === workspaceId && session.id === exactSessionId && session.sourceExecutionPlanId === planId
          ? session : undefined;
      };
      const prepared = async () => {
        if (!await live("dispatch")) return false;
        const role = await readRole();
        if (!role || !current()) return false;
        const stillAllowed = async (id: WorkspaceId) => id === workspaceId && await readRole() === role && await live("dispatch");
        const result = await workflows.prepare(workspaceId, {
          profileId: PROFILE, source: { kind: "reviewed-execution-plan", sourceId: planId, sourceRevision: planRevision },
        }, {
          context: { actorId: identity.principalId, organizationId: identity.organizationId, authenticated: true, roles: [role] },
          canRead: stillAllowed,
          canDiscoverApprovedTurns: stillAllowed,
        });
        return result.ok && result.value.profile.availability === "available" && result.value.snapshotRevision === snapshotRevision &&
          result.value.approvedSessionIds?.includes(exactSessionId) === true && await stillAllowed(workspaceId);
      };
      const validate: DelegatedConversationTurnFence["validate"] = async target => {
        if (target.workspaceId !== workspaceId || target.sessionId !== exactSessionId || target.planId !== planId ||
            target.planRevision !== planRevision || target.snapshotRevision !== snapshotRevision ||
            !await live("dispatch")) return false;
        if (target.phase === "before-record") return prepared();
        // A successfully linked turn updates the workflow snapshot itself.
        // The application checks the exact original approval and plan again at the adapter boundary.
        const session = await readSession();
        return Boolean(target.turnId && session?.turnIds.some(turnId => turnId === target.turnId) &&
          session?.executionApprovalId === target.approvalId && session.runtimeReferenceId === target.runtimeReferenceId &&
          await live("dispatch"));
      };
      if (!current()) return forbidden;
      try {
        const dispatch = new HeadlessApprovedConversationDispatchUseCase({
          reservations, fingerprint,
          submit: (command, delegated) => submit.execute(command, {
            planId, planRevision, snapshotRevision, validate, isCurrent: delegated.isCurrent, onAdmitted: delegated.onAdmitted,
          }),
          runOwned(work) {
            if (!current() || tasks.size >= MAX_DESKTOP_TURNS || tasks.has(ownerKey)) return false;
            const task = Promise.resolve().then(work).catch(() => {});
            tasks.set(ownerKey, task);
            void task.then(() => { if (tasks.get(ownerKey) === task) tasks.delete(ownerKey); });
            return true;
          },
        });
        const result = await dispatch.execute(input, {
          scope: { workspaceId, organizationId: identity.organizationId, principalId: identity.principalId,
            registeredClientId: grant.registeredClientId },
          isCurrent: current,
          canObserve: async () => await live("observe") && Boolean(await readSession()) && await live("observe"),
          canDispatch: prepared,
        });
        switch (result.kind) {
          case "observed": return { ok: true, value: result.reference };
          case "conflict": return { ok: false, code: "headless.idempotency-conflict" };
          case "expired": return { ok: false, code: "headless.idempotency-expired" };
          case "capacity": return { ok: false, code: "headless.operation-capacity" };
          case "denied": return forbidden;
          case "invalid": return { ok: false, code: "headless.invalid-request" };
          default: return unconfirmed;
        }
      } catch { return unconfirmed; }
    },
    stopAdmission() { open = false; },
    async drain() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(tasks.values()),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() =>
            reject(new Error("Desktop conversation task settlement remains pending.")), DRAIN_LIMIT_MS); }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}
