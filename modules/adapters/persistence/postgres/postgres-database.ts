import type { PoolClient } from "pg";

import type { OrganizationId } from "../../../contracts/organization";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocument,
  type StructuredDocumentStore,
  type StructuredDocumentWriteOptions,
} from "../shared";
import {
  createPostgresPool,
  type PostgresPoolLike,
  type PostgresQueryable,
  type ResolvedPostgresPoolConfig,
} from "./client/createPostgresPool";

export const POSTGRES_SCHEMA_VERSION = 2;
export const POSTGRES_MIGRATION_LOCK_KEY = 6_517_390_241;
export const POSTGRES_MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS structured_documents (
  namespace text NOT NULL,
  document_key text NOT NULL,
  payload_json jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (namespace, document_key)
);

CREATE INDEX IF NOT EXISTS structured_documents_updated_at_idx
  ON structured_documents (namespace, updated_at DESC);
`;

export const POSTGRES_MIGRATION_0002 = `
CREATE TABLE organization_documents (
  organization_id text NOT NULL,
  namespace text NOT NULL,
  document_key text NOT NULL,
  payload_json jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, namespace, document_key)
);

CREATE INDEX organization_documents_updated_at_idx
  ON organization_documents (organization_id, namespace, updated_at DESC);

ALTER TABLE organization_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_documents_isolation ON organization_documents
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
`;

export interface PostgresHealthReport {
  readonly healthy: boolean;
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  readonly queryLatencyMs: number;
  readonly pool: {
    total: number;
    idle: number;
    waiting: number;
    idleClientErrorCount: number;
    lastIdleClientErrorAt?: string;
  };
}

export interface OpenedPostgresDatabase {
  readonly documents: StructuredDocumentStore;
  checkHealth(): Promise<PostgresHealthReport>;
  close(): Promise<void>;
}

export interface OpenPostgresDatabaseOptions {
  readonly config: ResolvedPostgresPoolConfig;
  readonly pool?: PostgresPoolLike;
  readonly now?: () => string;
  /** Provisioned runtime roles validate but never execute DDL migrations. */
  readonly migrate?: boolean;
}

export async function openPostgresDatabase(options: OpenPostgresDatabaseOptions): Promise<OpenedPostgresDatabase> {
  const pool = options.pool ?? createPostgresPool(options.config);
  const now = options.now ?? (() => new Date().toISOString());
  let idleClientErrorCount = 0;
  let lastIdleClientErrorAt: string | undefined;
  pool.on?.("error", () => {
    idleClientErrorCount += 1;
    lastIdleClientErrorAt = now();
  });
  try {
    const client = await pool.connect();
    try {
      if (options.migrate === false) {
        await validatePostgresDatabaseSchema(client);
      } else {
        await migratePostgresDatabase(client, now);
      }
      await client.query("SELECT 1 AS healthy");
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.end();
    throw errorWithCause("PostgreSQL startup validation failed.", error);
  }

  let closed = false;
  return {
    documents: createPostgresStructuredDocumentStore(pool, now),
    async checkHealth() {
      const startedAt = performance.now();
      const result = await pool.query<{ schema_version: number }>(
        "SELECT COALESCE(MAX(version), 0)::int AS schema_version FROM schema_migrations",
      );
      const schemaVersion = result.rows[0]?.schema_version ?? 0;
      return {
        healthy: schemaVersion === POSTGRES_SCHEMA_VERSION,
        schemaVersion,
        expectedSchemaVersion: POSTGRES_SCHEMA_VERSION,
        queryLatencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
          idleClientErrorCount,
          ...(lastIdleClientErrorAt ? { lastIdleClientErrorAt } : {}),
        },
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

export async function validatePostgresDatabaseSchema(
  client: PostgresQueryable,
): Promise<void> {
  const current = await client.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations",
  );
  const version = current.rows[0]?.version ?? 0;
  if (version !== POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `PostgreSQL schema version ${version} does not match supported version ${POSTGRES_SCHEMA_VERSION}.`,
    );
  }
}

export async function migratePostgresDatabase(
  client: PostgresQueryable,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [POSTGRES_MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL
      )
    `);
    const current = await client.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations",
    );
    const version = current.rows[0]?.version ?? 0;
    if (version > POSTGRES_SCHEMA_VERSION) {
      throw new Error(`PostgreSQL schema version ${version} is newer than supported version ${POSTGRES_SCHEMA_VERSION}.`);
    }
    if (version < 1) {
      await client.query(POSTGRES_MIGRATION_0001);
      await client.query(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)",
        [1, "create-structured-document-store", now()],
      );
    }
    if (version < 2) {
      await client.query(POSTGRES_MIGRATION_0002);
      await client.query(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)",
        [2, "create-organization-document-store-with-rls", now()],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration failure.
    }
    throw error;
  }
}

