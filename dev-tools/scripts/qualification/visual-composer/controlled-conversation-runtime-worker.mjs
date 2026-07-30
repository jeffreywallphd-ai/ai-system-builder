import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_TASKS = 64;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function createControlledConversationRuntimeWorker(options) {
  const host = options.host ?? LOOPBACK_HOST;
  const port = Number(options.port);
  const token = String(options.token ?? "").trim();
  if (host !== LOOPBACK_HOST) {
    throw new Error(
      "Controlled runtime qualification must remain on loopback.",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Controlled runtime qualification port is invalid.");
  }
  if (token.length < 32) {
    throw new Error(
      "Controlled runtime qualification authentication is unavailable.",
    );
  }

  const tasks = new Map();
  const server = createServer(async (request, response) => {
    try {
      if (!isAuthorized(request.headers.authorization, token)) {
        return sendJson(response, 401, {
          error: {
            code: "runtime.unauthorized",
            message: "Runtime authentication is required.",
          },
        });
      }
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          healthy: true,
          status: {
            runtimeId: "python-sidecar",
            status: "ready",
            version: "qualification-1",
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/capabilities") {
        return sendJson(response, 200, {
          runtimeId: "python-sidecar",
          capabilities: [
            "prepare-training-dataset",
            "dataset-preparation.auto-inference-mode",
            "conversation-text-generation",
            "model-status",
            "unload-model",
          ],
        });
      }
      if (request.method === "GET" && url.pathname === "/models/status") {
        return sendJson(response, 200, {
          loadedModels: [],
          activeTaskCount: 0,
        });
      }
      if (request.method === "POST" && url.pathname === "/models/unload") {
        return sendJson(response, 200, {
          unloadedModels: [],
          activeTaskCount: 0,
        });
      }
      if (request.method === "POST" && url.pathname === "/tasks/start") {
        const body = await readJsonBody(request);
        const task = createCompletedTask(body);
        if (tasks.size >= MAX_TASKS) tasks.delete(tasks.keys().next().value);
        tasks.set(task.requestId, task);
        return sendJson(response, 200, {
          requestId: task.requestId,
          taskType: task.taskType,
          accepted: true,
          status: "queued",
          startedAt: task.startedAt,
          updatedAt: task.updatedAt,
        });
      }
      const taskMatch = /^\/tasks\/([A-Za-z0-9._:-]{1,128})$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && taskMatch) {
        const task = tasks.get(taskMatch[1]);
        if (!task) {
          return sendJson(response, 404, {
            error: {
              code: "runtime.task-not-found",
              message: "The runtime task is unavailable.",
            },
          });
        }
        return sendJson(response, 200, task);
      }
      return sendJson(response, 404, {
        error: {
          code: "runtime.endpoint-not-found",
          message: "The runtime endpoint is unavailable.",
        },
      });
    } catch (error) {
      const status = error?.code === "request-too-large" ? 413 : 400;
      return sendJson(response, status, {
        error: {
          code:
            status === 413
              ? "runtime.request-too-large"
              : "runtime.invalid-request",
          message:
            status === 413
              ? "The runtime request is too large."
              : "The runtime request is invalid.",
        },
      });
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Controlled runtime qualification failed to bind.");
      }
      return { host, port: address.port };
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function createCompletedTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid task");
  }
  const requestId = String(value.requestId ?? "").trim();
  if (!SAFE_REQUEST_ID.test(requestId)) throw new Error("invalid request id");
  if (value.taskType !== "conversation-text-generation") {
    throw new Error("unsupported task");
  }
  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid payload");
  }
  if (
    typeof payload.selectedModelId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(
      payload.selectedModelId,
    )
  ) {
    throw new Error("invalid model");
  }
  if (
    !Array.isArray(payload.messages) ||
    payload.messages.length < 1 ||
    payload.messages.length > 64
  ) {
    throw new Error("invalid messages");
  }
  const last = payload.messages[payload.messages.length - 1];
  if (
    !last ||
    typeof last !== "object" ||
    last.role !== "user" ||
    typeof last.content !== "string" ||
    last.content.trim().length < 1 ||
    last.content.length > 8_000
  ) {
    throw new Error("invalid user message");
  }
  const now = new Date().toISOString();
  return {
    requestId,
    taskType: value.taskType,
    status: "succeeded",
    data: {
      assistantResponseText: `Controlled response to: ${last.content.trim()}`,
    },
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      const error = new Error("request too large");
      error.code = "request-too-large";
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isAuthorized(header, token) {
  const presented =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
  const expectedBytes = Buffer.from(token);
  const presentedBytes = Buffer.from(presented);
  return (
    expectedBytes.length === presentedBytes.length &&
    timingSafeEqual(expectedBytes, presentedBytes)
  );
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function runFromEnvironment() {
  const worker = createControlledConversationRuntimeWorker({
    host: process.env.PYTHON_RUNTIME_HOST,
    port: process.env.PYTHON_RUNTIME_PORT,
    token: process.env.PYTHON_RUNTIME_AUTH_TOKEN,
  });
  await worker.start();
  const stop = async () => {
    await worker.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runFromEnvironment().catch(() => {
    process.stderr.write("Controlled runtime qualification failed to start.\n");
    process.exitCode = 1;
  });
}
