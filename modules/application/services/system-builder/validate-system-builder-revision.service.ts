import type {
  AssetBinding,
  AssetDefinition,
  AssetInstance,
  AssetPort,
  AssetReference,
  AssetValidationIssue,
} from "../../../contracts/asset";
import type {
  SystemBuilderRevision,
  SystemBuilderValidationResult,
} from "../../../contracts/system-builder";
import type { AssetDefinitionVersionReaderPort } from "../../ports/asset-implementation";
import {
  deriveAssetValidationStatus,
  validateAssetBinding,
  validateAssetComposition,
  validateAssetInstance,
} from "../asset";
import { validateSystemBuilderStructure } from "./validate-system-builder-structure.service";

const MAX_ISSUES = 200;
export const MAX_SYSTEM_BUILDER_INSTANCES = 513;
export const MAX_SYSTEM_BUILDER_BINDINGS = 1_024;
export const MAX_SYSTEM_BUILDER_PLACEMENT_REFERENCES = 512;

const CYCLE_SENSITIVE_BINDING_KINDS = new Set([
  "control",
  "dependency",
  "runtime",
  "adapter",
]);

export class ValidateSystemBuilderRevisionService {
  public constructor(
    private readonly definitionReader: AssetDefinitionVersionReaderPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    revision: Pick<
      SystemBuilderRevision,
      "composition" | "instances" | "bindings" | "structure" | "placements"
    >,
  ): Promise<SystemBuilderValidationResult> {
    const boundsIssue = revisionBoundsIssue(revision);
    if (boundsIssue) {
      return {
        status: "invalid",
        issues: [boundsIssue],
        validatedAt: this.now(),
      };
    }

    const issues: AssetValidationIssue[] = [];
    const instancesById = uniqueMap(
      revision.instances,
      (item) => String(item.instanceId),
      "instance",
      issues,
    );
    const bindingsById = uniqueMap(
      revision.bindings,
      (item) => String(item.bindingId),
      "binding",
      issues,
    );
    const definitionsById = await this.loadExactDefinitions(
      revision.instances,
      issues,
    );
    const context = { definitionsById, instancesById, bindingsById };

    append(
      issues,
      validateAssetComposition(revision.composition, context).issues,
      ["composition"],
    );
    revision.instances.forEach((instance, index) =>
      append(issues, validateAssetInstance(instance, context).issues, [
        "instances",
        String(index),
      ]),
    );
    revision.bindings.forEach((binding, index) =>
      append(issues, validateAssetBinding(binding, context).issues, [
        "bindings",
        String(index),
      ]),
    );

    validateCompositionMembership(
      revision.composition.instanceRefs,
      instancesById,
      "instance",
      issues,
    );
    validateCompositionMembership(
      revision.composition.bindingRefs ?? [],
      bindingsById,
      "binding",
      issues,
    );
    validateInstanceParents(
      revision.composition.compositionId,
      revision.instances,
      issues,
    );
    validateBindingEndpoints(revision.bindings, instancesById, issues);
    validatePortCardinality(
      revision.bindings,
      instancesById,
      definitionsById,
      issues,
    );
    validateDependencyCycles(revision.bindings, instancesById, issues);
    validateSystemBuilderStructure(
      revision,
      definitionsById,
      instancesById,
      issues,
    );

    const boundedIssues = issues.slice(0, MAX_ISSUES);
    if (issues.length > MAX_ISSUES) {
      boundedIssues.push({
        severity: "warning",
        category: "composition",
        message: `Validation diagnostics were limited to ${MAX_ISSUES} issues.`,
      });
    }
    return {
      status: deriveAssetValidationStatus(boundedIssues),
      issues: boundedIssues,
      validatedAt: this.now(),
    };
  }

