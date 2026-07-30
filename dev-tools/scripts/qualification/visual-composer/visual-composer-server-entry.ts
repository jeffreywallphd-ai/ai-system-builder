import path from "node:path";

import { createInMemoryStructuredDocumentStore } from "../../../../modules/adapters/persistence/shared";
import {
  createServer,
  createServerListener,
  type ServerListener,
} from "../../../../apps/server/src/createServer";
import { createVisualComposerQualificationRuntimeDatabase } from "./visual-composer-runtime-database";

let listener: ServerListener | undefined;
let closePersistence: (() => Promise<void>) | undefined;
let shutdown: Promise<void> | undefined;

async function start(): Promise<void> {
  const runtimeRoot = process.env.SERVER_RUNTIME_ROOT?.trim();
  if (!runtimeRoot) {
    throw new Error("SERVER_RUNTIME_ROOT is required for qualification.");
  }
  const normalizedRuntimeRoot = path.resolve(runtimeRoot).replaceAll("\\", "/");
  if (
    !normalizedRuntimeRoot.includes(
      "/artifacts/qualification/visual-composer/d/",
    )
  ) {
    throw new Error(
      "Qualification runtime data must remain inside its isolated data root.",
    );
  }
  const created = await createServer({
    env: process.env,
    structuredDocuments: createInMemoryStructuredDocumentStore(),
    runtimeDatabases: createVisualComposerQualificationRuntimeDatabase(),
  });
  listener = createServerListener(created);
  closePersistence = created.closePersistence;
  listener.listen(created.config.port);
}

async function close(): Promise<void> {
  const activeListener = listener;
  listener = undefined;
  if (activeListener) {
    await new Promise<void>((resolve, reject) => {
      activeListener.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await closePersistence?.();
  closePersistence = undefined;
}

function beginShutdown(): void {
  shutdown ??= close();
  void shutdown;
}

process.once("SIGINT", beginShutdown);
process.once("SIGTERM", beginShutdown);

void start();
