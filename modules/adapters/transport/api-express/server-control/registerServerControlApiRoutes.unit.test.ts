import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerServerControlApiRoutes } from "./registerServerControlApiRoutes";

interface ResponseDouble {
  statusCode?: number;
  body?: unknown;
  status: (code: number) => ResponseDouble;
  json: (body: unknown) => void;
}

type Handler = (request: { headers?: Record<string, string> }, response: ResponseDouble) => Promise<void>;

function createApp() {
  const routes = new Map<string, Handler>();
  return {
    routes,
    post(path: string, handler: Handler) {
      routes.set(`POST ${path}`, handler);
    },
  };
}

function createResponse() {
  return {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
}

describe("registerServerControlApiRoutes", () => {
  it("returns accepted before scheduling host-owned restart", async () => {
    const app = createApp();
    const restartServer = testDouble.fn();
    registerServerControlApiRoutes({ app, restartServer });

    const response = createResponse();
    await app.routes.get("POST /api/server/restart")?.({ headers: { "x-request-id": "req-1" } }, response);

    expect(response.statusCode).toBe(202);
    expect(response.body).toMatchObject({
      ok: true,
      operation: "server.restart",
      requestId: "req-1",
      value: { restartRequested: true },
    });
  });

  it("reports unavailable when the host did not provide restart wiring", async () => {
    const app = createApp();
    registerServerControlApiRoutes({ app });

    const response = createResponse();
    await app.routes.get("POST /api/server/restart")?.({}, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      operation: "server.restart",
      error: { code: "unavailable" },
    });
  });
});
