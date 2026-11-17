import { captureDerivedTargetList, captureDerivedTargetRead } from "./capture-derived-customization-requests";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import { requireWorkspaceAssetAccess } from "./workspace-asset-access.service";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import type { AuthoredAssetRepositoryPort } from "../../ports/asset-authoring";
import type { AssetDefinition } from "../../../contracts/asset";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationBackingResourceRepositoryPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import {
  ASSET_CUSTOMIZATION_PROTECTED_FIELDS,
  normalizeExactAssetDefinitionReference,
  type AssetDerivedCustomizationEligibility,
  type AssetDerivedCustomizationResourceCounts,
  type AssetDerivedCustomizationTargetDetail,
  type AssetDerivedCustomizationTargetSummary,
  type ListAssetDerivedCustomizationTargetsQuery,
  type ListAssetDerivedCustomizationTargetsResult,
  type ReadAssetDerivedCustomizationTargetQuery,
} from "../../../contracts/asset-authoring";
import {
  normalizeAssetImplementationBackingResourceBundle,
  normalizeAssetImplementationReleaseId,
  type AssetImplementationBackingResourceFileDescriptor,
  type AssetImplementationBackingResourceOrigin,
  type AssetImplementationBackingResourceRecord,
  type AssetImplementationRelease,
} from "../../../contracts/asset-implementation";

const EMPTY_COUNTS: AssetDerivedCustomizationResourceCounts = {
  total: 0,
  editable: 0,
  frontendStructure: 0,
  frontendStyle: 0,
  backendLogic: 0,
  other: 0,
};

type CatalogDefinitionSummary = Pick<AssetDefinition, "displayName" | "description" | "assetType" | "assetFamily">;

export class AssetDerivedCustomizationTargetCatalogService {
  public constructor(
    private readonly dependencies: {
      readonly workspaceAccess: WorkspaceAssetAccessPort;
      readonly definitions: AssetDefinitionRepositoryPort;
      readonly implementations: AssetImplementationRepositoryPort;
      readonly backingResources: AssetImplementationBackingResourceRepositoryPort;
      readonly artifacts: AssetImplementationArtifactPort;
      readonly authoredAssets?: AuthoredAssetRepositoryPort;
    },
  ) {}

