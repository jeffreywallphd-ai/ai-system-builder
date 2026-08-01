import type {
  DashboardSettingsDefaults,
  PageDashboardDataSource,
} from "../../../../../../modules/ui/shared";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";
import { createDesktopArtifactBrowserClient } from "../artifact-browser/api/desktopArtifactBrowserClient";
import { createDesktopAssetAuthoringClient } from "../asset-authoring/api/desktopAssetAuthoringClient";
import { createDesktopAssetStudioClient } from "../asset-studio/api/desktopAssetStudioClient";
import { createDesktopDatasetPreparationClient } from "../dataset-preparation/api/desktopDatasetPreparationClient";
import { createDesktopModelsClient } from "../models/api/desktopModelsClient";
import { createDesktopApplicationSettingsClient } from "../settings/api/desktopApplicationSettingsClient";
import { createDesktopSystemBuildClient } from "../system-builder/api/desktopSystemBuildClient";
import { createDesktopSystemBuilderClient } from "../system-builder/api/desktopSystemBuilderClient";

const PAGE_LIMIT = 100;

export const desktopPageDashboardSource: PageDashboardDataSource = {
  async listSystems(workspaceId) {
    const result = await createDesktopSystemBuilderClient().list({
      workspaceId,
      includeArchived: false,
    });
    if (!result.ok) throw new Error("Systems unavailable.");
    return result.value.map((system) => ({
      systemId: String(system.systemId),
    }));
  },

  async listReleases(workspaceId) {
    const result = await createDesktopSystemBuildClient().listReleases({
      workspaceId,
    });
    if (!result.ok) throw new Error("Releases unavailable.");
    return result.value.map((release) => ({
      systemId: String(release.systemId),
      approvedAt: release.approvedAt,
      createdAt: release.createdAt,
      assetCount: release.lock.resolvedImplementations.length,
    }));
  },

  async listDatasetIds(workspaceId) {
    const client = createDesktopDatasetPreparationClient();
    if (!client.listReviewTargets) throw new Error("Datasets unavailable.");
    const groups = await client.listReviewTargets(workspaceId);
    return groups.flatMap((group) =>
      group.datasetId ? [String(group.datasetId)] : [],
    );
  },

  async listArtifacts(workspaceId) {
    const artifacts =
      await createDesktopArtifactBrowserClient().browseArtifacts({
        workspaceId,
      });
    return artifacts.map((artifact) => ({
      artifactFamily: artifact.artifactFamily,
      sourceKind: artifact.sourceKind,
      storageKey: String(artifact.storageKey),
      originalName: artifact.originalName,
      mediaType: artifact.mediaType,
    }));
  },

  async listModels(workspaceId) {
    const models = await createDesktopModelsClient().listModels({
      workspaceId: createWorkspaceId(workspaceId),
      limit: 500,
      includeDiscovered: false,
    });
    return models.map((model) => ({
      source: model.source,
      localFilesAvailable: model.localFilesAvailable,
    }));
  },

  async listCustomAssetIds(workspaceId) {
    const authoring = createDesktopAssetAuthoringClient();
    const studio = createDesktopAssetStudioClient();
    const ids = new Set<string>();

    let cursor: string | undefined;
    let seenCursors = new Set<string>();
    do {
      const result = await authoring.listAuthoredAssets(workspaceId, {
        status: "published",
        limit: PAGE_LIMIT,
        cursor,
      });
      if (!result.ok) throw new Error("Custom assets unavailable.");
      for (const item of result.value.items)
        ids.add(assetRefKey(item.assetReference));
      cursor = boundedNextCursor(result.value.nextCursor, seenCursors);
    } while (cursor);

    cursor = undefined;
    seenCursors = new Set<string>();
    do {
      const result = await authoring.listOverrides(workspaceId, {
        status: "active",
        limit: PAGE_LIMIT,
        cursor,
      });
      if (!result.ok) throw new Error("Custom assets unavailable.");
      for (const item of result.value.items) {
        ids.add(assetRefKey(item.customizationTarget.effectiveAssetReference));
      }
      cursor = boundedNextCursor(result.value.nextCursor, seenCursors);
    } while (cursor);

    cursor = undefined;
    seenCursors = new Set<string>();
    do {
      const result = await authoring.listDerivedCustomizations({
        workspaceId,
        status: "published",
        limit: PAGE_LIMIT,
        cursor,
      });
      if (!result.ok) throw new Error("Custom assets unavailable.");
      for (const item of result.value.items) {
        ids.add(assetRefKey(item.derivedDefinitionRef));
      }
      cursor = boundedNextCursor(result.value.nextCursor, seenCursors);
    } while (cursor);

    cursor = undefined;
    seenCursors = new Set<string>();
    do {
      const result = await studio.listAssetDrafts({
        workspaceId: createWorkspaceId(workspaceId),
        status: "published",
        limit: PAGE_LIMIT,
        cursor,
      });
      if (!result.ok) throw new Error("Custom assets unavailable.");
      for (const item of result.value.drafts)
        ids.add(assetRefKey(item.definitionRef));
      cursor = boundedNextCursor(result.value.nextCursor, seenCursors);
    } while (cursor);

    return [...ids];
  },

  async readSettingsDefaults() {
    const result = await createDesktopApplicationSettingsClient().readSettings({
      keys: ["runtime.python.defaultDevice", "models.default"],
    });
    return settingsDefaults(result.values);
  },
};

function assetRefKey(reference: {
  readonly id: unknown;
  readonly version?: string;
}) {
  return `${String(reference.id)}@${reference.version ?? "current"}`;
}

function boundedNextCursor(
  cursor: string | undefined,
  seen: Set<string>,
): string | undefined {
  if (!cursor) return undefined;
  if (seen.has(cursor) || seen.size >= 100) {
    throw new Error("Dashboard pagination was invalid.");
  }
  seen.add(cursor);
  return cursor;
}

function settingsDefaults(
  values: readonly {
    readonly key: string;
    readonly value?: string | number | boolean | object;
  }[],
): DashboardSettingsDefaults {
  const device = values.find(
    (setting) => setting.key === "runtime.python.defaultDevice",
  )?.value;
  const model = values.find(
    (setting) => setting.key === "models.default",
  )?.value;
  return {
    runtimeDevice:
      typeof device === "string" && device.trim() ? device : "Not set",
    globalModel: modelName(model),
  };
}

function modelName(value: unknown): string {
  if (!value || typeof value !== "object") return "Not set";
  const modelId = (value as { readonly modelId?: unknown }).modelId;
  return typeof modelId === "string" && modelId.trim() ? modelId : "Not set";
}
