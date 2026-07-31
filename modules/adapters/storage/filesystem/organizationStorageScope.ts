import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import { normalizeStorageArtifactKey } from "../../../contracts/storage";

export function resolveOrganizationStorageKey(
  logicalKey: string,
  contexts?: OrganizationRequestContextProviderPort,
): string {
  const key = normalizeStorageArtifactKey(logicalKey);
  if (!contexts) return key;
  const context = contexts.getCurrentOrganizationContext();
  if (!context) throw new Error("Organization request context is required for organization-owned object storage.");
  return normalizeStorageArtifactKey(`organizations/${context.organizationId}/${key}`);
}
