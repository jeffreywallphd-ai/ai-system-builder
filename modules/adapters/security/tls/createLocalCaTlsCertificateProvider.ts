import path from "node:path";
import { X509Certificate } from "node:crypto";
import selfsigned from "selfsigned";
import type { TlsCertificateProviderPort, TlsCertificateStorePort } from "../../../application/ports/security";

const LOCAL_CA_CERT_FILE_NAME = "local-dev-ca.pem";
const LOCAL_CA_KEY_FILE_NAME = "local-dev-ca-key.pem";
const LOCAL_SERVER_CERT_FILE_NAME = "local-dev-server.pem";
const LOCAL_SERVER_KEY_FILE_NAME = "local-dev-server-key.pem";
const isIpHost = (h: string) => /^\d|:/.test(h);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

export function createLocalCaTlsCertificateProvider(store: TlsCertificateStorePort): TlsCertificateProviderPort {
  return { async resolveCertificateMaterial(input) {
    if (!input.httpsEnabled && !input.httpsRequired) return undefined;
    if (input.mode !== "auto-local-ca") return undefined;
    const caCertPath = path.join(input.certificateDirectory, LOCAL_CA_CERT_FILE_NAME);
    const caKeyPath = path.join(input.certificateDirectory, LOCAL_CA_KEY_FILE_NAME);
    const certPath = path.join(input.certificateDirectory, LOCAL_SERVER_CERT_FILE_NAME);
    const keyPath = path.join(input.certificateDirectory, LOCAL_SERVER_KEY_FILE_NAME);
    const caCertExists = await store.fileExists(caCertPath); const caKeyExists = await store.fileExists(caKeyPath); const certExists = await store.fileExists(certPath); const keyExists = await store.fileExists(keyPath);
    if (caCertExists !== caKeyExists || certExists !== keyExists) throw new Error(`TLS auto-local-ca directory has partial state at '${input.certificateDirectory}'.`);
    const hasAny = caCertExists || caKeyExists || certExists || keyExists;
    const hasAll = caCertExists && caKeyExists && certExists && keyExists;
    if (hasAny && !hasAll) throw new Error(`TLS auto-local-ca directory has partial state at '${input.certificateDirectory}'. Refusing destructive overwrite.`);
    if (!hasAny) {
      await store.ensureDirectory(input.certificateDirectory);
      const ca = await selfsigned.generate([{ name: "commonName", value: "AI System Builder Local Dev CA" }], {
        algorithm: "sha256", keySize: 2048, notBeforeDate: input.now, notAfterDate: addDays(input.now, 3650),
        extensions: [{ name: "basicConstraints", cA: true, critical: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }],
      });
      const server = await selfsigned.generate([{ name: "commonName", value: input.hosts[0] ?? "localhost" }], {
        algorithm: "sha256", keySize: 2048, notBeforeDate: input.now, notAfterDate: addDays(input.now, 365),
        ca: { cert: ca.cert, key: ca.private },
        extensions: [{ name: "basicConstraints", cA: false, critical: true }, { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true }, { name: "extKeyUsage", serverAuth: true }, { name: "subjectAltName", altNames: input.hosts.map((h) => isIpHost(h) ? ({ type: 7, ip: h }) : ({ type: 2, value: h })) }],
      });
      await store.writeTextAtomic(caCertPath, ca.cert, 0o644);
      await store.writeTextAtomic(caKeyPath, ca.private, 0o600);
      await store.writeTextAtomic(certPath, server.cert, 0o644);
      await store.writeTextAtomic(keyPath, server.private, 0o600);
    }
    const certPem = await store.readText(certPath); const keyPem = await store.readText(keyPath); const caPem = await store.readText(caCertPath);
    const expiresAt = new Date(new X509Certificate(certPem).validTo).toISOString();
    const caExpiresAt = new Date(new X509Certificate(caPem).validTo).toISOString();
    return { certPem, keyPem, certificatePath: certPath, keyPath, status: { mode: input.mode, enabled: true, source: hasAll ? "reused" : "generated", hosts: input.hosts, expiresAt, localCa: { available: true, source: hasAll ? "reused" : "generated", downloadUrl: "/api/security/tls/local-ca.pem", expiresAt: caExpiresAt, trustInstalled: false, trustInstallationRequired: true } }, getLocalCaPublicCertificatePem: async () => store.readText(caCertPath) };
  }};
}