  public async list(
    query: ListAssetDerivedCustomizationTargetsQuery,
  ): Promise<ListAssetDerivedCustomizationTargetsResult> {
    query = captureDerivedTargetList(query);
    await requireWorkspaceAssetAccess(this.dependencies.workspaceAccess, query.workspaceId, "asset-authoring.customization-target.list", "asset:read");
    const limit = normalizeLimit(query.limit);
    const offset = normalizeCursor(query.cursor);
    const [releases, backingRecords, authored] = await Promise.all([
      this.dependencies.implementations.listReleases(query.workspaceId),
      this.dependencies.backingResources.list(query.workspaceId),
      this.dependencies.authoredAssets
        ? this.dependencies.authoredAssets.listAuthoredAssetRecords({
            workspaceId: query.workspaceId,
            limit: 100,
          })
        : Promise.resolve({ records: [] as const }),
    ]);
    const revokedReleaseIds = await this.readRevokedReleaseIds(releases);
    const backingByRelease = new Map(
      backingRecords.map((record) => [String(record.releaseId), record]),
    );
    const definitions = await this.readDefinitionSnapshot(releases);
    const releaseTargets = releases.map((release) =>
        this.summaryForRelease(
          query.workspaceId,
          release,
          backingByRelease.get(String(release.releaseId)),
          revokedReleaseIds,
          definitions.get(exactDefinitionKey(release.definitionRef)),
        ),
    );
    const authoredTargets: AssetDerivedCustomizationTargetSummary[] =
      authored.records.map((record) => ({
        workspaceId: query.workspaceId,
        sourceKind: "authored-asset",
        definitionRef: record.assetReference,
        displayName:
          typeof record.editableValues["display-name"] === "string"
            ? record.editableValues["display-name"]
            : String(record.authoredAssetId),
        description:
          typeof record.editableValues.description === "string"
            ? record.editableValues.description
            : "Authored asset without an exact implementation base.",
        eligibility: ineligible(
          "exact-base-required",
          "Publish an exact definition and implementation backing resource before deriving a layered customization.",
        ),
        resources: EMPTY_COUNTS,
      }));
    const text = query.text?.trim().toLowerCase();
    const targets = [...releaseTargets, ...authoredTargets]
      .filter(
        (target) =>
          (!query.sourceKind || target.sourceKind === query.sourceKind) &&
          (query.eligibility === undefined ||
            query.eligibility === "all" ||
            (query.eligibility === "eligible" && target.eligibility.eligible) ||
            (query.eligibility === "ineligible" &&
              !target.eligibility.eligible)) &&
          (!text || targetText(target).includes(text)),
      )
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          String(left.definitionRef.id).localeCompare(
            String(right.definitionRef.id),
          ),
      );
    return {
      targets: targets.slice(offset, offset + limit),
      ...(offset + limit < targets.length
        ? { nextCursor: String(offset + limit) }
        : {}),
    };
  }

  public async read(
    query: ReadAssetDerivedCustomizationTargetQuery,
  ): Promise<AssetDerivedCustomizationTargetDetail | undefined> {
    query = captureDerivedTargetRead(query);
    await requireWorkspaceAssetAccess(this.dependencies.workspaceAccess, query.workspaceId, "asset-authoring.customization-target.read", "asset:read");
    const definitionRef = normalizeExactAssetDefinitionReference(
      query.definitionRef,
    );
    const releaseId = normalizeAssetImplementationReleaseId(
      query.implementationReleaseId,
    );
    const release = await this.dependencies.implementations.readRelease(
      releaseId,
      query.workspaceId,
    );
    if (!release || !sameReference(release.definitionRef, definitionRef)) {
      return undefined;
    }
    const backing = await this.dependencies.backingResources.readByRelease(
      releaseId,
      query.workspaceId,
    );
    const revokedReleaseIds = await this.readRevokedReleaseIds([release]);
    const definition =
      await this.dependencies.definitions.getDefinition(definitionRef);
    const summary = this.summaryForRelease(
      query.workspaceId,
      release,
      backing,
      revokedReleaseIds,
      definition,
    );
    if (!definition || !backing) {
      return {
        ...summary,
        ...(definition ? { definition } : {}),
        backingResources: [],
        protectedFields: ASSET_CUSTOMIZATION_PROTECTED_FIELDS,
      };
    }
    try {
      const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
        backing.artifactWorkspaceId,
        backing.artifact,
      );
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(stored);
      const bundle = normalizeAssetImplementationBackingResourceBundle(
        JSON.parse(raw),
      );
      const descriptors = new Map(
        backing.files.map((file) => [file.path.toLowerCase(), file]),
      );
      const resources = bundle.files.map((file) => {
        const descriptor = descriptors.get(file.path.toLowerCase());
        if (!descriptor || !matchesDescriptor(descriptor, file)) {
          throw new Error("Backing resource descriptor mismatch.");
        }
        return { ...descriptor, content: file.content };
      });
      if (resources.length !== backing.files.length) {
        throw new Error("Backing resource descriptor mismatch.");
      }
      return {
        ...summary,
        definition,
        baseSourceSnapshotId: backing.sourceSnapshotId,
        baseSourceArtifact: backing.artifact,
        backingResources: resources,
        protectedFields: ASSET_CUSTOMIZATION_PROTECTED_FIELDS,
      };
    } catch {
      return {
        ...summary,
        definition,
        baseSourceSnapshotId: backing.sourceSnapshotId,
        baseSourceArtifact: backing.artifact,
        eligibility: ineligible(
          "backing-resources-unreadable",
          "Implementation backing resources could not be verified and read.",
        ),
        backingResources: [],
        protectedFields: ASSET_CUSTOMIZATION_PROTECTED_FIELDS,
      };
    }
  }

  private async readDefinitionSnapshot(releases: readonly AssetImplementationRelease[]) {
    // Per-operation exact identities only. Hundreds of single reads each load
    // the whole collection and can exhaust a managed persistence connection pool.
    const references = [...new Map(releases.map(release => {
      const reference = normalizeExactAssetDefinitionReference(release.definitionRef);
      return [exactDefinitionKey(reference), reference] as const;
    })).values()];
    const snapshot = new Map<string, CatalogDefinitionSummary | undefined>();
    const capture = (reference: AssetImplementationRelease["definitionRef"], definition: AssetDefinition | undefined) => {
      if (definition !== undefined && (!definition || definition.definitionId !== reference.id || definition.version !== reference.version)) throw new Error("Customization definition snapshot is invalid.");
      // Own the consumed primitive fields before the next repository wait.
      snapshot.set(exactDefinitionKey(reference), definition === undefined ? undefined : {
        displayName: definition.displayName, description: definition.description,
        assetType: definition.assetType, assetFamily: definition.assetFamily,
      });
    };
    for (let offset = 0; offset < references.length; offset += 250) {
      const batch = references.slice(offset, offset + 250);
      if (!this.dependencies.definitions.getDefinitions) {
        // Compatibility ports retain one in-flight read, and capture each result
        // before another read can change a borrowed definition object.
        for (const reference of batch) capture(reference, await this.dependencies.definitions.getDefinition(reference));
        continue;
      }
      const values = await this.dependencies.definitions.getDefinitions(batch);
      if (!Array.isArray(values) || values.length !== batch.length) throw new Error("Customization definition snapshot is invalid.");
      batch.forEach((reference, index) => {
        const slot = Object.getOwnPropertyDescriptor(values, String(index));
        if (!slot || !("value" in slot)) throw new Error("Customization definition snapshot is invalid.");
        capture(reference, slot.value as AssetDefinition | undefined);
      });
    }
    return snapshot;
  }

  private summaryForRelease(
    workspaceId: ListAssetDerivedCustomizationTargetsQuery["workspaceId"],
    release: AssetImplementationRelease,
    backing: AssetImplementationBackingResourceRecord | undefined,
    revokedReleaseIds: ReadonlySet<string> | undefined,
    definition: CatalogDefinitionSummary | undefined,
  ): AssetDerivedCustomizationTargetSummary {
    const eligibility = !definition
      ? ineligible(
          "definition-unavailable",
          "The exact asset definition is unavailable.",
        )
      : revokedReleaseIds === undefined
        ? ineligible(
            "implementation-unavailable",
            "Implementation revocation status is unavailable.",
          )
        : revokedReleaseIds.has(String(release.releaseId))
          ? ineligible(
              "implementation-unavailable",
              "The exact implementation release is revoked.",
            )
          : release.status !== "published"
            ? ineligible(
                "implementation-unavailable",
                "The exact implementation release is not published.",
              )
            : !backing
              ? ineligible(
                  "backing-resources-unavailable",
                  "This implementation does not expose a customization backing resource.",
                )
              : eligible();
    return {
      workspaceId,
      sourceKind: sourceKind(backing?.origin, release),
      definitionRef: release.definitionRef,
      implementationReleaseId: release.releaseId,
      displayName: definition?.displayName ?? String(release.definitionRef.id),
      description:
        definition?.description ?? "Exact definition content is unavailable.",
      ...(definition
        ? {
            assetType: definition.assetType,
            assetFamily: definition.assetFamily,
          }
        : {}),
      implementationVersion: release.version,
      trustLevel: release.trustLevel,
      eligibility,
      resources: counts(backing?.files ?? []),
    };
  }

  private async readRevokedReleaseIds(
    releases: readonly AssetImplementationRelease[],
  ): Promise<ReadonlySet<string> | undefined> {
    if (releases.length === 0) return new Set();
    try {
      const revocations =
        await this.dependencies.implementations.listRevocations(
          releases.map((release) => release.releaseId),
        );
      return new Set(
        revocations.map((revocation) => String(revocation.releaseId)),
      );
    } catch {
      return undefined;
    }
  }
}

