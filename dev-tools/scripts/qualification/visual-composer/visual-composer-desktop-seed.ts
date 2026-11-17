import path from "node:path";
import { composeInternalAssetRegistry } from "../../../../modules/hosts/shared/composition/composeInternalAssetRegistry";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { seedReferenceBrowseFixture } from "./reference-browse-fixture";

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
    let existing = await readLocalIdentityProfile(database.documents);
    if (!existing) {
      await initializeLocalIdentityProfile({
        documents: database.documents,
        organizationDisplayName: "Qualification Organization",
        principalDisplayName: "Qualification Owner",
      });
      existing = await readLocalIdentityProfile(database.documents);
    }
    if(process.env.VISUAL_COMPOSER_LARGE_FIXTURE==="1") {
      if(!existing)throw new Error("Reference qualification identity is unavailable.");
      const documents=database.documents.forOrganization(existing.organizationId);
      const composition=composeInternalAssetRegistry({rootDirectory:dataRoot,documents});
      const result=await composition.workspaceUseCases.createWorkspace.execute({command:{displayName:"Desktop reference performance"},organizationId:existing.organizationId,generateWorkspaceId:()=>createWorkspaceId("workspace.reference.performance"),selectAfterCreate:true});
      if(result.status!=="created"||!result.workspace)throw new Error("Reference workspace setup failed.");
      await seedReferenceBrowseFixture({documents,definitionDocuments:documents,rootDirectory:dataRoot,workspaceId:result.workspace.workspaceId});
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
