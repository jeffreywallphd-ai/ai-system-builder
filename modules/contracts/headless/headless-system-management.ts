import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import {
  isSystemBuilderSystemId, normalizeSystemBuilderRevisionId, normalizeSystemBuilderTemplateId,
  type SystemBuilderRevisionId, type SystemBuilderSystemId, type SystemBuilderTemplateId,
} from "../system-builder";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";
import { readHeadlessLocalFileSavePlanRequest, type HeadlessLocalFileSavePlanRequest } from "./headless-data-local-file";
import { readHeadlessProviderFileSavePlanRequest, type HeadlessProviderFileSavePlanRequest } from "./headless-data-provider-file";
import type { HeadlessSemanticBatchRequest } from "./headless-semantic-batch";

interface ManagementTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;
  readonly name: string;
}

interface SavedTarget extends ManagementTarget {
  readonly systemId: SystemBuilderSystemId;
  readonly baseRecordRevision: number;
  readonly baseRevisionId: SystemBuilderRevisionId;
}

export type HeadlessSystemManagementRequest =
  { readonly version: typeof HEADLESS_CONTRACT_VERSION } & (
    | { readonly operation: "systems.create"; readonly input: ManagementTarget & { readonly templateId: SystemBuilderTemplateId } }
    | { readonly operation: "systems.rename"; readonly input: SavedTarget & { readonly description?: string } }
    | { readonly operation: "systems.clone"; readonly input: SavedTarget }
  );

export type HeadlessBuildPlanRequest = HeadlessSystemManagementRequest | HeadlessLocalFileSavePlanRequest | HeadlessProviderFileSavePlanRequest;
export interface HeadlessBuildPlanCapabilities {
  readonly allowLocalFileSave: boolean;
  readonly allowProviderFileSave?: boolean;
}

/** Serialize the saved effect without the connection identity or its receipt key. */
export function serializeHeadlessMutationInput(
  request: HeadlessBuildPlanRequest | Extract<HeadlessSemanticBatchRequest, { operation: "systems.apply-edits" }>,
): string {
  const { hostIncarnationId: _host, idempotencyKey: _key, ...input } = request.input;
  return JSON.stringify({ version: request.version, operation: request.operation, input }, (_name, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}

const commonFields = ["hostIncarnationId", "workspaceId", "idempotencyKey", "name"];
const savedFields = [...commonFields, "systemId", "baseRecordRevision", "baseRevisionId"];
const invalid = { ok: false, code: "headless.invalid-request" } as const;

export const HEADLESS_MAX_BUILD_PLAN_STEPS = 8;
const PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v1";
const PROVIDER_FILE_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v3";
const LOCAL_FILE_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v2";
const proposalFields = ["operation", "idempotencyKey", "name", "templateId", "systemId",
  "baseRecordRevision", "baseRevisionId", "description", "taskId", "fileId", "taskRevision"];

/** A decoded request carries data only. The running host supplies and checks identity. */
export function parseHeadlessSystemManagementRequest(value: unknown, host: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: HeadlessSystemManagementRequest } |
  { readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.unsupported-version" } {
  try {
    const { version, operation, input: rawInput } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["version", "operation", "input"],
    );
    if (typeof version !== "string" || !isHeadlessHostIncarnationId(host)) return invalid;
    if (version !== HEADLESS_CONTRACT_VERSION) return { ok: false, code: "headless.unsupported-version" };
    if (operation !== "systems.create" && operation !== "systems.rename" && operation !== "systems.clone") return invalid;
    const input = readStrictPassiveRecord(rawInput, operation === "systems.create" ? [...commonFields, "templateId"]
      : operation === "systems.rename" ? [...savedFields, "description"] : savedFields);
    const { hostIncarnationId, workspaceId, idempotencyKey, name } = input;
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) ||
        !isHeadlessHostIncarnationId(idempotencyKey) || !boundedText(name, 120)) return invalid;
    const common = { hostIncarnationId, workspaceId, idempotencyKey, name };
    let request: HeadlessSystemManagementRequest;
    if (operation === "systems.create") {
      if (typeof input.templateId !== "string" || input.templateId.length > 128) return invalid;
      const templateId = normalizeSystemBuilderTemplateId(input.templateId);
      if (templateId !== input.templateId) return invalid;
      request = { version, operation, input: { ...common, templateId } };
    } else {
      const { systemId, baseRecordRevision, baseRevisionId: rawRevision } = input;
      if (!isSystemBuilderSystemId(systemId) || typeof baseRecordRevision !== "number" ||
          !Number.isSafeInteger(baseRecordRevision) || baseRecordRevision <= 0 || !boundedText(rawRevision, 160)) return invalid;
      const baseRevisionId = normalizeSystemBuilderRevisionId(rawRevision);
      const saved = { ...common, systemId, baseRecordRevision, baseRevisionId };
      if (operation === "systems.clone") request = { version, operation, input: saved };
      else {
        const { description } = input;
        if (description !== undefined && !boundedText(description, 1_000, true)) return invalid;
        request = { version, operation, input: { ...saved, ...(description !== undefined ? { description } : {}) } };
      }
    }
    return hostIncarnationId === host ? { ok: true, request } : { ok: false, code: "headless.host-changed" };
  } catch {
    return invalid;
  }
}

function boundedText(value: unknown, limit: number, allowLineBreaks = false): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && value === value.trim() &&
    !(allowLineBreaks ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) &&
    !hasKnownPassiveCredential(value);
}

