import type { OrganizationId } from "../../../contracts/organization";

export interface StructuredDocument<T = unknown> {
  readonly namespace: string;
  readonly key: string;
  readonly value: T;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface StructuredDocumentWriteOptions {
  /** Revision 0 means insert only when the document is still absent. */
  readonly expectedRevision?: number;
  readonly updatedAt?: string;
}

/**
 * Adapter-internal persistence seam used to preserve application repository
 * contracts while deployment hosts select SQLite or PostgreSQL.
 *
 * This is intentionally not an application port. Domain/application code must
 * continue to depend on the typed repository ports for each record family.
 */
export interface StructuredDocumentStore {
  /** Undefined identifies the unassigned platform/legacy partition. */
  readonly organizationId?: OrganizationId;
  /** Returns a store whose operations are isolated to exactly one organization. */
  forOrganization(organizationId: OrganizationId): StructuredDocumentStore;
  readDocument<T>(namespace: string, key: string): Promise<StructuredDocument<T> | undefined>;
  listNamespaces(): Promise<readonly string[]>;
  listDocuments<T>(namespace: string): Promise<readonly StructuredDocument<T>[]>;
  writeDocument<T>(
    namespace: string,
    key: string,
    value: T,
    options?: StructuredDocumentWriteOptions,
  ): Promise<StructuredDocument<T>>;
  deleteDocument(namespace: string, key: string, expectedRevision?: number): Promise<boolean>;
  runInTransaction<T>(work: (transaction: StructuredDocumentStore) => Promise<T>): Promise<T>;
}

export class StructuredDocumentConflictError extends Error {
  public constructor(namespace: string, key: string, expectedRevision: number) {
    super(`Structured document revision conflict for ${namespace}/${key}; expected revision ${expectedRevision}.`);
    this.name = "StructuredDocumentConflictError";
  }
}

export function isStructuredDocumentConflict(error: unknown): error is StructuredDocumentConflictError {
  return error instanceof StructuredDocumentConflictError;
}

export function cloneStructuredJson<T>(value: T): T {
  if (value === undefined) {
    throw new TypeError("Structured document values must be JSON-compatible and cannot be undefined.");
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
