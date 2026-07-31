import path from "node:path";
import type { TlsCertificateMode } from "../../../contracts/security";
import { parseTlsCertificateHosts } from "../../../adapters/security/tls";

export function resolveServerTlsCertificateConfig(env: NodeJS.ProcessEnv, securityStorePath: string, httpsEnabled: boolean, httpsRequired: boolean) {
  const certMode = (env.AI_SYSTEM_BUILDER_TLS_CERT_MODE?.trim() || "manual") as TlsCertificateMode;
  const certPath = env.AI_SYSTEM_BUILDER_TLS_CERT_PATH?.trim();
  const keyPath = env.AI_SYSTEM_BUILDER_TLS_KEY_PATH?.trim();
  if ((httpsEnabled || httpsRequired) && certMode === "manual") {
    if (!certPath) throw new Error("AI_SYSTEM_BUILDER_TLS_CERT_PATH is required when HTTPS is enabled in manual TLS mode.");
    if (!keyPath) throw new Error("AI_SYSTEM_BUILDER_TLS_KEY_PATH is required when HTTPS is enabled in manual TLS mode.");
  }
  const certificateDirectory = env.AI_SYSTEM_BUILDER_TLS_CERT_DIRECTORY?.trim() || path.join(securityStorePath, "tls");
  const hosts = parseTlsCertificateHosts(env.AI_SYSTEM_BUILDER_TLS_CERT_HOSTS);
  return { certMode, certPath, keyPath, certificateDirectory, hosts };
}
