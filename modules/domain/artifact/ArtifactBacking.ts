import {
  decodeArtifactRepoBackingLocator,
  type ArtifactStorageBinding,
  type ArtifactStorageBindingRole,
  type StorageBackingReference,
  type StorageKind,
  type StorageProviderId,
} from "../../contracts/storage";

export interface ArtifactBackingVerification {
  exists: boolean;
  verifiedAt?: string;
}

export interface ArtifactRepoBackingTarget {
  provider: StorageProviderId;
  repository: string;
  path: string;
  revision?: string;
}

export interface ArtifactBackingProps {
  kind: StorageKind;
  provider: StorageProviderId;
  locator: string;
  role: ArtifactStorageBindingRole;
  createdAt?: string;
  revision?: string;
  target?: ArtifactRepoBackingTarget;
  verification?: ArtifactBackingVerification;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeTarget(
  target: ArtifactRepoBackingTarget | undefined,
  provider: StorageProviderId,
): ArtifactRepoBackingTarget | undefined {
  if (!target) {
    return undefined;
  }

  return {
    provider: normalizeRequiredText(target.provider, "target.provider").toLowerCase(),
    repository: normalizeRequiredText(target.repository, "target.repository"),
    path: normalizeRequiredText(target.path, "target.path"),
    revision: normalizeOptionalText(target.revision),
  };
}

function validateRoleForKind(role: ArtifactStorageBindingRole, kind: StorageKind): void {
  if ((role === "published" || role === "imported-source") && kind !== "artifact-repo") {
    throw new Error(`Artifact backing role "${role}" requires kind "artifact-repo".`);
  }
}

export class ArtifactBacking {
  public readonly kind: StorageKind;
  public readonly provider: StorageProviderId;
  public readonly locator: string;
  public readonly role: ArtifactStorageBindingRole;
  public readonly createdAt?: string;
  public readonly revision?: string;
  public readonly target?: ArtifactRepoBackingTarget;
  public readonly verification?: ArtifactBackingVerification;

  private constructor(props: ArtifactBackingProps) {
    this.kind = normalizeRequiredText(props.kind, "kind") as StorageKind;
    this.provider = normalizeRequiredText(props.provider, "provider").toLowerCase();
    this.locator = normalizeRequiredText(props.locator, "locator");
    this.role = normalizeRequiredText(props.role, "role").toLowerCase() as ArtifactStorageBindingRole;
    this.createdAt = normalizeOptionalText(props.createdAt);
    this.revision = normalizeOptionalText(props.revision);
    this.target = normalizeTarget(props.target, this.provider);
    this.verification = props.verification
      ? {
        exists: props.verification.exists,
        verifiedAt: normalizeOptionalText(props.verification.verifiedAt),
      }
      : undefined;

    validateRoleForKind(this.role, this.kind);
  }

  public static from(props: ArtifactBackingProps): ArtifactBacking {
    return new ArtifactBacking(props);
  }

  public static fromStorageBinding(binding: ArtifactStorageBinding): ArtifactBacking {
    const backing = binding.backing;
    return ArtifactBacking.from({
      kind: backing.kind,
      provider: backing.provider,
      locator: backing.locator,
      revision: backing.revision,
      target: backing.target
        ? {
          provider: backing.target.provider,
          repository: backing.target.repository,
          path: backing.target.path ?? decodeArtifactRepoBackingLocator(backing.locator).path,
          revision: backing.target.revision,
        }
        : undefined,
      verification: backing.verification,
      role: binding.role,
      createdAt: binding.createdAt,
    });
  }

  public toStorageBindingBacking(): StorageBackingReference {
    return {
      kind: this.kind,
      provider: this.provider,
      locator: this.locator,
      revision: this.revision,
      ...(this.target
        ? {
          target: {
            provider: this.target.provider,
            repository: this.target.repository,
            path: this.target.path,
            revision: this.target.revision,
          },
        }
        : {}),
      ...(this.verification
        ? {
          verification: {
            exists: this.verification.exists,
            verifiedAt: this.verification.verifiedAt,
          },
        }
        : {}),
    };
  }

  public toStorageBinding(artifactId: string): ArtifactStorageBinding {
    return {
      artifactId,
      role: this.role,
      createdAt: this.createdAt,
      backing: this.toStorageBindingBacking(),
    };
  }

  public sameLogicalBackingAs(other: ArtifactBacking): boolean {
    const left = this.normalizedIdentityParts();
    const right = other.normalizedIdentityParts();
    return left.join("|") === right.join("|");
  }

  public sameRoleAndBackingAs(other: ArtifactBacking): boolean {
    return this.role === other.role && this.sameLogicalBackingAs(other);
  }

  public withVerification(verification: ArtifactBackingVerification, createdAt?: string): ArtifactBacking {
    const resolvedTarget = this.resolvedTarget();
    return ArtifactBacking.from({
      kind: this.kind,
      provider: this.provider,
      locator: this.locator,
      role: this.role,
      revision: this.revision,
      target: resolvedTarget,
      verification,
      createdAt: createdAt ?? this.createdAt,
    });
  }

  public withCreatedAt(createdAt: string): ArtifactBacking {
    const resolvedTarget = this.resolvedTarget();
    return ArtifactBacking.from({
      kind: this.kind,
      provider: this.provider,
      locator: this.locator,
      role: this.role,
      revision: this.revision,
      target: resolvedTarget,
      verification: this.verification,
      createdAt,
    });
  }

  public resolvedTarget(): ArtifactRepoBackingTarget | undefined {
    if (this.target) {
      return this.target;
    }

    if (this.kind !== "artifact-repo") {
      return undefined;
    }

    // Fallback decode for legacy bindings only. New writes should carry
    // structured target data on backing.target.
    try {
      const decoded = decodeArtifactRepoBackingLocator(this.locator);
      return {
        provider: this.provider,
        repository: decoded.repository,
        path: decoded.path,
        revision: this.revision,
      };
    } catch {
      return undefined;
    }
  }

  private normalizedIdentityParts(): [string, string, string, string, string] {
    const target = this.resolvedTarget();
    return [
      this.kind,
      this.provider,
      target?.repository ?? "",
      target?.path ?? this.locator,
      target?.revision ?? this.revision ?? "",
    ];
  }
}
