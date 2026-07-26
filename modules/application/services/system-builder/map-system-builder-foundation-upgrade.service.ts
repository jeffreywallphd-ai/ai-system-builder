import type {
  AssetBinding,
  AssetConfigurationValues,
  AssetDefinition,
  AssetInstance,
  AssetJsonValue,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import type {
  SystemBuilderComposition,
  SystemBuilderFoundationUpgradeIssue,
  SystemBuilderRevision,
  SystemBuilderStructure,
} from "../../../contracts/system-builder";
import {
  SYSTEM_BUILDER_FOUNDATION_UPGRADE_SOURCE_VERSIONS,
  SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
} from "../../../contracts/system-builder";
import {
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../asset-packs/system-packs";
import { materializeReferenceSystemTemplateStructure } from "./materialize-reference-system-template-structure.service";

const sourceDefinitionsById = definitionsById(
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map((entry) => entry.definition),
);
const targetDefinitionsById = definitionsById(
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.map((entry) => entry.definition),
);
const foundationDefinitionIds = new Set([
  ...sourceDefinitionsById.keys(),
  ...targetDefinitionsById.keys(),
]);

export interface SystemBuilderFoundationUpgradeCandidate {
  readonly composition: SystemBuilderComposition;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly structure?: SystemBuilderStructure;
  readonly placements?: readonly AssetPlacement[];
  readonly systemDefinitionRef?: AssetReference;
}

export interface SystemBuilderFoundationUpgradeMapping {
  readonly candidate: SystemBuilderFoundationUpgradeCandidate;
  readonly sourceVersion: string;
  readonly mappedInstanceCount: number;
  readonly mappedConfigurationFieldCount: number;
  readonly issues: readonly SystemBuilderFoundationUpgradeIssue[];
}

export function mapSystemBuilderFoundationUpgrade(input: {
  readonly sourceRevision: SystemBuilderRevision;
  readonly systemName: string;
  readonly systemDescription?: string;
  readonly systemDefinitionRef?: AssetReference;
  readonly actorId: string;
  readonly timestamp: string;
}): SystemBuilderFoundationUpgradeMapping {
  const issues: SystemBuilderFoundationUpgradeIssue[] = [];
  const sourceVersion = summarizeSourceVersions(input.sourceRevision.instances);
  let mappedInstanceCount = 0;
  let mappedConfigurationFieldCount = 0;

  const instances = input.sourceRevision.instances.map((instance, index) => {
    const definitionId = String(instance.definitionRef.id);
    const path = ["instances", String(index)];
    if (!foundationDefinitionIds.has(definitionId)) {
      return {
        ...clone(instance),
        ...(instance.selectedConfiguration
          ? {
              selectedConfiguration: mapConfigurationReferences(
                instance.selectedConfiguration,
                issues,
                [...path, "selectedConfiguration"],
                String(instance.instanceId),
              ),
            }
          : {}),
      };
    }
    const instanceVersion = instance.definitionRef.version;
    if (
      instance.definitionRef.kind !== "asset-definition-version" ||
      (!isSupportedSourceVersion(instanceVersion) &&
        instanceVersion !== SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION)
    ) {
      issues.push({
        code: "foundation-source-version-unsupported",
        message:
          "Every System Foundation instance must use exact version 1.0.0, 2.0.0, or an already-mapped 3.0.0 definition before this upgrade.",
        path: [...path, "definitionRef"],
        instanceId: String(instance.instanceId),
      });
      return clone(instance);
    }
    const targetDefinition = targetDefinitionsById.get(definitionId);
    if (!targetDefinition) {
      issues.push({
        code: "foundation-target-definition-missing",
        message:
          "The matching System Foundation 3.0.0 definition is unavailable.",
        path: [...path, "definitionRef"],
        instanceId: String(instance.instanceId),
      });
      return clone(instance);
    }

    if (instanceVersion !== SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION) {
      mappedInstanceCount += 1;
    }
    const selectedConfiguration: Record<string, AssetJsonValue> = {
      ...(clone(targetDefinition.defaultConfiguration ?? {}) as Record<
        string,
        AssetJsonValue
      >),
    };
    const targetFields = new Set(
      targetDefinition.configurationSchema?.fields.map(
        (field) => field.fieldId,
      ) ?? [],
    );
    for (const [fieldId, value] of Object.entries(
      instance.selectedConfiguration ?? {},
    )) {
      if (!targetFields.has(fieldId)) {
        issues.push({
          code: "foundation-configuration-field-unmapped",
          message: `The Foundation ${instanceVersion} configuration field "${fieldId}" has no 3.0.0 mapping.`,
          path: [...path, "selectedConfiguration", fieldId],
          instanceId: String(instance.instanceId),
          fieldId,
        });
        continue;
      }
      selectedConfiguration[fieldId] = mapConfigurationValue(
        value,
        issues,
        [...path, "selectedConfiguration", fieldId],
        String(instance.instanceId),
        fieldId,
      );
      mappedConfigurationFieldCount += 1;
    }
    return {
      ...clone(instance),
      definitionRef: {
        ...clone(instance.definitionRef),
        version: SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
      },
      selectedConfiguration,
      ...(instance.bindingRefs
        ? {
            bindingRefs: instance.bindingRefs.map((reference, refIndex) =>
              mapFoundationReference(
                reference,
                issues,
                [...path, "bindingRefs", String(refIndex)],
                String(instance.instanceId),
              ),
            ),
          }
        : {}),
      ...(instance.resourceRefs
        ? {
            resourceRefs: instance.resourceRefs.map((reference, refIndex) =>
              mapFoundationReference(
                reference,
                issues,
                [...path, "resourceRefs", String(refIndex)],
                String(instance.instanceId),
              ),
            ),
          }
        : {}),
    } satisfies AssetInstance;
  });

  if (
    !instances.some(
      (instance) =>
        String(instance.definitionRef.id) === "builtin.system.system" &&
        instance.definitionRef.kind === "asset-definition-version" &&
        instance.definitionRef.version ===
          SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
    )
  ) {
    issues.push({
      code: "foundation-source-missing",
      message:
        "A supported System Foundation system root is required for this upgrade.",
      path: ["instances"],
    });
  }

  const composition = mapCompositionReferences(
    input.sourceRevision.composition,
    issues,
  );
  const bindings = input.sourceRevision.bindings.map((binding, index) =>
    mapBindingReferences(binding, issues, index),
  );
  const structure = input.sourceRevision.structure
    ? {
        ...clone(input.sourceRevision.structure),
        ...(input.sourceRevision.structure.layoutPresetRef
          ? {
              layoutPresetRef: mapFoundationReference(
                input.sourceRevision.structure.layoutPresetRef,
                issues,
                ["structure", "layoutPresetRef"],
              ),
            }
          : {}),
      }
    : undefined;
  const placements = input.sourceRevision.placements
    ? clone(input.sourceRevision.placements)
    : undefined;
  const systemDefinitionRef = input.systemDefinitionRef
    ? mapFoundationReference(input.systemDefinitionRef, issues, [
        "record",
        "systemDefinitionRef",
      ])
    : undefined;

  let candidate: SystemBuilderFoundationUpgradeCandidate = {
    composition,
    instances,
    bindings,
    ...(structure ? { structure } : {}),
    ...(placements ? { placements } : {}),
    ...(systemDefinitionRef ? { systemDefinitionRef } : {}),
  };
  const isLegacyFlat =
    !input.sourceRevision.structure &&
    (!input.sourceRevision.placements ||
      input.sourceRevision.placements.length === 0);
  if (issues.length === 0 && isLegacyFlat) {
    const materialized = materializeReferenceSystemTemplateStructure({
      systemId: String(input.sourceRevision.systemId),
      name: input.systemName,
      actorId: input.actorId,
      timestamp: input.timestamp,
      materialized: {
        composition,
        description: input.systemDescription ?? "",
        instances,
        bindings,
      },
    });
    candidate = {
      composition: materialized.composition,
      instances: materialized.instances,
      bindings: materialized.bindings,
      ...(materialized.structure ? { structure: materialized.structure } : {}),
      ...(materialized.placements
        ? { placements: materialized.placements }
        : {}),
      ...(systemDefinitionRef ? { systemDefinitionRef } : {}),
    };
  }

  return {
    candidate,
    sourceVersion,
    mappedInstanceCount,
    mappedConfigurationFieldCount,
    issues,
  };
}

function mapConfigurationReferences(
  values: AssetConfigurationValues,
  issues: SystemBuilderFoundationUpgradeIssue[],
  path: readonly string[],
  instanceId: string,
): AssetConfigurationValues {
  return Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => [
      fieldId,
      mapConfigurationValue(
        value,
        issues,
        [...path, fieldId],
        instanceId,
        fieldId,
      ),
    ]),
  );
}

