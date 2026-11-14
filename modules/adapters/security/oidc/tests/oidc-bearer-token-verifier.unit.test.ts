import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, jwtVerify } from "jose";

import { createOidcBearerConfig } from "../../../../contracts/security";
import {
  createInternalPrincipalId,
  createOidcBearerTokenVerifierAdapter,
  projectVerifiedOidcIdentity,
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
    assert.equal(context.oidcAccessTokenClientId, undefined);
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

  it("accepts only a bounded typed trusted client result from the issuer verifier", async () => {
    const now = new Date("2026-11-14T00:00:00.000Z");
    const signedClaims = { sub: "fixture-principal", iss: config.issuer, exp: now.getTime() / 1_000 + 30 };
    for (const [client, expiry, expected] of [
      ["browser.fixture", signedClaims.exp, "browser.fixture"], ["agent-fixture", signedClaims.exp, "agent-fixture"],
      ["agent-fixture", signedClaims.exp - 31, undefined], [" agent", signedClaims.exp, undefined],
      ["x".repeat(129), signedClaims.exp, undefined], [undefined, signedClaims.exp, undefined],
    ] as const) {
      const verifier = createOidcBearerTokenVerifierAdapter({ config, jwtVerifier: { async verify() {
        return { ...signedClaims, exp: expiry, accessTokenClientId: client };
      } } });
      const context = await verifier.verifyToken({ token: "fixture", now });
      assert.equal(context.oidcAccessTokenClientId, expected);
      assert.deepEqual(context.principal.scopes, []);
    }
  });

  it("projects the signed client only for verified access tokens, never a similarly named claim", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const keySet = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "fixture" }] });
    const verifier = createOidcBearerTokenVerifierAdapter({ config, jwtVerifier: {
      async verify({ token, issuer, audience, algorithms }) {
        return projectVerifiedOidcIdentity(await jwtVerify(token, keySet, { issuer, audience, algorithms: [...algorithms] }));
      },
    } });
    const now = new Date();
    async function token(typ: string | number | undefined, client: unknown, audience = config.audience) {
      return new SignJWT({ client_id: client, accessTokenClientId: "fake-projection", roles: ["owner"] })
        .setProtectedHeader({ alg: "RS256", kid: "fixture", ...(typ === undefined ? {} : { typ: typ as string }) }).setIssuedAt()
        .setExpirationTime("1m").setIssuer(config.issuer).setAudience(audience).setSubject("fixture").sign(privateKey);
    }
    const ordinary = await verifier.verifyToken({ token: await token(17, "browser.fixture"), now });
    assert.equal(ordinary.authenticated, true);
    assert.equal(ordinary.oidcAccessTokenClientId, undefined);
    for (const typ of ["at+jwt", "APPLICATION/AT+JWT", "JWT", undefined]) {
      const context = await verifier.verifyToken({ token: await token(typ, "browser.fixture"), now });
      assert.equal(context.oidcAccessTokenClientId, typ?.toLowerCase().endsWith("at+jwt") ? "browser.fixture" : undefined);
      assert.deepEqual(context.principal.roles, []);
      assert.equal(JSON.stringify(context).includes("fake-projection"), false);
    }
    assert.equal((await verifier.verifyToken({ token: await token("at+jwt", ["agent"]), now })).oidcAccessTokenClientId, undefined);
    await assert.rejects(async () => verifier.verifyToken({ token: await token("at+jwt", "agent", "wrong-audience"), now }),
      { message: "Invalid bearer token." });
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
