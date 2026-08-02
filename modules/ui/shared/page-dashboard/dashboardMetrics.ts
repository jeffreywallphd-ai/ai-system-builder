import { isArtifactBrowserVisible } from "../artifact-preview/artifactPreviewModel";

export type PageDashboardKind =
  | "home"
  | "systems"
  | "models"
  | "image-generation"
  | "artifacts"
  | "context"
  | "assets"
  | "settings";

export interface PageDashboardMetric {
  readonly label: string;
  readonly value: string | number;
  readonly detail?: string;
}

export interface DashboardSystemRecord {
  readonly systemId: string;
}

export interface DashboardReleaseRecord {
  readonly systemId: string;
  readonly approvedAt: string;
  readonly createdAt: string;
  readonly assetCount: number;
}

export interface DashboardArtifactRecord {
  readonly artifactFamily: string;
  readonly sourceKind?: string;
  readonly storageKey: string;
  readonly originalName?: string;
  readonly mediaType?: string;
}

export interface DashboardModelRecord {
  readonly source: string;
  readonly localFilesAvailable?: boolean;
}

export interface DashboardSettingsDefaults {
  readonly runtimeDevice: string;
  readonly globalModel: string;
}

export interface PageDashboardDataSource {
  listSystems(workspaceId: string): Promise<readonly DashboardSystemRecord[]>;
  listReleases(workspaceId: string): Promise<readonly DashboardReleaseRecord[]>;
  listDatasetIds(workspaceId: string): Promise<readonly string[]>;
  listArtifacts(
    workspaceId: string,
  ): Promise<readonly DashboardArtifactRecord[]>;
  listModels(workspaceId: string): Promise<readonly DashboardModelRecord[]>;
  listCustomAssetIds(workspaceId: string): Promise<readonly string[]>;
  readSettingsDefaults(): Promise<DashboardSettingsDefaults>;
}

export interface SystemDashboardCounts {
  readonly composed: number;
  readonly published: number;
  readonly unpublished: number;
}

export function countSystems(
  systems: readonly DashboardSystemRecord[],
  releases: readonly DashboardReleaseRecord[],
): SystemDashboardCounts {
  const publishedSystemIds = new Set(
    releases.map((release) => release.systemId),
  );
  const published = systems.filter((system) =>
    publishedSystemIds.has(system.systemId),
  ).length;
  return {
    composed: systems.length,
    published,
    unpublished: systems.length - published,
  };
}

export function countModels(models: readonly DashboardModelRecord[]) {
  return {
    installed: models.filter(
      (model) =>
        model.source !== "generated" && model.localFilesAvailable === true,
    ).length,
    trained: models.filter((model) => model.source === "generated").length,
  };
}

export function countArtifacts(artifacts: readonly DashboardArtifactRecord[]) {
  const browserArtifacts = artifacts.filter(isArtifactBrowserVisible);
  return {
    uploaded: browserArtifacts.filter(isUploadedArtifact).length,
    imagesGenerated: artifacts.filter(
      (artifact) =>
        artifact.artifactFamily === "image" &&
        (artifact.sourceKind === "generated" ||
          artifact.storageKey.includes("/generated/images/")),
    ).length,
  };
}

function isUploadedArtifact(artifact: DashboardArtifactRecord): boolean {
  if (
    artifact.sourceKind === "generated" ||
    artifact.sourceKind === "runtime" ||
    storageKeyHasSegment(artifact.storageKey, "generated")
  ) {
    return false;
  }
  return (
    artifact.sourceKind === "upload" ||
    storageKeyHasSegment(artifact.storageKey, "uploads")
  );
}

function storageKeyHasSegment(storageKey: string, segment: string): boolean {
  return storageKey.replace(/\\/g, "/").split("/").includes(segment);
}