  private async loadExactDefinitions(
    instances: readonly AssetInstance[],
    issues: AssetValidationIssue[],
  ): Promise<Map<string, AssetDefinition>> {
    const definitions = new Map<string, AssetDefinition>();
    for (const [index, instance] of instances.entries()) {
      const reference = instance.definitionRef;
      if (reference.kind !== "asset-definition-version" || !reference.version) {
        issues.push({
          severity: "error",
          category: "identity",
          message:
            "System instances must pin an exact asset-definition version.",
          assetRef: instanceReference(instance),
          path: ["instances", String(index), "definitionRef"],
        });
        continue;
      }
      const definition =
        await this.definitionReader.readExactDefinition(reference);
      if (
        !definition ||
        String(definition.version) !== String(reference.version)
      ) {
        issues.push({
          severity: "error",
          category: "requirement",
          message:
            "The exact asset definition version is not available in this workspace.",
          assetRef: instanceReference(instance),
          path: ["instances", String(index), "definitionRef"],
        });
        continue;
      }
      definitions.set(String(definition.definitionId), definition);
    }
    return definitions;
  }
}

function validateInstanceParents(
  compositionId: string,
  instances: readonly AssetInstance[],
  issues: AssetValidationIssue[],
): void {
  instances.forEach((instance, index) => {
    const parent = instance.parentCompositionRef;
    if (
      !parent ||
      parent.kind !== "asset-composition" ||
      String(parent.id) !== String(compositionId)
    ) {
      issues.push({
        severity: "error",
        category: "composition",
        message:
          "Every system instance must belong to the saved system composition.",
        assetRef: instanceReference(instance),
        path: ["instances", String(index), "parentCompositionRef"],
      });
    }
  });
}

function uniqueMap<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  label: "instance" | "binding",
  issues: AssetValidationIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  values.forEach((value, index) => {
    const key = keyOf(value);
    if (result.has(key)) {
      issues.push({
        severity: "error",
        category: label === "instance" ? "composition" : "binding",
        message: `System ${label} IDs must be unique.`,
        path: [`${label}s`, String(index)],
      });
    } else {
      result.set(key, value);
    }
  });
  return result;
}

function validateCompositionMembership<T>(
  references: readonly AssetReference[],
  values: ReadonlyMap<string, T>,
  label: "instance" | "binding",
  issues: AssetValidationIssue[],
): void {
  for (const [index, reference] of references.entries()) {
    if (!values.has(String(reference.id))) {
      issues.push({
        severity: "error",
        category: label === "instance" ? "composition" : "binding",
        message: `Composition ${label} references must resolve inside the saved system revision.`,
        path: ["composition", `${label}Refs`, String(index)],
      });
    }
  }
  for (const key of values.keys()) {
    if (!references.some((reference) => String(reference.id) === key)) {
      issues.push({
        severity: "error",
        category: label === "instance" ? "composition" : "binding",
        message: `Every saved system ${label} must be referenced by its composition.`,
        path: [`${label}s`, key],
      });
    }
  }
}

function validateBindingEndpoints(
  bindings: readonly AssetBinding[],
  instances: ReadonlyMap<string, AssetInstance>,
  issues: AssetValidationIssue[],
): void {
  bindings.forEach((binding, index) => {
    for (const [side, reference] of [
      ["sourceRef", binding.sourceRef],
      ["targetRef", binding.targetRef],
    ] as const) {
      if (
        reference.kind !== "asset-instance" ||
        !instances.has(String(reference.id))
      ) {
        issues.push({
          severity: "error",
          category: "binding",
          message:
            "System bindings must connect asset instances in the same revision.",
          path: ["bindings", String(index), side],
        });
      }
    }
  });
}

function validatePortCardinality(
  bindings: readonly AssetBinding[],
  instances: ReadonlyMap<string, AssetInstance>,
  definitions: ReadonlyMap<string, AssetDefinition>,
  issues: AssetValidationIssue[],
): void {
  for (const instance of instances.values()) {
    const definition = definitions.get(String(instance.definitionRef.id));
    for (const port of definition?.ports ?? []) {
      const count = bindings.filter((binding) =>
        port.direction === "input"
          ? String(binding.targetRef.id) === String(instance.instanceId) &&
            String(binding.targetPortRef?.id ?? "") === port.portId
          : String(binding.sourceRef.id) === String(instance.instanceId) &&
            String(binding.sourcePortRef?.id ?? "") === port.portId,
      ).length;
      const [minimum, maximum] = portBounds(port);
      if (count < minimum || (maximum !== undefined && count > maximum)) {
        issues.push({
          severity: "error",
          category: "binding",
          message: `Port "${port.portId}" requires ${describeBounds(minimum, maximum)}; found ${count}.`,
          assetRef: instanceReference(instance),
          path: [
            "instances",
            String(instance.instanceId),
            "ports",
            port.portId,
          ],
        });
      }
    }
  }
}

