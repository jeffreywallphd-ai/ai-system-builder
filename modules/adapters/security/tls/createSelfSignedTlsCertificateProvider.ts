import path from "node:path";
import { X509Certificate } from "node:crypto";
import selfsigned from "selfsigned";
import type { TlsCertificateProviderPort, TlsCertificateStorePort } from "../../../application/ports/security";

const CERT_FILE_NAME = "dev-self-signed-server.pem";
const KEY_FILE_NAME = "dev-self-signed-server-key.pem";
const isIpHost = (h: string) => /^\d|:/.test(h);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

export function createSelfSignedTlsCertificateProvider(store: TlsCertificateStorePort): TlsCertificateProviderPort {
  return { async resolveCertificateMaterial(input) {
    if (!input.httpsEnabled && !input.httpsRequired) return undefined;
    if (input.mode !== "auto-self-signed") return undefined;
    const certPath = path.join(input.certificateDirectory, CERT_FILE_NAME);
    const keyPath = path.join(input.certificateDirectory, KEY_FILE_NAME);
    const certExists = await store.fileExists(certPath); const keyExists = await store.fileExists(keyPath);
    if (certExists !== keyExists) throw new Error(`TLS certificate directory has partial state at '${input.certificateDirectory}'. Found only one of certificate/key files; delete both or repair manually.`);
    if (!certExists) {
      await store.ensureDirectory(input.certificateDirectory);
      const pems = await selfsigned.generate([{ name: "commonName", value: input.hosts[0] ?? "localhost" }], {
        algorithm: "sha256", keySize: 2048, notBeforeDate: input.now, notAfterDate: addDays(input.now, 365),
        extensions: [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, keyEncipherment: true }, { name: "extKeyUsage", serverAuth: true }, { name: "subjectAltName", altNames: input.hosts.map((h) => isIpHost(h) ? ({ type: 7, ip: h }) : ({ type: 2, value: h })) }],
      });
      await store.writeTextAtomic(certPath, pems.cert, 0o644);
      await store.writeTextAtomic(keyPath, pems.private, 0o600);
    }
    const certPem = await store.readText(certPath); const keyPem = await store.readText(keyPath);
    const expiresAt = new Date(new X509Certificate(certPem).validTo).toISOString();
    return { certPem, keyPem, certificatePath: certPath, keyPath, status: { mode: input.mode, enabled: true, source: certExists ? "reused" : "generated", hosts: input.hosts, expiresAt } };
  }};
}
