import type { AssetComposition, AssetValidationIssue } from "../../../contracts/asset";
import { isAssetCompositionType, isAssetLifecycleStatus, isAssetReviewStatus, isAssetValidationSummaryStatus } from "../../../contracts/asset";
import {
  addIssue,
  checkAllowed,
  checkNonEmpty,
  forEach,
  ref,
  referenceKey,
  result,
  validateCompositionRules,
  validateDependencies,
  validateProvenance,
  validateReference,
  validateSafeId,
  valueAsString,
  type AssetValidationContext,
  type AssetValidationOptions,
  type AssetValidationResult,
} from "./asset-validation-helpers";
import { validateAssetBinding } from "./validate-asset-binding.service";

export type { AssetValidationContext, AssetValidationOptions, AssetValidationResult };

export function validateAssetComposition(
  composition: AssetComposition,
  context: AssetValidationContext = {},
): AssetValidationResult {
  const assetRef = ref("asset-composition", valueAsString(composition.compositionId));
  const issues: AssetValidationIssue[] = [];
  validateSafeId(composition.compositionId, "compositionId", "identity", issues, assetRef);
  checkAllowed(composition.compositionType, isAssetCompositionType, "compositionType", "composition", issues, assetRef, "Composition type is not allowed.");
  checkNonEmpty(composition.displayName, "displayName", "identity", issues, assetRef, "Composition display name is required.");
  checkNonEmpty(composition.version, "version", "identity", issues, assetRef, "Composition version is required.");
  checkAllowed(composition.lifecycleStatus, isAssetLifecycleStatus, "lifecycleStatus", "lifecycle", issues, assetRef, "Lifecycle status is not allowed.");
  if (composition.reviewStatus !== undefined) checkAllowed(composition.reviewStatus, isAssetReviewStatus, "reviewStatus", "lifecycle", issues, assetRef, "Review status is not allowed.");
  validateProvenance(composition.provenance, issues, assetRef, ["provenance"]);
  if (composition.rootInstanceRefs.length === 0 && composition.lifecycleStatus !== "draft") {
    addIssue(issues, { severity: "error", category: "composition", message: "Non-draft compositions must declare at least one root instance ref.", assetRef, path: ["rootInstanceRefs"] });
  }
  const instanceKeys = new Set<string>();
  forEach(composition.instanceRefs, (instanceRef, index) => {
    validateReference(instanceRef, issues, assetRef, ["instanceRefs", String(index)]);
    const key = referenceKey(instanceRef);
    if (instanceKeys.has(key)) {
      addIssue(issues, { severity: "error", category: "composition", message: "Composition instance refs must be unique.", assetRef, path: ["instanceRefs", String(index)] });
    }
    instanceKeys.add(key);
  });
  forEach(composition.rootInstanceRefs, (rootRef, index) => {
    validateReference(rootRef, issues, assetRef, ["rootInstanceRefs", String(index)]);
    if (!instanceKeys.has(referenceKey(rootRef))) {
      addIssue(issues, { severity: "error", category: "composition", message: "Root instance refs must also be included in instanceRefs.", assetRef, path: ["rootInstanceRefs", String(index)] });
    }
  });
  forEach(composition.bindingRefs, (bindingRef, index) => {
    validateReference(bindingRef, issues, assetRef, ["bindingRefs", String(index)]);
    if (bindingRef.kind !== "asset-binding") {
      addIssue(issues, { severity: "error", category: "binding", message: "Composition bindingRefs must reference asset bindings.", assetRef, path: ["bindingRefs", String(index), "kind"] });
    }
    const resolvedBinding = context.bindingsById?.get(bindingRef.id);
    if (resolvedBinding) {
      const bindingResult = validateAssetBinding(resolvedBinding, context);
      for (const issue of bindingResult.issues) {
        addIssue(issues, { ...issue, path: ["bindingRefs", String(index), ...(issue.path ?? [])] });
      }
    }
  });
  forEach(composition.bindings, (binding, index) => {
    const bindingResult = validateAssetBinding(binding, context);
    for (const issue of bindingResult.issues) {
      addIssue(issues, { ...issue, path: ["bindings", String(index), ...(issue.path ?? [])] });
    }
  });
  validateCompositionRules(composition.compositionRules, issues, assetRef, ["compositionRules"], composition, context);
  validateDependencies(composition.dependencies, issues, assetRef, ["dependencies"]);
  if (composition.validationSummary?.status !== undefined) {
    checkAllowed(composition.validationSummary.status, isAssetValidationSummaryStatus, "validationSummary.status", "composition", issues, assetRef, "Validation summary status is not allowed.");
  }
  return result(issues, context.options);
}
