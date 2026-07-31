import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { OrganizationId } from "../../../contracts/organization";
import type { StructuredDocument, StructuredDocumentStore } from "../shared";

export const NON_ASSIGNABLE_PLATFORM_NAMESPACES = [
  "application-settings",
  "local-identity-profile",
  "organization-directory",
] as const;

export interface LegacyStructuredDataInventory {
  readonly namespaces: readonly {
    namespace: string;
    documentCount: number;
  }[];
  readonly totalDocumentCount: number;
  readonly fingerprint: string;
}

export async function inventoryLegacyStructuredData(
  documents: StructuredDocumentStore,
  requestedNamespaces?: readonly string[],
): Promise<LegacyStructuredDataInventory> {
  if (documents.organizationId !== undefined) {
    throw new Error("Legacy inventory requires the platform/legacy document store.");
  }
  const available = await documents.listNamespaces();
  const namespaces = (requestedNamespaces ?? available)
    .map((value) => value.trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
  for (const namespace of namespaces) assertAssignableNamespace(namespace);

  const records: StructuredDocument[] = [];
  const inventoryNamespaces: { namespace: string; documentCount: number }[] = [];
  for (const namespace of namespaces) {
    const namespaceRecords = await documents.listDocuments(namespace);
    records.push(...namespaceRecords);
    inventoryNamespaces.push({ namespace, documentCount: namespaceRecords.length });
  }
  return {
    namespaces: inventoryNamespaces,
    totalDocumentCount: records.length,
    fingerprint: fingerprint(records),
  };
}

/** Explicit move with a pre-written rollback source and optimistic inventory check. */
export async function assignLegacyStructuredDataToOrganization(input: {
  documents: StructuredDocumentStore;
  organizationId: OrganizationId;
  namespaces: readonly string[];
  expectedFingerprint: string;
  rollbackFilePath: string;
  assignedAt?: string;
}): Promise<LegacyStructuredDataInventory> {
  if (input.namespaces.length === 0) throw new Error("At least one legacy namespace must be selected explicitly.");
  const inventory = await inventoryLegacyStructuredData(input.documents, input.namespaces);
  if (inventory.fingerprint !== input.expectedFingerprint) {
    throw new Error("Legacy inventory changed; review a new inventory before assignment.");
  }
  const records = await readSelectedRecords(input.documents, input.namespaces);
  const rollbackPath = path.resolve(input.rollbackFilePath);
  await mkdir(path.dirname(rollbackPath), { recursive: true });
  await writeFile(
    rollbackPath,
    [
      JSON.stringify({
        kind: "ai-system-builder-legacy-organization-assignment-rollback",
        version: 1,
        organizationId: input.organizationId,
        fingerprint: inventory.fingerprint,
        createdAt: input.assignedAt ?? new Date().toISOString(),
      }),
      ...records.map((record) => JSON.stringify({ kind: "document", ...record })),
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  await input.documents.runInTransaction(async (transaction) => {
    const target = transaction.forOrganization(input.organizationId);
    for (const record of records) {
      const current = await transaction.readDocument(record.namespace, record.key);
      if (!current || current.revision !== record.revision) {
        throw new Error("Legacy inventory changed during assignment.");
      }
      await target.writeDocument(record.namespace, record.key, record.value, {
        expectedRevision: 0,
        updatedAt: record.updatedAt,
      });
      await transaction.deleteDocument(record.namespace, record.key, record.revision);
    }
  });
  return inventory;
}

async function readSelectedRecords(
  documents: StructuredDocumentStore,
  namespaces: readonly string[],
): Promise<StructuredDocument[]> {
  const records: StructuredDocument[] = [];
  for (const namespace of [...namespaces].sort((left, right) => left.localeCompare(right))) {
    assertAssignableNamespace(namespace);
    records.push(...await documents.listDocuments(namespace));
  }
  return records.sort((left, right) =>
    left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key));
}

function fingerprint(records: readonly StructuredDocument[]): string {
  const hash = createHash("sha256");
  for (const record of [...records].sort((left, right) =>
    left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key))) {
    hash.update(JSON.stringify([
      record.namespace,
      record.key,
      record.revision,
      record.updatedAt,
      record.value,
    ]));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function assertAssignableNamespace(namespace: string): void {
  if ((NON_ASSIGNABLE_PLATFORM_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(`Platform namespace ${namespace} cannot be assigned to an organization.`);
  }
}
