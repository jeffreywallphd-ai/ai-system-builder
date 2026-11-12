import {
  MAX_ASSET_PLACEMENT_DEPTH,
  MAX_ASSET_PLACEMENTS_PER_COMPOSITION,
  normalizeAssetId,
  type AssetInstance,
  type AssetReference,
  type AssetSlotDefinition,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import {
  addSystemComposerAsset,
  type SystemComposerDraft,
  type SystemComposerDraftResult,
} from "./systemComposerDraft";

export const FORM_COMPOSER_FOUNDATION_VERSION = "3.0.0";
export const FORM_COMPOSER_FOUNDATION_ASSET_IDS = {
  page: "builtin.layout.page.single",
  section: "builtin.ui.section",
  form: "builtin.form.form",
  step: "builtin.form.field-group",
} as const;

type FormAssetRole = keyof typeof FORM_COMPOSER_FOUNDATION_ASSET_IDS;
type FormAssets = Readonly<Record<FormAssetRole, SystemBuilderComposerAsset>>;

interface CreateFormInput {
  readonly name: string;
  readonly compositionId: string;
  readonly rootInstanceId: string;
  readonly instanceIds: Readonly<Record<FormAssetRole, string>>;
  readonly existingPageInstanceId?: string;
  readonly assets: FormAssets;
  readonly catalog: readonly SystemBuilderComposerAsset[];
}

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

function acceptsExactDefinition(slot: AssetSlotDefinition, child: SystemBuilderComposerAsset): boolean {
  return slot.acceptedDefinitionRefs?.some((reference) => reference.kind === "asset-definition-version" &&
    reference.id === child.definitionRef.id && reference.version === child.version) === true;
}

function accepts(slot: AssetSlotDefinition, child: SystemBuilderComposerAsset): boolean {
  return slot.acceptedAssetTypes?.includes(child.assetType) === true ||
    slot.acceptedAssetFamilies?.includes(child.assetFamily) === true ||
    acceptsExactDefinition(slot, child);
}

export function createSystemFormDraft(draft: SystemComposerDraft, input: CreateFormInput): SystemComposerDraftResult {
  const name = input.name.trim();
  if (!name || name.length > 200) return { ok: false, message: "Enter a form name of 1 to 200 characters." };
  const preset = draft.structure?.layoutPresetRef;
  if (draft.structure?.profile !== "interactive" || preset?.kind !== "asset-definition-version" ||
      preset.version !== FORM_COMPOSER_FOUNDATION_VERSION) {
    return { ok: false, message: "Choose an interactive system with a current Foundation layout." };
  }
  const addedCount = input.existingPageInstanceId ? 3 : 4;
  if (draft.placements.length + addedCount > MAX_ASSET_PLACEMENTS_PER_COMPOSITION ||
      draft.instances.length + addedCount > MAX_ASSET_PLACEMENTS_PER_COMPOSITION + 1) {
    return { ok: false, message: "This system has no space for a new form." };
  }
  const roles = Object.keys(FORM_COMPOSER_FOUNDATION_ASSET_IDS) as FormAssetRole[];
  const instanceIds = roles.map((role) => input.instanceIds[role]);
  try {
    if (new Set(instanceIds).size !== roles.length || instanceIds.some((id) => normalizeAssetId(id) !== id)) {
      return { ok: false, message: "Unique form asset IDs are required." };
    }
  } catch {
    return { ok: false, message: "Unique form asset IDs are required." };
  }
  if (roles.some((role) => {
    const asset = input.assets[role];
    // Unscoped catalog reads have not evaluated a target slot. The exact
    // shell, page, and parent slots are checked below for the proposed placements.
    return !asset.builtIn || asset.compatibility.status === "incompatible" ||
      asset.definitionId !== FORM_COMPOSER_FOUNDATION_ASSET_IDS[role] ||
      asset.definitionRef.kind !== "asset-definition-version" ||
      asset.definitionRef.id !== asset.definitionId ||
      asset.version !== FORM_COMPOSER_FOUNDATION_VERSION || asset.definitionRef.version !== asset.version;
  })) {
    return { ok: false, message: "A required Foundation form asset is unavailable." };
  }
  const shellEdge = draft.placements.find((edge) =>
    edge.parentInstanceRef.id === input.rootInstanceId && edge.slotId === "application-shell");
  const shell = draft.instances.find((item) => item.instanceId === shellEdge?.childInstanceRef.id);
  const shellDefinition = input.catalog.find((asset) => asset.builtIn && asset.layoutRole === "application-shell" &&
    asset.definitionId === preset.id && asset.version === preset.version);
  if (shell?.definitionRef.kind !== "asset-definition-version" || shell.definitionRef.id !== preset.id ||
      shell.definitionRef.version !== preset.version || !shellDefinition) {
    return { ok: false, message: "The current application shell is unavailable." };
  }
  const { page, section, form, step } = input.assets;
  const existingPage = input.existingPageInstanceId;
  const existingPlacement = existingPage ? draft.placements.find((edge) =>
    edge.parentInstanceRef.id === shell.instanceId && edge.childInstanceRef.id === existingPage) : undefined;
  const slot = shellDefinition.slots.find((candidate) => acceptsExactDefinition(candidate, page) &&
    (existingPage ? existingPlacement?.slotId === candidate.slotId :
      draft.placements.filter((edge) => edge.parentInstanceRef.id === shell.instanceId &&
        edge.slotId === candidate.slotId).length < candidate.cardinality.maxItems));
  if (!slot) return { ok: false, message: "The selected application layout has no available page region." };
  if (existingPage && (!draft.instances.some((item) => item.instanceId === existingPage && hasFoundationIdentity(item, "page")) ||
      draft.placements.some((edge) => edge.parentInstanceRef.id === existingPage))) {
    return { ok: false, message: "The new system does not have an empty Foundation page." };
  }

  const items = [
    { role: "page", asset: page, parentId: String(shell.instanceId), slotId: slot.slotId, label: name },
    { role: "section", asset: section, parentId: existingPage ?? input.instanceIds.page, slotId: "content", label: "Form content", parent: page },
    { role: "form", asset: form, parentId: input.instanceIds.section, slotId: "content", label: name, parent: section },
    { role: "step", asset: step, parentId: input.instanceIds.form, slotId: "fields", label: "Page 1", parent: form },
  ] as const;
  let current = draft;
  const labels = new Map<string, { name: string; title?: string }>();
  for (const item of items) {
    if (item.role === "page" && existingPage) continue;
    if ("parent" in item && !item.parent.slots.some((candidate) => candidate.slotId === item.slotId &&
        candidate.cardinality.maxItems > 0 && accepts(candidate, item.asset))) {
      return { ok: false, message: "The required form assets cannot be placed together." };
    }
    const instanceId = input.instanceIds[item.role];
    const added = addSystemComposerAsset(current, {
      asset: item.asset, compositionId: input.compositionId,
      parentInstanceId: item.parentId, slotId: item.slotId, instanceId,
    });
    if (!added.ok) return added;
    current = added.value;
    labels.set(instanceId, {
      name: item.label,
      ...(item.role === "form" || item.role === "step" ? { title: item.label } : {}),
    });
  }
  return { ok: true, value: {
    ...current,
    instances: current.instances.map((item) => {
      const label = labels.get(String(item.instanceId));
      if (!label) return item;
      return { ...item, displayName: label.name, ...(label.title ? { selectedConfiguration: { title: label.title } } : {}) };
    }),
  } };
}
