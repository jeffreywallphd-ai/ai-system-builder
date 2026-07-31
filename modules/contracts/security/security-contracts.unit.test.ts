import { describe, expect, it } from "../../testing/node-test";
import { createAnonymousAuthContext, createExternalSubjectIdentity, createSecurityError, missingSecurityScopes, SECURITY_SCOPES } from "./index";

describe("security contracts", () => {
  it("uses the exact OIDC issuer and subject as external identity", () => {
    expect(createExternalSubjectIdentity({
      issuer: "https://identity.example.test/tenant",
      subject: "stable-subject-123",
    })).toEqual({
      issuer: "https://identity.example.test/tenant",
      subject: "stable-subject-123",
    });
    expect(() => createExternalSubjectIdentity({
      issuer: "http://identity.example.test",
      subject: "stable-subject-123",
    })).toThrow(/exact HTTPS issuer/);
    expect(() => createExternalSubjectIdentity({
      issuer: "https://identity.example.test",
      subject: " user@example.test ",
    })).toThrow(/non-empty ASCII subject/);
  });
  it("identifies missing scopes", () => {
    const missing = missingSecurityScopes(["artifact:read"], ["artifact:read", "runtime:admin"]);
    expect(missing).toEqual(["runtime:admin"]);
  });

  it("declares workspace read and write scopes", () => {
    expect(SECURITY_SCOPES).toContain("workspace:read");
    expect(SECURITY_SCOPES).toContain("workspace:write");
  });

  it("declares asset read and write scopes", () => {
    expect(SECURITY_SCOPES).toContain("asset:read");
    expect(SECURITY_SCOPES).toContain("asset:write");
  });

  it("creates anonymous auth context", () => {
    const context = createAnonymousAuthContext();
    expect(context.authenticated).toBe(false);
    expect(context.principal.kind).toBe("anonymous");
    expect(context.principal.scopes).toEqual([]);
  });

  it("creates security error helper output", () => {
    const error = createSecurityError("security.forbidden", "Nope");
    expect(error.code).toBe("security.forbidden");
    expect(error.message).toBe("Nope");
  });
});
