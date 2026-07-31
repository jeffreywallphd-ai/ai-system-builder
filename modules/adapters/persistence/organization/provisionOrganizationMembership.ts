import type { OrganizationRole } from "../../../contracts/organization";
import { createStructuredOrganizationRepositories } from "./createStructuredOrganizationRepositories";
import type { StructuredDocumentStore } from "../shared";
import type { OrganizationId } from "../../../contracts/organization";

/** Privileged operator seam; callers must authenticate and confirm outside this adapter. */
export async function provisionOrganizationMembership(input: {
  documents: StructuredDocumentStore;
  organizationId: OrganizationId;
  organizationDisplayName: string;
  principalId: string;
  role: OrganizationRole;
  now?: () => string;
}): Promise<{ organizationCreated: boolean; membershipCreated: boolean }> {
  const displayName = input.organizationDisplayName.trim();
  const principalId = input.principalId.trim();
  if (!displayName || displayName.length > 160) throw new Error("Organization display name is invalid.");
  if (!principalId || principalId.length > 160) throw new Error("Principal id is invalid.");
  const now = input.now ?? (() => new Date().toISOString());

  return input.documents.runInTransaction(async (transaction) => {
    const repositories = createStructuredOrganizationRepositories(transaction);
    const existingOrganization = await repositories.organizations.readOrganization(input.organizationId);
    const existingMembership = await repositories.memberships.readMembership({
      organizationId: input.organizationId,
      principalId,
    });
    const occurredAt = now();
    await repositories.organizations.saveOrganization({
      organizationId: input.organizationId,
      displayName,
      status: "active",
      createdAt: existingOrganization?.createdAt ?? occurredAt,
      updatedAt: occurredAt,
    });
    await repositories.memberships.saveMembership({
      organizationId: input.organizationId,
      principalId,
      role: input.role,
      status: "active",
      createdAt: existingMembership?.createdAt ?? occurredAt,
      updatedAt: occurredAt,
    });
    return {
      organizationCreated: !existingOrganization,
      membershipCreated: !existingMembership,
    };
  });
}
