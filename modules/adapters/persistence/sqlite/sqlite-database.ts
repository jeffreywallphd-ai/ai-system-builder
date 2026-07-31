import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { OrganizationId } from "../../../contracts/organization";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocument,
  type StructuredDocumentStore,
  type StructuredDocumentWriteOptions,
} from "../shared";
import {
  DEFAULT_LOCAL_SQLITE_BUSY_TIMEOUT_MS,
  type LocalSqliteDatabasePolicy,
} from "./local-sqlite-database-policy";

export const LOCAL_SQLITE_SCHEMA_VERSION = 2;

export const LOCAL_SQLITE_MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS structured_documents (
  namespace TEXT NOT NULL,
  document_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, document_key)
) STRICT;

CREATE INDEX IF NOT EXISTS structured_documents_updated_at_idx
  ON structured_documents (namespace, updated_at DESC);
`;

export const LOCAL_SQLITE_MIGRATION_0002 = `
CREATE TABLE IF NOT EXISTS organization_documents (
  organization_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  document_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, namespace, document_key)
) STRICT;

CREATE INDEX IF NOT EXISTS organization_documents_updated_at_idx
  ON organization_documents (organization_id, namespace, updated_at DESC);
`;

type SqliteBindable = null | number | bigint | string | NodeJS.ArrayBufferView;

export interface SqliteStatementLike {
  get(...parameters: SqliteBindable[]): unknown;
  all(...parameters: SqliteBindable[]): unknown[];
  run(...parameters: SqliteBindable[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

export interface LocalSqliteHealthReport {
  readonly healthy: boolean;
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  readonly integrityResult: string;
  readonly journalMode: string;
  readonly foreignKeysEnabled: boolean;
}

export interface OpenLocalSqliteDatabaseOptions {
  readonly policy: LocalSqliteDatabasePolicy;
  readonly now?: () => string;
}

export interface OpenedLocalSqliteDatabase {
  readonly databasePath: string;
  readonly documents: StructuredDocumentStore;
  checkHealth(): LocalSqliteHealthReport;
  createBackup(destinationPath: string): Promise<{ destinationPath: string; pages: number }>;
  close(): void;
}

interface SqliteModuleLike {
  newDatabase(path: string, options: {
    enableForeignKeyConstraints: boolean;
    enableDoubleQuotedStringLiterals: boolean;
    allowExtension: boolean;
    timeout?: number;
    readOnly?: boolean;
  }): SqliteDatabaseLike;
  backup(source: SqliteDatabaseLike, destinationPath: string): Promise<number>;
}

export interface RestoreLocalSqliteDatabaseOptions {
  readonly backupPath: string;
  readonly databasePath: string;
}

export interface RestoredLocalSqliteDatabase {
  readonly databasePath: string;
  readonly replacedDatabasePath?: string;
}

export async function openLocalSqliteDatabase(
  options: OpenLocalSqliteDatabaseOptions,
): Promise<OpenedLocalSqliteDatabase> {
  await mkdir(path.dirname(options.policy.databaseFilePath), { recursive: true });
  const sqlite = await loadNodeSqlite();
  const database = sqlite.newDatabase(options.policy.databaseFilePath, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: options.policy.connection.busyTimeoutMs,
  });

  try {
    configureLocalSqliteDatabase(database, options.policy.connection);
    migrateLocalSqliteDatabase(database, options.now);
    const documents = createSqliteStructuredDocumentStore(database, options.now);
    let closed = false;
    return {
      databasePath: options.policy.databaseFilePath,
      documents,
      checkHealth: () => checkLocalSqliteHealth(database),
      async createBackup(destinationPath) {
        const resolvedDestination = path.resolve(destinationPath);
        await mkdir(path.dirname(resolvedDestination), { recursive: true });
        const pages = await sqlite.backup(database, resolvedDestination);
        return { destinationPath: resolvedDestination, pages };
      },
      close() {
        if (closed) return;
        closed = true;
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Restores a validated backup while the live database connection is closed. */
export async function restoreLocalSqliteDatabase(
  options: RestoreLocalSqliteDatabaseOptions,
): Promise<RestoredLocalSqliteDatabase> {
  const backupPath = path.resolve(options.backupPath);
  const databasePath = path.resolve(options.databasePath);
  if (backupPath === databasePath) throw new Error("SQLite backup and restore target must be different files.");

  const sqlite = await loadNodeSqlite();
  const backup = sqlite.newDatabase(backupPath, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    readOnly: true,
  });
  try {
    const integrityResult = readPragmaText(backup, "integrity_check");
    const schemaVersion = readPragmaNumber(backup, "user_version");
    if (integrityResult.toLowerCase() !== "ok" || schemaVersion !== LOCAL_SQLITE_SCHEMA_VERSION) {
      throw new Error(
        `SQLite backup validation failed (integrity=${integrityResult}, schemaVersion=${schemaVersion}).`,
      );
    }
  } finally {
    backup.close();
  }

  await mkdir(path.dirname(databasePath), { recursive: true });
  const restoreCandidatePath = `${databasePath}.restore-candidate`;
  const replacedDatabasePath = `${databasePath}.pre-restore`;
  await rm(restoreCandidatePath, { force: true });
  await rm(replacedDatabasePath, { force: true });
  await copyFile(backupPath, restoreCandidatePath);

  const liveDatabaseExists = await pathExists(databasePath);
  try {
    if (liveDatabaseExists) await rename(databasePath, replacedDatabasePath);
    await rename(restoreCandidatePath, databasePath);
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
  } catch (error) {
    await rm(restoreCandidatePath, { force: true });
    if (liveDatabaseExists && !(await pathExists(databasePath)) && await pathExists(replacedDatabasePath)) {
      await rename(replacedDatabasePath, databasePath);
    }
    throw errorWithCause("Unable to replace the local SQLite database with the validated backup.", error);
  }

  return {
    databasePath,
    replacedDatabasePath: liveDatabaseExists ? replacedDatabasePath : undefined,
  };
}

async function loadNodeSqlite(): Promise<SqliteModuleLike> {
  try {
    const sqlite = await import("node:sqlite");
    return {
      newDatabase: (databasePath, options) => new sqlite.DatabaseSync(databasePath, options) as unknown as SqliteDatabaseLike,
      backup: (source, destinationPath) => sqlite.backup(source as never, destinationPath),
    };
  } catch (error) {
    throw errorWithCause(
      "Local SQLite requires the Electron/Node runtime that provides node:sqlite; no JSON fallback was selected.",
      error,
    );
  }
}

export function configureLocalSqliteDatabase(
  database: SqliteDatabaseLike,
  policy: LocalSqliteDatabasePolicy["connection"],
): void {
  database.exec(`PRAGMA journal_mode = ${policy.journalMode.toUpperCase()};`);
  database.exec(`PRAGMA synchronous = ${policy.synchronous.toUpperCase()};`);
  database.exec(`PRAGMA foreign_keys = ${policy.foreignKeys ? "ON" : "OFF"};`);
  database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(policy.busyTimeoutMs ?? DEFAULT_LOCAL_SQLITE_BUSY_TIMEOUT_MS))};`);
}

