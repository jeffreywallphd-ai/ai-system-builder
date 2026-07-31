import type { AssetPackageTrustVerifierPort } from "../../../application/ports/asset-package";

export interface AssetPackageSignatureVerifier {
  verify(input: {
    readonly kind: "sigstore-bundle" | "local-signature";
    readonly signerIdentity: string;
    readonly packageDigest: string;
    readonly bundle: Uint8Array;
  }): Promise<boolean>;
}

export function createAssetPackageTrustVerifier(options: {
  readonly signatures?: AssetPackageSignatureVerifier;
} = {}): AssetPackageTrustVerifierPort {
  return {
    async verify(input) {
      const issues: Array<{ severity: "warning" | "error"; code: string; message: string }> = [];
      let signatureStatus: "verified" | "unverified" | "missing" | "failed" = "missing";
      const signature = input.container.signature;
      if (signature) {
        if (signature.artifactDigest !== input.packageDigest) {
          signatureStatus = "failed";
          issues.push({ severity: "error", code: "package.signature.digest-mismatch", message: "Package signature does not cover the inspected digest." });
        } else if (!options.signatures) {
          signatureStatus = "unverified";
          issues.push({ severity: "warning", code: "package.signature.verifier-unavailable", message: "A signature is present but no approved verifier is configured." });
        } else {
          try {
            const valid = await options.signatures.verify({
              kind: signature.kind,
              signerIdentity: signature.signerIdentity,
              packageDigest: input.packageDigest,
              bundle: Buffer.from(signature.bundleBase64, "base64"),
            });
            signatureStatus = valid ? "verified" : "failed";
            if (!valid) issues.push({ severity: "error", code: "package.signature.invalid", message: "Package signature verification failed." });
          } catch {
            signatureStatus = "failed";
            issues.push({ severity: "error", code: "package.signature.verification-failed", message: "Package signature could not be verified." });
          }
        }
      }

      const provenanceStatus = verifyJsonEvidence(
        input.container.manifest.provenanceEntryPath,
        input.entries,
        (value) => evidenceContainsDigest(value, input.packageDigest),
      );
      if (provenanceStatus === "failed") {
        issues.push({ severity: "error", code: "package.provenance.invalid", message: "Package provenance is malformed or does not match the inspected digest." });
      }
      const sbomStatus = verifyJsonEvidence(
        input.container.manifest.sbomEntryPath,
        input.entries,
        (value) => isRecord(value) && (value.bomFormat === "CycloneDX" || typeof value.SPDXID === "string"),
      );
      if (sbomStatus === "failed") {
        issues.push({ severity: "error", code: "package.sbom.invalid", message: "Package SBOM is malformed or unsupported." });
      }
      return {
        signatureStatus,
        provenanceStatus,
        sbomStatus,
        ...(signature?.signerIdentity ? { signerIdentity: signature.signerIdentity } : {}),
        issues,
      };
    },
  };
}

function verifyJsonEvidence(
  path: string | undefined,
  entries: ReadonlyMap<string, Uint8Array>,
  validate: (value: unknown) => boolean,
): "verified" | "missing" | "failed" {
  if (!path) return "missing";
  const bytes = entries.get(path);
  if (!bytes) return "failed";
  try {
    return validate(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
      ? "verified"
      : "failed";
  } catch {
    return "failed";
  }
}

function evidenceContainsDigest(value: unknown, digest: string): boolean {
  if (!isRecord(value)) return false;
  return JSON.stringify(value).includes(digest.slice("sha256:".length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
