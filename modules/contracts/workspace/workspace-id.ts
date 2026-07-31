export const WORKSPACE_ID_MAX_LENGTH = 96;

export const WORKSPACE_ID_FORMAT_DESCRIPTION =
  "a non-empty, trimmed, URL-safe and persistence-key-safe string that is not a path, URL, drive-qualified location, shell-heavy value, or raw locator";

export type WorkspaceId = string & { readonly __workspaceIdBrand: unique symbol };

const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SHELL_METACHARACTER_PATTERN = /[;&|`$<>*?()[\]{}'"!#~]/;
const URL_LIKE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DRIVE_QUALIFIED_PATTERN = /^[a-zA-Z]:/;
const TOKEN_LIKE_PATTERN = /^(?:gh[pousr]_|github_pat_|sk-[a-zA-Z0-9]|xox[baprs]-|secret[_-]?|token[_-]?)/i;

function invalidWorkspaceIdMessage(): string {
  return `Workspace id must be ${WORKSPACE_ID_FORMAT_DESCRIPTION}.`;
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

export function isWorkspaceId(input: unknown): input is WorkspaceId {
  if (typeof input !== "string") {
    return false;
  }

  const normalized = input.trim();

  return (
    normalized.length > 0 &&
    normalized.length <= WORKSPACE_ID_MAX_LENGTH &&
    normalized === input &&
    WORKSPACE_ID_PATTERN.test(normalized) &&
    !looksLikeUnsafePathUrlOrLocator(normalized)
  );
}

export function createWorkspaceId(input: string): WorkspaceId {
  const normalized = input.trim();

  if (!isWorkspaceId(normalized)) {
    const error = new Error(invalidWorkspaceIdMessage());
    error.stack = undefined;
    throw error;
  }

  return normalized as WorkspaceId;
}