export function migrateLocalSqliteDatabase(database: SqliteDatabaseLike, now: () => string = () => new Date().toISOString()): void {
  const currentVersion = readPragmaNumber(database, "user_version");
  if (currentVersion > LOCAL_SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${currentVersion} is newer than supported version ${LOCAL_SQLITE_SCHEMA_VERSION}.`,
    );
  }
  if (currentVersion === LOCAL_SQLITE_SCHEMA_VERSION) return;

  database.exec("BEGIN IMMEDIATE;");
  try {
    if (currentVersion < 1) {
      database.exec(LOCAL_SQLITE_MIGRATION_0001);
      database.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(1, "create-structured-document-store", now());
    }
    if (currentVersion < 2) {
      database.exec(LOCAL_SQLITE_MIGRATION_0002);
      database.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(2, "create-organization-document-store", now());
    }
    database.exec(`PRAGMA user_version = ${LOCAL_SQLITE_SCHEMA_VERSION};`);
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Preserve the migration failure; SQLite may already have rolled back.
    }
    throw errorWithCause("Unable to migrate the local SQLite database.", error);
  }
}

export function checkLocalSqliteHealth(database: SqliteDatabaseLike): LocalSqliteHealthReport {
  const integrityResult = readPragmaText(database, "quick_check");
  const journalMode = readPragmaText(database, "journal_mode");
  const foreignKeysEnabled = readPragmaNumber(database, "foreign_keys") === 1;
  const schemaVersion = readPragmaNumber(database, "user_version");
  return {
    healthy:
      integrityResult.toLowerCase() === "ok" &&
      journalMode.toLowerCase() === "wal" &&
      foreignKeysEnabled &&
      schemaVersion === LOCAL_SQLITE_SCHEMA_VERSION,
    schemaVersion,
    expectedSchemaVersion: LOCAL_SQLITE_SCHEMA_VERSION,
    integrityResult,
    journalMode,
    foreignKeysEnabled,
  };
}

export function createSqliteStructuredDocumentStore(
  database: SqliteDatabaseLike,
  now: () => string = () => new Date().toISOString(),
): StructuredDocumentStore {
  const store = createStore(database, now, false);
  return store;
}

function createStore(
  database: SqliteDatabaseLike,
  now: () => string,
  insideTransaction: boolean,
  organizationId?: OrganizationId,
): StructuredDocumentStore {
  return {
    organizationId,
    forOrganization(requestedOrganizationId) {
      assertOrganizationScope(organizationId, requestedOrganizationId);
      return createStore(database, now, insideTransaction, requestedOrganizationId);
    },
    async readDocument<T>(namespace: string, key: string) {
      const row = organizationId === undefined
        ? database.prepare(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM structured_documents WHERE namespace = ? AND document_key = ?",
        ).get(namespace, key)
        : database.prepare(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM organization_documents WHERE organization_id = ? AND namespace = ? AND document_key = ?",
        ).get(organizationId, namespace, key);
      return row ? mapDocument<T>(row) : undefined;
    },

    async listNamespaces() {
      const rows = organizationId === undefined
        ? database.prepare(
          "SELECT DISTINCT namespace FROM structured_documents ORDER BY namespace",
        ).all()
        : database.prepare(
          "SELECT DISTINCT namespace FROM organization_documents WHERE organization_id = ? ORDER BY namespace",
        ).all(organizationId);
      return rows.map((row) => {
        if (!row || typeof row !== "object" || typeof (row as { namespace?: unknown }).namespace !== "string") {
          throw new Error("SQLite returned an invalid structured document namespace.");
        }
        return (row as { namespace: string }).namespace;
      });
    },

    async listDocuments<T>(namespace: string) {
      const rows = organizationId === undefined
        ? database.prepare(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM structured_documents WHERE namespace = ? ORDER BY document_key",
        ).all(namespace)
        : database.prepare(
          "SELECT namespace, document_key, payload_json, revision, updated_at FROM organization_documents WHERE organization_id = ? AND namespace = ? ORDER BY document_key",
        ).all(organizationId, namespace);
      return rows.map((row) => mapDocument<T>(row));
    },

    async writeDocument<T>(namespace: string, key: string, value: T, options: StructuredDocumentWriteOptions = {}) {
      const payload = JSON.stringify(cloneStructuredJson(value));
      const updatedAt = options.updatedAt ?? now();
      let changes: number | bigint;
      if (organizationId !== undefined) {
        if (options.expectedRevision === undefined) {
          changes = database.prepare(`
            INSERT INTO organization_documents (organization_id, namespace, document_key, payload_json, revision, updated_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(organization_id, namespace, document_key) DO UPDATE SET
              payload_json = excluded.payload_json,
              revision = organization_documents.revision + 1,
              updated_at = excluded.updated_at
          `).run(organizationId, namespace, key, payload, updatedAt).changes;
        } else if (options.expectedRevision === 0) {
          changes = database.prepare(`
            INSERT INTO organization_documents (organization_id, namespace, document_key, payload_json, revision, updated_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(organization_id, namespace, document_key) DO NOTHING
          `).run(organizationId, namespace, key, payload, updatedAt).changes;
        } else {
          changes = database.prepare(`
            UPDATE organization_documents
            SET payload_json = ?, revision = revision + 1, updated_at = ?
            WHERE organization_id = ? AND namespace = ? AND document_key = ? AND revision = ?
          `).run(payload, updatedAt, organizationId, namespace, key, options.expectedRevision).changes;
        }
      } else if (options.expectedRevision === undefined) {
        changes = database.prepare(`
          INSERT INTO structured_documents (namespace, document_key, payload_json, revision, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(namespace, document_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            revision = structured_documents.revision + 1,
            updated_at = excluded.updated_at
        `).run(namespace, key, payload, updatedAt).changes;
      } else if (options.expectedRevision === 0) {
        changes = database.prepare(`
          INSERT INTO structured_documents (namespace, document_key, payload_json, revision, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(namespace, document_key) DO NOTHING
        `).run(namespace, key, payload, updatedAt).changes;
      } else {
        changes = database.prepare(`
          UPDATE structured_documents
          SET payload_json = ?, revision = revision + 1, updated_at = ?
          WHERE namespace = ? AND document_key = ? AND revision = ?
        `).run(payload, updatedAt, namespace, key, options.expectedRevision).changes;
      }
      if (Number(changes) !== 1) {
        throw new StructuredDocumentConflictError(namespace, key, options.expectedRevision ?? 0);
      }
      const written = await this.readDocument<T>(namespace, key);
      if (!written) throw new Error(`SQLite write did not return ${namespace}/${key}.`);
      return written;
    },

    async deleteDocument(namespace: string, key: string, expectedRevision?: number) {
      const result = organizationId === undefined
        ? expectedRevision === undefined
          ? database.prepare("DELETE FROM structured_documents WHERE namespace = ? AND document_key = ?").run(namespace, key)
          : database.prepare("DELETE FROM structured_documents WHERE namespace = ? AND document_key = ? AND revision = ?").run(namespace, key, expectedRevision)
        : expectedRevision === undefined
          ? database.prepare("DELETE FROM organization_documents WHERE organization_id = ? AND namespace = ? AND document_key = ?").run(organizationId, namespace, key)
          : database.prepare("DELETE FROM organization_documents WHERE organization_id = ? AND namespace = ? AND document_key = ? AND revision = ?").run(organizationId, namespace, key, expectedRevision);
      if (expectedRevision !== undefined && Number(result.changes) === 0) {
        throw new StructuredDocumentConflictError(namespace, key, expectedRevision);
      }
      return Number(result.changes) === 1;
    },

    async runInTransaction<T>(work: (transaction: StructuredDocumentStore) => Promise<T>): Promise<T> {
      if (insideTransaction) return work(this);
      database.exec("BEGIN IMMEDIATE;");
      try {
        const result = await work(createStore(database, now, true, organizationId));
        database.exec("COMMIT;");
        return result;
      } catch (error) {
        try {
          database.exec("ROLLBACK;");
        } catch {
          // Preserve the work failure; SQLite may already have rolled back.
        }
        throw error;
      }
    },
  };
}

function assertOrganizationScope(
  currentOrganizationId: OrganizationId | undefined,
  requestedOrganizationId: OrganizationId,
): void {
  if (currentOrganizationId !== undefined && currentOrganizationId !== requestedOrganizationId) {
    throw new Error("An organization-scoped document store cannot change organization scope.");
  }
}

function mapDocument<T>(value: unknown): StructuredDocument<T> {
  if (!value || typeof value !== "object") throw new Error("SQLite returned an invalid structured document row.");
  const row = value as Record<string, unknown>;
  if (
    typeof row.namespace !== "string" ||
    typeof row.document_key !== "string" ||
    typeof row.payload_json !== "string" ||
    typeof row.revision !== "number" ||
    typeof row.updated_at !== "string"
  ) {
    throw new Error("SQLite returned an invalid structured document row.");
  }
  return {
    namespace: row.namespace,
    key: row.document_key,
    value: JSON.parse(row.payload_json) as T,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function readPragmaNumber(database: SqliteDatabaseLike, pragma: string): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  const value = firstRowValue(row);
  if (typeof value !== "number") throw new Error(`SQLite PRAGMA ${pragma} did not return a number.`);
  return value;
}

function readPragmaText(database: SqliteDatabaseLike, pragma: string): string {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  const value = firstRowValue(row);
  if (typeof value !== "string") throw new Error(`SQLite PRAGMA ${pragma} did not return text.`);
  return value;
}

function firstRowValue(row: unknown): unknown {
  if (!row || typeof row !== "object") return undefined;
  return Object.values(row as Record<string, unknown>)[0];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}
