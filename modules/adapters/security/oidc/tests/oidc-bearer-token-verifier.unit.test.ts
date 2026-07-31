import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOidcBearerConfig } from "../../../../contracts/security";
import {
  createInternalPrincipalId,
  createOidcBearerTokenVerifierAdapter,
} from "../createOidcBearerTokenVerifierAdapter";

const config = createOidcBearerConfig({
  issuer: "https://identity.example.test/tenant",
  audience: "ai-system-builder",
  jwksUri: "https://identity.example.test/tenant/keys",
  algorithms: ["RS256"],
});

describe("OIDC bearer token verifier", () => {
  it("uses verified issuer and subject for a stable opaque principal id", async () => {
    const verifier = createOidcBearerTokenVerifierAdapter({
      config,
      jwtVerifier: {
        verify: async (input) => {
          assert.deepEqual(input, {
            token: "signed-token",
            ...config,
          });
          return {
            iss: config.issuer,
            sub: "subject-1",
            iat: 1_700_000_000,
            exp: 1_700_003_600,
          };
        },
      },
    });
    const context = await verifier.verifyToken({
      token: "signed-token",
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    assert.equal(context.authMethod, "oidc-bearer");
    assert.equal(context.principal.kind, "user");
    assert.deepEqual(context.principal.scopes, []);
    assert.deepEqual(context.principal.externalIdentity, {
      issuer: config.issuer,
      subject: "subject-1",
    });
    assert.equal(
      context.principal.principalId,
      createInternalPrincipalId({ issuer: config.issuer, subject: "subject-1" }),
    );
    assert.equal(JSON.stringify(context).includes("email"), false);
  });

  it("maps signature, claims, and malformed identity failures to one safe error", async () => {
    const verifier = createOidcBearerTokenVerifierAdapter({
      config,
      jwtVerifier: { verify: async () => { throw new Error("private verifier details"); } },
    });
    await assert.rejects(
      () => verifier.verifyToken({ token: "bad", now: new Date() }),
      (error: unknown) => {
        assert.deepEqual(
          { code: (error as { code?: unknown }).code, message: (error as Error).message },
          { code: "security.invalid-token", message: "Invalid bearer token." },
        );
        return true;
      },
    );
  });

  it("rejects symmetric algorithms and untrusted URL shapes", () => {
    assert.throws(() => createOidcBearerConfig({
      issuer: config.issuer,
      audience: config.audience,
      jwksUri: config.jwksUri,
      algorithms: ["HS256"],
    }), /asymmetric allowlist/);
    assert.throws(() => createOidcBearerConfig({
      issuer: "https://identity.example.test?issuer=other",
      audience: config.audience,
      jwksUri: config.jwksUri,
    }), /exact HTTPS URL/);
  });
});