function projectSystemPlanStep({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }:
  HeadlessSystemManagementRequest) {
  return { operation, input, effect: "saved-system-write" as const, externalProviderCalls: 0 as const };
}

function projectLocalFilePlanStep({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }:
  HeadlessLocalFileSavePlanRequest) {
  return { operation, input, effect: "save-local-source" as const, externalProviderCalls: 0 as const };
}

function projectProviderFilePlanStep({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }:
  HeadlessProviderFileSavePlanRequest) {
  return { operation, input, effect: "save-provider-source" as const, externalProviderCalls: "required" as const };
}

type PlanScope = { readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId };
type PlanPreview<V, Step> = PlanScope & {
  readonly version: V;
  readonly approval: "required";
  readonly steps: readonly Step[];
};
type SystemStep = ReturnType<typeof projectSystemPlanStep>;
type LocalFileStep = ReturnType<typeof projectLocalFilePlanStep>;
type ProviderFileStep = ReturnType<typeof projectProviderFilePlanStep>;
type SystemPreview = PlanPreview<typeof PLAN_PREVIEW_VERSION, SystemStep>;
type MixedPreview = PlanPreview<typeof LOCAL_FILE_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep> |
  PlanPreview<typeof PROVIDER_FILE_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep | ProviderFileStep>;
type PlanSuccess<Request, Preview> = { readonly ok: true; readonly scope: PlanScope; readonly requests: readonly Request[];
  readonly preview: Preview };
type PlanFailure = typeof invalid | { readonly ok: false; readonly code: "headless.host-changed" };
type SystemProposal = PlanSuccess<HeadlessSystemManagementRequest, SystemPreview>;
type MixedProposal = PlanSuccess<HeadlessBuildPlanRequest, MixedPreview>;

/** Interpret passive proposals. A host must opt in to the exact local-file effect it can enforce. */
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId): SystemProposal | PlanFailure;
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId,
  options: HeadlessBuildPlanCapabilities): SystemProposal | MixedProposal | PlanFailure;
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId,
  options?: HeadlessBuildPlanCapabilities): SystemProposal | MixedProposal | PlanFailure {
  try {
    const { hostIncarnationId, workspaceId, steps } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["hostIncarnationId", "workspaceId", "steps"],
    );
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) ||
        !isWorkspaceId(workspaceId) || !Array.isArray(steps) ||
        steps.length === 0 || steps.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return invalid;
    if (hostIncarnationId !== host) return { ok: false, code: "headless.host-changed" } as const;
    const scope = { hostIncarnationId, workspaceId };
    const requests: HeadlessBuildPlanRequest[] = [];
    const keys = new Set<string>();
    const renamedSystems = new Set<SystemBuilderSystemId>();
    const selectedUploads = new Set<string>();
    for (const step of steps) {
      const { operation, ...fields } = readStrictPassiveRecord(step, proposalFields);
      const input = { version: HEADLESS_CONTRACT_VERSION, operation, input: { ...scope, ...fields } };
      const decoded = operation === "data.save-local-source" && options?.allowLocalFileSave
        ? readHeadlessLocalFileSavePlanRequest(input, host)
        : operation === "data.save-provider-source" && options?.allowProviderFileSave
          ? readHeadlessProviderFileSavePlanRequest(input, host)
          : parseHeadlessSystemManagementRequest(input, host);
      if (!decoded.ok) return invalid;
      const request = decoded.request;
      if (keys.has(request.input.idempotencyKey)) return invalid;
      keys.add(request.input.idempotencyKey);
      if (request.operation === "data.save-local-source" || request.operation === "data.save-provider-source") {
        // Saving an item advances the shared upload revision. A later step
        // must start from the new revision and a new app selection.
        if (selectedUploads.has(request.input.taskId)) return invalid;
        selectedUploads.add(request.input.taskId);
      } else if (request.operation !== "systems.create") {
        // A saved revision cannot be reused after a previous change to that system.
        if (renamedSystems.has(request.input.systemId)) return invalid;
        if (request.operation === "systems.rename") renamedSystems.add(request.input.systemId);
      }
      requests.push(request);
    }
    const previewScope = { ...scope, approval: "required" as const };
    if (requests.some(request => request.operation === "data.save-provider-source")) return { ok: true, scope, requests, preview: {
      version: PROVIDER_FILE_PLAN_PREVIEW_VERSION, ...previewScope,
      steps: requests.map(request => request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
        : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request)),
    } };
    const localRequests = requests.filter((request): request is HeadlessSystemManagementRequest | HeadlessLocalFileSavePlanRequest =>
      request.operation !== "data.save-provider-source");
    if (selectedUploads.size) return { ok: true, scope, requests: localRequests, preview: {
      version: LOCAL_FILE_PLAN_PREVIEW_VERSION, ...previewScope,
      steps: localRequests.map(request => request.operation === "data.save-local-source"
        ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request)),
    } };
    const systems = requests.filter((request): request is HeadlessSystemManagementRequest =>
      request.operation !== "data.save-local-source" && request.operation !== "data.save-provider-source");
    return { ok: true, scope, requests: systems, preview: {
      version: PLAN_PREVIEW_VERSION, ...previewScope, steps: systems.map(projectSystemPlanStep),
    } };
  } catch {
    return invalid;
  }
}
