import path from "node:path";

export const DEFAULT_LOCAL_SQLITE_DATABASE_FILE_NAME =
  "ai-system-builder.sqlite3";
export const DEFAULT_LOCAL_SQLITE_BUSY_TIMEOUT_MS = 5_000;

export interface LocalSqliteDatabasePolicy {
  adapter: "sqlite";
  persistenceRootDirectory: string;
  databaseFilePath: string;
  connection: {
    journalMode: "wal";
    synchronous: "full";
    foreignKeys: true;
    busyTimeoutMs: number;
  };
  backupStrategy: "online-backup-api";
}

export interface ResolveLocalSqliteDatabasePolicyOptions {
  dataRootDirectory: string;
  databaseFileName?: string;
  busyTimeoutMs?: number;
}

function validateDataRootDirectory(dataRootDirectory: string): string {
  const normalizedRoot = dataRootDirectory.trim();
  if (normalizedRoot.length === 0) {
    throw new Error("Local SQLite data root directory must not be empty.");
  }

  return path.resolve(normalizedRoot);
}

function validateDatabaseFileName(databaseFileName: string): string {
  const normalizedFileName = databaseFileName.trim();
  const isBareFileName = path.basename(normalizedFileName) === normalizedFileName;
  const isSqliteFile = /^[a-z0-9][a-z0-9._-]*\.sqlite3$/i.test(
    normalizedFileName,
  );

  if (!isBareFileName || !isSqliteFile) {
    throw new Error(
      `Local SQLite database file name must be a bare .sqlite3 file name. Received "${databaseFileName}".`,
    );
  }

  return normalizedFileName;
}

function validateBusyTimeoutMs(busyTimeoutMs: number): number {
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
    throw new Error(
      `Local SQLite busy timeout must be a positive integer in milliseconds. Received "${busyTimeoutMs}".`,
    );
  }

  return busyTimeoutMs;
}

export function resolveLocalSqliteDatabasePolicy(
  options: ResolveLocalSqliteDatabasePolicyOptions,
): LocalSqliteDatabasePolicy {
  const dataRootDirectory = validateDataRootDirectory(options.dataRootDirectory);
  const databaseFileName = validateDatabaseFileName(
    options.databaseFileName ?? DEFAULT_LOCAL_SQLITE_DATABASE_FILE_NAME,
  );
  const busyTimeoutMs = validateBusyTimeoutMs(
    options.busyTimeoutMs ?? DEFAULT_LOCAL_SQLITE_BUSY_TIMEOUT_MS,
  );
  const persistenceRootDirectory = path.join(dataRootDirectory, "persistence");

  return {
    adapter: "sqlite",
    persistenceRootDirectory,
    databaseFilePath: path.join(persistenceRootDirectory, databaseFileName),
    connection: {
      journalMode: "wal",
      synchronous: "full",
      foreignKeys: true,
      busyTimeoutMs,
    },
    backupStrategy: "online-backup-api",
  };
}
