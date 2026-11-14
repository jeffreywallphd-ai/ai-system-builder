import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH, type HeadlessHostIncarnationId } from "../../../../../contracts/headless";
import { createOrganizationId } from "../../../../../contracts/organization";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { resolveApiRoutePolicy } from "../../security/apiRouteSecurityPolicy";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { setExpressOrganizationContext } from "../../security/expressOrganizationContext";
import { registerManagedBrowserConsentRoute } from "../registerManagedBrowserConsentRoute";

const configuredOrigin = "https://fixture.invalid";
const organizationId = createOrganizationId("fixture-org");
const workspaceId = createWorkspaceId("fixture-workspace");
const target = {hostIncarnationId: randomUUID() as HeadlessHostIncarnationId, windowId: randomUUID(),
  uiIncarnationId: randomUUID(), workspaceId};
const attempt = {...target, requestId: randomUUID(), attemptId: randomUUID()};
const proof = "a".repeat(43);

test("only the exact POST has a central non-public policy", () => {
  assert.deepEqual(resolveApiRoutePolicy("POST", MANAGED_BROWSER_CONSENT_PATH), {public: false, scopes: ["workspace:read", "asset:read"]});
  assert.deepEqual(resolveApiRoutePolicy("POST", MANAGED_BROWSER_OBSERVE_PATH), {public: false, scopes: ["workspace:read", "asset:read"]});
  for (const [method, path] of [["GET", MANAGED_BROWSER_CONSENT_PATH], ["POST", `${MANAGED_BROWSER_CONSENT_PATH}/`],
    ["POST", MANAGED_BROWSER_CONSENT_PATH.toUpperCase()], ["OPTIONS", MANAGED_BROWSER_CONSENT_PATH]] as const) {
    assert.equal(resolveApiRoutePolicy(method, path).deny, true);
  }
});

