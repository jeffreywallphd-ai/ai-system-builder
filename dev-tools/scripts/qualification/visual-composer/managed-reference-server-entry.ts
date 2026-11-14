import express from "express";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
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
    async createHost(database:Awaited<ReturnType<typeof openPostgresDatabase>>,preparer:ReturnType<typeof createControlledRuntimeEnvironmentPreparer>) {
      const serveBrowser = process.env.MANAGED_REFERENCE_SERVE_BUILT_BROWSER === "1";
      const directory = path.resolve("apps/thin-client/dist");
      if (serveBrowser) {
        const index = path.join(directory, "index.html");
        if (process.env.NODE_ENV !== "test" || !/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(process.env.AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_ORIGIN ?? "") ||
            await realpath(directory) !== directory || await realpath(index) !== index || !(await lstat(index)).isFile())
          throw new Error("The managed browser test requires its exact built thin client and local test origin.");
      }
      const host = await createServer({env:process.env,postgresDatabase:database,pythonRuntimeEnvironmentPreparer:preparer});
      if (serveBrowser) {
        host.app.use("/assets", express.static(path.join(directory, "assets"), {dotfiles:"deny", index:false, redirect:false}));
        host.app.get(["/", "/systems"], (_request, response) => response.sendFile("index.html", {root: directory}));
      }
      return host;
    },
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
