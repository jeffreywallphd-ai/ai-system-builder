export interface ArtifactIdGenerationOptions {
  now?: () => Date;
  randomSuffix?: () => string;
}

const ARTIFACT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/;

function normalizeRawId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (!normalized) {
    throw new Error("ArtifactId must be a non-empty string.");
  }

  if (!ARTIFACT_ID_PATTERN.test(normalized)) {
    throw new Error(
      "ArtifactId may contain lowercase letters, numbers, '/', '-', '_', and '.' only.",
    );
  }

  return normalized;
}

function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class ArtifactId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static from(value: string): ArtifactId {
    return new ArtifactId(normalizeRawId(value));
  }

  public static generate(options: ArtifactIdGenerationOptions = {}): ArtifactId {
    const now = options.now ?? (() => new Date());
    const randomSuffix = options.randomSuffix ?? defaultRandomSuffix;
    const timestamp = now().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const suffix = randomSuffix().trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);

    if (!suffix) {
      throw new Error("ArtifactId random suffix must include at least one alphanumeric character.");
    }

    return ArtifactId.from(`artifacts/${timestamp}-${suffix}`);
  }

  public equals(other: ArtifactId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}