export function countAssetsUsed(
  releases: readonly DashboardReleaseRecord[],
): number {
  const latestBySystem = new Map<string, DashboardReleaseRecord>();
  for (const release of releases) {
    const current = latestBySystem.get(release.systemId);
    if (!current || compareReleaseDates(release, current) > 0) {
      latestBySystem.set(release.systemId, release);
    }
  }
  return [...latestBySystem.values()].reduce(
    (total, release) => total + release.assetCount,
    0,
  );
}

function compareReleaseDates(
  left: DashboardReleaseRecord,
  right: DashboardReleaseRecord,
): number {
  return (
    left.approvedAt.localeCompare(right.approvedAt) ||
    left.createdAt.localeCompare(right.createdAt)
  );
}

export async function loadPageDashboardMetrics(
  kind: PageDashboardKind,
  source: PageDashboardDataSource,
  workspaceId?: string,
): Promise<readonly PageDashboardMetric[]> {
  if (kind === "settings") {
    const defaults = await source.readSettingsDefaults();
    return [
      { label: "Default Runtime Device", value: defaults.runtimeDevice },
      { label: "Default Global Model", value: defaults.globalModel },
    ];
  }

  if (!workspaceId) return [];

  if (kind === "systems") {
    const [systems, releases] = await Promise.all([
      source.listSystems(workspaceId),
      source.listReleases(workspaceId),
    ]);
    const counts = countSystems(systems, releases);
    return [
      {
        label: "Systems Composed",
        value: counts.composed,
        detail: `${counts.published} published · ${counts.unpublished} unpublished`,
      },
      { label: "Systems Published", value: counts.published },
    ];
  }

  if (kind === "models") {
    const counts = countModels(await source.listModels(workspaceId));
    return [
      { label: "Models Installed", value: counts.installed },
      { label: "Models Trained", value: counts.trained },
    ];
  }

  if (kind === "image-generation") {
    const counts = countArtifacts(await source.listArtifacts(workspaceId));
    return [{ label: "Images Generated", value: counts.imagesGenerated }];
  }

  if (kind === "artifacts") {
    const [artifacts, datasetIds] = await Promise.all([
      source.listArtifacts(workspaceId),
      source.listDatasetIds(workspaceId),
    ]);
    return [
      {
        label: "Artifacts Uploaded",
        value: countArtifacts(artifacts).uploaded,
      },
      { label: "Datasets Created", value: new Set(datasetIds).size },
    ];
  }

  if (kind === "context") {
    const artifacts = (await source.listArtifacts(workspaceId)).filter(
      isArtifactBrowserVisible,
    );
    return [
      {
        label: "RAG Databases",
        value: artifacts.filter(
          (artifact) =>
            artifact.mediaType ===
            "application/vnd.ai-system-builder.rag-database+lancedb+zip",
        ).length,
      },
      {
        label: "Markdown Context Packs",
        value: artifacts.filter(
          (artifact) =>
            artifact.mediaType ===
            "application/vnd.ai-system-builder.markdown-context-pack+zip",
        ).length,
      },
    ];
  }

  if (kind === "assets") {
    const [releases, customAssetIds] = await Promise.all([
      source.listReleases(workspaceId),
      source.listCustomAssetIds(workspaceId),
    ]);
    return [
      {
        label: "Assets Used",
        value: countAssetsUsed(releases),
        detail: "Across latest published system builds",
      },
      { label: "Custom Assets", value: new Set(customAssetIds).size },
    ];
  }

  const [systems, releases, datasetIds, models, customAssetIds] =
    await Promise.all([
      source.listSystems(workspaceId),
      source.listReleases(workspaceId),
      source.listDatasetIds(workspaceId),
      source.listModels(workspaceId),
      source.listCustomAssetIds(workspaceId),
    ]);
  return [
    {
      label: "Systems Published",
      value: countSystems(systems, releases).published,
    },
    {
      label: "Training Datasets Created",
      value: new Set(datasetIds).size,
    },
    { label: "Custom Models Trained", value: countModels(models).trained },
    { label: "Custom Assets Created", value: new Set(customAssetIds).size },
  ];
}
