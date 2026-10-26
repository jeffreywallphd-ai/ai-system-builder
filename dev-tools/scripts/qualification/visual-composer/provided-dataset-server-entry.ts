import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, createServerListener } from "../../../../apps/server/src/createServer";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite";
import { createOrganizationId } from "../../../../modules/contracts/organization";
import { createVisualComposerQualificationRuntimeDatabase } from "./visual-composer-runtime-database";
import { createProvidedDatasetServerLifecycle, requireProvidedDatasetRoot } from "./provided-dataset-server-lifecycle";

let sequence = 0;
const lifecycle = createProvidedDatasetServerLifecycle(async restartServer => {
  const runtimeRoot = process.env.SERVER_RUNTIME_ROOT ?? "";
  if (process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "dataset-profile" ||
      process.env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID !== "qualification.local") throw new Error("Fixed qualification composition is required.");
  await requireProvidedDatasetRoot(path.resolve(process.cwd()), runtimeRoot);
  if (++sequence > 2) throw new Error("The fixed restart count was exceeded.");
  const sourceRevision = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if (!/^source\.[a-f0-9]{64}$/.test(sourceRevision ?? "")) throw new Error("Current qualification source identity is required.");
  const cache = path.join(runtimeRoot, `provided-server-cache-${sequence}`);
  await mkdir(cache, { recursive: false });
  const env = { ...process.env, HF_HUB_CACHE: cache };
  const database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: runtimeRoot }) });
  let created: Awaited<ReturnType<typeof createServer>> | undefined;
  let listener: ReturnType<typeof createServerListener> | undefined;
  try {
    created = await createServer({ env, restartServer,
      structuredDocuments: database.documents.forOrganization(createOrganizationId("qualification.local")),
      runtimeDatabases: createVisualComposerQualificationRuntimeDatabase(),
      // No controlled Node preparation override: production Python dependencies.
    });
    listener = createServerListener(created);
    const activeListener = listener;
    await new Promise<void>((resolve, reject) => {
      activeListener.once("error", reject);
      activeListener.listen(created!.config.port, () => { activeListener.off("error", reject); resolve(); });
    });
    // The lifecycle invokes this second factory only after complete resource
    // shutdown. Exclusive records cannot be borrowed from an earlier run.
    await writeFile(path.join(runtimeRoot, `provided-server-session-${sequence}.json`), JSON.stringify({
      schemaVersion: "provided-server-session-v1", sequence, sourceRevision,
      previousResourcesClosed: sequence === 2,
    }), { flag: "wx" });
    const owner = created;
    return { listener, shutdownBackgroundTasks: () => owner.shutdownBackgroundTasks(),
      closePersistence: async () => { await owner.closePersistence(); database.close(); } };
  } catch {
    // If task retirement is uncertain, keep the connection owned and fail closed.
    if (created) {
      const { shutdownServerResources } = await import("../../../../apps/server/src/shutdownServerResources");
      await shutdownServerResources({ listener: listener?.listening ? listener : undefined,
        shutdownBackgroundTasks: created.shutdownBackgroundTasks, closePersistence: created.closePersistence });
    }
    database.close();
    throw new Error("Qualification server startup failed.");
  }
});
function stop() { void lifecycle.stop().catch(() => { process.exitCode = 1; }); }
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
void lifecycle.start().catch(() => { process.exitCode = 1; });
