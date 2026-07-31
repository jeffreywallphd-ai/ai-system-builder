import type {
  AssetPackageContainerV1,
  AssetPackageEvidenceStatus,
  AssetPackageInspectionIssue,
} from "../../../contracts/asset-package";
import type { Sha256Digest } from "../../../contracts/asset-implementation";

export interface AssetPackageTrustVerificationResult {
  readonly signatureStatus: AssetPackageEvidenceStatus;
  readonly provenanceStatus: AssetPackageEvidenceStatus;
  readonly sbomStatus: AssetPackageEvidenceStatus;
  readonly signerIdentity?: string;
  readonly issues: readonly AssetPackageInspectionIssue[];
}

export interface AssetPackageTrustVerifierPort {
  verify(input: {
    readonly container: AssetPackageContainerV1;
    readonly packageDigest: Sha256Digest;
    readonly entries: ReadonlyMap<string, Uint8Array>;
  }): Promise<AssetPackageTrustVerificationResult>;
}
