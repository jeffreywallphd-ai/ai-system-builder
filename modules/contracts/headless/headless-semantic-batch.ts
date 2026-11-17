import {
  MAX_ASSET_SLOT_CHILDREN,
  normalizeAssetVersion,
  normalizeAssetSlotId,
  type AssetConfigurationValue,
  type AssetConfigurationValues,
} from "../asset";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import {
  isSystemBuilderSystemId, normalizeSystemBuilderRevisionId,
  type SystemBuilderRevisionId, type SystemBuilderSystemId,
} from "../system-builder";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";

export const HEADLESS_MAX_SEMANTIC_EDITS = 24;

export interface HeadlessAssetPlacementTarget {
  readonly parentInstanceId: string;
  readonly slotId: string;
  readonly order: number;
}

export type HeadlessSemanticEdit =
  | ({ readonly kind: "add"; readonly instanceId: string; readonly definitionId: string; readonly version: string;
      readonly configuration: AssetConfigurationValues } & HeadlessAssetPlacementTarget)
  | { readonly kind: "configure"; readonly instanceId: string; readonly values: AssetConfigurationValues }
  | { readonly kind: "connect"; readonly bindingId: string; readonly bindingKind: "input" | "output" | "event" | "control";
      readonly sourceInstanceId: string; readonly sourcePortId: string;
      readonly targetInstanceId: string; readonly targetPortId: string }
  | ({ readonly kind: "move"; readonly instanceId: string } & HeadlessAssetPlacementTarget)
  | { readonly kind: "remove"; readonly instanceId: string };

export interface HeadlessSemanticBatchTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly workspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
  readonly baseRecordRevision: number;
  readonly baseRevisionId: SystemBuilderRevisionId;
  readonly edits: readonly HeadlessSemanticEdit[];
}

type WriteInput = HeadlessSemanticBatchTarget & { readonly previewDigest: string; readonly idempotencyKey: string };
export type HeadlessSemanticBatchRequest =
  | { readonly version: typeof HEADLESS_CONTRACT_VERSION; readonly operation: "systems.preview-edits"; readonly input: HeadlessSemanticBatchTarget }
  | { readonly version: typeof HEADLESS_CONTRACT_VERSION; readonly operation: "systems.apply-edits"; readonly input: WriteInput };

type ParseResult = { readonly ok: true; readonly request: HeadlessSemanticBatchRequest } |
  { readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.unsupported-version" };

const shared = ["hostIncarnationId", "workspaceId", "systemId", "baseRecordRevision", "baseRevisionId", "edits"];
const placement = ["parentInstanceId", "slotId", "order"];
const limits = { configDepth: 6, configKeys: 32, configArray: 64, configText: 1024 };
const forbiddenField = /^(?:password|credential|secret|access[-_.]?token|api[-_.]?key)(?:$|[._-])/i;
const passiveIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function invalid(): never { throw new Error("Invalid semantic batch."); }
function identifier(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !passiveIdentifier.test(value) ||
      value.includes("..") || hasKnownPassiveCredential(value)) return invalid();
  return value;
}

function exactVersion(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value) ||
      value.includes("..") || /^(?:latest|stable|current|head|next)$/i.test(value) ||
      hasKnownPassiveCredential(value) || normalizeAssetVersion(value) !== value) return invalid();
  return value;
}

function data(value: unknown, depth = 0): AssetConfigurationValue {
  if (depth > limits.configDepth) return invalid();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= limits.configText && !hasKnownPassiveCredential(value)) return value;
  if (Array.isArray(value) && value.length <= limits.configArray) return value.map((entry) => data(entry, depth + 1));
  return configuration(value, depth + 1);
}

function configuration(value: unknown, depth = 0): AssetConfigurationValues {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > limits.configDepth) return invalid();
  const keys = Object.keys(value);
  if (keys.length > limits.configKeys) return invalid();
  const record = readStrictPassiveRecord(value, keys);
  const result: Record<string, AssetConfigurationValue> = {};
  for (const key of keys) {
    if (key.length > 64 || forbiddenField.test(key)) return invalid();
    result[identifier(key)] = data(record[key], depth);
  }
  return result;
}

