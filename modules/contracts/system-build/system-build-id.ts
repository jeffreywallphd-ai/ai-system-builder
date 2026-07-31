const SAFE_SYSTEM_BUILD_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export type SystemBuildId = string & { readonly __systemBuildIdBrand: unique symbol };
export type SystemReleaseId = string & { readonly __systemReleaseIdBrand: unique symbol };
export type SystemBuildArtifactId = string & { readonly __systemBuildArtifactIdBrand: unique symbol };

function normalizeId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!SAFE_SYSTEM_BUILD_ID.test(normalized) || normalized.includes("..") || /[\\/]/.test(normalized)) {
    const error = new Error(`${label} must be a safe non-path identifier.`);
    error.stack = undefined;
    throw error;
  }
  return normalized as T;
}

export const normalizeSystemBuildId = (value: string) => normalizeId<SystemBuildId>(value, "System build id");
export const normalizeSystemReleaseId = (value: string) => normalizeId<SystemReleaseId>(value, "System release id");
export const normalizeSystemBuildArtifactId = (value: string) => normalizeId<SystemBuildArtifactId>(value, "System build artifact id");
