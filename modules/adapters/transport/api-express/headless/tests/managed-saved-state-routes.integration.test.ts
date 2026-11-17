import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import test from "node:test";
import express from "express";

import { createOrganizationContextStructuredDocumentStore, createInMemoryStructuredDocumentStore } from "../../../../persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../persistence/system-builder";
import { createLocalWorkspaceRepository } from "../../../../persistence/workspace";
import { createStructuredOrganizationRepositories } from "../../../../persistence/organization";
import { AuthorizeOperationService, AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../../../application/services/security";
import { createTenantPlacementConfig } from "../../../../../contracts/config";
import { createOrganizationId } from "../../../../../contracts/organization";
import { createSecurityApplicationError, type AuthContext } from "../../../../../contracts/security";
import { normalizeSystemBuilderSystemId } from "../../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { composeManagedSavedState } from "../../../../../hosts/server/composition/composeManagedSavedState";
import { createManagedSavedStateAuthorizationAudit } from "../../../../../hosts/server/security/createManagedSavedStateAuthorizationAudit";
import { MANAGED_SAVED_STATE_PATHS, resolveApiRoutePolicy } from "../../security/apiRouteSecurityPolicy";
import { createExpressOrganizationAuthorizationMiddleware } from "../../security/createExpressOrganizationAuthorizationMiddleware";
import { createExpressOrganizationContextScope } from "../../security/expressOrganizationContextScope";
import { createExpressSecurityMiddleware } from "../../security/createExpressSecurityMiddleware";
import { registerManagedSavedStateRoutes } from "../registerManagedSavedStateRoutes";

test("saved-state routes are exact and require managed read scopes", () => {
  for (const path of Object.values(MANAGED_SAVED_STATE_PATHS)) {
    assert.deepEqual(resolveApiRoutePolicy("POST", path), { public: false, scopes: ["workspace:read", "asset:read"] });
    for (const method of ["GET", "HEAD", "PUT", "DELETE"]) assert.equal(resolveApiRoutePolicy(method, path).deny, true);
    for (const variant of [path + "/", path + "/extra", path.replace("/headless/", "//headless/"), path.toUpperCase(), path.replace("headless", "%68eadless")]) {
      assert.equal(resolveApiRoutePolicy("POST", variant).deny, true);
    }
  }
});

test("authenticated managed snapshot and replay retain scope, durable metadata and current access", { timeout: 12_000 }, async () => {
  const root = createInMemoryStructuredDocumentStore();
  const contexts = createExpressOrganizationContextScope();
  const orgA = createOrganizationId("org-replay-first");
  const orgB = createOrganizationId("org-replay-second");
  const workspaceId = createWorkspaceId("replay-workspace");
  const principalId = "principal-replay-first";
  const anotherPrincipal = "principal-replay-second";
  const now = "2026-11-14T00:00:00.000Z";
  const systemId = normalizeSystemBuilderSystemId("saved-system.one");
  const organizations = createStructuredOrganizationRepositories(root);
  await organizations.organizations.saveOrganization({ organizationId: orgA, status: "active", displayName: "Fixture one", createdAt: now, updatedAt: now });
  await organizations.organizations.saveOrganization({ organizationId: orgB, status: "active", displayName: "Fixture two", createdAt: now, updatedAt: now });
  const membership = { principalId, organizationId: orgA, role: "member", status: "active", createdAt: now, updatedAt: now } as const;
  await organizations.memberships.saveMembership(membership);
  await organizations.memberships.saveMembership({ ...membership, principalId: anotherPrincipal });
  const workspace = { workspaceId, organizationId: orgA, status: "active", displayName: "Fixture workspace", createdAt: now, updatedAt: now } as const;
  const scoped = root.forOrganization(orgA);
  await createLocalWorkspaceRepository({ rootDirectory: ".", documents: scoped }).saveWorkspace(workspace);
  const documents = createOrganizationContextStructuredDocumentStore(root, contexts);
  const tenantPlacement = createTenantPlacementConfig();
  const policy = createOrganizationAuthorizationPolicy({ ...organizations, tenantPlacement });
  const events: unknown[] = [];
  const audit = { async recordSecurityEvent(event: unknown) { events.push(event); } };
  const authorizer = new AuthorizeOperationService(policy, { audit });
  const passive = new AuthorizeOperationService(policy, { audit: createManagedSavedStateAuthorizationAudit(audit, () => 0) });
  const authz = new AuthorizeWorkspaceOperationService({ organizationContext: contexts, authorizer: passive });
  const repository = createStructuredSystemBuilderRepository(documents);
  let afterRead: (() => Promise<void>) | undefined;
  const handlers = composeManagedSavedState({ documents: root, contexts, authorization: authz,
    workspaces: createLocalWorkspaceRepository({ rootDirectory: ".", documents }),
    async listActiveSystems(organizationId, target) {
      assert.equal(organizationId, orgA);
      const records = await repository.listRecords(target);
      await afterRead?.();
      return records;
    },
  });
  const tokens = { writer: randomUUID(), other: randomUUID(), expired: randomUUID(), nonOidc: randomUUID(), noExpiry: randomUUID() };
  const app = express();
  app.enable("case sensitive routing");
  app.use(createExpressSecurityMiddleware({ mode: "oidc-bearer", authRequired: true, httpsRequired: false,
    tenantPlacement, organizationContextScope: contexts, async verifyToken({ token }): Promise<AuthContext> {
      if (!Object.values(tokens).includes(token)) throw createSecurityApplicationError("security.invalid-token", "Invalid token.");
      return {
        authenticated: true, authMethod: token === tokens.nonOidc ? "lan-pairing-token" : "oidc-bearer",
        principal: { principalId: token === tokens.other ? anotherPrincipal : principalId, kind: "user", roles: [], scopes: [] },
        expiresAt: token === tokens.noExpiry ? undefined : new Date(Date.now() + (token === tokens.expired ? -1_000 : 60_000)).toISOString(),
      };
    } }));
  app.use(createExpressOrganizationAuthorizationMiddleware({ authorizer, passiveSavedStateAuthorizer: passive }));
  let enabled = true;
  const retire = registerManagedSavedStateRoutes(app, () => enabled ? handlers : undefined);
  let generalParserCalls = 0;
  app.use(express.json({ verify() { generalParserCalls += 1; } }));
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  try {
    const snapshotPath = MANAGED_SAVED_STATE_PATHS.snapshot;
    const changesPath = MANAGED_SAVED_STATE_PATHS.changes;
    const missingAuth = await send(snapshotPath, { workspaceId }, { token: null });
    assert.equal(missingAuth.status, 401);
    assert.equal((await send(snapshotPath, { workspaceId }, { token: "invalid" })).status, 401);
    assert.equal((await send(snapshotPath, { workspaceId }, { token: tokens.nonOidc })).status, 403);
    assert.equal((await send(snapshotPath, { workspaceId }, { token: tokens.expired })).status, 403);
    assert.equal((await send(snapshotPath, { workspaceId }, { token: tokens.noExpiry })).status, 403);
    assert.equal((await send(snapshotPath, { workspaceId }, { organization: orgB })).status, 403);
    assert.equal((await send(snapshotPath, { workspaceId: "foreign-workspace" })).status, 403);
    assert.equal((await send(snapshotPath + "?unused=1", { workspaceId })).status, 400);
    assert.equal((await send(snapshotPath, { workspaceId }, { contentType: "text/plain" })).status, 415);
    assert.equal((await send(snapshotPath, `{"workspaceId":"first","workspaceId":"${workspaceId}"}`)).status, 400);
    assert.equal((await send(snapshotPath, { workspaceId, extra: true })).status, 400);
    assert.equal((await send(snapshotPath, "x".repeat(1025))).status, 413);
    assert.equal(generalParserCalls, 0);
    assert.equal(events.length, 1);

    enabled = false;
    assert.equal((await send(snapshotPath, { workspaceId })).status, 404);
    enabled = true;
    const before = await send(snapshotPath, { workspaceId });
    assert.equal(before.status, 200);
    assert.equal(before.cache, "no-store");
    assert.deepEqual(before.body.value.systems, []);
    const { cursor } = before.body.value;
    const active = createStructuredSystemBuilderRepository(scoped, { journalChanges: true });
    await active.createRecord({ systemId, targetWorkspaceId: workspaceId, name: "Synthetic private name", status: "draft",
      revision: 1, createdAt: now, updatedAt: now, createdBy: "fixture-actor", updatedBy: "fixture-actor" });

    const replay = await send(changesPath, { workspaceId, cursor });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.value.events, [{ sequence: 1, systemId, recordRevision: 1, revisionId: null }]);
    assert.doesNotMatch(JSON.stringify(replay.body), /Synthetic private name|fixture-actor/);
    assert.deepEqual((await send(changesPath, { workspaceId, cursor }, { token: tokens.other })).body.value, { kind: "resync" });
    assert.equal((await send(changesPath, { workspaceId, cursor: { ...cursor, sequence: -1 } })).status, 400);
    assert.deepEqual((await send(changesPath, { workspaceId, cursor: { ...cursor, scopeTag: "a".repeat(64) } })).body.value, { kind: "resync" });
    for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await send(changesPath, { workspaceId, cursor })).status, 200);
    assert.equal(events.length, 1);
    afterRead = () => organizations.memberships.saveMembership({ ...membership, status: "suspended" });
    assert.deepEqual((await send(snapshotPath, { workspaceId })).body, { ok: false, code: "headless.forbidden" });
    assert.equal((await send(changesPath, { workspaceId, cursor })).status, 403);
    await organizations.memberships.saveMembership(membership);
    afterRead = async () => { throw new Error("private database detail"); };
    assert.deepEqual((await send(snapshotPath, { workspaceId })).body, { ok: false, code: "headless.unavailable" });
    afterRead = undefined;
    const signal = new AbortController();
    const changesStream = await connectStream(cursor, tokens.writer, signal.signal);
    assert.equal(changesStream.status, 200);
    assert.match(changesStream.headers.get("Content-Type") ?? "", /^text\/event-stream/);
    const reader = changesStream.body!.getReader();
    const decoder = new TextDecoder();
    const firstEvent = await reader.read();
    assert.match(decoder.decode(firstEvent.value), /event: changes\ndata: .*"sequence":1/);
    await organizations.memberships.saveMembership({ ...membership, status: "suspended" });
    assert.equal((await reader.read()).done, true);
    await organizations.memberships.saveMembership(membership);

    const otherViewer = await connectStream(cursor, tokens.other);
    assert.equal(await otherViewer.text(), 'event: resync\ndata: {}\n\n');
    const heldConnections = Array.from({ length: 8 }, () => new AbortController());
    try {
      const readers = await Promise.all(heldConnections.map(async (entry) => {
        const connection = await connectStream(replay.body.value.cursor, tokens.writer, entry.signal);
        assert.equal(connection.status, 200);
        const feed = connection.body!.getReader();
        assert.match(decoder.decode((await feed.read()).value), /: ready/);
        return feed;
      }));
      assert.equal((await connectStream(cursor, tokens.writer)).status, 503);
      assert.equal((await send(snapshotPath, { workspaceId })).status, 200);
      retire();
      const closedReaders = await Promise.allSettled(readers.map((item) => item.read()));
      assert.ok(closedReaders.every((item) => item.status === "rejected" || item.value.done));
    } finally {
      for (const connection of heldConnections) connection.abort();
      signal.abort();
    }
    assert.equal((await send(snapshotPath, { workspaceId })).status, 404);
  } finally {
    retire();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  async function send(path: string, input: unknown, options: { token?: string | null; organization?: string; contentType?: string } = {}) {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const token = options.token === undefined ? tokens.writer : options.token;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(2_000),
      headers: { "Content-Type": options.contentType ?? "application/json", "X-Organization-Id": options.organization ?? orgA,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof input === "string" ? input : JSON.stringify(input),
    });
    return { status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json() };
  }

  async function connectStream(cursor: unknown, token: string, signal = AbortSignal.timeout(4_000)) {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return fetch(`http://127.0.0.1:${address.port}${MANAGED_SAVED_STATE_PATHS.stream}`, {
      method: "POST", redirect: "error", signal,
      headers: { "Content-Type": "application/json", "X-Organization-Id": orgA, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId, cursor }),
    });
  }
});