export function createPostgresStructuredDocumentStore(
  pool: PostgresPoolLike,
  now: () => string = () => new Date().toISOString(),
): StructuredDocumentStore {
  return createStore(pool, pool, now, false);
}

function createStore(
  pool: PostgresPoolLike,
  queryable: PostgresQueryable,
  now: () => string,
  insideTransaction: boolean,
  organizationId?: OrganizationId,
): StructuredDocumentStore {
  const executeScoped = async <T>(work: (active: PostgresQueryable) => Promise<T>): Promise<T> => {
    if (organizationId === undefined) return work(queryable);
    if (insideTransaction) {
      await bindPostgresOrganizationContext(queryable, organizationId);
      return work(queryable);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await bindPostgresOrganizationContext(client, organizationId);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the scoped operation failure.
      }
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    organizationId,
    forOrganization(requestedOrganizationId) {
      assertOrganizationScope(organizationId, requestedOrganizationId);
      return createStore(pool, queryable, now, insideTransaction, requestedOrganizationId);
    },
    async readDocument<T>(namespace: string, key: string) {
      const result = await executeScoped((active) => organizationId === undefined
        ? active.query(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM structured_documents WHERE namespace = $1 AND document_key = $2",
          [namespace, key],
        )
        : active.query(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM organization_documents WHERE organization_id = $1 AND namespace = $2 AND document_key = $3",
          [organizationId, namespace, key],
        ));
      return result.rows[0] ? mapDocument<T>(result.rows[0]) : undefined;
    },
    async listNamespaces() {
      const result = await executeScoped((active) => organizationId === undefined
        ? active.query<{ namespace: string }>(
          "SELECT DISTINCT namespace FROM structured_documents ORDER BY namespace",
        )
        : active.query<{ namespace: string }>(
          "SELECT DISTINCT namespace FROM organization_documents WHERE organization_id = $1 ORDER BY namespace",
          [organizationId],
        ));
      if (result.rows.some((row) => typeof row.namespace !== "string")) {
        throw new Error("PostgreSQL returned an invalid structured document namespace.");
      }
      return result.rows.map((row) => row.namespace);
    },
    async listDocuments<T>(namespace: string) {
      const result = await executeScoped((active) => organizationId === undefined
        ? active.query(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM structured_documents WHERE namespace = $1 ORDER BY document_key",
          [namespace],
        )
        : active.query(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM organization_documents WHERE organization_id = $1 AND namespace = $2 ORDER BY document_key",
          [organizationId, namespace],
        ));
      return result.rows.map((row) => mapDocument<T>(row));
    },
    async writeDocument<T>(namespace: string, key: string, value: T, options: StructuredDocumentWriteOptions = {}) {
      const updatedAt = options.updatedAt ?? now();
      const payload = cloneStructuredJson(value);
      const result = await executeScoped(async (active) => {
        if (organizationId !== undefined) {
          return options.expectedRevision === undefined
            ? active.query(`
                INSERT INTO organization_documents (organization_id, namespace, document_key, payload_json, revision, updated_at)
                VALUES ($1, $2, $3, $4::jsonb, 1, $5::timestamptz)
                ON CONFLICT (organization_id, namespace, document_key) DO UPDATE SET
                  payload_json = EXCLUDED.payload_json,
                  revision = organization_documents.revision + 1,
                  updated_at = EXCLUDED.updated_at
                RETURNING namespace, document_key, payload_json, revision, updated_at
              `, [organizationId, namespace, key, JSON.stringify(payload), updatedAt])
            : options.expectedRevision === 0
              ? active.query(`
                  INSERT INTO organization_documents (organization_id, namespace, document_key, payload_json, revision, updated_at)
                  VALUES ($1, $2, $3, $4::jsonb, 1, $5::timestamptz)
                  ON CONFLICT (organization_id, namespace, document_key) DO NOTHING
                  RETURNING namespace, document_key, payload_json, revision, updated_at
                `, [organizationId, namespace, key, JSON.stringify(payload), updatedAt])
              : active.query(`
                  UPDATE organization_documents
                  SET payload_json = $4::jsonb, revision = revision + 1, updated_at = $5::timestamptz
                  WHERE organization_id = $1 AND namespace = $2 AND document_key = $3 AND revision = $6
                  RETURNING namespace, document_key, payload_json, revision, updated_at
                `, [organizationId, namespace, key, JSON.stringify(payload), updatedAt, options.expectedRevision]);
        }
        return options.expectedRevision === undefined
        ? active.query(`
            INSERT INTO structured_documents (namespace, document_key, payload_json, revision, updated_at)
            VALUES ($1, $2, $3::jsonb, 1, $4::timestamptz)
            ON CONFLICT (namespace, document_key) DO UPDATE SET
              payload_json = EXCLUDED.payload_json,
              revision = structured_documents.revision + 1,
              updated_at = EXCLUDED.updated_at
            RETURNING namespace, document_key, payload_json, revision, updated_at
          `, [namespace, key, JSON.stringify(payload), updatedAt])
        : options.expectedRevision === 0
          ? active.query(`
              INSERT INTO structured_documents (namespace, document_key, payload_json, revision, updated_at)
              VALUES ($1, $2, $3::jsonb, 1, $4::timestamptz)
              ON CONFLICT (namespace, document_key) DO NOTHING
              RETURNING namespace, document_key, payload_json, revision, updated_at
            `, [namespace, key, JSON.stringify(payload), updatedAt])
          : active.query(`
            UPDATE structured_documents
            SET payload_json = $3::jsonb, revision = revision + 1, updated_at = $4::timestamptz
            WHERE namespace = $1 AND document_key = $2 AND revision = $5
            RETURNING namespace, document_key, payload_json, revision, updated_at
          `, [namespace, key, JSON.stringify(payload), updatedAt, options.expectedRevision]);
      });
      if (!result.rows[0]) {
        throw new StructuredDocumentConflictError(namespace, key, options.expectedRevision ?? 0);
      }
      return mapDocument<T>(result.rows[0]);
    },
    async deleteDocument(namespace: string, key: string, expectedRevision?: number) {
      const result = await executeScoped((active) => organizationId === undefined
        ? expectedRevision === undefined
          ? active.query("DELETE FROM structured_documents WHERE namespace = $1 AND document_key = $2 RETURNING revision", [namespace, key])
          : active.query("DELETE FROM structured_documents WHERE namespace = $1 AND document_key = $2 AND revision = $3 RETURNING revision", [namespace, key, expectedRevision])
        : expectedRevision === undefined
          ? active.query("DELETE FROM organization_documents WHERE organization_id = $1 AND namespace = $2 AND document_key = $3 RETURNING revision", [organizationId, namespace, key])
          : active.query("DELETE FROM organization_documents WHERE organization_id = $1 AND namespace = $2 AND document_key = $3 AND revision = $4 RETURNING revision", [organizationId, namespace, key, expectedRevision]));
      if (expectedRevision !== undefined && result.rowCount === 0) {
        throw new StructuredDocumentConflictError(namespace, key, expectedRevision);
      }
      return (result.rowCount ?? 0) === 1;
    },
    async runInTransaction<T>(work: (transaction: StructuredDocumentStore) => Promise<T>) {
      if (insideTransaction) return work(this);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          if (organizationId !== undefined) await bindPostgresOrganizationContext(client, organizationId);
          const result = await work(createStore(pool, client, now, true, organizationId));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the work failure.
          }
          if (!isRetryablePostgresTransactionError(error) || attempt === 4) throw error;
        } finally {
          (client as PoolClient).release();
        }
      }
      throw new Error("PostgreSQL transaction retry loop ended unexpectedly.");
    },
  };
}

export async function bindPostgresOrganizationContext(
  queryable: PostgresQueryable,
  organizationId: OrganizationId,
): Promise<void> {
  await queryable.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
}

function assertOrganizationScope(
  currentOrganizationId: OrganizationId | undefined,
  requestedOrganizationId: OrganizationId,
): void {
  if (currentOrganizationId !== undefined && currentOrganizationId !== requestedOrganizationId) {
    throw new Error("An organization-scoped document store cannot change organization scope.");
  }
}

export function isRetryablePostgresTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "40001" || code === "40P01";
}

function mapDocument<T>(row: Record<string, unknown>): StructuredDocument<T> {
  if (
    typeof row.namespace !== "string" ||
    typeof row.document_key !== "string" ||
    row.payload_json === undefined ||
    (typeof row.revision !== "number" && typeof row.revision !== "string") ||
    !(typeof row.updated_at === "string" || row.updated_at instanceof Date)
  ) {
    throw new Error("PostgreSQL returned an invalid structured document row.");
  }
  return {
    namespace: row.namespace,
    key: row.document_key,
    value: (typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json) as T,
    revision: Number(row.revision),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}
