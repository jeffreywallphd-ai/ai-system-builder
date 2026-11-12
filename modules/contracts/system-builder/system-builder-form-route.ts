import { normalizeAssetId, type AssetBinding, type AssetJsonValue } from "../asset";

export const SYSTEM_FORM_ROUTE_METADATA_KEY = "systemBuilderFormRoute";
export const SYSTEM_FORM_ROUTE_SCHEMA = "system-builder-form-route.v1";
export const SYSTEM_FORM_ROUTE_OPERATORS = ["equals", "not-equals", "less-than", "greater-than"] as const;
export type SystemFormRouteOperator = (typeof SYSTEM_FORM_ROUTE_OPERATORS)[number];
export type SystemFormValue = string | number | boolean;

export type SystemFormRouteCondition = {
  readonly fieldId: string;
  readonly operator: SystemFormRouteOperator;
  readonly value: SystemFormValue;
};

export interface SystemFormRoute {
  readonly fromStepId: string;
  /** A step ID continues the form; the containing form ID ends it. */
  readonly destinationId: string;
  /** Null is the fallback after evaluating ordered conditions. */
  readonly when: SystemFormRouteCondition | null;
  readonly priority: number;
}

function object(value: AssetJsonValue | undefined): Readonly<Record<string, AssetJsonValue>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, AssetJsonValue>> : undefined;
}

function safeId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  try { return value === normalizeAssetId(value); } catch { return false; }
}

export function readSystemFormRoute(binding: AssetBinding): SystemFormRoute | undefined {
  const data = object(binding.metadata?.[SYSTEM_FORM_ROUTE_METADATA_KEY]);
  if (!data || Object.keys(data).length !== 3 || data.schemaVersion !== SYSTEM_FORM_ROUTE_SCHEMA ||
      binding.bindingKind !== "control" || binding.sourceRef.kind !== "asset-instance" ||
      binding.targetRef.kind !== "asset-instance" || binding.sourceRef.version !== undefined ||
      binding.targetRef.version !== undefined || binding.sourcePortRef || binding.targetPortRef ||
      binding.constraints?.length || !safeId(binding.sourceRef.id) || !safeId(binding.targetRef.id) ||
      typeof data.priority !== "number" || !Number.isInteger(data.priority) || data.priority < 0 || data.priority > 7) return;
  const condition = object(data.when);
  if (data.when !== null && (!condition || Object.keys(condition).length !== 3 || !safeId(condition.fieldId) ||
      !SYSTEM_FORM_ROUTE_OPERATORS.some((operator) => operator === condition.operator) ||
      !((typeof condition.value === "string" && condition.value.length > 0 && condition.value.length <= 200) ||
        (typeof condition.value === "number" && Number.isFinite(condition.value)) || typeof condition.value === "boolean"))) return;
  if (data.when === null && data.priority !== 0) return;
  return { fromStepId: binding.sourceRef.id, destinationId: binding.targetRef.id, priority: data.priority,
    when: condition as SystemFormRouteCondition | undefined ?? null };
}

export function createSystemFormRouteBinding(bindingId: string, route: SystemFormRoute): AssetBinding {
  return {
    bindingId: normalizeAssetId(bindingId), bindingKind: "control", lifecycleStatus: "draft",
    sourceRef: { kind: "asset-instance", id: normalizeAssetId(route.fromStepId) },
    targetRef: { kind: "asset-instance", id: normalizeAssetId(route.destinationId) },
    metadata: {
      [SYSTEM_FORM_ROUTE_METADATA_KEY]: { schemaVersion: SYSTEM_FORM_ROUTE_SCHEMA,
        priority: route.priority, when: route.when && { ...route.when } },
    },
  };
}
