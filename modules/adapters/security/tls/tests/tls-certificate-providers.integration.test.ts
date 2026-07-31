import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSecureContext } from "node:tls";

import { createFilesystemTlsCertificateStore } from "../createFilesystemTlsCertificateStore";
import { createLocalCaTlsCertificateProvider } from "../createLocalCaTlsCertificateProvider";
import { createSelfSignedTlsCertificateProvider } from "../createSelfSignedTlsCertificateProvider";

const hosts = ["localhost", "127.0.0.1"] as const;

test("self-signed TLS material is usable, host-bound, and reused", async () => {
  const certificateDirectory = await mkdtemp(path.join(tmpdir(), "ai-system-builder-self-signed-"));
  try {
    const provider = createSelfSignedTlsCertificateProvider(createFilesystemTlsCertificateStore());
    const input = {
      httpsEnabled: true,
      httpsRequired: false,
      mode: "auto-self-signed" as const,
      certificateDirectory,
      hosts,
      now: new Date(),
    };
    const generated = await provider.resolveCertificateMaterial(input);

    assert.ok(generated);
    assert.equal(generated.status.source, "generated");
    createSecureContext({ cert: generated.certPem, key: generated.keyPem });
    const certificate = new X509Certificate(generated.certPem);
    assert.equal(certificate.verify(certificate.publicKey), true);
    assert.match(certificate.subjectAltName ?? "", /DNS:localhost/);
    assert.match(certificate.subjectAltName ?? "", /IP Address:127\.0\.0\.1/);

    const reused = await provider.resolveCertificateMaterial({ ...input, now: new Date(input.now.getTime() + 60_000) });
    assert.ok(reused);
    assert.equal(reused.status.source, "reused");
    assert.equal(reused.certPem, generated.certPem);
  } finally {
    await rm(certificateDirectory, { recursive: true, force: true });
  }
});

test("local CA mode produces a CA-signed server certificate for every configured host", async () => {
  const certificateDirectory = await mkdtemp(path.join(tmpdir(), "ai-system-builder-local-ca-"));
  try {
    const provider = createLocalCaTlsCertificateProvider(createFilesystemTlsCertificateStore());
    const generated = await provider.resolveCertificateMaterial({
      httpsEnabled: true,
      httpsRequired: false,
      mode: "auto-local-ca",
      certificateDirectory,
      hosts,
      now: new Date(),
    });

    assert.ok(generated);
    assert.equal(generated.status.source, "generated");
    createSecureContext({ cert: generated.certPem, key: generated.keyPem });
    const caPem = await generated.getLocalCaPublicCertificatePem?.();
    assert.ok(caPem);
    const certificate = new X509Certificate(generated.certPem);
    const ca = new X509Certificate(caPem);
    assert.equal(ca.ca, true);
    assert.equal(certificate.ca, false);
    assert.equal(certificate.checkIssued(ca), true);
    assert.equal(certificate.verify(ca.publicKey), true);
    assert.match(certificate.subjectAltName ?? "", /DNS:localhost/);
    assert.match(certificate.subjectAltName ?? "", /IP Address:127\.0\.0\.1/);
  } finally {
    await rm(certificateDirectory, { recursive: true, force: true });
  }
});
