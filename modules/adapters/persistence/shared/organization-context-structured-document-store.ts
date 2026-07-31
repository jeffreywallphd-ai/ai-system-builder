import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { OrganizationId } from "../../../contracts/organization";
import type {
  StructuredDocumentStore,
  StructuredDocumentWriteOptions,
} from "./structured-document-store";

/**
 * Requires an explicit host request context before choosing an organization
 * partition. Organization-owned repositories cannot fall back to legacy data.
 */
export function createOrganizationContextStructuredDocumentStore(
  root: StructuredDocumentStore,
  contexts: OrganizationRequestContextProviderPort,
): StructuredDocumentStore {
  const resolve = (): StructuredDocumentStore => {
    const context = contexts.getCurrentOrganizationContext();
    if (!context) throw new Error("Organization request context is required for organization-owned persistence.");
    return root.forOrganization(context.organizationId);
  };

  return {
    get organizationId() {
      return contexts.getCurrentOrganizationContext()?.organizationId;
    },
    forOrganization(organizationId: OrganizationId) {
      const context = contexts.getCurrentOrganizationContext();
      if (!context) throw new Error("Organization request context is required for organization-owned persistence.");
      if (context.organizationId !== organizationId) {
        throw new Error("Requested organization does not match the active organization context.");
      }
      return root.forOrganization(organizationId);
    },
    readDocument: <T>(namespace: string, key: string) => resolve().readDocument<T>(namespace, key),
    listNamespaces: () => resolve().listNamespaces(),
    listDocuments: <T>(namespace: string) => resolve().listDocuments<T>(namespace),
    writeDocument: <T>(namespace: string, key: string, value: T, options?: StructuredDocumentWriteOptions) =>
      resolve().writeDocument(namespace, key, value, options),
    deleteDocument: (namespace: string, key: string, expectedRevision?: number) =>
      resolve().deleteDocument(namespace, key, expectedRevision),
    runInTransaction: <T>(work: (transaction: StructuredDocumentStore) => Promise<T>) =>
      resolve().runInTransaction(work),
  };
}
