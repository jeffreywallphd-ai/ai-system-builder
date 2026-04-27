import {
  normalizeStorageBackingReference,
  type StorageBackingReference,
} from "./storage-backing-reference";

export const ARTIFACT_STORAGE_BINDING_ROLES = [
  "primary",
  "replica",
  "published",
  "imported-source",
] as const;

export type ArtifactStorageBindingRole = (typeof ARTIFACT_STORAGE_BINDING_ROLES)[number];

export interface ArtifactStorageBinding {
  artifactId: string;
  backing: StorageBackingReference;
  role: ArtifactStorageBindingRole;
  createdAt?: string;
}

export function isArtifactStorageBindingRole(value: string): value is ArtifactStorageBindingRole {
  return ARTIFACT_STORAGE_BINDING_ROLES.includes(value as ArtifactStorageBindingRole);
}

export function normalizeArtifactStorageBinding(
  binding: ArtifactStorageBinding,
): ArtifactStorageBinding {
  const artifactId = binding.artifactId.trim();
  const role = binding.role.trim().toLowerCase();
  const createdAt = binding.createdAt?.trim();

  if (artifactId.length < 1) {
    throw new Error("Artifact storage binding artifactId must be a non-empty string.");
  }

  if (!isArtifactStorageBindingRole(role)) {
    throw new Error(
      `Artifact storage binding role must be one of ${ARTIFACT_STORAGE_BINDING_ROLES.join(", ")}. Received "${binding.role}".`,
    );
  }

  return {
    artifactId,
    backing: normalizeStorageBackingReference(binding.backing),
    role,
    createdAt: createdAt && createdAt.length > 0 ? createdAt : undefined,
  };
}
