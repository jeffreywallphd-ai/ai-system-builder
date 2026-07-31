export const WORKSPACE_STORAGE_ROOT_KINDS = [
  "host-managed",
  "custom-local",
] as const;

export type WorkspaceStorageRootKind =
  (typeof WORKSPACE_STORAGE_ROOT_KINDS)[number];

/**
 * Public/passive storage ownership descriptor. It is not a filesystem path;
 * host adapters may map storageId internally to paths later without exposing
 * those paths as normal UI-facing workspace data.
 */
export interface WorkspaceStorageRootDescriptor {
  readonly kind: WorkspaceStorageRootKind;
  readonly storageId?: string;
  readonly label?: string;
}

export function isWorkspaceStorageRootKind(
  value: unknown,
): value is WorkspaceStorageRootKind {
  return WORKSPACE_STORAGE_ROOT_KINDS.includes(value as WorkspaceStorageRootKind);
}
