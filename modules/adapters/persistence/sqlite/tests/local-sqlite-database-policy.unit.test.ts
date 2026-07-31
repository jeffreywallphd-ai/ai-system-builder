import path from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

import {
  DEFAULT_LOCAL_SQLITE_BUSY_TIMEOUT_MS,
  DEFAULT_LOCAL_SQLITE_DATABASE_FILE_NAME,
  resolveLocalSqliteDatabasePolicy,
} from "..";

describe("local SQLite database policy", () => {
  it("resolves the local database below a dedicated persistence root", () => {
    const dataRootDirectory = path.resolve("tmp", "desktop-app-data");

    expect(resolveLocalSqliteDatabasePolicy({ dataRootDirectory })).toEqual({
      adapter: "sqlite",
      persistenceRootDirectory: path.join(dataRootDirectory, "persistence"),
      databaseFilePath: path.join(
        dataRootDirectory,
        "persistence",
        DEFAULT_LOCAL_SQLITE_DATABASE_FILE_NAME,
      ),
      connection: {
        journalMode: "wal",
        synchronous: "full",
        foreignKeys: true,
        busyTimeoutMs: DEFAULT_LOCAL_SQLITE_BUSY_TIMEOUT_MS,
      },
      backupStrategy: "online-backup-api",
    });
  });

  it("supports validated file-name and timeout overrides", () => {
    const policy = resolveLocalSqliteDatabasePolicy({
      dataRootDirectory: path.resolve("tmp", "desktop-app-data"),
      databaseFileName: "test-data.sqlite3",
      busyTimeoutMs: 1_250,
    });

    expect(path.basename(policy.databaseFilePath)).toBe("test-data.sqlite3");
    expect(policy.connection.busyTimeoutMs).toBe(1_250);
  });

  it("rejects paths masquerading as database file names", () => {
    expect(() =>
      resolveLocalSqliteDatabasePolicy({
        dataRootDirectory: path.resolve("tmp", "desktop-app-data"),
        databaseFileName: "../outside.sqlite3",
      }),
    ).toThrow(
      'Local SQLite database file name must be a bare .sqlite3 file name. Received "../outside.sqlite3".',
    );
  });

  it("rejects invalid roots and busy timeouts", () => {
    expect(() =>
      resolveLocalSqliteDatabasePolicy({ dataRootDirectory: " " }),
    ).toThrow("Local SQLite data root directory must not be empty.");

    expect(() =>
      resolveLocalSqliteDatabasePolicy({
        dataRootDirectory: path.resolve("tmp", "desktop-app-data"),
        busyTimeoutMs: 0,
      }),
    ).toThrow(
      'Local SQLite busy timeout must be a positive integer in milliseconds. Received "0".',
    );
  });
});
