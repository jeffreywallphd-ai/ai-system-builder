import { createServer, createServerListener } from "../../../../apps/server/src/createServer";
import { openPostgresDatabase, resolvePostgresPoolConfig } from "../../../../modules/adapters/persistence/postgres";
import { createControlledRuntimeEnvironmentPreparer } from "./controlled-runtime-preparation.mjs";
import { openManagedReferenceListener } from "./managed-reference-lifecycle.mjs";

// Separate measured composition: real PostgreSQL, RLS, OIDC and verified TLS.
// No in-memory persistence or identity-verifier substitutions are admitted.
async function main() {
  const owned = await openManagedReferenceListener({
    openDatabase:()=>openPostgresDatabase({config: resolvePostgresPoolConfig(process.env), migrate:false}),
    prepareEnvironment:()=>createControlledRuntimeEnvironmentPreparer({repoRoot:process.cwd(),runRoot:process.env.SERVER_RUNTIME_ROOT!,environment:process.env}),
    createHost:(database:Awaited<ReturnType<typeof openPostgresDatabase>>,preparer:ReturnType<typeof createControlledRuntimeEnvironmentPreparer>)=>createServer({env:process.env,postgresDatabase:database,pythonRuntimeEnvironmentPreparer:preparer}),
    createListener:createServerListener,
  });
  process.send?.({type: "ready"});
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    await owned.close();
    process.send?.({type: "closed"}, () => process.disconnect?.());
  }
  process.on("message", message => {if ((message as {type?: string})?.type === "shutdown") void close();});
  process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
}
void main().catch(() => {process.send?.({type: "failed"}); process.exitCode = 1; process.disconnect?.();});
