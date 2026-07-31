export const SYSTEM_BUILDER_ID_MAX_LENGTH = 96;

export type SystemBuilderSystemId = string & {
  readonly __systemBuilderSystemIdBrand: unique symbol;
};

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const UNSAFE_LOCATOR_PATTERN = /[\\/]|\.\.|^[a-z][a-z0-9+.-]*:\/\//i;
const TOKEN_LIKE_PATTERN = /^(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|secret[_-]?|token[_-]?|api[_-]?key)/i;

export function isSystemBuilderSystemId(value: unknown): value is SystemBuilderSystemId {
  if (typeof value !== "string") return false;
  return (
    value.length > 0 &&
    value.length <= SYSTEM_BUILDER_ID_MAX_LENGTH &&
    value === value.trim() &&
    SAFE_ID_PATTERN.test(value) &&
    !UNSAFE_LOCATOR_PATTERN.test(value) &&
    !TOKEN_LIKE_PATTERN.test(value)
  );
}

export function normalizeSystemBuilderSystemId(value: string): SystemBuilderSystemId {
  const normalized = value.trim();
  if (!isSystemBuilderSystemId(normalized)) {
    const error = new Error("System Builder system id must be a non-empty, trimmed, safe identifier.");
    error.stack = undefined;
    throw error;
  }
  return normalized;
}
