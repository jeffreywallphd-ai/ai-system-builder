export const OIDC_ASYMMETRIC_SIGNING_ALGORITHMS = [
  "RS256",
  "PS256",
  "ES256",
] as const;
export type OidcAsymmetricSigningAlgorithm =
  (typeof OIDC_ASYMMETRIC_SIGNING_ALGORITHMS)[number];

export interface OidcBearerConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly algorithms: readonly OidcAsymmetricSigningAlgorithm[];
}

export function createOidcBearerConfig(input: {
  issuer: string;
  audience: string;
  jwksUri: string;
  algorithms?: readonly string[];
}): OidcBearerConfig {
  const issuer = exactHttpsUrl(input.issuer, "OIDC issuer");
  const jwksUri = exactHttpsUrl(input.jwksUri, "OIDC JWKS URI");
  const audience = input.audience.trim();
  if (audience.length === 0 || audience !== input.audience || audience.length > 512) {
    throw new Error("OIDC audience must be a non-empty exact value.");
  }
  const algorithms = input.algorithms ?? ["RS256"];
  if (
    algorithms.length === 0 ||
    algorithms.some((algorithm) => !OIDC_ASYMMETRIC_SIGNING_ALGORITHMS.includes(
      algorithm as OidcAsymmetricSigningAlgorithm,
    ))
  ) {
    throw new Error(
      `OIDC algorithms must use the asymmetric allowlist: ${OIDC_ASYMMETRIC_SIGNING_ALGORITHMS.join(", ")}.`,
    );
  }
  return {
    issuer,
    audience,
    jwksUri,
    algorithms: [...new Set(algorithms)] as OidcAsymmetricSigningAlgorithm[],
  };
}

function exactHttpsUrl(value: string, label: string): string {
  if (value !== value.trim() || value.length === 0 || value.length > 2048) {
    throw new Error(`${label} must be an exact HTTPS URL.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an exact HTTPS URL.`);
  }
  return value;
}