function placementTarget(record: Record<string, unknown>): HeadlessAssetPlacementTarget {
  const parentInstanceId = identifier(record.parentInstanceId);
  const slotId = identifier(record.slotId);
  const { order } = record;
  if (normalizeAssetSlotId(slotId) !== slotId || typeof order !== "number" || !Number.isInteger(order) ||
      order < 0 || order >= MAX_ASSET_SLOT_CHILDREN) return invalid();
  return { parentInstanceId, slotId, order };
}

function readEdit(value: unknown): HeadlessSemanticEdit {
  if (typeof value !== "object" || value === null || !("kind" in value)) return invalid();
  switch (value.kind) {
    case "add": {
      const input = readStrictPassiveRecord(value, ["kind", "instanceId", "definitionId", "version", "configuration", ...placement]);
      const version = exactVersion(input.version);
      return { kind: "add", instanceId: identifier(input.instanceId), definitionId: identifier(input.definitionId),
        version, configuration: configuration(input.configuration), ...placementTarget(input) };
    }
    case "configure": {
      const input = readStrictPassiveRecord(value, ["kind", "instanceId", "values"]);
      const values = configuration(input.values);
      if (!Object.keys(values).length) return invalid();
      return { kind: "configure", instanceId: identifier(input.instanceId), values };
    }
    case "connect": {
      const input = readStrictPassiveRecord(value, ["kind", "bindingId", "bindingKind",
        "sourceInstanceId", "sourcePortId", "targetInstanceId", "targetPortId"]);
      const { bindingKind } = input;
      if (bindingKind !== "input" && bindingKind !== "output" && bindingKind !== "event" && bindingKind !== "control") return invalid();
      return { kind: "connect", bindingKind, bindingId: identifier(input.bindingId),
        sourceInstanceId: identifier(input.sourceInstanceId), sourcePortId: identifier(input.sourcePortId),
        targetInstanceId: identifier(input.targetInstanceId), targetPortId: identifier(input.targetPortId) };
    }
    case "move": {
      const input = readStrictPassiveRecord(value, ["kind", "instanceId", ...placement]);
      return { kind: "move", instanceId: identifier(input.instanceId), ...placementTarget(input) };
    }
    case "remove": {
      const input = readStrictPassiveRecord(value, ["kind", "instanceId"]);
      return { kind: "remove", instanceId: identifier(input.instanceId) };
    }
    default: return invalid();
  }
}

/** Decode a bounded passive object. A parsed batch is not authorization to apply it. */
export function parseHeadlessSemanticBatchRequest(value: unknown, currentHost: HeadlessHostIncarnationId): ParseResult {
  try {
    const envelope = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (!isHeadlessHostIncarnationId(currentHost) || typeof envelope.version !== "string") return invalid();
    if (envelope.version !== HEADLESS_CONTRACT_VERSION) return { ok: false, code: "headless.unsupported-version" };
    const { operation, version } = envelope;
    if (operation !== "systems.preview-edits" && operation !== "systems.apply-edits") return invalid();
    const input = readStrictPassiveRecord(envelope.input, operation === "systems.apply-edits" ? [...shared, "previewDigest", "idempotencyKey"] : shared);
    const { hostIncarnationId, workspaceId, systemId, baseRecordRevision } = input;
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) || !isSystemBuilderSystemId(systemId) ||
        typeof baseRecordRevision !== "number" || !Number.isSafeInteger(baseRecordRevision) || baseRecordRevision <= 0 ||
        !Array.isArray(input.edits) || input.edits.length < 1 || input.edits.length > HEADLESS_MAX_SEMANTIC_EDITS) return invalid();
    const baseRevisionId = normalizeSystemBuilderRevisionId(identifier(input.baseRevisionId));
    const target = { hostIncarnationId, workspaceId, systemId, baseRecordRevision, baseRevisionId, edits: input.edits.map(readEdit) };
    if (hostIncarnationId !== currentHost) return { ok: false, code: "headless.host-changed" };
    if (operation === "systems.preview-edits") return { ok: true, request: { version, operation, input: target } };
    const { previewDigest, idempotencyKey } = input;
    if (typeof previewDigest !== "string" || previewDigest.length !== 64 || !/^[a-f0-9]{64}$/.test(previewDigest) ||
        !isHeadlessHostIncarnationId(idempotencyKey)) return invalid();
    return { ok: true, request: { version, operation, input: { ...target, previewDigest, idempotencyKey } } };
  } catch {
    return { ok: false, code: "headless.invalid-request" };
  }
}
