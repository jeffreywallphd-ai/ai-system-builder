/** Integrity for authorized staged sources, independently of version storage. */
export interface DatasetPreparationSourceHasherPort {
  /** Canonical algorithm-prefixed SHA256; implementations must not change bytes. */
  digest(content: Uint8Array): `sha256:${string}`;
}
