import path from "node:path";
import { DEFAULT_DEVICE_TOKEN_TTL_DAYS, DEFAULT_SECURITY_MODE } from "./serverSecurityDefaults";
import { resolveServerTlsCertificateConfig } from "./resolveServerTlsCertificateConfig";
import type { SecurityMode } from "../../../contracts/security";

const IMPLEMENTED_SERVER_SECURITY_MODES = [
  "disabled-dev",
  "lan-https-token",
  "oidc-bearer",
] as const satisfies readonly SecurityMode[];

export function resolveServerSecurityConfig(env: NodeJS.ProcessEnv, storageRootDirectory: string) {
  const requestedMode = env.AI_SYSTEM_BUILDER_SECURITY_MODE?.trim() || DEFAULT_SECURITY_MODE;
  if (!IMPLEMENTED_SERVER_SECURITY_MODES.includes(requestedMode as typeof IMPLEMENTED_SERVER_SECURITY_MODES[number])) {
    throw new Error(
      `Server security mode must be one of ${IMPLEMENTED_SERVER_SECURITY_MODES.join(", ")}.`,
    );
  }
  const mode = requestedMode as typeof IMPLEMENTED_SERVER_SECURITY_MODES[number];
  const httpsEnabled = env.AI_SYSTEM_BUILDER_HTTPS_ENABLED === "true" || mode !== "disabled-dev";
  const httpsRequired = mode !== "disabled-dev";

  const devSecurityToggleRequested = env.AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED === "true";
  const devSecurityToggleEnabled = mode === "disabled-dev" && devSecurityToggleRequested;
  if (mode !== "disabled-dev" && devSecurityToggleRequested) console.warn("[security] Ignoring AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED because startup mode is not disabled-dev.");
  const securityStorePath = env.AI_SYSTEM_BUILDER_SECURITY_STORE_PATH?.trim() || path.join(storageRootDirectory, "config", "security");
  const tls = resolveServerTlsCertificateConfig(env, securityStorePath, httpsEnabled, httpsRequired);
  return {
    mode, httpsEnabled, httpsRequired, tls,
    pairingEnabled: mode === "lan-https-token" && env.AI_SYSTEM_BUILDER_PAIRING_ENABLED !== "false",
    deviceTokenTtlDays: Number(env.AI_SYSTEM_BUILDER_DEVICE_TOKEN_TTL_DAYS || DEFAULT_DEVICE_TOKEN_TTL_DAYS),
    allowLocalhostWithoutAuth: env.AI_SYSTEM_BUILDER_ALLOW_LOCALHOST_WITHOUT_AUTH === "true",
    securityStorePath,
    authRequired: mode !== "disabled-dev",
    devSecurityToggleEnabled,
  };
}
