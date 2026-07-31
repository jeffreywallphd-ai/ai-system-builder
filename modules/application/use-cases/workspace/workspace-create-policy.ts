import { createWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";

export const WORKSPACE_DISPLAY_NAME_MAX_LENGTH = 120;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const PATH_LIKE_PATTERN = /(?:^\.{1,2}$|[\\/]|\.\.|^[a-z][a-z0-9+.-]*:\/\/|^[a-zA-Z]:)/;

export interface NormalizedWorkspaceDisplayNameResult {
  readonly displayName?: string;
  readonly reason?: "required" | "too-long" | "control-character" | "path-like";
}

export function normalizeWorkspaceDisplayName(
  input: string,
): NormalizedWorkspaceDisplayNameResult {
  const displayName = input.trim();

  if (displayName.length === 0) {
    return { reason: "required" };
  }

  if (displayName.length > WORKSPACE_DISPLAY_NAME_MAX_LENGTH) {
    return { reason: "too-long" };
  }

  if (CONTROL_CHARACTER_PATTERN.test(displayName)) {
    return { reason: "control-character" };
  }

  if (PATH_LIKE_PATTERN.test(displayName)) {
    return { reason: "path-like" };
  }

  return { displayName };
}

export function normalizeWorkspaceDescription(input: string | undefined): string | undefined {
  const description = input?.trim();
  return description && description.length > 0 ? description : undefined;
}

export function defaultGenerateWorkspaceId(): WorkspaceId {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  const randomValue = randomUUID
    ? randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;

  return createWorkspaceId(`workspace.${randomValue}`);
}
