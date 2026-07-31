import type {
  OrganizationId,
  OrganizationMembership,
} from "../../../contracts/organization";

export interface OrganizationMembershipRepositoryPort {
  readMembership(input: {
    organizationId: OrganizationId;
    principalId: string;
  }): Promise<OrganizationMembership | undefined>;
  listPrincipalMemberships(
    principalId: string,
  ): Promise<readonly OrganizationMembership[]>;
  saveMembership(record: OrganizationMembership): Promise<void>;
}
