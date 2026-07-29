import path from "node:path";

import {
  openLocalSqliteDatabase,
  resolveLocalSqliteDatabasePolicy,
} from "../../../../modules/adapters/persistence/sqlite";
import {
  initializeLocalIdentityProfile,
  readLocalIdentityProfile,
} from "../../../../modules/adapters/security/local-identity";

async function main(): Promise<void> {
  const dataRoot = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT?.trim();
  if (!dataRoot) {
    throw new Error("VISUAL_COMPOSER_DESKTOP_DATA_ROOT is required.");
  }
  const normalized = path.resolve(dataRoot).replaceAll("\\", "/");
  if (!normalized.includes("/artifacts/qualification/visual-composer/d/")) {
    throw new Error(
      "Desktop qualification identity must remain inside the isolated run root.",
    );
  }

  const database = await openLocalSqliteDatabase({
    policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: dataRoot }),
  });
  try {
    const existing = await readLocalIdentityProfile(database.documents);
    if (!existing) {
      await initializeLocalIdentityProfile({
        documents: database.documents,
        organizationDisplayName: "Qualification Organization",
        principalDisplayName: "Qualification Owner",
      });
    }
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown seed failure.";
  process.stderr.write(
    `Unable to seed desktop qualification identity: ${message}\n`,
  );
  process.exitCode = 1;
});
