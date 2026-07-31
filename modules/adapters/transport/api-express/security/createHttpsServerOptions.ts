import type { ServerOptions } from "node:https";
import type { ResolvedTlsCertificateMaterial } from "../../../../application/ports/security";

export function createHttpsServerOptions(material: ResolvedTlsCertificateMaterial | undefined): ServerOptions {
  if (!material?.certPem || !material?.keyPem) {
    throw new Error("HTTPS is enabled but TLS certificate material is unavailable. Configure manual cert/key paths or use AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed.");
  }
  return { cert: material.certPem, key: material.keyPem };
}
