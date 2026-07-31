import { createHash } from "node:crypto";
import type { DatasetVersionHasherPort } from "../../../application/ports/dataset-version";
import { normalizeDatasetVersionDigest } from "../../../contracts/dataset";

export function createSha256DatasetVersionHasher(): DatasetVersionHasherPort {
  return {
    digest(content) {
      return normalizeDatasetVersionDigest(
        `sha256:${createHash("sha256").update(content).digest("hex")}`,
      );
    },
  };
}
