import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import { composeServerHost } from "../../../../hosts/server/composition/composeServerHost";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createSecurityApplicationError, type AuthContext } from "../../../../contracts/security";
import { resolveApiRoutePolicy } from "../security/apiRouteSecurityPolicy";
import { createExpressSecurityMiddleware } from "../security/createExpressSecurityMiddleware";
import { createExpressOrganizationContextScope } from "../security/expressOrganizationContextScope";

const route = "/api/ingestion/tasks/execute";
test("only the exact POST ingestion endpoint admits existing artifact writers", () => {
  assert.deepEqual(resolveApiRoutePolicy("POST", route), { public: false, scopes: ["artifact:write"] });
  for (const [method, url] of [["GET", route], ["DELETE", route], ["PUT", route], ["POST", route + "/extra"],
    ["POST", route + "/"], ["POST", "/API/ingestion/tasks/execute"], ["POST", "/api/ingestion/tasks/%65xecute"]]) {
    assert.equal(resolveApiRoutePolicy(method!, url!).deny, true);
  }
});

test("real HTTP middleware and composed ingestion preserve writer, organization and task workspace authority", { timeout: 45_000 }, async () => {
  const parent = await realpath(tmpdir());
  const fixture = await realpath(await mkdtemp(path.join(parent, "ingestion-http-authority-")));
  const organizationId = createOrganizationId("organization-a");
  const workspaceId = createWorkspaceId("workspace-a");
  const otherWorkspaceId = createWorkspaceId("workspace-b");
  const documents = createInMemoryStructuredDocumentStore();
  const scoped = documents.forOrganization(organizationId);
  const scope = createExpressOrganizationContextScope();
  const writer = randomUUID(), reader = randomUUID();
  let providerCalls = 0, bodyParses = 0;
  const unexpectedProvider = async () => { providerCalls++; throw new Error("Unexpected provider request."); };
  const app = express();
  app.use(createExpressSecurityMiddleware({ mode: "lan-https-token", authRequired: true, httpsRequired: false,
    organizationContextScope: scope, tenantPlacement: { mode: "dedicated", organizationId },
    verifyToken: async ({ token }): Promise<AuthContext> => {
      if (token !== writer && token !== reader) throw createSecurityApplicationError("security.invalid-token", "Invalid token.");
      return { authenticated: true, authMethod: "bearer-token", principal: {
        principalId: "principal-a", kind: "device", roles: [], scopes: token === writer ? ["artifact:read", "artifact:write"] : ["artifact:read"],
      } };
    },
  }));
  app.use(express.json({ limit: "5mb", verify() { bodyParses++; } }));
  const storageRoot = path.join(fixture, "storage");
  const host = composeServerHost({ env: { NODE_ENV: "test" },
    persistence: { documents, organizationDocuments: scoped }, organizationContextProvider: scope,
    settings: { localSettingsFilePath: path.join(fixture, "settings.json") },
    artifactRepo: { providerCredentialRootDirectory: path.join(fixture, "credentials"),
      huggingFaceTokenConfigFilePath: path.join(fixture, "no-legacy-token.json"), huggingFaceFetchImplementation: unexpectedProvider,
      huggingFaceHubClient: { fileExists: unexpectedProvider, uploadFile: unexpectedProvider, downloadFile: unexpectedProvider },
    }, logSink() {},
  });
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    host.registerApi({ app: app as never, storageRootDirectory: storageRoot, runtimeRootDirectory: path.join(fixture, "runtime") });
    await host.waitForAssetFoundation();
    const registry = host.getInternalAssetRegistry(); assert.ok(registry);
    const now = new Date().toISOString();
    for (const id of [workspaceId, otherWorkspaceId]) await registry.workspaceRepositories.workspaceRepository.saveWorkspace({
      workspaceId: id, organizationId, displayName: id, status: "active", createdAt: now, updatedAt: now,
    });
    await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", resolve); server.once("error", reject); });
    const address = server!.address(); assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    async function send(body: unknown, options: { token?: string | null; method?: string; url?: string; organization?: string; raw?: boolean } = {}) {
      const token = options.token === undefined ? writer : options.token;
      const response = await fetch(origin + (options.url ?? route), { method: options.method ?? "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(options.organization ? { "x-organization-id": options.organization } : {}) },
        body: options.method === "GET" ? undefined : options.raw ? String(body) : JSON.stringify(body),
        signal: AbortSignal.timeout(8_000), redirect: "error",
      });
      const bytes = await response.text(); assert.ok(Buffer.byteLength(bytes) <= 16_384);
      assert.doesNotMatch(bytes, /ingestion-http-authority|[A-Z]:\\/);
      return { status: response.status, body: JSON.parse(bytes) };
    }
    const create = { workspaceId, command: { action: "create-files", files: [{ fileName: "energy.csv", mediaType: "text/csv", sizeBytes: 4 }] } };
    for (const [token, expected] of [[null, 401], ["invalid-synthetic", 401], [reader, 403]] as const) {
      assert.equal((await send("{invalid-json", { token, raw: true })).status, expected);
    }
    assert.equal((await send(create, { organization: "organization-b" })).status, 403);
    assert.equal((await send(create, { method: "DELETE" })).status, 403);
    assert.equal((await send(create, { url: route + "/extra" })).status, 403);
    assert.equal(bodyParses, 0); // Denial precedes payload parsing and acquisition.
    const malformed = await send({ ...create, command: { action: "unknown-action" } });
    assert.equal(malformed.status, 400);
    const created = await send(create); assert.equal(created.status, 200); assert.equal(created.body.ok, true);
    const task = created.body.value.task; const file = task.files[0];
    const bytes = Buffer.from("a,b\n");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const append = { action: "append-chunk", taskId: task.taskId, fileId: file.fileId,
      chunkIndex: 0, expectedOffset: 0, bytes: Array.from(bytes), sha256: digest };
    const foreign = await send({ workspaceId: otherWorkspaceId, command: append });
    assert.equal(foreign.status, 404); assert.equal(foreign.body.ok, false);
    assert.equal((await send({ workspaceId, command: append }, { token: reader })).status, 403);
    assert.equal((await send({ workspaceId, command: append })).body.ok, true);
    const finalized = await send({ workspaceId, command: { action: "finalize-file", taskId: task.taskId, fileId: file.fileId, sha256: digest } });
    assert.equal(finalized.status, 200); assert.equal(finalized.body.ok, true);
    assert.equal(finalized.body.value.task.status, "succeeded");
    const output = finalized.body.value.task.files[0].output;
    assert.deepEqual(await readFile(path.join(storageRoot, "organizations", organizationId, output.key)), bytes);
    assert.equal((await send({ workspaceId: otherWorkspaceId, command: { action: "read", taskId: task.taskId } })).status, 404);
    assert.equal((await send({ workspaceId, command: { action: "read", taskId: task.taskId } }, { token: reader })).status, 403);
    const reread = await send({ workspaceId, command: { action: "read", taskId: task.taskId } });
    assert.equal(reread.body.ok, true); assert.equal(reread.body.value.task.status, "succeeded");
    assert.equal(providerCalls, 0);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await host.closeRuntimeDatabases();
    const target = await realpath(fixture); assert.equal(target, fixture); assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("ingestion-http-authority-"));
    await rm(target, { recursive: true, force: true });
  }
});
