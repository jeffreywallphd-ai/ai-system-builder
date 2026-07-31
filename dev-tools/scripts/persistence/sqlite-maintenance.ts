#!/usr/bin/env node

import path from "node:path";
import { access } from "node:fs/promises";

import {
  openLocalSqliteDatabase,
  resolveLocalSqliteDatabasePolicy,
  restoreLocalSqliteDatabase,
} from "../../../modules/adapters/persistence/sqlite";
import { exportStructuredData, writeStructuredDataExport } from "../../../modules/adapters/persistence/migration";
import { assignLegacyStructuredDataToOrganization, inventoryLegacyStructuredData } from "../../../modules/adapters/persistence/migration";
import { createOrganizationId } from "../../../modules/contracts/organization";

type Operation = "health" | "backup" | "restore" | "export" | "legacy-inventory" | "legacy-assign";

interface Arguments {
  operation: Operation;
  dataRoot: string;
  destination?: string;
  backup?: string;
  confirmReplace: boolean;
  organizationId?: string;
  namespaces?: readonly string[];
  fingerprint?: string;
  rollback?: string;
  confirmAssignment?: string;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: args.dataRoot });

  if (args.operation === "restore") {
    if (!args.backup) throw new Error("restore requires --backup <sqlite-file>.");
    if (!args.confirmReplace) throw new Error("restore requires --confirm-replace after the desktop application is stopped.");
    const result = await restoreLocalSqliteDatabase({
      backupPath: path.resolve(args.backup),
      databasePath: policy.databaseFilePath,
    });
    process.stdout.write(`${JSON.stringify({ operation: "restore", status: "completed", ...result })}\n`);
    return;
  }

  await access(policy.databaseFilePath);
  const database = await openLocalSqliteDatabase({ policy });
  try {
    if (args.operation === "health") {
      const health = database.checkHealth();
      process.stdout.write(`${JSON.stringify({ operation: "health", ...health })}\n`);
      if (!health.healthy) process.exitCode = 2;
      return;
    }
    if (args.operation === "export") {
      if (!args.destination) throw new Error("export requires --destination <ndjson-file>.");
      const exported = await exportStructuredData(database.documents);
      const result = await writeStructuredDataExport(args.destination, exported);
      process.stdout.write(`${JSON.stringify({ operation: "export", status: "completed", ...result })}\n`);
      return;
    }
    if (args.operation === "legacy-inventory") {
      if (!args.namespaces?.length) throw new Error("legacy-inventory requires --namespaces <comma-separated-list>.");
      const inventory = await inventoryLegacyStructuredData(database.documents, args.namespaces);
      process.stdout.write(`${JSON.stringify({ operation: "legacy-inventory", ...inventory })}\n`);
      return;
    }
    if (args.operation === "legacy-assign") {
      if (!args.organizationId) throw new Error("legacy-assign requires --organization-id <id>.");
      if (args.confirmAssignment !== args.organizationId) {
        throw new Error("legacy-assign requires --confirm-assignment to exactly match --organization-id.");
      }
      if (!args.namespaces?.length || !args.fingerprint || !args.rollback) {
        throw new Error("legacy-assign requires --namespaces, --fingerprint, and --rollback.");
      }
      const inventory = await assignLegacyStructuredDataToOrganization({
        documents: database.documents,
        organizationId: createOrganizationId(args.organizationId),
        namespaces: args.namespaces,
        expectedFingerprint: args.fingerprint,
        rollbackFilePath: args.rollback,
      });
      process.stdout.write(`${JSON.stringify({ operation: "legacy-assign", status: "completed", ...inventory })}\n`);
      return;
    }
    if (!args.destination) throw new Error("backup requires --destination <sqlite-file>.");
    const result = await database.createBackup(path.resolve(args.destination));
    process.stdout.write(`${JSON.stringify({ operation: "backup", status: "completed", ...result })}\n`);
  } finally {
    database.close();
  }
}

function parseArguments(values: string[]): Arguments {
  const operation = values[0];
  if (operation !== "health" && operation !== "backup" && operation !== "restore" && operation !== "export" && operation !== "legacy-inventory" && operation !== "legacy-assign") {
    throw new Error("Usage: persistence:sqlite <health|backup|restore|export|legacy-inventory|legacy-assign> --data-root <directory> [options].");
  }
  const options = new Map<string, string>();
  let confirmReplace = false;
  for (let index = 1; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--confirm-replace") {
      confirmReplace = true;
      continue;
    }
    if (!name?.startsWith("--")) throw new Error(`Unexpected SQLite maintenance argument: ${name ?? ""}.`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    options.set(name, value);
    index += 1;
  }
  const dataRoot = options.get("--data-root");
  if (!dataRoot) throw new Error("--data-root <directory> is required.");
  return {
    operation,
    dataRoot,
    destination: options.get("--destination"),
    backup: options.get("--backup"),
    confirmReplace,
    organizationId: options.get("--organization-id"),
    namespaces: options.get("--namespaces")?.split(",").map((value) => value.trim()).filter(Boolean),
    fingerprint: options.get("--fingerprint"),
    rollback: options.get("--rollback"),
    confirmAssignment: options.get("--confirm-assignment"),
  };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown SQLite maintenance failure.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
