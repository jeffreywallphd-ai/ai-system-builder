import assert from "node:assert/strict";
import test from "node:test";

import { createOidcBearerTokenVerifierAdapter } from "../../../../adapters/security/oidc/createOidcBearerTokenVerifierAdapter";
import { isDesktopHeadlessClientId } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createOidcBearerConfig, type AuthContext } from "../../../../contracts/security";
import { resolveManagedHeadlessClientPolicy } from "../resolveManagedHeadlessClientPolicy";

const issuer = "https://issuer.example.invalid";
const agent = "controlled-agent";
const browser = "controlled-browser";
const input = { env: {
  AI_SYSTEM_BUILDER_MANAGED_HEADLESS_AGENT_CLIENT_ID: agent,
  AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_CLIENT_ID: browser,
}, oidcIssuer: issuer };
const organization = { organizationId: createOrganizationId("org-fixture"), principalId: "principal-fixture" };
const authenticated = (clientId?: string): AuthContext => ({
  authenticated: true,
  authMethod: "oidc-bearer",
  oidcAccessTokenClientId: clientId,
  expiresAt: new Date(2_000).toISOString(),
  principal: {kind: "user", principalId: organization.principalId, externalIdentity: {issuer, subject: "fixture"}, roles: [], scopes: []},
});
const verifiedBrowser = () => {
  const config = createOidcBearerConfig({issuer, jwksUri: `${issuer}/keys`, audience: "fixture", algorithms: ["RS256"]});
  const verifier = createOidcBearerTokenVerifierAdapter({config, jwtVerifier: {async verify() {
    return {iss: issuer, sub: "fixture", exp: 2, accessTokenClientId: browser};
  }}});
  return verifier.verifyToken({token: "fixture-token", now: new Date(1_000)});
};

test("managed classification is opt-in and fails closed on incomplete or ambiguous startup bindings", () => {
  assert.equal(resolveManagedHeadlessClientPolicy({env: {}, oidcIssuer: issuer}), undefined);
  for (const value of [undefined, "", " controlled-browser", agent, "x".repeat(257)]) {
    assert.throws(() => resolveManagedHeadlessClientPolicy({ ...input,
      env: {...input.env, AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_CLIENT_ID: value} }),
    /requires two distinct OIDC client registrations/);
  }
  assert.throws(() => resolveManagedHeadlessClientPolicy({env: input.env}), /requires two distinct OIDC client registrations/);
});

test("only the exact client can take each purpose, and receipt identity is stable across restarts", async () => {
  let time = 1_000;
  const options = {...input, now: () => time};
  const policy = resolveManagedHeadlessClientPolicy(options)!;
  const base = { organization, organizationHeader: organization.organizationId };
  const forAgent = { ...base, purpose: "agent" as const, auth: authenticated(agent) };
  const browserAuth = await verifiedBrowser();
  const forBrowser = { purpose: "browser" as const, auth: browserAuth,
    organization: {...organization, principalId: browserAuth.principal.principalId}, organizationHeader: organization.organizationId };
  const agentRegistration = policy.identify(forAgent)!;
  const browserRegistration = policy.identify(forBrowser)!;
  assert.ok(isDesktopHeadlessClientId(agentRegistration.registeredClientId));
  assert.notEqual(agentRegistration.registeredClientId, browserRegistration.registeredClientId);
  assert.equal(browserRegistration.purpose, "browser");
  assert.equal(policy.identify({...forBrowser, auth: {...browserAuth}}), undefined);
  assert.equal(resolveManagedHeadlessClientPolicy(options)!.identify(forAgent)?.registeredClientId, agentRegistration.registeredClientId);
  assert.equal(policy.identify({...forBrowser, purpose: "agent"}), undefined);
  assert.equal(policy.identify({...forAgent, purpose: "browser"}), undefined);
  assert.equal(JSON.stringify(agentRegistration).includes(agent), false);
  assert.equal(agentRegistration.isCurrent(), true);
  time = 2_000;
  assert.equal(agentRegistration.isCurrent(), false);
  assert.equal(policy.identify(forAgent), undefined);
  time = 1_000;
  assert.equal(agentRegistration.isCurrent(), false);
});

test("professed browser source or role cannot replace verified client identity and exact membership context", async () => {
  const policy = resolveManagedHeadlessClientPolicy({...input, now: () => 1_000})!;
  const auth = await verifiedBrowser();
  const request = { purpose: "browser" as const, auth,
    organization: {...organization, principalId: auth.principal.principalId}, organizationHeader: organization.organizationId };
  assert.equal(policy.identify(request)?.purpose, "browser");
  for (const header of [undefined, [organization.organizationId], "wrong-org", " org-fixture"]) {
    assert.equal(policy.identify({...request, organizationHeader: header}), undefined);
  }
  for (const context of [undefined, {...organization, principalId: "other-principal"}]) {
    assert.equal(policy.identify({...request, organization: context}), undefined);
  }
  for (const credential of [authenticated(), {...auth, authenticated: false},
    {...auth, authMethod: "external"}, {...auth, expiresAt: undefined},
    {...auth, principal: {...auth.principal, externalIdentity: {issuer: "https://another.example.invalid", subject: "fixture"}}},
    {...auth, principal: {...auth.principal, kind: "service"}},
  ] as const) {
    assert.equal(policy.identify({...request, auth: credential}), undefined);
  }
  for (const purpose of ["__proto__", "constructor", "unregistered"]) {
    assert.equal(policy.identify({...request, purpose: purpose as "agent", auth: authenticated()}), undefined);
  }
});
