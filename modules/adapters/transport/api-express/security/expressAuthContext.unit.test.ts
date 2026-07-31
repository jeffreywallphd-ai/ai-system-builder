import type { Request } from "express";

import { describe, expect, it } from "../../../../testing/node-test";
import { createAnonymousAuthContext } from "../../../../contracts/security";
import {
  requireExpressAuthenticatedPrincipalId,
  setExpressAuthContext,
} from "./expressAuthContext";

describe("Express authenticated principal context", () => {
  it("returns the verified principal identity and ignores transport-shaped fields", () => {
    const request = {
      securityContext: { principal: { id: "renderer-spoof" } },
    } as unknown as Request;
    setExpressAuthContext(request, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: {
        principalId: "principal-1",
        kind: "user",
        displayName: "Principal",
        roles: ["organization-member"],
        scopes: ["asset:write"],
      },
    });

    expect(requireExpressAuthenticatedPrincipalId(request)).toBe("principal-1");
  });

  it("fails closed for missing or anonymous authentication context", () => {
    expect(() =>
      requireExpressAuthenticatedPrincipalId({} as Request),
    ).toThrow("Authenticated principal context is required.");
    const anonymous = {} as Request;
    setExpressAuthContext(anonymous, createAnonymousAuthContext());
    expect(() =>
      requireExpressAuthenticatedPrincipalId(anonymous),
    ).toThrow("Authenticated principal context is required.");
  });
});
