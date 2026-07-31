export const USER_LIBRARY_ID_MAX_LENGTH = 96;

export const USER_LIBRARY_ID_FORMAT_DESCRIPTION =
  "a non-empty, trimmed, URL-safe and persistence-key-safe string that is not a path, URL, drive-qualified location, shell-heavy value, or raw locator";

export type UserLibraryAssetId = string & {
  readonly __userLibraryAssetIdBrand: unique symbol;
};

export type UserLibraryAssetVersion = string & {
  readonly __userLibraryAssetVersionBrand: unique symbol;
};

export type UserLibraryLinkId = string & {
  readonly __userLibraryLinkIdBrand: unique symbol;
};

export type UserLibraryOperationId = string & {
  readonly __userLibraryOperationIdBrand: unique symbol;
};

export type UserLibraryRelationshipId = string & {
  readonly __userLibraryRelationshipIdBrand: unique symbol;
};

const USER_LIBRARY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const USER_LIBRARY_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SHELL_METACHARACTER_PATTERN = /[;&|`$<>*?()[\]{}'"!#~]/;
const URL_LIKE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DRIVE_QUALIFIED_PATTERN = /^[a-zA-Z]:/;
const TOKEN_LIKE_PATTERN = /^(?:gh[pousr]_|github_pat_|sk-[a-zA-Z0-9]|xox[baprs]-|secret[_-]?|token[_-]?|api[_-]?key)/i;

function invalidUserLibraryIdentifierMessage(kind: string): string {
  return `${kind} must be ${USER_LIBRARY_ID_FORMAT_DESCRIPTION}.`;
}

function looksLikeUnsafePathUrlOrLocator(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.startsWith(".") ||
    URL_LIKE_PATTERN.test(value) ||
    DRIVE_QUALIFIED_PATTERN.test(value) ||
    TOKEN_LIKE_PATTERN.test(value) ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    SHELL_METACHARACTER_PATTERN.test(value)
  );
}

function isSafeUserLibraryIdentifier(input: unknown): input is string {
  if (typeof input !== "string") {
    return false;
  }

  const normalized = input.trim();

  return (
    normalized.length > 0 &&
    normalized.length <= USER_LIBRARY_ID_MAX_LENGTH &&
    normalized === input &&
    USER_LIBRARY_ID_PATTERN.test(normalized) &&
    !looksLikeUnsafePathUrlOrLocator(normalized)
  );
}

function createSafeUserLibraryIdentifier(input: string, kind: string): string {
  const normalized = input.trim();

  if (!isSafeUserLibraryIdentifier(normalized)) {
    const error = new Error(invalidUserLibraryIdentifierMessage(kind));
    error.stack = undefined;
    throw error;
  }

  return normalized;
}

export function isUserLibraryAssetId(input: unknown): input is UserLibraryAssetId {
  return isSafeUserLibraryIdentifier(input);
}

export function createUserLibraryAssetId(input: string): UserLibraryAssetId {
  return createSafeUserLibraryIdentifier(input, "User-library asset id") as UserLibraryAssetId;
}

function isSafeUserLibraryVersion(input: unknown): input is string {
  if (typeof input !== "string") {
    return false;
  }

  const normalized = input.trim();

  return (
    normalized.length > 0 &&
    normalized.length <= USER_LIBRARY_ID_MAX_LENGTH &&
    normalized === input &&
    USER_LIBRARY_VERSION_PATTERN.test(normalized) &&
    !looksLikeUnsafePathUrlOrLocator(normalized)
  );
}

export function isUserLibraryAssetVersion(input: unknown): input is UserLibraryAssetVersion {
  return isSafeUserLibraryVersion(input);
}

export function createUserLibraryAssetVersion(input: string): UserLibraryAssetVersion {
  const normalized = input.trim();

  if (!isSafeUserLibraryVersion(normalized)) {
    const error = new Error(
      "User-library asset version must be a non-empty, trimmed, safe identifier-like string.",
    );
    error.stack = undefined;
    throw error;
  }

  return normalized as UserLibraryAssetVersion;
}

export function isUserLibraryLinkId(input: unknown): input is UserLibraryLinkId {
  return isSafeUserLibraryIdentifier(input);
}

export function createUserLibraryLinkId(input: string): UserLibraryLinkId {
  return createSafeUserLibraryIdentifier(input, "User-library link id") as UserLibraryLinkId;
}

export function isUserLibraryOperationId(input: unknown): input is UserLibraryOperationId {
  return isSafeUserLibraryIdentifier(input);
}

export function createUserLibraryOperationId(input: string): UserLibraryOperationId {
  return createSafeUserLibraryIdentifier(input, "User-library operation id") as UserLibraryOperationId;
}

export function isUserLibraryRelationshipId(input: unknown): input is UserLibraryRelationshipId {
  return isSafeUserLibraryIdentifier(input);
}

export function createUserLibraryRelationshipId(input: string): UserLibraryRelationshipId {
  return createSafeUserLibraryIdentifier(input, "User-library relationship id") as UserLibraryRelationshipId;
}
