import { createAnonymousAuthContext, type AuthContext } from "../../../contracts/security";

export function createDevelopmentNoAuthSecurityAdapter(): { verifyToken: () => Promise<AuthContext> } {
  return {
    async verifyToken() {
      return {
        ...createAnonymousAuthContext(),
        principal: {
          principalId: "dev-anonymous",
          kind: "anonymous",
          displayName: "Development Anonymous",
          roles: ["developer"],
          scopes: ["security:admin"],
        },
      };
    },
  };
}
