import type { AssetBinding, AssetValidationIssue } from "../../../contracts/asset";
import { isAssetBindingConstraintKind, isAssetBindingKind, isAssetLifecycleStatus } from "../../../contracts/asset";
import {
  addIssue,
  checkAllowed,
  forEach,
  isJsonCompatible,
  ref,
  result,
  validateBindingPorts,
  validateProvenance,
  validateReference,
  validateSafeId,
  valueAsString,
  type AssetValidationContext,
  type AssetValidationOptions,
  type AssetValidationResult,
} from "./asset-validation-helpers";

export type { AssetValidationContext, AssetValidationOptions, AssetValidationResult };

export function validateAssetBinding(
  binding: AssetBinding,
  context: AssetValidationContext = {},
): AssetValidationResult {
  const assetRef = ref("asset-binding", valueAsString(binding.bindingId));
  const issues: AssetValidationIssue[] = [];
  validateSafeId(binding.bindingId, "bindingId", "identity", issues, assetRef);
  checkAllowed(binding.bindingKind, isAssetBindingKind, "bindingKind", "binding", issues, assetRef, "Binding kind is not allowed.");
  validateReference(binding.sourceRef, issues, assetRef, ["sourceRef"]);
  validateReference(binding.targetRef, issues, assetRef, ["targetRef"]);
  if (!binding.sourceRef) addIssue(issues, { severity: "error", category: "binding", message: "Binding sourceRef is required.", assetRef, path: ["sourceRef"] });
  if (!binding.targetRef) addIssue(issues, { severity: "error", category: "binding", message: "Binding targetRef is required.", assetRef, path: ["targetRef"] });
  if (binding.sourcePortRef) validateReference(binding.sourcePortRef, issues, assetRef, ["sourcePortRef"]);
  if (binding.targetPortRef) validateReference(binding.targetPortRef, issues, assetRef, ["targetPortRef"]);
  forEach(binding.constraints, (constraint, index) => {
    checkAllowed(constraint.constraintKind, isAssetBindingConstraintKind, `constraints.${index}.constraintKind`, "binding", issues, assetRef, "Binding constraint kind is not allowed.");
    if (constraint.value !== undefined && !isJsonCompatible(constraint.value)) {
      addIssue(issues, { severity: "error", category: "binding", message: "Binding constraint value must be JSON-compatible.", assetRef, path: ["constraints", String(index), "value"] });
    }
  });
  if (binding.lifecycleStatus !== undefined) {
    checkAllowed(binding.lifecycleStatus, isAssetLifecycleStatus, "lifecycleStatus", "lifecycle", issues, assetRef, "Lifecycle status is not allowed.");
  }
  if (binding.provenance) validateProvenance(binding.provenance, issues, assetRef, ["provenance"]);
  validateBindingPorts(binding, context, issues, assetRef);
  return result(issues, context.options);
}
