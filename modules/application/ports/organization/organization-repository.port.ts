import type {
  OrganizationId,
  OrganizationRecord,
} from "../../../contracts/organization";

export interface OrganizationRepositoryPort {
  listOrganizations(): Promise<readonly OrganizationRecord[]>;
  readOrganization(
    organizationId: OrganizationId,
  ): Promise<OrganizationRecord | undefined>;
  saveOrganization(record: OrganizationRecord): Promise<void>;
}
