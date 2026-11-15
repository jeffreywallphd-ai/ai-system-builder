import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import {
  isSystemBuilderSystemId, normalizeSystemBuilderRevisionId, normalizeSystemBuilderTemplateId,
  type SystemBuilderRevisionId, type SystemBuilderSystemId, type SystemBuilderTemplateId,
} from "../system-builder";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";

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

const commonFields = ["hostIncarnationId", "workspaceId", "idempotencyKey", "name"];
const savedFields = [...commonFields, "systemId", "baseRecordRevision", "baseRevisionId"];
const invalid = { ok: false, code: "headless.invalid-request" } as const;

export const HEADLESS_MAX_BUILD_PLAN_STEPS = 8;
const PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v1";
const proposalFields = ["operation", "idempotencyKey", "name", "templateId", "systemId",
  "baseRecordRevision", "baseRevisionId", "description"];

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

/** Interpret passive proposals before display or policy checks. The host supplies its own incarnation. */
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const { hostIncarnationId, workspaceId, steps } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["hostIncarnationId", "workspaceId", "steps"],
    );
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) ||
        !isWorkspaceId(workspaceId) || !Array.isArray(steps) ||
        steps.length === 0 || steps.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return invalid;
    if (hostIncarnationId !== host) return { ok: false, code: "headless.host-changed" } as const;
    const scope = { hostIncarnationId, workspaceId };
    const requests: HeadlessSystemManagementRequest[] = [];
    const keys = new Set<string>();
    const renamedSystems = new Set<SystemBuilderSystemId>();
    for (const step of steps) {
      const { operation, ...fields } = readStrictPassiveRecord(step, proposalFields);
      const decoded = parseHeadlessSystemManagementRequest({
        version: HEADLESS_CONTRACT_VERSION, operation, input: { ...scope, ...fields },
      }, host);
      if (!decoded.ok) return invalid;
      const request = decoded.request;
      if (keys.has(request.input.idempotencyKey)) return invalid;
      keys.add(request.input.idempotencyKey);
      if (request.operation !== "systems.create") {
        // A saved revision cannot be reused after a previous change to that system.
        if (renamedSystems.has(request.input.systemId)) return invalid;
        if (request.operation === "systems.rename") renamedSystems.add(request.input.systemId);
      }
      requests.push(request);
    }
    const preview = {
      version: PLAN_PREVIEW_VERSION,
      ...scope,
      approval: "required" as const,
      steps: requests.map(({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }) => ({
        operation, input, effect: "saved-system-write" as const, externalProviderCalls: 0 as const,
      })),
    };
    return { ok: true, scope, requests, preview } as const;
  } catch {
    return invalid;
  }
}