function exactDefinitionKey(reference: AssetImplementationRelease["definitionRef"]): string {
  return JSON.stringify([reference.kind, reference.id, reference.version ?? null]);
}

function sourceKind(
  origin: AssetImplementationBackingResourceOrigin | undefined,
  release: AssetImplementationRelease,
): AssetDerivedCustomizationTargetSummary["sourceKind"] {
  if (origin === "system-foundation" || !release.workspaceId) {
    return "system-owned-asset";
  }
  if (origin === "derived-customization") return "customized-asset";
  if (origin === "authored") return "authored-asset";
  return "workspace-imported-asset";
}

function counts(
  files: readonly AssetImplementationBackingResourceFileDescriptor[],
): AssetDerivedCustomizationResourceCounts {
  return {
    total: files.length,
    editable: files.filter((file) => file.editable).length,
    frontendStructure: files.filter(
      (file) => file.role === "frontend-structure",
    ).length,
    frontendStyle: files.filter((file) => file.role === "frontend-style")
      .length,
    backendLogic: files.filter((file) => file.role === "backend-logic").length,
    other: files.filter((file) => file.role === "other").length,
  };
}

function ineligible(
  code: Exclude<AssetDerivedCustomizationEligibility["code"], "eligible">,
  message: string,
): AssetDerivedCustomizationEligibility {
  return { eligible: false, code, message };
}

function eligible(): AssetDerivedCustomizationEligibility {
  return { eligible: true, code: "eligible", message: "Ready to customize." };
}

function normalizeLimit(value: number | undefined): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), 100)
    : 50;
}

function normalizeCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) throw new Error("Customization cursor is invalid.");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset))
    throw new Error("Customization cursor is invalid.");
  return offset;
}

function targetText(target: AssetDerivedCustomizationTargetSummary): string {
  return [
    target.displayName,
    target.description,
    target.definitionRef.id,
    target.definitionRef.version,
    target.sourceKind,
    target.assetType,
    target.assetFamily,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function sameReference(
  left: { id: unknown; version?: string },
  right: { id: unknown; version?: string },
): boolean {
  return left.id === right.id && left.version === right.version;
}

function matchesDescriptor(
  descriptor: AssetImplementationBackingResourceFileDescriptor,
  file: { path: string; role: string; mediaType: string; content: string },
): boolean {
  return (
    descriptor.path === file.path &&
    descriptor.role === file.role &&
    descriptor.mediaType === file.mediaType &&
    descriptor.sizeCharacters === file.content.length
  );
}
