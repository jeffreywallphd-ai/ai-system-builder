import {
  ASSET_PLACEMENT_SCHEMA_VERSION, MAX_ASSET_PLACEMENT_DEPTH, normalizeAssetId, normalizeAssetSlotId,
  type AssetBinding, type AssetConfigurationValues, type AssetDefinition, type AssetInstance,
  type AssetPlacement, type AssetReference,
} from "../../../contracts/asset";
import type { HeadlessSemanticEdit } from "../../../contracts/headless";
import { minimumSystemBuilderSlotItems, type SystemBuilderRevision } from "../../../contracts/system-builder";
import {
  MAX_SYSTEM_BUILDER_BINDINGS, MAX_SYSTEM_BUILDER_INSTANCES, MAX_SYSTEM_BUILDER_PLACEMENT_REFERENCES,
} from "../../services/system-builder/validate-system-builder-revision.service";

type DefinitionResolver = (reference: AssetReference) => Promise<AssetDefinition | undefined>;
const provenance = { sourceKind: "ai-generated" } as const;
const secretField = /(?:secret|password|passwd|token|private[-_.]?key|credential|authorization|cookie|api[-_.]?key)/i;
const numericTokenLimits = new Set(["maxTokens", "maxNewTokens", "minTokens", "minNewTokens"]);

const instanceRef = (id: string): AssetReference => ({ kind: "asset-instance", id: normalizeAssetId(id) });
const portRef = (id: string): AssetReference => ({ kind: "asset-definition", id: normalizeAssetId(id) });
const rejected = () => new Error("Semantic edit does not match the saved composition.");

