import path from "node:path";
import { createLocalModelRegistryAdapter } from "../../../../modules/adapters/persistence/model";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite";
import { createLocalWorkspaceRepository } from "../../../../modules/adapters/persistence/workspace";
import { readLocalIdentityProfile } from "../../../../modules/adapters/security/local-identity";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { CONTEXT_FIXTURE_MODEL, CONTEXT_FIXTURE_MODEL_RECORD, verifyContextFixtureModel } from "./headless-context-fixture";

async function seed() {
  if (process.env.ELECTRON_RUN_AS_NODE !== "1" || process.argv.length !== 2) throw new Error("Invalid fixture entry.");
  const root = process.cwd(), profile = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT;
  const localPath = process.env.AISB_QUALIFICATION_CONTEXT_MODEL;
  if (!profile || !localPath || !process.env.AISB_QUALIFICATION_WORKSPACE) throw new Error("Missing fixture input.");
  const {bytes} = await verifyContextFixtureModel(root, profile, localPath);
  const workspaceId = createWorkspaceId(process.env.AISB_QUALIFICATION_WORKSPACE);
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: profile})});
  try {
    const identity = await readLocalIdentityProfile(db.documents);
    if (!identity) throw new Error("Missing fixture identity.");
    const documents = db.documents.forOrganization(identity.organizationId);
    const workspace = await createLocalWorkspaceRepository({rootDirectory: profile, documents}).readWorkspace(workspaceId);
    if (workspace?.organizationId !== identity.organizationId || workspace.status !== "active") throw new Error("Invalid fixture workspace.");
    const registry = createLocalModelRegistryAdapter({filePath: path.join(profile, "model-registry/models.json"),
      rootDirectory: profile, documents, discovery: {enabled: false}});
    if (await registry.getModelRecord(workspaceId, CONTEXT_FIXTURE_MODEL_RECORD)) throw new Error("Fixture model already exists.");
    // Only pre-existing installed input metadata. No task, result, policy or approval is seeded.
    await registry.registerDownloadedModel({workspaceId, modelRecordId: CONTEXT_FIXTURE_MODEL_RECORD,
      displayName: "Qualification MiniLM", source: "local", provider: "huggingface", artifactForm: "full-model",
      modelId: CONTEXT_FIXTURE_MODEL, localPath, serializationFormat: "safetensors", sizeBytes: bytes, taskTags: ["embeddings"]});
  } finally { await db.close(); }
}
void seed().catch(() => { process.stderr.write("The isolated Context model fixture could not be initialized.\n"); process.exitCode = 1; });