function mapConfigurationValue(
  value: AssetJsonValue,
  issues: SystemBuilderFoundationUpgradeIssue[],
  path: readonly string[],
  instanceId?: string,
  fieldId?: string,
): AssetJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      mapConfigurationValue(
        entry,
        issues,
        [...path, String(index)],
        instanceId,
        fieldId,
      ),
    );
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, AssetJsonValue>>;
  if (
    record.kind === "asset-definition-version" &&
    typeof record.id === "string" &&
    foundationDefinitionIds.has(record.id)
  ) {
    if (
      (!isSupportedSourceVersion(String(record.version)) &&
        record.version !== SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION) ||
      !targetDefinitionsById.has(record.id)
    ) {
      issues.push({
        code:
          isSupportedSourceVersion(String(record.version)) ||
          record.version === SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION
            ? "foundation-target-definition-missing"
            : "foundation-source-version-unsupported",
        message:
          "A nested System Foundation reference cannot be mapped exactly to version 3.0.0.",
        path,
        ...(instanceId ? { instanceId } : {}),
        ...(fieldId ? { fieldId } : {}),
      });
      return value;
    }
    return record.version === SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION
      ? { ...record }
      : {
          ...record,
          version: SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
        };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      mapConfigurationValue(entry, issues, [...path, key], instanceId, fieldId),
    ]),
  );
}

