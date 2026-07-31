import type {
  AssetBinding,
  AssetComposition,
  AssetConfigurationValue,
  AssetDefinition,
  AssetInstance,
  AssetMetadata,
  AssetReference,
  AssetValidationIssue,
  AssetValidationSummaryStatus,
} from "../../../contracts/asset";
import type { AssetBindingRepositoryPort, AssetDefinitionRepositoryPort, AssetInstanceRepositoryPort } from "../../ports/asset";
import type { AssetValidationContext, AssetValidationResult } from "../../services/asset";
import type { AssetUseCaseErrorCode, AssetUseCaseResult } from "./asset-use-case-result";

export function definitionReferenceFor(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: String(definition.definitionId) as AssetReference["id"], version: definition.version };
}

export function instanceReferenceFor(instance: AssetInstance): AssetReference {
  return { kind: "asset-instance", id: String(instance.instanceId) as AssetReference["id"] };
}

export function compositionReferenceFor(composition: AssetComposition): AssetReference {
  return { kind: "asset-composition", id: String(composition.compositionId) as AssetReference["id"], version: composition.version };
}

export function isDefinitionReference(reference: AssetReference): boolean {
  return reference.kind === "asset-definition" || reference.kind === "asset-definition-version";
}

export function isInstanceReference(reference: AssetReference): boolean {
  return reference.kind === "asset-instance";
}

export function isCompositionReference(reference: AssetReference): boolean {
  return reference.kind === "asset-composition";
}

export function isBindingReference(reference: AssetReference): boolean {
  return reference.kind === "asset-binding";
}

export function invalidReferenceResult<T>(message: string, details?: AssetMetadata): AssetUseCaseResult<T> {
  return failure("invalid-reference", message, details);
}

export function notFoundResult<T>(message: string, details?: AssetMetadata): AssetUseCaseResult<T> {
  return failure("not-found", message, details);
}

export function failure<T>(code: AssetUseCaseErrorCode, message: string, details?: AssetMetadata, validation?: AssetValidationResult): AssetUseCaseResult<T> {
  return { ok: false, error: { code, message, details }, validation };
}

export function success<T>(value: T, validation?: AssetValidationResult): AssetUseCaseResult<T> {
  return { ok: true, value, validation };
}

export function validationFailure<T>(validation: AssetValidationResult): AssetUseCaseResult<T> {
  return failure("validation-failed", "Asset validation failed; the asset was not saved.", { status: validation.status }, validation);
}

export function canSaveValidationResult(validation: AssetValidationResult): boolean {
  return validation.status === "valid" || validation.status === "valid-with-warnings";
}

export function mergeValidationIssues(validation: AssetValidationResult, issues: readonly AssetValidationIssue[]): AssetValidationResult {
  if (issues.length === 0) return validation;
  const mergedIssues = [...validation.issues, ...issues];
  return { ...validation, issues: mergedIssues, status: deriveStatus(mergedIssues) };
}

export async function buildInstanceValidationContext(
  instance: AssetInstance,
  definitionRepository: AssetDefinitionRepositoryPort,
): Promise<{ context: AssetValidationContext; issues: readonly AssetValidationIssue[] }> {
  const definitions = new Map<string, AssetDefinition>();
  const issues: AssetValidationIssue[] = [];
  if (isDefinitionReference(instance.definitionRef)) {
    const definition = await definitionRepository.getDefinition(instance.definitionRef);
    if (definition) {
      definitions.set(instance.definitionRef.id, definition);
    } else {
      issues.push(contextIssue("error", "Referenced asset definition was not found in the asset definition repository.", instanceReferenceFor(instance), ["definitionRef"], { referenceKind: instance.definitionRef.kind, referenceId: instance.definitionRef.id }));
    }
  }
  return { context: { definitionsById: definitions }, issues };
}

export async function buildCompositionValidationContext(
  composition: AssetComposition,
  dependencies: {
    definitionRepository: AssetDefinitionRepositoryPort;
    instanceRepository: AssetInstanceRepositoryPort;
    bindingRepository?: AssetBindingRepositoryPort;
  },
): Promise<{ context: AssetValidationContext; issues: readonly AssetValidationIssue[] }> {
  const definitions = new Map<string, AssetDefinition>();
  const instances = new Map<string, AssetInstance>();
  const bindings = new Map<string, AssetBinding>();
  const issues: AssetValidationIssue[] = [];

  for (const instanceRef of composition.instanceRefs) {
    if (!isInstanceReference(instanceRef)) {
      issues.push(contextIssue("error", "Composition instanceRefs must reference asset instances.", compositionReferenceFor(composition), ["instanceRefs"], { referenceKind: instanceRef.kind, referenceId: instanceRef.id }));
      continue;
    }

    const instance = await dependencies.instanceRepository.getInstance(instanceRef);
    if (!instance) {
      issues.push(contextIssue("error", "Referenced asset instance was not found in the asset instance repository.", compositionReferenceFor(composition), ["instanceRefs"], { referenceKind: instanceRef.kind, referenceId: instanceRef.id }));
      continue;
    }

    instances.set(instanceRef.id, instance);
    if (isDefinitionReference(instance.definitionRef)) {
      const definition = await dependencies.definitionRepository.getDefinition(instance.definitionRef);
      if (definition) {
        definitions.set(instance.definitionRef.id, definition);
      } else {
        issues.push(contextIssue("error", "Referenced asset definition for a composition instance was not found.", compositionReferenceFor(composition), ["instanceRefs", instanceRef.id, "definitionRef"], { referenceKind: instance.definitionRef.kind, referenceId: instance.definitionRef.id }));
      }
    }
  }

  if (dependencies.bindingRepository) {
    for (const bindingRef of composition.bindingRefs ?? []) {
      if (!isBindingReference(bindingRef)) {
        issues.push(contextIssue("error", "Composition bindingRefs must reference asset bindings.", compositionReferenceFor(composition), ["bindingRefs"], { referenceKind: bindingRef.kind, referenceId: bindingRef.id }));
        continue;
      }

      const binding = await dependencies.bindingRepository.getBinding(bindingRef);
      if (binding) {
        bindings.set(bindingRef.id, binding);
      } else {
        issues.push(contextIssue("error", "Referenced asset binding was not found in the asset binding repository.", compositionReferenceFor(composition), ["bindingRefs"], { referenceKind: bindingRef.kind, referenceId: bindingRef.id }));
      }
    }
  }

  return { context: { definitionsById: definitions, instancesById: instances, bindingsById: bindings }, issues };
}

function contextIssue(
  severity: "warning" | "error",
  message: string,
  assetRef: AssetReference,
  path: readonly string[],
  details: Record<string, AssetConfigurationValue>,
): AssetValidationIssue {
  return { severity, category: "identity", message, assetRef, path, details };
}

function deriveStatus(issues: readonly AssetValidationIssue[]): AssetValidationSummaryStatus {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  if (issues.some((issue) => issue.severity === "warning")) return "valid-with-warnings";
  return "valid";
}
