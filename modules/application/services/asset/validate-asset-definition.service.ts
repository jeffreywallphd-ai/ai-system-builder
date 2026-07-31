import type { AssetDefinition, AssetValidationIssue } from "../../../contracts/asset";
import { isAssetFamily, isAssetLifecycleStatus, isAssetReviewStatus, isAssetType, isAssetVersion, normalizeAssetSlotDefinitions } from "../../../contracts/asset";
import {
  addIssue,
  checkAllowed,
  checkNonEmpty,
  forEach,
  ref,
  result,
  validateAiContextCompleteness,
  validateCompositionRules,
  validateConfigurationSchema,
  validateConfigurationValues,
  validateDependencies,
  validatePorts,
  validateProvenance,
  validateReference,
  validateRequirements,
  validateSafeId,
  valueAsString,
  type AssetValidationContext,
  type AssetValidationOptions,
  type AssetValidationResult,
} from "./asset-validation-helpers";

export type { AssetValidationContext, AssetValidationOptions, AssetValidationResult };

export function validateAssetDefinition(
  definition: AssetDefinition,
  context: AssetValidationContext = {},
): AssetValidationResult {
  const assetRef = ref("asset-definition", valueAsString(definition.definitionId));
  const issues: AssetValidationIssue[] = [];

  validateSafeId(definition.definitionId, "definitionId", "identity", issues, assetRef);
  checkAllowed(definition.assetType, isAssetType, "assetType", "identity", issues, assetRef, "Asset type is not allowed.");
  checkAllowed(definition.assetFamily, isAssetFamily, "assetFamily", "identity", issues, assetRef, "Asset family is not allowed.");
  checkNonEmpty(definition.version, "version", "identity", issues, assetRef, "Asset definition version is required.");
  if (typeof definition.version === "string" && !isAssetVersion(definition.version)) {
    addIssue(issues, { severity: "error", category: "identity", message: "Asset definition version is invalid.", assetRef, path: ["version"] });
  }
  checkNonEmpty(definition.displayName, "displayName", "identity", issues, assetRef, "Asset definition display name is required.");
  checkNonEmpty(definition.description, "description", "identity", issues, assetRef, "Asset definition description is required.");
  checkAllowed(definition.lifecycleStatus, isAssetLifecycleStatus, "lifecycleStatus", "lifecycle", issues, assetRef, "Lifecycle status is not allowed.");
  if (definition.reviewStatus !== undefined) {
    checkAllowed(definition.reviewStatus, isAssetReviewStatus, "reviewStatus", "lifecycle", issues, assetRef, "Review status is not allowed.");
  }
  validateProvenance(definition.provenance, issues, assetRef, ["provenance"]);

  if (definition.configurationSchema) {
    validateConfigurationSchema(definition.configurationSchema, issues, assetRef, ["configurationSchema"]);
  }
  if (definition.defaultConfiguration !== undefined) {
    validateConfigurationValues(
      definition.defaultConfiguration,
      definition.configurationSchema,
      "default configuration",
      issues,
      assetRef,
      ["defaultConfiguration"],
      true,
    );
  }
  forEach(definition.configurationExamples, (example, index) => {
    if (example.values !== undefined) {
      validateConfigurationValues(
        example.values,
        definition.configurationSchema,
        "configuration example",
        issues,
        assetRef,
        ["configurationExamples", String(index), "values"],
        false,
      );
    }
  });

  if (definition.slots !== undefined) {
    try {
      const normalizedSlots = normalizeAssetSlotDefinitions(definition.slots);
      if (JSON.stringify(normalizedSlots) !== JSON.stringify(definition.slots)) {
        addIssue(issues, { severity: "error", category: "composition", message: "Asset slot definitions must use their canonical normalized form.", assetRef, path: ["slots"] });
      }
    } catch {
      addIssue(issues, { severity: "error", category: "composition", message: "Asset slot definitions are invalid or exceed supported limits.", assetRef, path: ["slots"] });
    }
  }

  validatePorts(definition.ports, issues, assetRef, ["ports"]);
  validateCompositionRules(definition.compositionRules, issues, assetRef, ["compositionRules"]);
  validateDependencies(definition.dependencies, issues, assetRef, ["dependencies"]);
  validateRequirements(definition.requirements, issues, assetRef, ["requirements"]);
  forEach(definition.requirementRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, ["requirementRefs", String(index)]));
  forEach(definition.portRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, ["portRefs", String(index)]));
  forEach(definition.compositionRuleRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, ["compositionRuleRefs", String(index)]));

  validateAiContextCompleteness(definition, context.options, issues, assetRef);

  return result(issues, context.options);
}
