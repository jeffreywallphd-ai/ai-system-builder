import type { WorkspaceAssetAccessPort } from "../../../application/ports/asset/workspace-asset-access.port";
import type { OrganizationMembershipRepositoryPort, OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { SystemBuildArtifactPort, SystemBuildHasherPort, SystemBuildRepositoryPort } from "../../../application/ports/system-build";
import type { SystemBuilderRepositoryPort } from "../../../application/ports/system-builder";
import type { SystemDeploymentRevocationPort } from "../../../application/ports/system-deployment";
import type { SystemDataReleaseDefinitionPort } from "../../../application/ports/system-data";
import { ResolveSystemFormReleaseService } from "../../../application/services/system-builder/resolve-system-form-release.service";
import { PublishedSystemFormRuntime } from "../../../application/use-cases/system-builder/published-system-form-runtime.use-case";
import { SubmitReleasedSystemFormUseCase, type SystemFormExecutionAuthority } from "../../../application/use-cases/system-builder/submit-released-system-form.use-case";
import type { ReleaseBoundSystemDataUseCases } from "../../../application/use-cases/system-data";
import { systemBuilderFailure, type PublishedSystemFormsInput, type PublishedSystemFormSubmitInput } from "../../../contracts/system-builder";
import { createWorkspaceId } from "../../../contracts/workspace";

export interface ComposePublishedSystemFormsOptions {
  readonly builds: Pick<SystemBuildRepositoryPort, "readRelease">;
  readonly systems: Pick<SystemBuilderRepositoryPort, "readRecord" | "readRevision">;
  readonly artifacts: Pick<SystemBuildArtifactPort, "readVerified">;
  readonly hasher: SystemBuildHasherPort;
  readonly revocations: SystemDeploymentRevocationPort;
  readonly systemData: { readonly definitions: SystemDataReleaseDefinitionPort;
    readonly runtime: Pick<ReleaseBoundSystemDataUseCases, "createFormRecordOnce"> };
  readonly workspaceAccess: WorkspaceAssetAccessPort;
  readonly organizations: OrganizationRequestContextProviderPort;
  readonly memberships: Pick<OrganizationMembershipRepositoryPort, "readMembership">;
}

export function composePublishedSystemForms(options: ComposePublishedSystemFormsOptions) {
  const releases = new ResolveSystemFormReleaseService(options);
  const submissions = new SubmitReleasedSystemFormUseCase({ release: releases, hasher: options.hasher,
    records: { createOnce: (command) => options.systemData.runtime.createFormRecordOnce(command) } });
  const runtime = new PublishedSystemFormRuntime({ releases, submissions, records: options.systemData.definitions });
  return {
    async list(input: PublishedSystemFormsInput, expectedActor?: string) {
      const authority = readPublishedFormAuthority(options, input.workspaceId, "asset:read", expectedActor);
      return authority ? runtime.list(input, authority) : unavailable();
    },
    async submit(input: PublishedSystemFormSubmitInput, expectedActor?: string) {
      const authority = readPublishedFormAuthority(options, input.workspaceId, "asset:write", expectedActor);
      return authority ? runtime.submit(input, authority) : unavailable();
    },
  };
}

export function readPublishedFormAuthority(options: Pick<ComposePublishedSystemFormsOptions, "workspaceAccess" | "organizations" | "memberships">,
  rawWorkspaceId: string, scope: "asset:read" | "asset:write", expectedActor?: string): SystemFormExecutionAuthority | undefined {
  try {
    const workspaceId = createWorkspaceId(rawWorkspaceId);
    const accepted = options.organizations.getCurrentOrganizationContext();
    if (!accepted || (expectedActor !== undefined && accepted.principalId !== expectedActor)) return;
    const { organizationId, principalId } = accepted;
    const samePrincipal = () => {
      const current = options.organizations.getCurrentOrganizationContext();
      return current?.organizationId === organizationId && current.principalId === principalId;
    };
    return { actorId: principalId, async readPrincipal() {
      try {
        if (!samePrincipal()) return;
        await options.workspaceAccess.authorize(workspaceId, scope === "asset:read" ? "system-form.list" : "system-form.submit", scope);
        const membership = await options.memberships.readMembership({ organizationId, principalId });
        if (!samePrincipal() || membership?.status !== "active" || membership.organizationId !== organizationId || membership.principalId !== principalId) return;
        return { actorId: principalId, authenticated: true, roles: [membership.role] };
      } catch { return; }
    } };
  } catch { return; }
}

function unavailable() {
  return systemBuilderFailure("system-form.forbidden", "You cannot use forms in this workspace.");
}
