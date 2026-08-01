import type { ArtifactCatalogReadPort } from "../../ports/artifact-catalog";
import type { ParquetDatasetReviewPort } from "../../ports/dataset-review";
import type {
  DatasetVersionHasherPort,
  DatasetVersionRepositoryPort,
} from "../../ports/dataset-version";
import type { ApplicationRequestContext } from "../../ports";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { ArtifactObjectStoragePort } from "../../ports/storage";
import type { WorkspaceRepository } from "../../ports/workspace";
import { DatasetVersionFinalizationService } from "../../services/dataset-version";
import {
  groupDatasetVersionsForDisplay,
  type DatasetReviewDatasetGroup,
  type DatasetReviewRowEditResult,
  type DatasetReviewPage,
  type DatasetReviewPageSize,
  type DatasetReviewRowRejectionResult,
  type DatasetVersionRecord,
} from "../../../contracts/dataset";
import {
  createDeleteArtifactRequest,
  createHasArtifactRequest,
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "../../../contracts/storage";
import {
  createWorkspaceId,
  type WorkspaceId,
} from "../../../contracts/workspace";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";

interface DatasetReviewDependencies {
  readonly repository: DatasetVersionRepositoryPort;
  readonly catalog: ArtifactCatalogReadPort;
  readonly artifacts: ArtifactObjectStoragePort;
  readonly parquet: ParquetDatasetReviewPort;
  readonly finalizer: DatasetVersionFinalizationService;
  readonly hasher: DatasetVersionHasherPort;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  readonly now?: () => string;
}

interface DatasetReviewTargetInput {
  readonly workspaceId: WorkspaceId;
  readonly artifactKey: string;
  readonly versionId?: string;
}

export class ListDatasetReviewTargetsUseCase {
  public constructor(
    private readonly dependencies: DatasetReviewDependencies,
  ) {}

  public async execute(
    input: { readonly workspaceId: WorkspaceId },
    context: ApplicationRequestContext = {},
  ): Promise<readonly DatasetReviewDatasetGroup[]> {
    await requireWorkspaceAccess(
      this.dependencies,
      input.workspaceId,
      context,
      "dataset-review.read",
    );
    const [versions, catalogResult] = await Promise.all([
      this.dependencies.repository.listVersions(input.workspaceId),
      this.dependencies.catalog.browseArtifactCatalogRecords(
        { workspaceId: input.workspaceId },
        context,
      ),
    ]);
    if (!catalogResult.ok) {
      throw new Error("Workspace datasets could not be listed.");
    }
    const versionGroups = groupDatasetVersionsForDisplay(versions);
    const versionArtifactKeys = new Set(
      versions.flatMap((version) =>
        version.artifacts.map((artifact) => String(artifact.artifactKey)),
      ),
    );
    const localAvailability = new Map<string, boolean>();
    const isLocallyAvailable = async (artifactKey: StorageArtifactKey) => {
      const key = String(artifactKey);
      const cached = localAvailability.get(key);
      if (cached !== undefined) return cached;
      const local = await this.dependencies.artifacts.hasArtifact(
        createHasArtifactRequest(artifactKey),
        context,
      );
      const available = local.ok && local.value.exists;
      localAvailability.set(key, available);
      return available;
    };
    let groups: DatasetReviewDatasetGroup[] = versionGroups
      .map((group) => ({
        groupId: `dataset:${group.datasetId}`,
        datasetId: group.datasetId,
        name: group.name,
        versions: group.versions.flatMap((entry) => {
          const artifact = selectReviewArtifact(entry.version);
          return artifact
            ? [
                {
                  versionId: entry.version.versionId,
                  label: entry.label,
                  artifactKey: artifact.artifactKey,
                  createdAt: entry.version.createdAt,
                  totalRows: entry.version.totalRows,
                  latest: entry.latest,
                },
              ]
            : [];
        }),
      }))
      .filter((group) => group.versions.length > 0);
    groups = (
      await Promise.all(
        groups.map(async (group) => ({
          ...group,
          versions: (
            await Promise.all(
              group.versions.map(async (version) =>
                (await isLocallyAvailable(version.artifactKey))
                  ? version
                  : undefined,
              ),
            )
          ).filter((version): version is NonNullable<typeof version> =>
            Boolean(version),
          ),
        })),
      )
    ).filter((group) => group.versions.length > 0);
    for (const record of catalogResult.value.records) {
      if (
        !isParquet(record.storageKey, record.mediaType) ||
        versionArtifactKeys.has(record.storageKey)
      ) {
        continue;
      }
      if (
        !(await isLocallyAvailable(
          normalizeStorageArtifactKey(record.storageKey),
        ))
      ) {
        continue;
      }
      groups.push({
        groupId: `artifact:${record.storageKey}`,
        name: record.originalName?.trim() || fileName(record.storageKey),
        versions: [
          {
            label: "1.0",
            artifactKey: normalizeStorageArtifactKey(record.storageKey),
            ...(record.createdAt ? { createdAt: record.createdAt } : {}),
            latest: true,
          },
        ],
      });
    }
    return groups.sort((left, right) => left.name.localeCompare(right.name));
  }
}

export class ReadDatasetReviewPageUseCase {
  public constructor(
    private readonly dependencies: DatasetReviewDependencies,
  ) {}

  public async execute(
    input: DatasetReviewTargetInput & {
      readonly page: number;
      readonly pageSize: DatasetReviewPageSize;
    },
    context: ApplicationRequestContext = {},
  ): Promise<DatasetReviewPage> {
    await requireWorkspaceAccess(
      this.dependencies,
      input.workspaceId,
      context,
      "dataset-review.read",
    );
    validatePage(input.page, input.pageSize);
    const target = await resolveTarget(this.dependencies, input, context);
    const content = await retrieveBytes(
      this.dependencies.artifacts,
      target.artifactKey,
      context,
    );
    const reviewed = await this.dependencies.parquet.readPage({
      workspaceId: input.workspaceId,
      content,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      artifactKey: target.artifactKey,
      ...(target.version ? { versionId: target.version.versionId } : {}),
      page: input.page,
      pageSize: input.pageSize,
      totalRows: reviewed.totalRows,
      rows: reviewed.rows,
    };
  }
}

export class RejectDatasetReviewRowUseCase {
  public constructor(
    private readonly dependencies: DatasetReviewDependencies,
  ) {}

  public async execute(
    input: DatasetReviewTargetInput & {
      readonly rowIndex: number;
      readonly rowFingerprint: `sha256:${string}`;
    },
    context: ApplicationRequestContext = {},
  ): Promise<DatasetReviewRowRejectionResult> {
    const result = await reviseDatasetReviewRow(
      this.dependencies,
      input,
      { kind: "reject" },
      context,
    );
    return {
      version: result.version,
      versionLabel: result.versionLabel,
      rejectedRowIndex: input.rowIndex,
    };
  }
}

export class EditDatasetReviewRowUseCase {
  public constructor(
    private readonly dependencies: DatasetReviewDependencies,
  ) {}

  public async execute(
    input: DatasetReviewTargetInput & {
      readonly rowIndex: number;
      readonly rowFingerprint: `sha256:${string}`;
      readonly values: Readonly<Record<string, unknown>>;
    },
    context: ApplicationRequestContext = {},
  ): Promise<DatasetReviewRowEditResult> {
    const result = await reviseDatasetReviewRow(
      this.dependencies,
      input,
      { kind: "edit", values: validateEditedRow(input.values) },
      context,
    );
    return {
      version: result.version,
      versionLabel: result.versionLabel,
      editedRowIndex: input.rowIndex,
    };
  }
}

async function reviseDatasetReviewRow(
  dependencies: DatasetReviewDependencies,
  input: DatasetReviewTargetInput & {
    readonly rowIndex: number;
    readonly rowFingerprint: `sha256:${string}`;
  },
  mutation:
    | { readonly kind: "reject" }
    | {
        readonly kind: "edit";
        readonly values: Readonly<Record<string, unknown>>;
      },
  context: ApplicationRequestContext,
): Promise<{
  version: DatasetVersionRecord;
  versionLabel: string;
}> {
  await requireWorkspaceAccess(
    dependencies,
    input.workspaceId,
    context,
    "dataset-review.write",
  );
  if (!Number.isSafeInteger(input.rowIndex) || input.rowIndex < 0) {
    throw new Error("A valid dataset row is required.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.rowFingerprint)) {
    throw new Error("The reviewed row fingerprint is invalid.");
  }
  if (!context.principalId?.trim()) {
    throw new Error("Dataset review requires an authenticated user.");
  }
  const target = await resolveTarget(dependencies, input, context);
  const sourceContent = await retrieveBytes(
    dependencies.artifacts,
    target.artifactKey,
    context,
  );
  const reviewed =
    mutation.kind === "edit"
      ? await dependencies.parquet.replaceRow({
          workspaceId: input.workspaceId,
          content: sourceContent,
          rowIndex: input.rowIndex,
          rowFingerprint: input.rowFingerprint,
          values: mutation.values,
        })
      : await dependencies.parquet.rejectRow({
          workspaceId: input.workspaceId,
          content: sourceContent,
          rowIndex: input.rowIndex,
          rowFingerprint: input.rowFingerprint,
        });
  const digest = dependencies.hasher.digest(reviewed.content);
  const reviewedKey = normalizeStorageArtifactKey(
    `dataset-versions/reviews/${digest.slice("sha256:".length)}.parquet`,
  );
  let createdArtifact = false;
  try {
    const present = await dependencies.artifacts.hasArtifact(
      createHasArtifactRequest(reviewedKey),
      context,
    );
    if (!present.ok)
      throw new Error("Revised dataset storage could not be checked.");
    if (!present.value.exists) {
      const stored = await dependencies.artifacts.storeArtifact(
        createStoreArtifactRequest(reviewed.content, {
          descriptor: {
            key: reviewedKey,
            mediaType: "application/vnd.apache.parquet",
            sizeBytes: reviewed.content.byteLength,
            checksum: {
              algorithm: "sha256",
              value: digest.slice("sha256:".length),
            },
            metadata: {
              workspaceId: input.workspaceId,
              artifactRole:
                mutation.kind === "edit"
                  ? "edited-dataset"
                  : "reviewed-dataset",
            },
          },
          overwrite: false,
        }),
        context,
      );
      if (!stored.ok) throw new Error("Revised dataset could not be stored.");
      createdArtifact = true;
    }
    const parent =
      target.version ??
      (await createImportedBaseline(
        dependencies,
        target,
        sourceContent,
        reviewed.totalRows + (mutation.kind === "reject" ? 1 : 0),
        context,
      ));
    const replacementFingerprint =
      mutation.kind === "edit"
        ? dependencies.hasher.digest(JSON.stringify(mutation.values))
        : undefined;
    const reviewFingerprint = dependencies.hasher.digest(
      JSON.stringify({
        operation: mutation.kind === "edit" ? "edit-row" : "reject-row",
        parentVersionId: parent.versionId,
        rowIndex: input.rowIndex,
        rowFingerprint: input.rowFingerprint,
        ...(replacementFingerprint ? { replacementFingerprint } : {}),
      }),
    );
    const finalized = await dependencies.finalizer.finalize(
      {
        workspaceId: String(input.workspaceId),
        ...(context.organizationId
          ? { organizationId: context.organizationId }
          : {}),
        createdBy: context.principalId,
        datasetName: parent.documentation.name,
        recipeSnapshot: {
          operation:
            mutation.kind === "edit"
              ? "dataset-row-edit"
              : "dataset-row-review",
          parentVersionId: parent.versionId,
          rowIndex: input.rowIndex,
          originalRowFingerprint: input.rowFingerprint,
          ...(replacementFingerprint ? { replacementFingerprint } : {}),
        },
        recipeImplementation: {
          id:
            mutation.kind === "edit"
              ? "builtin.dataset-row-edit"
              : "builtin.dataset-row-review",
          version: "1.0.0",
        },
        sources: parent.lineage.sources,
        artifacts: [
          {
            role: "dataset",
            artifactKey: reviewedKey,
            mediaType: "application/vnd.apache.parquet",
            sizeBytes: reviewed.content.byteLength,
            checksum: {
              algorithm: "sha256",
              value: digest.slice("sha256:".length),
            },
            rowCount: reviewed.totalRows,
          },
        ],
        quality: {
          ...parent.lineage.quality,
          reportFingerprint: reviewFingerprint,
        },
        documentation: parent.documentation,
        totalRows: reviewed.totalRows,
        createdAt: (dependencies.now ?? (() => new Date().toISOString()))(),
        parentVersionId: parent.versionId,
      },
      context,
    );
    const allVersions = await dependencies.repository.listVersions(
      input.workspaceId,
      String(finalized.version.datasetId),
    );
    const display = groupDatasetVersionsForDisplay(allVersions)[0];
    const versionLabel =
      display?.versions.find(
        (entry) => entry.version.versionId === finalized.version.versionId,
      )?.label ?? "1.1";
    return { version: finalized.version, versionLabel };
  } catch (error) {
    if (createdArtifact) {
      try {
        await dependencies.artifacts.deleteArtifact(
          createDeleteArtifactRequest(reviewedKey),
          context,
        );
      } catch {
        // Best-effort cleanup; content-addressed orphan contains no additional data.
      }
    }
    throw error;
  }
}

function validateEditedRow(values: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(values)) {
    throw new Error("Edited dataset values are required.");
  }
  const entries = Object.entries(values);
  if (entries.length === 0 || entries.length > 256) {
    throw new Error("Edited dataset values must keep the existing columns.");
  }
  if (
    entries.some(([key]) =>
      ["__proto__", "prototype", "constructor"].includes(key),
    )
  ) {
    throw new Error(
      "Edited dataset values contain an unsupported column name.",
    );
  }
  assertEditableValue(values, new Set<object>(), 0);
  let serialized: string;
  try {
    serialized = JSON.stringify(values);
  } catch {
    throw new Error("Edited dataset values must use supported JSON values.");
  }
  if (Buffer.byteLength(serialized, "utf8") > 32 * 1024) {
    throw new Error("Edited dataset values are too large.");
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertEditableValue(
  value: unknown,
  seen: Set<object>,
  depth: number,
): void {
  if (depth > 8)
    throw new Error("Edited dataset values are too deeply nested.");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Edited dataset values contain an invalid number.");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Edited dataset values must use supported JSON values.");
  }
  if (seen.has(value)) {
    throw new Error("Edited dataset values must not be circular.");
  }
  seen.add(value);
  try {
    const children = Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>);
    if (children.length > 256) {
      throw new Error("Edited dataset values contain too many items.");
    }
    children.forEach((child) => assertEditableValue(child, seen, depth + 1));
  } finally {
    seen.delete(value);
  }
}

async function createImportedBaseline(
  dependencies: DatasetReviewDependencies,
  target: ResolvedTarget,
  content: Uint8Array,
  totalRows: number,
  context: ApplicationRequestContext,
): Promise<DatasetVersionRecord> {
  const digest = dependencies.hasher.digest(content);
  const fingerprint = dependencies.hasher.digest(
    JSON.stringify({
      operation: "imported-dataset-baseline",
      artifactKey: target.artifactKey,
      digest,
    }),
  );
  const finalized = await dependencies.finalizer.finalize(
    {
      workspaceId: String(target.workspaceId),
      ...(context.organizationId
        ? { organizationId: context.organizationId }
        : {}),
      createdBy: context.principalId!,
      datasetName: target.name,
      recipeSnapshot: {
        operation: "imported-dataset-baseline",
        artifactKey: target.artifactKey,
      },
      recipeImplementation: {
        id: "builtin.imported-dataset",
        version: "1.0.0",
      },
      sources: [
        {
          sourceArtifactId: target.artifactKey,
          artifactKey: target.artifactKey,
          digest,
          mediaType: "application/vnd.apache.parquet",
        },
      ],
      artifacts: [
        {
          role: "dataset",
          artifactKey: target.artifactKey,
          mediaType: "application/vnd.apache.parquet",
          sizeBytes: content.byteLength,
          checksum: {
            algorithm: "sha256",
            value: digest.slice("sha256:".length),
          },
        },
      ],
      quality: {
        policyId: "manual-row-review",
        policyVersion: "1.0.0",
        policyFingerprint: fingerprint,
        reportFingerprint: fingerprint,
      },
      documentation: {
        name: target.name,
        summary: "Imported Parquet dataset available for row review.",
        intendedUses: ["Review and prepare training data."],
        limitations: ["Rows have not yet received a complete manual review."],
      },
      totalRows,
      createdAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    },
    context,
  );
  return finalized.version;
}

interface ResolvedTarget {
  readonly workspaceId: WorkspaceId;
  readonly artifactKey: StorageArtifactKey;
  readonly name: string;
  readonly totalRows?: number;
  readonly version?: DatasetVersionRecord;
}

async function resolveTarget(
  dependencies: DatasetReviewDependencies,
  input: DatasetReviewTargetInput,
  context: ApplicationRequestContext,
): Promise<ResolvedTarget> {
  const artifactKey = normalizeStorageArtifactKey(input.artifactKey);
  if (input.versionId) {
    const version = await dependencies.repository.readVersion(
      input.workspaceId,
      input.versionId as DatasetVersionRecord["versionId"],
    );
    const artifact = version && selectReviewArtifact(version);
    if (!version || !artifact || artifact.artifactKey !== artifactKey) {
      throw new Error("The selected dataset version was not found.");
    }
    return {
      workspaceId: input.workspaceId,
      artifactKey,
      name: version.documentation.name,
      totalRows: version.totalRows,
      version,
    };
  }
  const catalog = await dependencies.catalog.readArtifactCatalogRecord(
    { workspaceId: input.workspaceId, storageKey: artifactKey },
    context,
  );
  if (
    !catalog.ok ||
    catalog.value.record.workspaceId !== input.workspaceId ||
    !isParquet(artifactKey, catalog.value.record.mediaType)
  ) {
    throw new Error("The selected workspace Parquet artifact was not found.");
  }
  return {
    workspaceId: input.workspaceId,
    artifactKey,
    name: catalog.value.record.originalName?.trim() || fileName(artifactKey),
  };
}

function selectReviewArtifact(version: DatasetVersionRecord) {
  return version.artifacts.find(
    (artifact) =>
      artifact.role === "dataset" &&
      isParquet(artifact.artifactKey, artifact.mediaType),
  );
}

async function retrieveBytes(
  artifacts: ArtifactObjectStoragePort,
  artifactKey: StorageArtifactKey,
  context: ApplicationRequestContext,
): Promise<Uint8Array> {
  const result = await artifacts.retrieveArtifact<Uint8Array>(
    createRetrieveArtifactRequest(artifactKey),
    context,
  );
  if (
    !result.ok ||
    !(result.value.content instanceof Uint8Array) ||
    result.value.content.byteLength === 0
  ) {
    throw new Error(
      "This Parquet dataset is not available in local storage. Localize or import it again, then retry.",
    );
  }
  return result.value.content;
}

async function requireWorkspaceAccess(
  dependencies: DatasetReviewDependencies,
  workspaceId: WorkspaceId,
  context: ApplicationRequestContext,
  operation: string,
): Promise<void> {
  if (
    context.workspaceId !== undefined &&
    context.workspaceId !== workspaceId
  ) {
    throw new Error("Dataset review is not available for this workspace.");
  }
  if (!dependencies.workspaceRepository && !dependencies.workspaceAuthorization)
    return;
  const access = await resolveArtifactWorkspaceContext(
    { ...context, workspaceId },
    dependencies.workspaceRepository,
    dependencies.workspaceAuthorization
      ? {
          port: dependencies.workspaceAuthorization,
          operation,
          requiredScopes: operation.endsWith(".write")
            ? ["artifact:write"]
            : ["artifact:read"],
        }
      : undefined,
  );
  if (!access.ok)
    throw new Error("Dataset review is not available for this workspace.");
}

function validatePage(page: number, pageSize: DatasetReviewPageSize): void {
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    ![10, 25, 50].includes(pageSize)
  ) {
    throw new Error("Dataset review page settings are invalid.");
  }
}

function isParquet(key: string, mediaType?: string): boolean {
  const normalizedType = mediaType?.trim().toLowerCase();
  return (
    normalizedType === "application/x-parquet" ||
    normalizedType === "application/vnd.apache.parquet" ||
    key.toLowerCase().endsWith(".parquet")
  );
}

function fileName(key: string): string {
  return key.split(/[\\/]/).filter(Boolean).pop() ?? "Dataset";
}
