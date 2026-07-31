import type { AssetInstance, AssetValidationIssue } from "../../../contracts/asset";
import { isAssetLifecycleStatus, isAssetReviewStatus } from "../../../contracts/asset";
import {
  addIssue,
  checkAllowed,
  forEach,
  lookupDefinition,
  ref,
  result,
  validateConfigurationValues,
  validateProvenance,
  validateReference,
  validateSafeId,
  valueAsString,
  type AssetValidationContext,
  type AssetValidationOptions,
  type AssetValidationResult,
} from "./asset-validation-helpers";

export type { AssetValidationContext, AssetValidationOptions, AssetValidationResult };

export function validateAssetInstance(
  instance: AssetInstance,
  context: AssetValidationContext = {},
): AssetValidationResult {
  const assetRef = ref("asset-instance", valueAsString(instance.instanceId));
  const issues: AssetValidationIssue[] = [];
  validateSafeId(instance.instanceId, "instanceId", "identity", issues, assetRef);
  validateReference(instance.definitionRef, issues, assetRef, ["definitionRef"]);
  if (instance.definitionRef?.kind !== "asset-definition" && instance.definitionRef?.kind !== "asset-definition-version") {
    addIssue(issues, { severity: "error", category: "identity", message: "Instance definitionRef must reference an asset definition.", assetRef, path: ["definitionRef", "kind"] });
  }
  checkAllowed(instance.lifecycleStatus, isAssetLifecycleStatus, "lifecycleStatus", "lifecycle", issues, assetRef, "Lifecycle status is not allowed.");
  if (instance.reviewStatus !== undefined) {
    checkAllowed(instance.reviewStatus, isAssetReviewStatus, "reviewStatus", "lifecycle", issues, assetRef, "Review status is not allowed.");
  }
  const definition = lookupDefinition(instance.definitionRef, context);
  if (instance.selectedConfiguration !== undefined) {
    validateConfigurationValues(instance.selectedConfiguration, definition?.configurationSchema, "selected configuration", issues, assetRef, ["selectedConfiguration"], true);
  }
  forEach(instance.bindingRefs, (assetReference, index) => {
    validateReference(assetReference, issues, assetRef, ["bindingRefs", String(index)]);
    if (assetReference.kind !== "asset-binding") {
      addIssue(issues, { severity: "error", category: "binding", message: "Instance bindingRefs must reference asset bindings.", assetRef, path: ["bindingRefs", String(index), "kind"] });
    }
  });
  forEach(instance.resourceRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, ["resourceRefs", String(index)]));
  if (instance.parentCompositionRef) {
    validateReference(instance.parentCompositionRef, issues, assetRef, ["parentCompositionRef"]);
  }
  validateProvenance(instance.provenance, issues, assetRef, ["provenance"]);
  if (definition?.lifecycleStatus === "archived" && instance.lifecycleStatus === "published") {
    addIssue(issues, { severity: "error", category: "lifecycle", message: "Published instances must not reference archived definitions.", assetRef, path: ["lifecycleStatus"] });
  }
  if (definition?.lifecycleStatus === "failed-validation") {
    addIssue(issues, { severity: "warning", category: "lifecycle", message: "Instance references a definition that failed validation.", assetRef, path: ["definitionRef"] });
  }
  return result(issues, context.options);
}
