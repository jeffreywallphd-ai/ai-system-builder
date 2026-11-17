import type { SystemBuildArtifactPort, SystemBuildRepositoryPort } from "../../../application/ports/system-build";
import type { OrganizationMembershipRepositoryPort, OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import { ReleaseBoundSystemDataDefinitionService } from "../../../application/services/system-data";
import { ReleaseBoundSystemDataUseCases } from "../../../application/use-cases/system-data";
import { createStructuredSystemDataRepository } from "../../../adapters/persistence/system-data";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { isOrganizationRole } from "../../../contracts/organization";
import type { SystemDataPrincipal } from "../../../contracts/system-data";

export function createManagedSystemDataPrincipal(
  organizations: OrganizationRequestContextProviderPort,
  memberships?: Pick<OrganizationMembershipRepositoryPort, "readMembership">,
) {
  return async (actorId: string): Promise<SystemDataPrincipal | undefined> => {
    const context = organizations.getCurrentOrganizationContext();
    if (!context || context.principalId !== actorId) return undefined;
    const { organizationId, principalId } = context;
    const member = await memberships?.readMembership({ organizationId, principalId });
    const current = organizations.getCurrentOrganizationContext();
    if (current?.organizationId !== organizationId || current.principalId !== principalId ||
        member?.status !== "active" || member.organizationId !== organizationId || member.principalId !== principalId ||
        !isOrganizationRole(member.role)) return undefined;
    return { actorId: principalId, roles: [member.role], authenticated: true };
  };
}

export interface ComposeSystemDataOptions {
  readonly documents: StructuredDocumentStore;
  readonly builds: SystemBuildRepositoryPort;
  readonly artifacts: SystemBuildArtifactPort;
  readonly generateAuditId: () => string;
  readonly now?: () => string;
}

export function composeSystemData(options: ComposeSystemDataOptions) {
  const repository = createStructuredSystemDataRepository(options.documents);
  const definitions = new ReleaseBoundSystemDataDefinitionService(options.builds, options.artifacts);
  const runtime = new ReleaseBoundSystemDataUseCases({
    repository,
    definitions,
    generateAuditId: options.generateAuditId,
    now: options.now,
  });
  return { repository, definitions, runtime };
}

export type SystemDataCompositionRoot = ReturnType<typeof composeSystemData>;
