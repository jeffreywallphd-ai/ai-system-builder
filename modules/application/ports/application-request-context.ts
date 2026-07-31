import type { OrganizationId } from "../../contracts/organization";

export interface ApplicationRequestContext {
  requestId?: string;
  correlationId?: string;
  organizationId?: OrganizationId;
  principalId?: string;
  workspaceId?: string;
}
