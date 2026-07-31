import { describe, expect, it } from "../../../../testing/node-test";
import { createSecurityApplicationError } from "../../../../contracts/security";
import { registerSecurityRoutes } from "./registerSecurityRoutes";

type Handler = (req: any, res: any) => Promise<void> | void;
function makeApp() { const routes = new Map<string, Handler>(); return { routes, get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); }, post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); } } as any; }
function makeRes() { const out: any = { statusCode: 200, body: undefined, contentType: undefined }; out.status = (code: number) => { out.statusCode = code; return out; }; out.json = (body: unknown) => { out.body = body; return out; }; out.type = (contentType: string) => { out.contentType = contentType; return out; }; out.send = (body: unknown) => { out.body = body; return out; }; return out; }

describe("registerSecurityRoutes", () => {
  it("maps pairing security errors", async () => {
    const app = makeApp();
    registerSecurityRoutes(app, { getStatus: async () => ({}), completePairing: async () => { throw createSecurityApplicationError("security.pairing-code-invalid", "Invalid pairing code."); }, revokeToken: async () => ({}) });
    const res = makeRes();
    await app.routes.get("POST /api/security/pairing/complete")({ body: { pairingCode: "ABC" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("dev mode endpoints are 404 when toggle disabled", async () => {
    const app = makeApp();
    registerSecurityRoutes(app, { getStatus: async () => ({}), completePairing: async () => ({}), revokeToken: async () => ({}) });
    let res = makeRes();
    await app.routes.get("GET /api/security/dev-mode")({}, res);
    expect(res.statusCode).toBe(404);
    res = makeRes();
    await app.routes.get("POST /api/security/dev-mode")({ body: { mode: "disabled-dev" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("dev mode endpoints validate and update mode when enabled", async () => {
    const app = makeApp();
    let mode: "disabled-dev" | "lan-token-enforced" = "disabled-dev";
    registerSecurityRoutes(app, { getStatus: async () => ({}), completePairing: async () => ({}), revokeToken: async () => ({}), getDevMode: () => mode, setDevMode: (m) => { mode = m; } });
    let res = makeRes();
    await app.routes.get("GET /api/security/dev-mode")({}, res);
    expect(res.statusCode).toBe(200);
    res = makeRes();
    await app.routes.get("POST /api/security/dev-mode")({ body: { mode: "invalid" } }, res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await app.routes.get("POST /api/security/dev-mode")({ body: { mode: "lan-token-enforced" } }, res);
    expect(mode).toBe("lan-token-enforced");
  });
});


it("serves local CA PEM only when provider exists", async () => {
  const app = makeApp();
  registerSecurityRoutes(app, { getStatus: async () => ({}), completePairing: async () => ({}), revokeToken: async () => ({}), getLocalCaPem: async () => "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----" });
  const res = makeRes();
  await app.routes.get("GET /api/security/tls/local-ca.pem")({}, res);
  expect(res.statusCode).toBe(200);
});
