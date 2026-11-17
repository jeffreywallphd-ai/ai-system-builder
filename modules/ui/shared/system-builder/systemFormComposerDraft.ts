import {
  MAX_ASSET_PLACEMENT_DEPTH,
  type AssetInstance,
  type AssetReference,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import type { SystemComposerDraft } from "./systemComposerDraft";

export const FORM_COMPOSER_FOUNDATION_VERSION = "3.0.0";
export const FORM_COMPOSER_FOUNDATION_ASSET_IDS = {
  page: "builtin.layout.page.single",
  section: "builtin.ui.section",
  form: "builtin.form.form",
  step: "builtin.form.field-group",
} as const;

type FormAssetRole = keyof typeof FORM_COMPOSER_FOUNDATION_ASSET_IDS;
export interface SystemFormDraftEntry {
  readonly form: AssetInstance;
  readonly page?: AssetInstance;
  readonly region?: AssetInstance;
  readonly steps: readonly AssetInstance[];
}

function hasFoundationIdentity(instance: AssetInstance, role: FormAssetRole): boolean {
  return instance.definitionRef.kind === "asset-definition-version" &&
    instance.definitionRef.id === FORM_COMPOSER_FOUNDATION_ASSET_IDS[role] &&
    instance.definitionRef.version === FORM_COMPOSER_FOUNDATION_VERSION;
}

export function readSystemForms(
  draft: SystemComposerDraft,
  catalog: readonly SystemBuilderComposerAsset[],
  roots?: readonly AssetReference[],
): readonly SystemFormDraftEntry[] {
  const instances = new Map(draft.instances.map((item) => [String(item.instanceId), item]));
  const parents = new Map(draft.placements.map((edge) => [String(edge.childInstanceRef.id), edge]));
  const definitions = new Map(catalog.map((asset) => [`${asset.definitionId}@${asset.version}`, asset]));
  const pageDefinitions = new Set(catalog.filter((asset) => asset.builtIn &&
    asset.layoutRole === "page-layout" && asset.version === FORM_COMPOSER_FOUNDATION_VERSION)
    .map((asset) => asset.definitionId));
  const rootIds = new Set(roots?.filter((root) => root.kind === "asset-instance").map((root) => String(root.id)) ??
    draft.instances.filter((item) => item.definitionRef.kind === "asset-definition-version" &&
      item.definitionRef.id === "builtin.system.system" && item.definitionRef.version === FORM_COMPOSER_FOUNDATION_VERSION)
      .map((item) => String(item.instanceId)));
  const stepsByForm = new Map<string, { readonly order: number; readonly step: AssetInstance }[]>();
  for (const edge of draft.placements) {
    if (edge.slotId !== "fields") continue;
    const step = instances.get(String(edge.childInstanceRef.id));
    if (!step || !hasFoundationIdentity(step, "step")) continue;
    const parentId = String(edge.parentInstanceRef.id);
    const steps = stepsByForm.get(parentId) ?? [];
    steps.push({ order: edge.order, step });
    stepsByForm.set(parentId, steps);
  }
  const entries: SystemFormDraftEntry[] = [];
  for (const form of draft.instances) {
    if (!hasFoundationIdentity(form, "form")) continue;
    let parentId = parents.get(String(form.instanceId))?.parentInstanceRef.id;
    const region = parentId ? instances.get(parentId) : undefined;
    let page: AssetInstance | undefined;
    for (let depth = 0; parentId && depth < MAX_ASSET_PLACEMENT_DEPTH; depth++) {
      const parent = instances.get(parentId);
      if (!parent) break;
      if (!page && parent.definitionRef.kind === "asset-definition-version" &&
          parent.definitionRef.version === FORM_COMPOSER_FOUNDATION_VERSION &&
          pageDefinitions.has(String(parent.definitionRef.id))) {
        page = parent;
      }
      if (rootIds.has(parentId)) {
        const steps = (stepsByForm.get(String(form.instanceId)) ?? []).sort((left, right) => left.order - right.order).map(({step}) => step);
        entries.push({ form, page, region, steps });
        break;
      }
      parentId = parents.get(parentId)?.parentInstanceRef.id;
    }
  }
  function placementPath(pageId: string): readonly number[] {
    const positions: number[] = [];
    let edge = parents.get(pageId);
    for (let depth = 0; edge && depth < MAX_ASSET_PLACEMENT_DEPTH; depth++) {
      const parent = instances.get(String(edge.parentInstanceRef.id));
      const definition = parent && definitions.get(`${parent.definitionRef.id}@${parent.definitionRef.version}`);
      const slotId = edge.slotId;
      const slotIndex = definition?.slots.findIndex((slot) => slot.slotId === slotId) ?? -1;
      positions.unshift(slotIndex >= 0 ? slotIndex : Number.MAX_SAFE_INTEGER, edge.order);
      edge = parents.get(String(edge.parentInstanceRef.id));
    }
    return positions;
  }
  const paths = new Map(entries.map(({form}) => [form.instanceId, placementPath(String(form.instanceId))]));
  return entries.sort((left, right) => {
    const a = paths.get(left.form.instanceId)!;
    const b = paths.get(right.form.instanceId)!;
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const offset = a[index]! - b[index]!;
      if (offset) return offset;
    }
    return a.length - b.length || left.form.instanceId.localeCompare(right.form.instanceId);
  });
}
