import crypto from "node:crypto";
import path from "node:path";
import { CompleteLanPairingService, GetSecurityStatusService } from "../../../application/services/security";
import { createLanPairingTokenIssuerAdapter } from "../../../adapters/security/lan/createLanPairingTokenIssuerAdapter";
import { createLanDeviceCredentialStoreAdapter } from "../../../adapters/security/lan/createLanDeviceCredentialStoreAdapter";
import { createLanBearerTokenVerifierAdapter } from "../../../adapters/security/lan/createLanBearerTokenVerifierAdapter";
import { createLanPairingCodeStoreAdapter } from "../../../adapters/security/lan/createLanPairingCodeStoreAdapter";
import { createOidcBearerTokenVerifierAdapter } from "../../../adapters/security/oidc/createOidcBearerTokenVerifierAdapter";
import { createExpressOrganizationContextScope, createExpressSecurityMiddleware, createInMemoryDevSecurityEnforcementStore } from "../../../adapters/transport/api-express/security";
import { resolveServerSecurityConfig } from "./resolveServerSecurityConfig";
import { resolveServerOidcBearerConfig } from "./resolveServerOidcBearerConfig";
import { resolveServerTenantPlacementConfig } from "./resolveServerTenantPlacementConfig";
import { createCompositeTlsCertificateProvider, createFilesystemTlsCertificateStore } from "../../../adapters/security/tls";
import { createSecurityApplicationError } from "../../../contracts/security";


const DEV_ONLY_INSECURE_TOKEN_HASH_SECRET = "dev-only-insecure-token-hash-secret";

function resolveTokenHashSecret(env: NodeJS.ProcessEnv, mode: "disabled-dev" | "lan-https-token"): string {
  const configuredSecret = env.SERVER_TOKEN_HASH_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  if (mode === "disabled-dev") {
    console.warn("[security] SERVER_TOKEN_HASH_SECRET is not set; using dev-only insecure token hash secret for disabled-dev mode.");
    return DEV_ONLY_INSECURE_TOKEN_HASH_SECRET;
  }
  throw new Error("SERVER_TOKEN_HASH_SECRET is required in lan-https-token mode. Set a strong random secret in your environment before starting the server.");
}

export async function composeServerSecurity(env: NodeJS.ProcessEnv, storageRootDirectory: string) {
  const config = resolveServerSecurityConfig(env, storageRootDirectory);
  const tlsProvider = createCompositeTlsCertificateProvider(createFilesystemTlsCertificateStore());
  const tlsMaterial = await tlsProvider.resolveCertificateMaterial({ httpsEnabled: config.httpsEnabled, httpsRequired: config.httpsRequired, mode: config.tls.certMode, manualCertPath: config.tls.certPath, manualKeyPath: config.tls.keyPath, certificateDirectory: config.tls.certificateDirectory, hosts: config.tls.hosts, now: new Date() });
  const credentials = createLanDeviceCredentialStoreAdapter(path.join(config.securityStorePath, "device-credentials.json"));
  const tokenHashSecret = config.mode === "oidc-bearer"
    ? undefined
    : resolveTokenHashSecret(env, config.mode);
  const verifier = config.mode === "oidc-bearer"
    ? createOidcBearerTokenVerifierAdapter({
        config: resolveServerOidcBearerConfig(env),
      })
    : createLanBearerTokenVerifierAdapter({
        findCredentialByTokenHash: credentials.findDeviceCredentialByTokenHash,
        tokenHashSecret: tokenHashSecret!,
      });
  const completePairing = tokenHashSecret
    ? new CompleteLanPairingService({
        pairingCodes: createLanPairingCodeStoreAdapter(path.join(config.securityStorePath, "pairing-codes.json")),
        tokens: createLanPairingTokenIssuerAdapter(tokenHashSecret),
        credentials,
        idGenerator: {
          createDeviceId: () => `device-${crypto.randomUUID()}`,
          createSecurityEventId: () => `evt-${crypto.randomUUID()}`,
        },
      })
    : {
        execute: async () => {
          throw createSecurityApplicationError(
            "security.pairing-disabled",
            "LAN pairing is disabled.",
          );
        },
      };
  const getStatusService = new GetSecurityStatusService(credentials);
  const devSecurityEnforcement = createInMemoryDevSecurityEnforcementStore(config.devSecurityToggleEnabled ? "disabled-dev" : undefined);
  const tenantPlacement = resolveServerTenantPlacementConfig(env);
  const organizationContextScope = createExpressOrganizationContextScope();
  const middleware = createExpressSecurityMiddleware({ verifyToken: verifier.verifyToken.bind(verifier), httpsRequired: config.httpsRequired, authRequired: config.authRequired, mode: config.mode, devSecurityEnforcement, tenantPlacement, organizationContextScope });
  return { config: { ...config, tenantPlacement, tlsMaterial, tlsStatus: tlsMaterial?.status }, middleware, services: { completePairing, getStatusService }, credentials, devSecurityEnforcement, organizationContextScope };
}
