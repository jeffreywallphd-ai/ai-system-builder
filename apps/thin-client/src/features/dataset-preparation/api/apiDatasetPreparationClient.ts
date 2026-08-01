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
  type DatasetQualityReviewLineId,
  type DatasetQualityReviewPage,
} from "../../../../../../modules/contracts/runtime";
import type {
  DatasetReviewDatasetGroup,
  DatasetReviewRowEditResult,
  DatasetReviewPage,
  DatasetReviewPageSize,
  DatasetReviewRowRejectionResult,
} from "../../../../../../modules/contracts/dataset";
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
    outputBaseName?: string;
  }): Promise<ApiDatasetPreparationApproveValue>;
  readPreparedReviewPage(input: {
    workspaceId: string;
    requestId: string;
    reportFingerprint: string;
    lineId: DatasetQualityReviewLineId;
    page: number;
  }): Promise<DatasetQualityReviewPage>;
  listVersions?(input: {
    workspaceId: string;
    datasetId?: string;
  }): Promise<ApiDatasetVersionListValue>;
  compareVersions?(input: {
    workspaceId: string;
    fromVersionId: string;
    toVersionId: string;
  }): Promise<ApiDatasetVersionCompareValue>;
  readReproduction?(input: {
    workspaceId: string;
    versionId: string;
  }): Promise<ApiDatasetVersionReproduceValue>;
  publishVersion?(input: {
    workspaceId: string;
    versionId: string;
    repositoryId: string;
    visibility: "private" | "public";
    createRepository?: boolean;
    publicAccessConfirmed?: true;
  }): Promise<ApiDatasetVersionPublishValue>;
  listReviewTargets?(input: {
    workspaceId: string;
  }): Promise<{ groups: readonly DatasetReviewDatasetGroup[] }>;
  readReviewPage?(input: {
    workspaceId: string;
    artifactKey: string;
    versionId?: string;
    page: number;
    pageSize: DatasetReviewPageSize;
  }): Promise<{ page: DatasetReviewPage }>;
  rejectReviewRow?(input: {
    workspaceId: string;
    artifactKey: string;
    versionId?: string;
    rowIndex: number;
    rowFingerprint: `sha256:${string}`;
  }): Promise<DatasetReviewRowRejectionResult>;
  editReviewRow?(input: {
    workspaceId: string;
    artifactKey: string;
    versionId?: string;
    rowIndex: number;
    rowFingerprint: `sha256:${string}`;
    values: Readonly<Record<string, unknown>>;
  }): Promise<DatasetReviewRowEditResult>;
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
            ...(input.outputBaseName !== undefined
              ? { outputBaseName: input.outputBaseName }
              : {}),
          }),
        },
      ),
    readPreparedReviewPage: (input) =>
      request<DatasetQualityReviewPage>(
        root +
          "/dataset-preparation/tasks/" +
          encodeURIComponent(input.requestId) +
          "/review-page?workspaceId=" +
          encodeURIComponent(input.workspaceId) +
          "&reportFingerprint=" +
          encodeURIComponent(input.reportFingerprint) +
          "&lineId=" +
          encodeURIComponent(input.lineId) +
          "&page=" +
          encodeURIComponent(String(input.page)),
      ),
    listVersions: (input) =>
      request<ApiDatasetVersionListValue>(
        root +
          "/dataset-versions?workspaceId=" +
          encodeURIComponent(input.workspaceId) +
          (input.datasetId
            ? "&datasetId=" + encodeURIComponent(input.datasetId)
            : ""),
      ),
    compareVersions: (input) =>
      request<ApiDatasetVersionCompareValue>(
        root +
          "/dataset-versions/compare?workspaceId=" +
          encodeURIComponent(input.workspaceId) +
          "&fromVersionId=" +
          encodeURIComponent(input.fromVersionId) +
          "&toVersionId=" +
          encodeURIComponent(input.toVersionId),
      ),
    readReproduction: (input) =>
      request<ApiDatasetVersionReproduceValue>(
        root +
          "/dataset-versions/" +
          encodeURIComponent(input.versionId) +
          "/reproduction?workspaceId=" +
          encodeURIComponent(input.workspaceId),
      ),
    publishVersion: (input) =>
      request<ApiDatasetVersionPublishValue>(
        root +
          "/dataset-versions/" +
          encodeURIComponent(input.versionId) +
          "/publish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: input.workspaceId,
            repositoryId: input.repositoryId,
            visibility: input.visibility,
            createRepository: input.createRepository,
            publicAccessConfirmed: input.publicAccessConfirmed,
          }),
        },
      ),
    listReviewTargets: (input) =>
      request<{ groups: readonly DatasetReviewDatasetGroup[] }>(
        root +
          "/dataset-reviews?workspaceId=" +
          encodeURIComponent(input.workspaceId),
      ),
    readReviewPage: (input) =>
      request<{ page: DatasetReviewPage }>(
        root +
          "/dataset-reviews/page?workspaceId=" +
          encodeURIComponent(input.workspaceId) +
          "&artifactKey=" +
          encodeURIComponent(input.artifactKey) +
          (input.versionId
            ? "&versionId=" + encodeURIComponent(input.versionId)
            : "") +
          "&page=" +
          encodeURIComponent(String(input.page)) +
          "&pageSize=" +
          encodeURIComponent(String(input.pageSize)),
      ),
    rejectReviewRow: (input) =>
      request<DatasetReviewRowRejectionResult>(
        root + "/dataset-reviews/rejections",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      ),
    editReviewRow: (input) =>
      request<DatasetReviewRowEditResult>(root + "/dataset-reviews/edits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  };
}