test("exact browser origin, purposeful authentication, framing and live request are required for consent", async () => {
  const app = express();
  app.use((request, _response, next) => {
    const client = request.headers.authorization;
    if (client) setExpressAuthContext(request, {authenticated: true, authMethod: "oidc-bearer", oidcAccessTokenClientId: client,
      principal: {principalId: "fixture-user", kind: "user", roles: [], scopes: []}});
    setExpressOrganizationContext(request, {organizationId, principalId: "fixture-user"});
    next();
  });
  let admitted = true;
  let registrationRetired = false;
  let observed = 0;
  let registerReply: unknown = {target, proof};
  let observeReply: Awaited<ReturnType<import("../registerManagedBrowserConsentRoute").ManagedBrowserConsentHandlers<unknown>["observe"]>> | undefined;
  const grant = {target: {...attempt, leaseId: randomUUID(), generation: 1}, remainingMs: 10_000};
  let consentReply: typeof grant | undefined;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const retire = registerManagedBrowserConsentRoute(app, configuredOrigin, () => ({
    hostIncarnationId: target.hostIncarnationId,
    identify({auth, organization, organizationHeader}) {
      if (auth?.oidcAccessTokenClientId === "fixture-browser" && organization?.organizationId === organizationId &&
        organizationHeader === organizationId) return {isCurrent: () => admitted};
    },
    isCurrent(identity) { return identity.isCurrent(); },
    async register(_identity, workspace) { return workspace === workspaceId ? registerReply : undefined; },
    async observe(document) {
      observed++;
      return observeReply ?? {status: document.proof === proof ? "ready" : "unavailable"};
    },
    async consent(_document, _target, _phase, current) {
      if (consentReply) return consentReply;
      entered.resolve();
      await release.promise;
      assert.equal(current(), false);
      return {target: {...attempt, leaseId: randomUUID(), generation: 1}, remainingMs: 10_000};
    },
    async revoke() { return false; },
    disconnect() { registrationRetired = true; return true; },
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const post = (body: unknown, headers: Record<string, string> = {}, query = "",
      route = typeof body === "object" && body && "operation" in body && body.operation === "observe" ? MANAGED_BROWSER_OBSERVE_PATH : MANAGED_BROWSER_CONSENT_PATH) => fetch(url + route + query, {method: "POST", headers: {
      origin: configuredOrigin, "sec-fetch-site": "same-origin", authorization: "fixture-browser",
      "x-organization-id": organizationId, "content-type": "application/json", ...headers,
    }, body: typeof body === "string" ? body : JSON.stringify(body)});
    const register = {operation: "register", workspaceId};
    for (const headers of [{origin: "null"}, {origin: "https://other.invalid"}, {"sec-fetch-site": "cross-site"},
      {authorization: "fixture-agent"}, {"x-organization-id": "other-org"}]) assert.equal((await post(register, headers)).status, 403);
    assert.equal((await post(register, {"content-type": "text/plain"})).status, 415);
    assert.equal((await post(register, {}, "?ignored=yes")).status, 400);
    assert.equal((await post(register, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).status, 400);
    assert.equal((await post(` {"operation":"register","workspaceId":"${workspaceId}"}`)).status, 400);
    assert.equal((await post({operation: "register", workspaceId, extra: "x".repeat(5_000)})).status, 413);
    registerReply = {status: "busy"};
    assert.equal((await post(register)).status, 503);
    registerReply = undefined;
    assert.equal((await post(register)).status, 403);
    for (const foreign of [{...target, hostIncarnationId: randomUUID()}, {...target, workspaceId: "foreign-workspace"}]) {
      registerReply = {target: foreign, proof};
      const refused = await post(register);
      assert.equal(refused.status, 503);
      assert.equal(JSON.stringify(await refused.json()).includes(proof), false);
    }
    registerReply = {target, proof};
    const registration = await post(register);
    assert.equal(registration.status, 200);
    assert.equal(registration.headers.get("cache-control"), "no-store");
    assert.equal(registration.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await registration.json(), {target, proof});
    assert.equal((await post(register, {}, "", MANAGED_BROWSER_OBSERVE_PATH)).status, 400);
    assert.equal((await post({operation: "observe", document: target}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof}, "", MANAGED_BROWSER_CONSENT_PATH)).status, 400);
    assert.equal((await post({operation: "observe", document: target})).status, 403);
    assert.equal((await post({operation: "accept", document: target, target: {...attempt, uiIncarnationId: randomUUID()}},
      {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).status, 400);
    assert.equal(observed, 0);
    assert.deepEqual(await (await post({operation: "observe", document: target}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).json(), {status: "ready"});
    assert.equal(observed, 1);
    const descriptor = {target: attempt, agentSessionId: randomUUID(), taskId: randomUUID(), expiresAt: 50_000};
    const proofHeader = {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof};
    assert.equal((await post({operation: "revoke", document: target, target: attempt}, proofHeader, "", MANAGED_BROWSER_OBSERVE_PATH)).status, 400);
    observeReply = {status: "ready", request: {...descriptor, status: "pending", target: {...attempt, windowId: randomUUID()}}};
    assert.equal((await post({operation: "observe", document: target}, proofHeader)).status, 503);
    observeReply = {status: "ready", request: {...descriptor, status: "active"}, lease: grant, contextChallenge: randomUUID()};
    assert.equal((await post({operation: "observe", document: target}, proofHeader)).status, 503);
    observeReply = {status: "ready", request: {...descriptor, status: "active"}, lease: grant};
    assert.equal((await post({operation: "observe", document: target}, proofHeader)).status, 200);
    consentReply = {...grant, target: {...grant.target, attemptId: randomUUID()}};
    assert.equal((await post({operation: "accept", document: target, target: attempt}, proofHeader)).status, 503);
    consentReply = {...grant, target: {...grant.target, generation: grant.target.generation + 1}};
    assert.equal((await post({operation: "ready", document: target, target: grant.target}, proofHeader)).status, 503);
    consentReply = grant;
    assert.deepEqual(await (await post({operation: "ready", document: target, target: grant.target}, proofHeader)).json(), grant);
    consentReply = undefined;
    const stale = post({operation: "accept", document: target, target: attempt}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof});
    await entered.promise;
    admitted = false;
    release.resolve();
    assert.equal((await stale).status, 403);
    assert.equal(registrationRetired, false);
    admitted = true;
    assert.deepEqual(await (await post({operation: "disconnect", document: target}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).json(), {ok: true});
    assert.equal(registrationRetired, true);
    retire();
    assert.equal((await post(register)).status, 404);
  } finally { release.resolve(); retire(); server.close(); await once(server, "close"); }
});
