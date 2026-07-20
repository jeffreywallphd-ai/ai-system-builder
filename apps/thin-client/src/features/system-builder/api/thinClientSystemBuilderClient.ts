import type { SystemBuilderClient } from "../../../../../../modules/ui/shared/system-builder";
import type { SystemBuilderResult } from "../../../../../../modules/contracts/system-builder";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

const failure = <T>(
  message = "System Builder is unavailable.",
  code = "unavailable",
): SystemBuilderResult<T> => ({ ok: false, error: { code, message } });
async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<SystemBuilderResult<T>> {
  try {
    const response = await secureFetch(url, init);
    const envelope = parseApiEnvelope(await response.json()) as any;
    return envelope.ok
      ? { ok: true, value: envelope.value as T }
      : failure(
          envelope.error?.message ?? "The request failed.",
          envelope.error?.code ?? "internal",
        );
  } catch {
    return failure();
  }
}
const post = <T>(url: string, body: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function createThinClientSystemBuilderClient(
  baseUrl = "/api",
): SystemBuilderClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    list: (input) =>
      request(
        `${root}/systems?workspaceId=${encodeURIComponent(input.workspaceId)}&includeArchived=${input.includeArchived === true}`,
      ),
    listManagement: (input) =>
      request(`${root}/systems/manage?${managementQuery(input)}`),
    create: (input) => post(`${root}/systems/create`, input),
    listTemplates: () => request(`${root}/systems/templates`),
    createFromTemplate: (input) =>
      post(`${root}/systems/create-from-template`, input),
    readRevision: (input) =>
      request(
        `${root}/systems/revision?workspaceId=${encodeURIComponent(input.workspaceId)}&systemId=${encodeURIComponent(input.systemId)}${input.revisionId ? `&revisionId=${encodeURIComponent(input.revisionId)}` : ""}`,
      ),
    saveRevision: (input) => post(`${root}/systems/revisions/save`, input),
    archive: (input) => post(`${root}/systems/archive`, input),
    restore: (input) => post(`${root}/systems/restore`, input),
    clone: (input) => post(`${root}/systems/clone`, input),
    listRevisions: (input) =>
      request(
        `${root}/systems/revisions?workspaceId=${encodeURIComponent(input.workspaceId)}&systemId=${encodeURIComponent(input.systemId)}`,
      ),
    listComposerAssets: (input) =>
      request(`${root}/systems/composer/assets?${composerQuery(input)}`),
    previewLayoutChange: (input) =>
      post(`${root}/systems/layout-change/preview`, input),
  };
}

function composerQuery(
  input: Parameters<SystemBuilderClient["listComposerAssets"]>[0],
): string {
  const parameters = new URLSearchParams({
    workspaceId: String(input.workspaceId),
  });
  if (input.searchText) parameters.set("searchText", input.searchText);
  if (input.cursor) parameters.set("cursor", input.cursor);
  if (input.limit !== undefined) parameters.set("limit", String(input.limit));
  if (input.parentDefinitionRef) {
    parameters.set("parentDefinitionId", String(input.parentDefinitionRef.id));
    if (input.parentDefinitionRef.version) {
      parameters.set("parentVersion", input.parentDefinitionRef.version);
    }
  }
  if (input.slotId) parameters.set("slotId", String(input.slotId));
  if (input.compatibleOnly) parameters.set("compatibleOnly", "true");
  return parameters.toString();
}

function managementQuery(
  input: Parameters<SystemBuilderClient["listManagement"]>[0],
): string {
  const parameters = new URLSearchParams({
    workspaceId: String(input.workspaceId),
  });
  if (input.searchText) parameters.set("searchText", input.searchText);
  if (input.view) parameters.set("view", input.view);
  if (input.sort) parameters.set("sort", input.sort);
  if (input.cursor) parameters.set("cursor", input.cursor);
  if (input.limit !== undefined) parameters.set("limit", String(input.limit));
  return parameters.toString();
}
