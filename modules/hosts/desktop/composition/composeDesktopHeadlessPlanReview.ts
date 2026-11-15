import { createStructuredHeadlessPlanReviewRepository } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createStructuredSystemBuilderRepository } from "../../../adapters/persistence/system-builder";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { startDesktopHeadlessLoopback } from "../../../adapters/transport/headless-loopback";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import type { HeadlessPlanReviewSnapshotResult } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { isDesktopHeadlessClientId, type HeadlessHostIncarnationId, type HeadlessPlanReviewAgentRequest,
  type HeadlessPlanReviewAgentResult } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

type LoopbackPlanReview = NonNullable<Parameters<typeof startDesktopHeadlessLoopback>[0]["planReview"]>;
const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const requiredScopes = ["workspace:read", "asset:read", "asset:write"] as const;

export function composeDesktopHeadlessPlanReview(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly isOpen: () => boolean;
}): LoopbackPlanReview {
  const { hostIncarnationId, identity, platform, rootDirectory, workspaces, authorization, isOpen } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Desktop plan review requires the platform transaction owner.");

  async function authorize(
    repository: typeof workspaces, policy: WorkspaceOperationAuthorizationPort,
    workspaceId: WorkspaceId, operation: HeadlessPlanReviewAgentRequest["operation"],
  ) {
    try {
      const workspace = await repository.readWorkspace(workspaceId);
      if (workspace?.organizationId !== identity.organizationId || workspace.workspaceId !== workspaceId ||
          workspace.status !== "active") return false;
      await policy.authorizeWorkspaceOperation({ workspace, operation: `headless.${operation}`, requiredScopes });
      return isOpen();
    } catch { return false; }
  }

  return {
    hostIncarnationId,
    async execute(request, initialGrant, getCurrentGrant) {
      const { workspaceId, fingerprint } = request.target;
      const { registeredClientId } = initialGrant;
      const admits = (grant: typeof initialGrant | undefined) => Boolean(isOpen() && grant?.planReview === true &&
        !grant.authoring?.length && !grant.conversation && !grant.presentation && grant.isCurrent?.() &&
        grant.registeredClientId === registeredClientId && grant.organizationId === identity.organizationId &&
        grant.principalId === identity.principalId && grant.workspaceIds.includes(workspaceId));
      const isCurrent = () => admits(initialGrant);
      const canUse = async () => isCurrent() && admits(await getCurrentGrant()) &&
        await authorize(workspaces, authorization, workspaceId, request.operation) && isCurrent();
      if (request.target.hostIncarnationId !== hostIncarnationId || !isDesktopHeadlessClientId(registeredClientId)) return forbidden;
      try {
        if (!await canUse()) return forbidden;
        const target = { hostIncarnationId, fingerprint, scope: {
          organizationId: identity.organizationId, principalId: identity.principalId, workspaceId, registeredClientId,
        } };
        const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) => {
          if (!isCurrent() || actual.hostIncarnationId !== hostIncarnationId || actual.fingerprint !== fingerprint ||
              actual.scope.organizationId !== identity.organizationId || actual.scope.principalId !== identity.principalId ||
              actual.scope.workspaceId !== workspaceId || actual.scope.registeredClientId !== registeredClientId ||
              action !== (request.operation === "plan.submit" ? "propose" : "read")) return false;
          const documents = owner.forOrganization(identity.organizationId);
          const repository = createLocalWorkspaceRepository({ rootDirectory, documents });
          const policy = composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity });
          return await authorize(repository, policy, workspaceId, request.operation) && isCurrent();
        }, Date.now, async documents => {
          if (request.operation !== "plan.submit" || !isCurrent()) return false;
          const systems = createStructuredSystemBuilderRepository(documents);
          for (const { operation, input } of request.proposal.requests) {
            if (operation === "systems.create") continue;
            const record = await systems.readRecord(workspaceId, input.systemId);
            if (!isCurrent()) return false;
            if (!record || record.targetWorkspaceId !== workspaceId || record.systemId !== input.systemId ||
                record.status === "archived" || record.revision !== input.baseRecordRevision ||
                record.currentRevisionId !== input.baseRevisionId) return "stale";
            const revision = await systems.readRevision(workspaceId, input.systemId, input.baseRevisionId);
            if (!isCurrent()) return false;
            if (!revision || revision.targetWorkspaceId !== workspaceId || revision.systemId !== input.systemId ||
                revision.revisionId !== input.baseRevisionId ||
                revision.composition.compositionId !== record.composition.compositionId) return "stale";
          }
          return isCurrent();
        });
        const result = request.operation === "plan.submit" ?
          await reviews.propose({ target, isCurrent, proposal: {
            ...request.proposal.scope,
            steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
          } }) : await reviews.read({ target, isCurrent });
        if (!await canUse()) return forbidden;
        return project(result, fingerprint);
      } catch { return isCurrent() ? unavailable : forbidden; }
    },
  };
}

function project(result: HeadlessPlanReviewSnapshotResult, fingerprint: string): HeadlessPlanReviewAgentResult {
  if (!result.ok) {
    switch (result.code) {
      case "forbidden": return forbidden;
      case "invalid": return { ok: false, code: "headless.invalid-request" };
      case "expired": return { ok: false, code: "headless.plan-expired" };
      case "stale": return { ok: false, code: "headless.stale" };
      case "capacity": return { ok: false, code: "headless.operation-capacity" };
      default: return unavailable;
    }
  }
  const { revision, stepCount, expiresAt, status, approvedSteps, mode } = result.snapshot.state;
  return { ok: true, value: { fingerprint, revision, stepCount, expiresAt, status, approvedSteps,
    ...(mode === undefined ? {} : { mode }) } };
}
