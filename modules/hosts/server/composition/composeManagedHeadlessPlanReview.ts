import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessPlanReviewRepository } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../application/services/security";
import type { TenantPlacementConfig } from "../../../contracts/config";
import { isDesktopHeadlessClientId, type HeadlessHostIncarnationId,
  type HeadlessPlanReviewAgentRequest, type HeadlessPlanReviewAgentResult } from "../../../contracts/headless";
import type { WorkspaceId } from "../../../contracts/workspace";
import { projectHeadlessPlanReview, validateHeadlessPlanSavedSources } from "../../shared/composition/headlessPlanReview";
import type { ManagedPlanReviewRegistration } from "../security/resolveManagedHeadlessClientPolicy";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

export function composeManagedHeadlessPlanReview(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly placement: TenantPlacementConfig;
}) {
  const { hostIncarnationId, platform, rootDirectory, workspaces, contexts, authorization, placement } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Managed plan review requires the platform transaction owner.");

  return async function execute(request: HeadlessPlanReviewAgentRequest, registration: ManagedPlanReviewRegistration,
    isOpen: () => boolean): Promise<HeadlessPlanReviewAgentResult> {
    const { organizationId, principalId, registeredClientId } = registration;
    const { workspaceId, fingerprint } = request.target;
    const current = () => {
      const active = contexts.getCurrentOrganizationContext();
      return isOpen() && registration.isCurrent() && active?.organizationId === organizationId && active?.principalId === principalId;
    };
    if (registration.purpose !== "plan-review" || !isDesktopHeadlessClientId(registeredClientId) ||
        request.target.hostIncarnationId !== hostIncarnationId || !current()) return forbidden;
    const scope = { organizationId, principalId, registeredClientId, workspaceId };

    async function authorize(repository: typeof workspaces, policy: WorkspaceOperationAuthorizationPort, target: WorkspaceId) {
      try {
        if (!current() || target !== workspaceId) return false;
        const workspace = await repository.readWorkspace(workspaceId);
        if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
            workspace.status !== "active") return false;
        await policy.authorizeWorkspaceOperation({ workspace, operation: "headless." + request.operation,
          requiredScopes: ["workspace:read", "asset:read", "asset:write"] });
        return current();
      } catch { return false; }
    }

    try {
      if (!await authorize(workspaces, authorization, workspaceId)) return forbidden;
      const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, target, action) => {
        const stored = target.scope;
        if (!current() || target.hostIncarnationId !== hostIncarnationId || target.fingerprint !== fingerprint ||
            stored.organizationId !== organizationId || stored.principalId !== principalId || stored.registeredClientId !== registeredClientId ||
            action !== (request.operation === "plan.submit" ? "propose" : "read")) return false;
        const repository = createLocalWorkspaceRepository({ rootDirectory, documents: owner.forOrganization(organizationId) });
        const policy = createOrganizationAuthorizationPolicy({ ...createStructuredOrganizationRepositories(owner), tenantPlacement: placement });
        const authorizer = new AuthorizeWorkspaceOperationService({ organizationContext: contexts, authorizer: {
          async execute(input) {
            const decision = await policy.authorize(input);
            if (!decision.allowed) throw new Error("The workspace is unavailable.");
          },
        } });
        return authorize(repository, authorizer, stored.workspaceId);
      }, Date.now, documents => request.operation === "plan.submit"
        ? validateHeadlessPlanSavedSources(documents, workspaceId, request.proposal.requests, current) : Promise.resolve(false));
      const target = { hostIncarnationId, fingerprint, scope };
      const outcome = request.operation === "plan.submit"
        ? await reviews.propose({ target, isCurrent: current, proposal: {
            ...request.proposal.scope,
            steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
          } })
        : await reviews.read({ target, isCurrent: current });
      if (!await authorize(workspaces, authorization, workspaceId)) return forbidden;
      return projectHeadlessPlanReview(outcome, fingerprint);
    } catch { return current() ? unavailable : forbidden; }
  };
}
