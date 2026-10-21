import assert from "node:assert/strict";
import { test } from "node:test";
import { ANONYMOUS_AUTH_CONTEXT, type AuthContext } from "../../../../contracts/security";
import { VerifyTransportAuthenticationService } from "../verify-transport-authentication.service";

const authenticated: AuthContext = {
  authenticated: true, authMethod: "bearer-token",
  principal: { principalId: "device.valid", kind: "device", roles: [], scopes: ["model:read"] },
};

test("verifier results must establish authenticated non-anonymous identity before success audit", async () => {
  for (const context of [ANONYMOUS_AUTH_CONTEXT, undefined, null, {},
    { ...authenticated, authenticated: "true" },
    { ...authenticated, principal: { ...authenticated.principal, kind: "anonymous" } },
    { ...authenticated, principal: { ...authenticated.principal, principalId: " " } },
    { ...authenticated, authMethod: "none" },
    { ...authenticated, principal: { ...authenticated.principal, principalId: " anonymous " } },
    { ...authenticated, principal: { ...authenticated.principal, scopes: "model:write" } },
  ]) {
    const events: any[] = [];
    const service = new VerifyTransportAuthenticationService({ verifyToken: async () => context as AuthContext }, {
      authRequired: true, audit: { recordSecurityEvent: async (e) => { events.push(e); } },
    });
    await assert.rejects(service.execute({ now: new Date(), bearerToken: "synthetic" }), { code: "security.unauthenticated" });
    assert.equal(events.some((e) => e.kind === "auth.succeeded"), false);
    assert.equal(events.at(-1)?.kind, "auth.failed");
  }
});

test("valid verifier identity is preserved and audited", async () => {
  const events: any[] = [];
  const service = new VerifyTransportAuthenticationService({ verifyToken: async () => authenticated }, {
    authRequired: true, audit: { recordSecurityEvent: async (e) => { events.push(e); } },
  });
  assert.equal(await service.execute({ now: new Date(), bearerToken: "synthetic" }), authenticated);
  assert.equal(events[0].kind, "auth.succeeded");
  assert.equal(JSON.stringify(events).includes("synthetic"), false);
});
