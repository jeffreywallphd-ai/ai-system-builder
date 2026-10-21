import { createWorkspaceId, type WorkspaceId } from "./workspace-id";

export const WORKSPACE_SUMMARY_METRICS = ["systemsComposed", "systemsPublished", "systemsUnpublished", "modelsInstalled", "modelsTrained", "imagesGenerated", "artifactsUploaded", "datasetsCreated", "ragDatabases", "markdownContextPacks", "assetsUsed", "customAssets"] as const;
export type WorkspaceSummaryMetric = typeof WORKSPACE_SUMMARY_METRICS[number];
export const WORKSPACE_SUMMARY_PAGES = {
  home: ["systemsPublished", "datasetsCreated", "modelsTrained", "customAssets"],
  systems: ["systemsComposed", "systemsPublished", "systemsUnpublished"],
  models: ["modelsInstalled", "modelsTrained"],
  "image-generation": ["imagesGenerated"],
  artifacts: ["artifactsUploaded", "datasetsCreated"],
  context: ["ragDatabases", "markdownContextPacks"],
  assets: ["assetsUsed", "customAssets"],
} as const satisfies Record<string, readonly WorkspaceSummaryMetric[]>;
export type WorkspaceSummaryPage = keyof typeof WORKSPACE_SUMMARY_PAGES;
export interface ReadWorkspaceSummaryRequest { readonly workspaceId: WorkspaceId; readonly page: WorkspaceSummaryPage; }
export type WorkspaceSummaryValue = { readonly status: "available"; readonly value: number } | { readonly status: "unavailable" };
export interface WorkspaceSummary { readonly schemaVersion: "workspace-summary-v1"; readonly workspaceId: WorkspaceId; readonly page: WorkspaceSummaryPage; readonly metrics: Partial<Record<WorkspaceSummaryMetric, WorkspaceSummaryValue>>; }

export function normalizeReadWorkspaceSummaryRequest(input: unknown): ReadWorkspaceSummaryRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid workspace summary request.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "workspaceId" && key !== "page") || typeof value.workspaceId !== "string" || typeof value.page !== "string" || !Object.prototype.hasOwnProperty.call(WORKSPACE_SUMMARY_PAGES, value.page)) throw new Error("Invalid workspace summary request.");
  return {workspaceId: createWorkspaceId(value.workspaceId), page: value.page as WorkspaceSummaryPage};
}

export function normalizeWorkspaceSummary(input: unknown, request: ReadWorkspaceSummaryRequest): WorkspaceSummary {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid workspace summary response.");
  const value = input as WorkspaceSummary;
  if (value.schemaVersion !== "workspace-summary-v1" || value.workspaceId !== request.workspaceId || value.page !== request.page || !value.metrics || typeof value.metrics !== "object" || Array.isArray(value.metrics)) throw new Error("Invalid workspace summary response.");
  const metrics: WorkspaceSummary["metrics"] = {};
  for (const key of WORKSPACE_SUMMARY_PAGES[request.page]) {
    const metric = value.metrics[key];
    if (!metric || (metric.status !== "unavailable" && (metric.status !== "available" || !Number.isSafeInteger(metric.value) || metric.value < 0))) throw new Error("Invalid workspace summary metric.");
    metrics[key] = metric.status === "available" ? {status: "available", value: metric.value} : {status: "unavailable"};
  }
  return {schemaVersion: "workspace-summary-v1", workspaceId: request.workspaceId, page: request.page, metrics};
}
