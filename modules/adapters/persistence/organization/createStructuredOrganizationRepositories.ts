import type {
  OrganizationMembershipRepositoryPort,
  OrganizationRepositoryPort,
} from "../../../application/ports/organization";
import {
  isOrganizationId,
  isOrganizationMembershipStatus,
  isOrganizationRole,
  isOrganizationStatus,
  type OrganizationMembership,
  type OrganizationRecord,
} from "../../../contracts/organization";
import type { StructuredDocumentStore } from "../shared";

const ORGANIZATION_DIRECTORY_NAMESPACE = "organization-directory";
const ORGANIZATION_MEMBERSHIP_NAMESPACE = "organization-memberships";

export function createStructuredOrganizationRepositories(
  documents: StructuredDocumentStore,
): {
  organizations: OrganizationRepositoryPort;
  memberships: OrganizationMembershipRepositoryPort;
} {
  const organizations: OrganizationRepositoryPort = {
    async listOrganizations() {
      const records = await documents.listDocuments<OrganizationRecord>(ORGANIZATION_DIRECTORY_NAMESPACE);
      return records.map((record) => validateOrganization(record.value));
    },
    async readOrganization(organizationId) {
      const record = await documents.readDocument<OrganizationRecord>(
        ORGANIZATION_DIRECTORY_NAMESPACE,
        organizationId,
      );
      return record ? validateOrganization(record.value) : undefined;
    },
    async saveOrganization(record) {
      validateOrganization(record);
      await documents.writeDocument(
        ORGANIZATION_DIRECTORY_NAMESPACE,
        record.organizationId,
        record,
      );
    },
  };

  const memberships: OrganizationMembershipRepositoryPort = {
    async readMembership(input) {
      const record = await documents.forOrganization(input.organizationId)
        .readDocument<OrganizationMembership>(ORGANIZATION_MEMBERSHIP_NAMESPACE, input.principalId);
      return record ? validateMembership(record.value) : undefined;
    },
    async listPrincipalMemberships(principalId) {
      const results: OrganizationMembership[] = [];
      for (const organization of await organizations.listOrganizations()) {
        const membership = await this.readMembership({
          organizationId: organization.organizationId,
          principalId,
        });
        if (membership) results.push(membership);
      }
      return results;
    },
    async saveMembership(record) {
      validateMembership(record);
      await documents.forOrganization(record.organizationId).writeDocument(
        ORGANIZATION_MEMBERSHIP_NAMESPACE,
        record.principalId,
        record,
      );
    },
  };

  return { organizations, memberships };
}

function validateOrganization(record: OrganizationRecord): OrganizationRecord {
  if (
    !record ||
    !isOrganizationId(record.organizationId) ||
    !record.displayName?.trim() ||
    !isOrganizationStatus(record.status) ||
    !isTimestamp(record.createdAt) ||
    !isTimestamp(record.updatedAt)
  ) {
    throw new Error("Organization persistence returned an invalid record.");
  }
  return record;
}

function validateMembership(record: OrganizationMembership): OrganizationMembership {
  if (
    !record ||
    !isOrganizationId(record.organizationId) ||
    !record.principalId?.trim() ||
    !isOrganizationRole(record.role) ||
    !isOrganizationMembershipStatus(record.status) ||
    !isTimestamp(record.createdAt) ||
    !isTimestamp(record.updatedAt)
  ) {
    throw new Error("Organization membership persistence returned an invalid record.");
  }
  return record;
}

function isTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
