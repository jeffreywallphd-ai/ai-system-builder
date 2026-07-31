import { createOidcBearerConfig } from "../../../contracts/security";

export function resolveServerOidcBearerConfig(env: NodeJS.ProcessEnv) {
  const issuer = env.AI_SYSTEM_BUILDER_OIDC_ISSUER;
  const audience = env.AI_SYSTEM_BUILDER_OIDC_AUDIENCE;
  const jwksUri = env.AI_SYSTEM_BUILDER_OIDC_JWKS_URI;
  if (!issuer || !audience || !jwksUri) {
    throw new Error(
      "OIDC bearer mode requires AI_SYSTEM_BUILDER_OIDC_ISSUER, AI_SYSTEM_BUILDER_OIDC_AUDIENCE, and AI_SYSTEM_BUILDER_OIDC_JWKS_URI.",
    );
  }
  const algorithms = env.AI_SYSTEM_BUILDER_OIDC_ALGORITHMS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return createOidcBearerConfig({ issuer, audience, jwksUri, algorithms });
}
