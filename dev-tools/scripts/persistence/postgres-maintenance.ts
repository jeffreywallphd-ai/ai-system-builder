#!/usr/bin/env node

import { exportStructuredData, writeStructuredDataExport } from "../../../modules/adapters/persistence/migration";
import { openPostgresDatabase, resolvePostgresPoolConfig } from "../../../modules/adapters/persistence/postgres";

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation !== "health" && operation !== "export") {
    throw new Error("Usage: persistence:postgres <health|export> [--destination <ndjson-file>].");
  }
  const database = await openPostgresDatabase({ config: resolvePostgresPoolConfig(process.env) });
  try {
    if (operation === "health") {
      const health = await database.checkHealth();
      process.stdout.write(`${JSON.stringify({ operation: "health", ...health })}\n`);
      if (!health.healthy) process.exitCode = 2;
      return;
    }
    const destinationIndex = process.argv.indexOf("--destination");
    const destination = destinationIndex >= 0 ? process.argv[destinationIndex + 1] : undefined;
    if (!destination) throw new Error("export requires --destination <ndjson-file>.");
    const exported = await exportStructuredData(database.documents);
    const result = await writeStructuredDataExport(destination, exported);
    process.stdout.write(`${JSON.stringify({ operation: "export", status: "completed", ...result })}\n`);
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown PostgreSQL maintenance failure.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
