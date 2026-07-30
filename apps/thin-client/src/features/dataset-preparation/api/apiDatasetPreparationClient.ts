import type {
  ApiDatasetPreparationCancelValue,
  ApiDatasetPreparationApproveValue,
  ApiDatasetPreparationCommand,
  ApiDatasetPreparationStartValue,
  ApiDatasetPreparationTaskReadValue,
  ApiDatasetVersionCompareValue,
  ApiDatasetVersionListValue,
  ApiDatasetVersionPublishValue,
  ApiDatasetVersionReproduceValue,
} from "../../../../../../modules/contracts/api";
import {
  normalizeDatasetPreparationGenerationCapacitySnapshot,
  type DatasetPreparationGenerationCapacitySnapshot,
} from "../../../../../../modules/contracts/runtime";
import {
  parseApiEnvelope,
  toThinClientApiError,
} from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

export interface ApiDatasetPreparationClient {
  readGenerationCapacity?(input: {
    workspaceId: string;
  }): Promise<DatasetPreparationGenerationCapacitySnapshot>;
  start(input: {
    workspaceId: string;
    command: ApiDatasetPreparationCommand;
  }): Promise<ApiDatasetPreparationStartValue>;
  read(input: {
    workspaceId: string;
    requestId: string;
  }): Promise<ApiDatasetPreparationTaskReadValue>;
  cancel(input: {
    workspaceId: string;
    requestId: string;
  }): Promise<ApiDatasetPreparationCancelValue>;
  approve(input: {
    workspaceId: string;
    requestId: string;
    reportFingerprint: string;
  }): Promise<ApiDatasetPreparationApproveValue>;
  listVersions?(input: { workspaceId: string; datasetId?: string }): Promise<ApiDatasetVersionListValue>;
  compareVersions?(input: { workspaceId: string; fromVersionId: string; toVersionId: string }): Promise<ApiDatasetVersionCompareValue>;
  readReproduction?(input: { workspaceId: string; versionId: string }): Promise<ApiDatasetVersionReproduceValue>;
  publishVersion?(input: { workspaceId: string; versionId: string; repositoryId: string; visibility: "private" | "public"; createRepository?: boolean; publicAccessConfirmed?: true }): Promise<ApiDatasetVersionPublishValue>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await secureFetch(url, init);
  const envelope = parseApiEnvelope(await response.json());
  if (!envelope.ok) {
    const error = toThinClientApiError(response.status, url, envelope as never);
    throw Object.assign(new Error(error.message), error);
  }
  return envelope.value as T;
}

export function createApiDatasetPreparationClient(
  baseUrl = "/api",
): ApiDatasetPreparationClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    readGenerationCapacity: async (input) => {
      const value = await request<unknown>(
        root +
          "/dataset-preparation/generation-capacity?workspaceId=" +
          encodeURIComponent(input.workspaceId),
      );
      const normalized =
        normalizeDatasetPreparationGenerationCapacitySnapshot(value);
      if (!normalized) {
        throw new Error("Generation capacity response payload is invalid.");
      }
      return normalized;
    },
    start: (input) =>
      request<ApiDatasetPreparationStartValue>(
        root + "/dataset-preparation/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      ),
    read: (input) =>
      request<ApiDatasetPreparationTaskReadValue>(
        root +
          "/dataset-preparation/tasks/" +
          encodeURIComponent(input.requestId) +
          "?workspaceId=" +
          encodeURIComponent(input.workspaceId),
      ),
    cancel: (input) =>
      request<ApiDatasetPreparationCancelValue>(
        root +
          "/dataset-preparation/tasks/" +
          encodeURIComponent(input.requestId) +
          "/cancel",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: input.workspaceId }),
        },
      ),
    approve: (input) =>
      request<ApiDatasetPreparationApproveValue>(
        root +
          "/dataset-preparation/tasks/" +
          encodeURIComponent(input.requestId) +
          "/approve",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: input.workspaceId,
            reportFingerprint: input.reportFingerprint,
          }),
        },
      ),
    listVersions: (input) =>
      request<ApiDatasetVersionListValue>(root + "/dataset-versions?workspaceId=" + encodeURIComponent(input.workspaceId) + (input.datasetId ? "&datasetId=" + encodeURIComponent(input.datasetId) : "")),
    compareVersions: (input) =>
      request<ApiDatasetVersionCompareValue>(root + "/dataset-versions/compare?workspaceId=" + encodeURIComponent(input.workspaceId) + "&fromVersionId=" + encodeURIComponent(input.fromVersionId) + "&toVersionId=" + encodeURIComponent(input.toVersionId)),
    readReproduction: (input) =>
      request<ApiDatasetVersionReproduceValue>(root + "/dataset-versions/" + encodeURIComponent(input.versionId) + "/reproduction?workspaceId=" + encodeURIComponent(input.workspaceId)),
    publishVersion: (input) =>
      request<ApiDatasetVersionPublishValue>(root + "/dataset-versions/" + encodeURIComponent(input.versionId) + "/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: input.workspaceId, repositoryId: input.repositoryId, visibility: input.visibility, createRepository: input.createRepository, publicAccessConfirmed: input.publicAccessConfirmed }),
      }),
  };
}
