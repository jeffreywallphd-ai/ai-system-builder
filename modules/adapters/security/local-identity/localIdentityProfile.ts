import { randomUUID } from "node:crypto";

import {
  createOrganizationId,
  type LocalIdentityProfile,
} from "../../../contracts/organization";
import { createStructuredOrganizationRepositories } from "../../persistence/organization";
import type { StructuredDocumentStore } from "../../persistence/shared";

const LOCAL_IDENTITY_NAMESPACE = "local-identity-profile";
const ACTIVE_LOCAL_IDENTITY_KEY = "active";

export async function readLocalIdentityProfile(
  documents: StructuredDocumentStore,
): Promise<LocalIdentityProfile | undefined> {
  const record = await documents.readDocument<LocalIdentityProfile>(
    LOCAL_IDENTITY_NAMESPACE,
    ACTIVE_LOCAL_IDENTITY_KEY,
  );
  return record?.value;
}

/** Explicit, one-time local first-run operation. It is never called as a read fallback. */
export async function initializeLocalIdentityProfile(input: {
  documents: StructuredDocumentStore;
  organizationDisplayName: string;
  principalDisplayName: string;
  now?: () => string;
  createId?: () => string;
}): Promise<LocalIdentityProfile> {
  const organizationDisplayName = requiredDisplayName(input.organizationDisplayName, "Organization");
  const principalDisplayName = requiredDisplayName(input.principalDisplayName, "Principal");
  const now = input.now ?? (() => new Date().toISOString());
  const createId = input.createId ?? randomUUID;

  return input.documents.runInTransaction(async (transaction) => {
    if (await readLocalIdentityProfile(transaction)) {
      throw new Error("A local identity profile is already initialized.");
    }
    const occurredAt = now();
    const organizationId = createOrganizationId(`org-${createId()}`);
    const principalId = `local-principal-${createId()}`;
    const profile: LocalIdentityProfile = {
      organizationId,
      principalId,
      principalDisplayName,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const repositories = createStructuredOrganizationRepositories(transaction);
    await repositories.organizations.saveOrganization({
      organizationId,
      displayName: organizationDisplayName,
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    await repositories.memberships.saveMembership({
      organizationId,
      principalId,
      role: "owner",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    await transaction.writeDocument(
      LOCAL_IDENTITY_NAMESPACE,
      ACTIVE_LOCAL_IDENTITY_KEY,
      profile,
      { expectedRevision: 0, updatedAt: occurredAt },
    );
    return profile;
  });
}

function requiredDisplayName(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160) {
    throw new Error(`${label} display name must contain 1 through 160 characters.`);
  }
  return normalized;
}