function mapFoundationReference(
  reference: AssetReference,
  issues: SystemBuilderFoundationUpgradeIssue[],
  path: readonly string[],
  instanceId?: string,
): AssetReference {
  const definitionId = String(reference.id);
  if (
    reference.kind !== "asset-definition-version" ||
    !foundationDefinitionIds.has(definitionId)
  ) {
    return clone(reference);
  }
  if (
    reference.version !== SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION &&
    !isSupportedSourceVersion(reference.version)
  ) {
    issues.push({
      code: "foundation-source-version-unsupported",
      message:
        "Every mapped System Foundation reference must use exact version 1.0.0, 2.0.0, or 3.0.0.",
      path,
      ...(instanceId ? { instanceId } : {}),
    });
    return clone(reference);
  }
  if (!targetDefinitionsById.has(definitionId)) {
    issues.push({
      code: "foundation-target-definition-missing",
      message: "The matching System Foundation 3.0.0 reference is unavailable.",
      path,
      ...(instanceId ? { instanceId } : {}),
    });
    return clone(reference);
  }
  if (reference.version === SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION) {
    return clone(reference);
  }
  return {
    ...clone(reference),
    version: SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
  };
}

function mapCompositionReferences(
  composition: SystemBuilderComposition,
  issues: SystemBuilderFoundationUpgradeIssue[],
): SystemBuilderComposition {
  return {
    ...clone(composition),
    ...(composition.dependencies
      ? {
          dependencies: composition.dependencies.map((dependency, index) => ({
            ...clone(dependency),
            ...(dependency.ref
              ? {
                  ref: mapFoundationReference(dependency.ref, issues, [
                    "composition",
                    "dependencies",
                    String(index),
                    "ref",
                  ]),
                }
              : {}),
          })),
        }
      : {}),
  };
}

function mapBindingReferences(
  binding: AssetBinding,
  issues: SystemBuilderFoundationUpgradeIssue[],
  index: number,
): AssetBinding {
  const path = ["bindings", String(index)];
  return {
    ...clone(binding),
    sourceRef: mapFoundationReference(binding.sourceRef, issues, [
      ...path,
      "sourceRef",
    ]),
    targetRef: mapFoundationReference(binding.targetRef, issues, [
      ...path,
      "targetRef",
    ]),
    ...(binding.sourcePortRef
      ? {
          sourcePortRef: mapFoundationReference(binding.sourcePortRef, issues, [
            ...path,
            "sourcePortRef",
          ]),
        }
      : {}),
    ...(binding.targetPortRef
      ? {
          targetPortRef: mapFoundationReference(binding.targetPortRef, issues, [
            ...path,
            "targetPortRef",
          ]),
        }
      : {}),
  };
}

function definitionsById(
  definitions: readonly AssetDefinition[],
): Map<string, AssetDefinition> {
  return new Map(
    definitions.map((definition) => [
      String(definition.definitionId),
      definition,
    ]),
  );
}

function isSupportedSourceVersion(value: string | undefined): boolean {
  return SYSTEM_BUILDER_FOUNDATION_UPGRADE_SOURCE_VERSIONS.some(
    (version) => version === value,
  );
}

function summarizeSourceVersions(instances: readonly AssetInstance[]): string {
  const versions = new Set(
    instances
      .filter((instance) =>
        foundationDefinitionIds.has(String(instance.definitionRef.id)),
      )
      .map((instance) => instance.definitionRef.version)
      .filter(
        (version): version is string =>
          Boolean(version) &&
          version !== SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
      ),
  );
  return versions.size === 0
    ? SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION
    : [...versions].sort().join(", ");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
