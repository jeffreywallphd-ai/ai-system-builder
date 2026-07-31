export const ORGANIZATION_ID_MAX_LENGTH = 96;

export const ORGANIZATION_ID_FORMAT_DESCRIPTION =
  "a non-empty, trimmed, URL-safe and persistence-key-safe identifier";

export type OrganizationId = string & {
  readonly __organizationIdBrand: unique symbol;
};

const ORGANIZATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const TOKEN_LIKE_PATTERN = /^(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|secret[_-]?|token[_-]?)/i;

export function isOrganizationId(value: unknown): value is OrganizationId {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= ORGANIZATION_ID_MAX_LENGTH &&
    value === value.trim() &&
    ORGANIZATION_ID_PATTERN.test(value) &&
    !value.includes("..") &&
    !TOKEN_LIKE_PATTERN.test(value);
}

export function createOrganizationId(value: string): OrganizationId {
  const normalized = value.trim();
  if (!isOrganizationId(normalized)) {
    const error = new Error(
      `Organization id must be ${ORGANIZATION_ID_FORMAT_DESCRIPTION}.`,
    );
    error.stack = undefined;
    throw error;
  }
  return normalized as OrganizationId;
}
