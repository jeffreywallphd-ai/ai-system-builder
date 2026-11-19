import { createServer } from "node:net";
import {
  resolvePythonRuntimeLoopbackEndpoint,
  type PythonRuntimeLoopbackEndpoint,
} from "../config/pythonRuntimeEndpoint";

const SELECTION_TIMEOUT_MS = 5_000;
const SELECTION_FAILURE = "Python runtime loopback port selection failed.";

/** Availability selection, not a reservation across the worker handoff. */
async function selectAvailablePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const server = createServer(socket => socket.destroy());
    server.maxConnections = 1;
    let closing = false;
    let failed = false;
    let selected: string | undefined;
    const timer = setTimeout(() => {
      close(true);
      // Never publish an endpoint after an unconfirmed retirement. Keep the
      // socket callbacks alive to observe cleanup even if close is delayed.
      reject(new Error(SELECTION_FAILURE));
    }, SELECTION_TIMEOUT_MS);
    const close = (failure: boolean) => {
      failed ||= failure;
      if (closing) return;
      closing = true;
      server.close(() => {
        clearTimeout(timer);
        if (failed || !selected || server.listening) reject(new Error(SELECTION_FAILURE));
        else resolve(selected);
      });
      // Register retirement observation before abort can initiate a close itself.
      controller.abort();
    };
    // Keep this handler until retirement: a late socket error must not escape.
    server.on("error", () => close(true));
    try {
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true, signal: controller.signal }, () => {
        const address = server.address();
        if (!closing && address && typeof address === "object"
          && address.address === "127.0.0.1" && Number.isInteger(address.port)
          && address.port >= 1024 && address.port <= 65_535) {
          selected = String(address.port);
        }
        close(!selected);
      });
    } catch {
      close(true);
    }
  });
}

/** Called only by an explicit lazy host activation, never a passive read. */
export async function selectPythonRuntimeLoopbackEndpoint(
  input: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<Readonly<PythonRuntimeLoopbackEndpoint>> {
  // Snapshot before awaiting: concurrent environment edits cannot split client/bind.
  const env = { ...(input.env ?? process.env) };
  const configured = resolvePythonRuntimeLoopbackEndpoint({ env, defaultPort: "43111" });
  if (env.PYTHON_RUNTIME_BASE_URL?.trim() || env.PYTHON_RUNTIME_PORT?.trim()) {
    return Object.freeze(configured);
  }
  const port = await selectAvailablePort();
  return Object.freeze(resolvePythonRuntimeLoopbackEndpoint({ env, defaultPort: port }));
}