function portBounds(port: AssetPort): readonly [number, number | undefined] {
  const cardinality = port.cardinality;
  let minimum = cardinality?.minConnections ?? 0;
  let maximum = cardinality?.maxConnections;
  if (
    cardinality?.required ||
    cardinality?.preset === "required" ||
    cardinality?.preset === "one-or-more" ||
    cardinality?.preset === "exactly-one"
  ) {
    minimum = Math.max(minimum, 1);
  }
  if (
    cardinality?.preset === "exactly-one" ||
    cardinality?.allowMultiple === false
  ) {
    maximum = Math.min(maximum ?? 1, 1);
  }
  return [minimum, maximum] as const;
}

function describeBounds(minimum: number, maximum: number | undefined): string {
  if (maximum === minimum) {
    return `exactly ${minimum} connection${minimum === 1 ? "" : "s"}`;
  }
  if (maximum === undefined) {
    return `at least ${minimum} connection${minimum === 1 ? "" : "s"}`;
  }
  return `${minimum} to ${maximum} connections`;
}

function validateDependencyCycles(
  bindings: readonly AssetBinding[],
  instances: ReadonlyMap<string, AssetInstance>,
  issues: AssetValidationIssue[],
): void {
  const graph = new Map<string, Set<string>>(
    [...instances.keys()].map((id) => [id, new Set<string>()]),
  );
  for (const binding of bindings) {
    if (
      CYCLE_SENSITIVE_BINDING_KINDS.has(binding.bindingKind) &&
      graph.has(String(binding.sourceRef.id)) &&
      graph.has(String(binding.targetRef.id))
    ) {
      graph
        .get(String(binding.sourceRef.id))
        ?.add(String(binding.targetRef.id));
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of graph.keys()) {
    if (visit(id)) {
      issues.push({
        severity: "error",
        category: "composition",
        message:
          "Control, dependency, runtime, and adapter bindings must not contain a cycle.",
        path: ["bindings"],
      });
      return;
    }
  }
}

function revisionBoundsIssue(
  revision: Pick<
    SystemBuilderRevision,
    "composition" | "instances" | "bindings" | "placements"
  >,
): AssetValidationIssue | undefined {
  if (
    revision.instances.length > MAX_SYSTEM_BUILDER_INSTANCES ||
    revision.composition.instanceRefs.length > MAX_SYSTEM_BUILDER_INSTANCES
  ) {
    return boundedIssue(
      `System revisions may contain at most ${MAX_SYSTEM_BUILDER_INSTANCES} instances.`,
    );
  }
  if (
    revision.bindings.length > MAX_SYSTEM_BUILDER_BINDINGS ||
    (revision.composition.bindingRefs?.length ?? 0) >
      MAX_SYSTEM_BUILDER_BINDINGS
  ) {
    return boundedIssue(
      `System revisions may contain at most ${MAX_SYSTEM_BUILDER_BINDINGS} bindings.`,
    );
  }
  if (
    (revision.composition.placementRefs?.length ?? 0) >
    MAX_SYSTEM_BUILDER_PLACEMENT_REFERENCES
  ) {
    return boundedIssue(
      `System revisions may reference at most ${MAX_SYSTEM_BUILDER_PLACEMENT_REFERENCES} placements.`,
    );
  }
  return undefined;
}

function boundedIssue(message: string): AssetValidationIssue {
  return {
    severity: "error",
    category: "composition",
    message,
  };
}

function append(
  target: AssetValidationIssue[],
  source: readonly AssetValidationIssue[],
  prefix: readonly string[],
): void {
  for (const issue of source) {
    target.push({ ...issue, path: [...prefix, ...(issue.path ?? [])] });
  }
}

function instanceReference(instance: AssetInstance): AssetReference {
  return {
    kind: "asset-instance",
    id: String(instance.instanceId),
  } as AssetReference;
}
