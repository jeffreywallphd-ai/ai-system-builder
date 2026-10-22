import { createInMemoryStructuredDocumentStore } from "../../../../../adapters/persistence/shared";
import { createStructuredImageResourceIdentityAdapter } from "../../../../../adapters/persistence/image";

export function createTestImageResourceIdentity() {
  return createStructuredImageResourceIdentityAdapter(createInMemoryStructuredDocumentStore().forOrganization("organization-a" as never));
}