export async function prepareHeadlessEditDraft(
  revision: SystemBuilderRevision,
  edits: readonly HeadlessSemanticEdit[],
  resolve: DefinitionResolver,
) {
  if (revision.instances.length > MAX_SYSTEM_BUILDER_INSTANCES ||
      revision.bindings.length > MAX_SYSTEM_BUILDER_BINDINGS ||
      (revision.placements?.length ?? 0) > MAX_SYSTEM_BUILDER_PLACEMENT_REFERENCES) throw rejected();
  const instances = new Map(revision.instances.map((item) => [String(item.instanceId), item]));
  let placements = [...(revision.placements ?? [])];
  let bindings = [...revision.bindings];
  const roots = new Set(revision.composition.rootInstanceRefs.map((item) => String(item.id)));
  const removedIds = new Set<string>();
  const disconnectedIds = new Set<string>();
  const definitions = new Map<string, Promise<AssetDefinition>>();

  const definitionFor = async (reference: AssetReference) => {
    const key = JSON.stringify([reference.id, reference.version]);
    let value = definitions.get(key);
    if (!value) {
      value = resolve(reference).then((found) => {
        if (!found || found.definitionId !== reference.id || found.version !== reference.version) throw rejected();
        return found;
      });
      definitions.set(key, value);
    }
    return value;
  };
  const requireInstance = (id: string) => {
    const item = instances.get(id);
    if (!item) throw rejected();
    return item;
  };
  const protectedIds = new Set(roots);
  let frontier = [...roots];
  for (let depth = 0; frontier.length && depth <= MAX_ASSET_PLACEMENT_DEPTH; depth++) {
    const next: string[] = [];
    for (const parentId of frontier) {
      const children = placements.filter((edge) => edge.parentInstanceRef.id === parentId);
      if (!children.length) continue;
      const parentReference = requireInstance(parentId).definitionRef;
      const parent = await definitionFor(parentReference);
      for (const slot of parent.slots ?? []) {
        const required = minimumSystemBuilderSlotItems(revision.structure?.profile, parentReference, slot);
        const occupied = children.filter((edge) => edge.slotId === slot.slotId).sort((a, b) => a.order - b.order);
        for (const edge of occupied.slice(0, required)) {
          const child = String(edge.childInstanceRef.id);
          if (!protectedIds.has(child)) { protectedIds.add(child); next.push(child); }
        }
      }
    }
    frontier = next;
  }

  function slotChildren(parentInstanceId: string, slotId: string) {
    return placements.filter((edge) => edge.parentInstanceRef.id === parentInstanceId && edge.slotId === slotId)
      .sort((a, b) => a.order - b.order);
  }
  function replaceSlot(parentInstanceId: string, slotId: string, rows: readonly AssetPlacement[]) {
    placements = placements.filter((edge) => edge.parentInstanceRef.id !== parentInstanceId || edge.slotId !== slotId);
    placements.push(...rows.map((row, order) => ({ ...row, order })));
  }
  async function place(id: string, parentId: string, slotId: string, order: number, existing?: AssetPlacement) {
    const parent = await definitionFor(requireInstance(parentId).definitionRef);
    if (!parent.slots?.some((slot) => slot.slotId === slotId) || id === parentId) throw rejected();
    for (let ancestor: string | undefined = parentId, depth = 0; ancestor; depth++) {
      if (depth > MAX_ASSET_PLACEMENT_DEPTH || ancestor === id) throw rejected();
      ancestor = placements.find((edge) => edge.childInstanceRef.id === ancestor)?.parentInstanceRef.id;
    }
    if (existing) replaceSlot(existing.parentInstanceRef.id, existing.slotId,
      slotChildren(existing.parentInstanceRef.id, existing.slotId).filter((edge) => edge !== existing));
    const rows = slotChildren(parentId, slotId);
    if (order > rows.length) throw rejected();
    const placementId = existing?.placementId ?? `headless-placement.${id}`;
    if (placements.some((edge) => edge.placementId === placementId)) throw rejected();
    rows.splice(order, 0, {
      ...existing, schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION, placementId,
      parentInstanceRef: instanceRef(parentId), childInstanceRef: instanceRef(id),
      slotId: normalizeAssetSlotId(slotId), order, provenance: existing?.provenance ?? provenance,
    });
    replaceSlot(parentId, slotId, rows);
  }

  for (const edit of edits) {
    switch (edit.kind) {
      case "add": {
        if (instances.has(edit.instanceId) || removedIds.has(edit.instanceId)) throw rejected();
        const definitionRef = { kind: "asset-definition-version", id: normalizeAssetId(edit.definitionId), version: edit.version } as const;
        const definition = await definitionFor(definitionRef);
        validateConfigurableFields(definition, edit.configuration);
        instances.set(edit.instanceId, {
          instanceId: normalizeAssetId(edit.instanceId), definitionRef, displayName: definition.displayName,
          lifecycleStatus: "draft", provenance, selectedConfiguration: edit.configuration,
          parentCompositionRef: { kind: "asset-composition", id: normalizeAssetId(revision.composition.compositionId) },
        });
        await place(edit.instanceId, edit.parentInstanceId, edit.slotId, edit.order);
        break;
      }
      case "configure": {
        const instance = requireInstance(edit.instanceId);
        const definition = await definitionFor(instance.definitionRef);
        validateConfigurableFields(definition, edit.values);
        instances.set(edit.instanceId, { ...instance, selectedConfiguration: { ...instance.selectedConfiguration, ...edit.values } });
        break;
      }
      case "connect": {
        if (edit.sourceInstanceId === edit.targetInstanceId || bindings.some((entry) =>
          entry.bindingId === edit.bindingId ||
          (entry.bindingKind === edit.bindingKind &&
           entry.sourceRef.id === edit.sourceInstanceId && entry.sourcePortRef?.id === edit.sourcePortId &&
           entry.targetRef.id === edit.targetInstanceId && entry.targetPortRef?.id === edit.targetPortId))) throw rejected();
        const source = await definitionFor(requireInstance(edit.sourceInstanceId).definitionRef);
        const target = await definitionFor(requireInstance(edit.targetInstanceId).definitionRef);
        if (!source.ports?.some((port) => port.portId === edit.sourcePortId) ||
            !target.ports?.some((port) => port.portId === edit.targetPortId)) throw rejected();
        bindings.push({
          bindingId: normalizeAssetId(edit.bindingId), bindingKind: edit.bindingKind,
          sourceRef: instanceRef(edit.sourceInstanceId), sourcePortRef: portRef(edit.sourcePortId),
          targetRef: instanceRef(edit.targetInstanceId), targetPortRef: portRef(edit.targetPortId),
          lifecycleStatus: "draft", provenance,
        });
        break;
      }
      case "move": {
        requireInstance(edit.instanceId);
        if (protectedIds.has(edit.instanceId)) throw rejected();
        const existing = placements.find((edge) => edge.childInstanceRef.id === edit.instanceId);
        if (!existing) throw rejected();
        await place(edit.instanceId, edit.parentInstanceId, edit.slotId, edit.order, existing);
        break;
      }
      case "remove": {
        requireInstance(edit.instanceId);
        const descendants = new Set([edit.instanceId]);
        const queue = [edit.instanceId];
        while (queue.length) {
          const parent = queue.pop();
          for (const edge of placements) {
            const child = String(edge.childInstanceRef.id);
            if (edge.parentInstanceRef.id === parent && !descendants.has(child)) { descendants.add(child); queue.push(child); }
          }
        }
        if ([...descendants].some((id) => protectedIds.has(id))) throw rejected();
        for (const id of descendants) { instances.delete(id); removedIds.add(id); }
        const touched = placements.filter((edge) => descendants.has(edge.childInstanceRef.id) && !descendants.has(edge.parentInstanceRef.id));
        placements = placements.filter((edge) => !descendants.has(edge.parentInstanceRef.id) && !descendants.has(edge.childInstanceRef.id));
        for (const edge of touched) replaceSlot(edge.parentInstanceRef.id, edge.slotId, slotChildren(edge.parentInstanceRef.id, edge.slotId));
        bindings = bindings.filter((binding) => {
          if (!descendants.has(binding.sourceRef.id) && !descendants.has(binding.targetRef.id)) return true;
          disconnectedIds.add(String(binding.bindingId));
          return false;
        });
        break;
      }
    }
  }
  const resultInstances = [...instances.values()];
  return {
    instances: resultInstances, placements, bindings,
    structure: revision.structure,
    composition: {
      ...revision.composition, lifecycleStatus: "draft" as const,
      instanceRefs: resultInstances.map(({ instanceId }) => instanceRef(instanceId)),
      bindingRefs: bindings.map(({ bindingId }) => ({ kind: "asset-binding" as const, id: normalizeAssetId(bindingId) })),
      placementRefs: placements.map(({ placementId }) => ({ kind: "asset-placement" as const, id: normalizeAssetId(placementId) })),
    },
    consequences: { removedIds: [...removedIds], disconnectedIds: [...disconnectedIds] },
  };
}

function validateConfigurableFields(definition: AssetDefinition, values: AssetConfigurationValues) {
  for (const fieldId of Object.keys(values)) {
    const field = definition.configurationSchema?.fields.find((item) => item.fieldId === fieldId);
    const credentialLike = secretField.test(fieldId) &&
      !(numericTokenLimits.has(fieldId) && typeof values[fieldId] === "number");
    if (!field || credentialLike || field.uiHint?.hintKind === "hidden" ||
        field.valueKind.endsWith("-reference")) throw rejected();
  }
}
