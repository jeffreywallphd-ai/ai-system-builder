import type { TlsCertificateProviderPort, TlsCertificateStorePort } from "../../../application/ports/security";
import { createSelfSignedTlsCertificateProvider } from "./createSelfSignedTlsCertificateProvider";
import { createLocalCaTlsCertificateProvider } from "./createLocalCaTlsCertificateProvider";

export function createCompositeTlsCertificateProvider(store: TlsCertificateStorePort): TlsCertificateProviderPort {
  const selfSigned = createSelfSignedTlsCertificateProvider(store);
  const localCa = createLocalCaTlsCertificateProvider(store);
  return {
    async resolveCertificateMaterial(input) {
      if (!input.httpsEnabled && !input.httpsRequired) return undefined;
      if (input.mode === "manual") {
        if (!input.manualCertPath || !input.manualKeyPath) throw new Error("Manual TLS mode requires AI_SYSTEM_BUILDER_TLS_CERT_PATH and AI_SYSTEM_BUILDER_TLS_KEY_PATH when HTTPS is enabled.");
        const certPem = await store.readText(input.manualCertPath); const keyPem = await store.readText(input.manualKeyPath);
        return { certPem, keyPem, certificatePath: input.manualCertPath, keyPath: input.manualKeyPath, status: { mode: input.mode, enabled: true, source: "manual", hosts: input.hosts } };
      }
      if (input.mode === "auto-self-signed") return selfSigned.resolveCertificateMaterial(input);
      if (input.mode === "auto-local-ca") return localCa.resolveCertificateMaterial(input);
      throw new Error(`Unsupported TLS certificate mode: ${String((input as any).mode)}`);
    }
  };
}
