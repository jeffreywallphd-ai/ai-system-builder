import type {
  AssetBinding,
  AssetComposition,
  AssetCompositionDependency,
  AssetCompositionRule,
  AssetConfigurationField,
  AssetConfigurationSchema,
  AssetConfigurationValue,
  AssetConfigurationValues,
  AssetDefinition,
  AssetInstance,
  AssetPort,
  AssetReference,
  AssetRequirement,
  AssetValidationIssue,
  AssetValidationIssueCategory,
  AssetValidationIssueSeverity,
  AssetValidationSummaryStatus,
} from "../../../contracts/asset";
import {
  isAssetBindingConstraintKind,
  isAssetBindingKind,
  isAssetCompositionDependencyKind,
  isAssetCompositionRuleKind,
  isAssetCompositionType,
  isAssetConfigurationConstraintKind,
  isAssetConfigurationUiHintKind,
  isAssetConfigurationValidationRuleKind,
  isAssetConfigurationValueKind,
  isAssetFamily,
  isAssetId,
  isAssetLifecycleStatus,
  isAssetPortContractKind,
  isAssetPortDirection,
  isAssetProvenanceSourceKind,
  isAssetReferenceKind,
  isAssetRequirementHostKind,
  isAssetRequirementKind,
  isAssetRequirementPermissionKind,
  isAssetRequirementSafetyStatus,
  isAssetReviewStatus,
  isAssetType,
  isAssetValidationSummaryStatus,
  isAssetVersion,
} from "../../../contracts/asset";
import { isRuntimeCapabilityId } from "../../../contracts/runtime";

export interface AssetValidationOptions {
  readonly requireAiContextForComposableAssets?: boolean;
  readonly requireAiContextForResourceBackedAssets?: boolean;
  readonly validatedAt?: string;
}

export interface AssetValidationContext {
  readonly definitionsById?: ReadonlyMap<string, AssetDefinition>;
  readonly instancesById?: ReadonlyMap<string, AssetInstance>;
  readonly bindingsById?: ReadonlyMap<string, AssetBinding>;
  readonly options?: AssetValidationOptions;
}

export interface AssetValidationResult {
  readonly status: AssetValidationSummaryStatus;
  readonly issues: readonly AssetValidationIssue[];
  readonly validatedAt?: string;
}

export interface IssueInput {
  readonly severity: AssetValidationIssueSeverity;
  readonly category: AssetValidationIssueCategory;
  readonly message: string;
  readonly assetRef?: AssetReference;
  readonly path?: readonly string[];
  readonly details?: Record<string, AssetConfigurationValue>;
}

export const COMPOSABLE_AI_CONTEXT_FAMILIES = new Set(["structural", "behavioral", "composition", "context"]);
export const SAFETY_REQUIREMENT_KINDS = new Set([
  "runtime-capability",
  "filesystem-access",
  "network-access",
  "secret-access",
  "external-provider",
  "automation-safety",
  "user-approval",
]);

export function validateConfigurationSchema(schema: AssetConfigurationSchema, issues: AssetValidationIssue[], assetRef: AssetReference, basePath: readonly string[]): void {
  const fieldIds = new Set<string>();
  forEach(schema.fields, (field, index) => {
    const path = [...basePath, "fields", String(index)];
    checkNonEmpty(field.fieldId, [...path, "fieldId"].join("."), "configuration", issues, assetRef, "Configuration field ID is required.");
    if (field.fieldId && fieldIds.has(field.fieldId)) {
      addIssue(issues, { severity: "error", category: "configuration", message: "Configuration field IDs must be unique.", assetRef, path: [...path, "fieldId"] });
    }
    fieldIds.add(field.fieldId);
    checkAllowed(field.valueKind, isAssetConfigurationValueKind, [...path, "valueKind"].join("."), "configuration", issues, assetRef, "Configuration field value kind is not allowed.");
    if (field.required && !isUsableField(field)) {
      addIssue(issues, { severity: "error", category: "configuration", message: "Required configuration fields must have usable definitions.", assetRef, path });
    }
    if (field.valueKind === "enum" && (!field.options || field.options.length === 0)) {
      addIssue(issues, { severity: "error", category: "configuration", message: "Enum configuration fields must declare options.", assetRef, path: [...path, "options"] });
    }
    forEach(field.options, (option, optionIndex) => {
      if (!isJsonCompatible(option.value)) addIssue(issues, { severity: "error", category: "configuration", message: "Configuration option values must be JSON-compatible.", assetRef, path: [...path, "options", String(optionIndex), "value"] });
    });
    forEach(field.constraints, (constraint, constraintIndex) => {
      checkAllowed(constraint.constraintKind, isAssetConfigurationConstraintKind, [...path, "constraints", String(constraintIndex), "constraintKind"].join("."), "configuration", issues, assetRef, "Configuration constraint kind is not allowed.");
      if (constraint.value !== undefined && !isJsonCompatible(constraint.value)) addIssue(issues, { severity: "error", category: "configuration", message: "Configuration constraint values must be JSON-compatible.", assetRef, path: [...path, "constraints", String(constraintIndex), "value"] });
    });
    if (field.uiHint) {
      checkAllowed(field.uiHint.hintKind, isAssetConfigurationUiHintKind, [...path, "uiHint", "hintKind"].join("."), "configuration", issues, assetRef, "Configuration UI hint kind is not allowed.");
    }
    if (field.defaultValue !== undefined && !valueMatchesKind(field.defaultValue, field)) {
      addIssue(issues, { severity: "error", category: "configuration", message: "Configuration field default value does not match its declared value kind.", assetRef, path: [...path, "defaultValue"] });
    }
  });
  forEach(schema.requiredFieldIds, (fieldId, index) => {
    if (!fieldIds.has(fieldId)) addIssue(issues, { severity: "error", category: "configuration", message: "Required field IDs must reference declared configuration fields.", assetRef, path: [...basePath, "requiredFieldIds", String(index)] });
  });
  forEach(schema.validationRules, (rule, index) => {
    checkAllowed(rule.ruleKind, isAssetConfigurationValidationRuleKind, [...basePath, "validationRules", String(index), "ruleKind"].join("."), "configuration", issues, assetRef, "Configuration validation rule kind is not allowed.");
    checkNonEmpty(rule.ruleId, [...basePath, "validationRules", String(index), "ruleId"].join("."), "configuration", issues, assetRef, "Configuration validation rule ID is required.");
  });
}

export function validateConfigurationValues(values: AssetConfigurationValues, schema: AssetConfigurationSchema | undefined, label: string, issues: AssetValidationIssue[], assetRef: AssetReference, basePath: readonly string[], checkRequired: boolean): void {
  if (!isPlainObject(values) || !isJsonCompatible(values)) {
    addIssue(issues, { severity: "error", category: "configuration", message: `${label} must be a JSON-compatible object.`, assetRef, path: basePath });
    return;
  }
  if (!schema) return;
  const fields = new Map(schema.fields.map((field) => [field.fieldId, field]));
  if (schema.strict) {
    for (const key of Object.keys(values)) {
      if (!fields.has(key)) addIssue(issues, { severity: "error", category: "configuration", message: `Strict schema does not allow undeclared ${label} fields.`, assetRef, path: [...basePath, key] });
    }
  }
  if (checkRequired) {
    const requiredIds = new Set([...(schema.requiredFieldIds ?? []), ...schema.fields.filter((field) => field.required).map((field) => field.fieldId)]);
    for (const requiredId of requiredIds) {
      if (!(requiredId in values)) addIssue(issues, { severity: "warning", category: "configuration", message: `Required configuration field "${requiredId}" is missing from ${label}.`, assetRef, path: [...basePath, requiredId] });
    }
  }
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (field && !valueMatchesKind(value, field)) addIssue(issues, { severity: "error", category: "configuration", message: `${label} value does not match field value kind.`, assetRef, path: [...basePath, key], details: { fieldId: key, valueKind: field.valueKind } });
  }
}

export function validateAiContextCompleteness(definition: AssetDefinition, options: AssetValidationOptions | undefined, issues: AssetValidationIssue[], assetRef: AssetReference): void {
  const requireDefault = options?.requireAiContextForComposableAssets ?? true;
  const shouldRequire = (requireDefault && COMPOSABLE_AI_CONTEXT_FAMILIES.has(String(definition.assetFamily))) || (options?.requireAiContextForResourceBackedAssets === true && definition.assetFamily === "resource-backed");
  if (!shouldRequire) return;
  const context = definition.aiContext;
  const required: Array<[string, boolean, string]> = [
    ["purpose", hasText(context?.purpose), "AI context purpose is required for composable asset definitions."],
    ["userFacingSummary", hasText(context?.userFacingSummary), "AI context user-facing summary is required for composable asset definitions."],
    ["developerFacingSummary", hasText(context?.developerFacingSummary), "AI context developer-facing summary is required for composable asset definitions."],
    ["capabilities", (context?.capabilities?.length ?? 0) > 0, "AI context must declare at least one capability."],
    ["limitations", (context?.limitations?.length ?? 0) > 0, "AI context must declare at least one limitation."],
  ];
  if (definition.configurationSchema) required.push(["configurationGuidance", hasText(context?.configurationGuidance?.summary), "AI context configuration guidance is required when configuration schema exists."]);
  if ((definition.ports?.length ?? 0) > 0 || (definition.compositionRules?.length ?? 0) > 0 || (definition.dependencies?.length ?? 0) > 0) required.push(["compositionGuidance", hasText(context?.compositionGuidance?.summary), "AI context composition guidance is required for composable definitions with ports, rules, or dependencies."]);
  if ((definition.requirements ?? []).some((requirement) => SAFETY_REQUIREMENT_KINDS.has(String(requirement.requirementKind)))) required.push(["safetyNotes", (context?.safetyNotes?.length ?? 0) > 0, "AI context safety notes are required when safety-sensitive requirements are declared."]);
  for (const [path, ok, message] of required) {
    if (!ok) addIssue(issues, { severity: "warning", category: "ai-context", message, assetRef, path: ["aiContext", path] });
  }
}

export function validatePorts(ports: readonly AssetPort[] | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, basePath: readonly string[]): void {
  const ids = new Set<string>();
  forEach(ports, (port, index) => {
    const path = [...basePath, String(index)];
    checkNonEmpty(port.portId, [...path, "portId"].join("."), "binding", issues, assetRef, "Port ID is required.");
    if (ids.has(port.portId)) addIssue(issues, { severity: "error", category: "binding", message: "Port IDs must be unique.", assetRef, path: [...path, "portId"] });
    ids.add(port.portId);
    checkAllowed(port.direction, isAssetPortDirection, [...path, "direction"].join("."), "binding", issues, assetRef, "Port direction is not allowed.");
    if (port.contract) {
      checkAllowed(port.contract.contractKind, isAssetPortContractKind, [...path, "contract", "contractKind"].join("."), "binding", issues, assetRef, "Port contract kind is not allowed.");
      if (port.contract.runtimeCapabilityId && !isRuntimeCapabilityId(String(port.contract.runtimeCapabilityId))) addIssue(issues, { severity: "error", category: "binding", message: "Port runtime capability ID is not allowed.", assetRef, path: [...path, "contract", "runtimeCapabilityId"] });
    }
  });
}

export function validateBindingPorts(binding: AssetBinding, context: AssetValidationContext, issues: AssetValidationIssue[], assetRef: AssetReference): void {
  const sourceDefinition = resolveDefinitionForRef(binding.sourceRef, context);
  const targetDefinition = resolveDefinitionForRef(binding.targetRef, context);
  const sourcePort = binding.sourcePortRef ? findPort(sourceDefinition, binding.sourcePortRef.id) : undefined;
  const targetPort = binding.targetPortRef ? findPort(targetDefinition, binding.targetPortRef.id) : undefined;
  if (binding.sourcePortRef && sourceDefinition && !sourcePort) addIssue(issues, { severity: "error", category: "binding", message: "Source port does not exist on supplied source definition.", assetRef, path: ["sourcePortRef"] });
  if (binding.targetPortRef && targetDefinition && !targetPort) addIssue(issues, { severity: "error", category: "binding", message: "Target port does not exist on supplied target definition.", assetRef, path: ["targetPortRef"] });
  if (!sourcePort || !targetPort) return;
  if (!directionsCompatible(sourcePort.direction, targetPort.direction)) addIssue(issues, { severity: "error", category: "binding", message: "Source and target port directions are not compatible for default binding validation.", assetRef, path: ["sourcePortRef", "targetPortRef"], details: { sourceDirection: sourcePort.direction, targetDirection: targetPort.direction } });
  if (sourcePort.contract?.contractKind && targetPort.contract?.contractKind && sourcePort.contract.contractKind !== targetPort.contract.contractKind) addIssue(issues, { severity: "error", category: "binding", message: "Source and target port contract kinds are not compatible.", assetRef, path: ["sourcePortRef", "targetPortRef"], details: { sourceContractKind: sourcePort.contract.contractKind, targetContractKind: targetPort.contract.contractKind } });
}

export function validateCompositionRules(rules: readonly AssetCompositionRule[] | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, basePath: readonly string[], composition?: AssetComposition, context?: AssetValidationContext): void {
  forEach(rules, (rule, index) => {
    const path = [...basePath, String(index)];
    checkAllowed(rule.ruleKind, isAssetCompositionRuleKind, [...path, "ruleKind"].join("."), "composition", issues, assetRef, "Composition rule kind is not allowed.");
    validateDependencies(rule.requiredDependencies, issues, assetRef, [...path, "requiredDependencies"]);
    if (rule.ruleKind === "required-dependency" && (!rule.requiredDependencies || rule.requiredDependencies.length === 0)) addIssue(issues, { severity: "error", category: "composition", message: "Required-dependency rules must declare requiredDependencies.", assetRef, path: [...path, "requiredDependencies"] });
    if (rule.cardinality && composition) validateCardinalityRule(rule, composition, context, issues, assetRef, path);
    if (rule.incompatibleAssetTypes && composition && context) validateIncompatibleAssetTypes(rule, composition, context, issues, assetRef, path);
  });
}

export function validateDependencies(dependencies: readonly AssetCompositionDependency[] | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, basePath: readonly string[]): void {
  forEach(dependencies, (dependency, index) => {
    const path = [...basePath, String(index)];
    checkAllowed(dependency.dependencyKind, isAssetCompositionDependencyKind, [...path, "dependencyKind"].join("."), "composition", issues, assetRef, "Composition dependency kind is not allowed.");
    if (typeof dependency.required !== "boolean") addIssue(issues, { severity: "error", category: "composition", message: "Composition dependency required flag must be boolean.", assetRef, path: [...path, "required"] });
    if (dependency.ref) validateReference(dependency.ref, issues, assetRef, [...path, "ref"]);
    if (dependency.dependencyKind === "runtime-capability" && !isRuntimeCapabilityId(String(dependency.runtimeCapabilityId ?? ""))) addIssue(issues, { severity: "error", category: "composition", message: "Runtime-capability dependencies must reference a shared runtime capability ID.", assetRef, path: [...path, "runtimeCapabilityId"] });
  });
}

export function validateRequirements(requirements: readonly AssetRequirement[] | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, basePath: readonly string[]): void {
  forEach(requirements, (requirement, index) => {
    const path = [...basePath, String(index)];
    checkAllowed(requirement.requirementKind, isAssetRequirementKind, [...path, "requirementKind"].join("."), "requirement", issues, assetRef, "Requirement kind is not allowed.");
    if (typeof requirement.required !== "boolean") addIssue(issues, { severity: "error", category: "requirement", message: "Requirement required flag must be boolean.", assetRef, path: [...path, "required"] });
    if (requirement.requirementKind === "runtime-capability" && !isRuntimeCapabilityId(String(requirement.runtimeCapabilityId ?? ""))) addIssue(issues, { severity: "error", category: "requirement", message: "Runtime-capability requirements must reference a shared runtime capability ID.", assetRef, path: [...path, "runtimeCapabilityId"] });
    if (requirement.hostKind !== undefined) checkAllowed(requirement.hostKind, isAssetRequirementHostKind, [...path, "hostKind"].join("."), "requirement", issues, assetRef, "Requirement host kind is not allowed.");
    if (requirement.permissionKind !== undefined) checkAllowed(requirement.permissionKind, isAssetRequirementPermissionKind, [...path, "permissionKind"].join("."), "requirement", issues, assetRef, "Requirement permission kind is not allowed.");
    if (requirement.safetyStatus !== undefined) checkAllowed(requirement.safetyStatus, isAssetRequirementSafetyStatus, [...path, "safetyStatus"].join("."), "requirement", issues, assetRef, "Requirement safety status is not allowed.");
    if (requirement.ref) validateReference(requirement.ref, issues, assetRef, [...path, "ref"]);
    const canonical = requirement.requirementId ?? requirement.ref?.id ?? "";
    if ((requirement.requirementKind === "secret-access" || requirement.permissionKind === "secret-read") && looksLikeSecret(canonical)) addIssue(issues, { severity: "error", category: "security", message: "Secret requirements must be declarative and must not contain secret values.", assetRef, path });
    if ((requirement.requirementKind === "network-access" || requirement.requirementKind === "filesystem-access") && looksLikePathOrUrl(canonical)) addIssue(issues, { severity: "error", category: "security", message: "Network/filesystem requirements must not use raw URLs or local filesystem paths as canonical IDs.", assetRef, path });
  });
}

export function validateReference(assetReference: AssetReference | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, path: readonly string[]): void {
  if (!assetReference) return;
  checkAllowed(assetReference.kind, isAssetReferenceKind, [...path, "kind"].join("."), "identity", issues, assetRef, "Asset reference kind is not allowed.");
  validateSafeId(assetReference.id, [...path, "id"].join("."), "identity", issues, assetRef);
}

export function validateProvenance(provenance: { readonly sourceKind?: string; readonly sourceAssetRefs?: readonly AssetReference[]; readonly sourceResourceRefs?: readonly AssetReference[]; readonly derivedFromRefs?: readonly AssetReference[] } | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, path: readonly string[]): void {
  if (!provenance) { addIssue(issues, { severity: "error", category: "provenance", message: "Asset provenance is required.", assetRef, path }); return; }
  checkAllowed(provenance.sourceKind, isAssetProvenanceSourceKind, [...path, "sourceKind"].join("."), "provenance", issues, assetRef, "Provenance source kind is not allowed.");
  forEach(provenance.sourceAssetRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, [...path, "sourceAssetRefs", String(index)]));
  forEach(provenance.sourceResourceRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, [...path, "sourceResourceRefs", String(index)]));
  forEach(provenance.derivedFromRefs, (assetReference, index) => validateReference(assetReference, issues, assetRef, [...path, "derivedFromRefs", String(index)]));
}

function validateCardinalityRule(rule: AssetCompositionRule, composition: AssetComposition, context: AssetValidationContext | undefined, issues: AssetValidationIssue[], assetRef: AssetReference, path: readonly string[]): void {
  const types = rule.requiredAssetTypes ?? rule.allowedChildTypes;
  const count = types && context ? composition.instanceRefs.filter((instanceRef) => {
    const instance = context.instancesById?.get(instanceRef.id);
    const definition = instance ? lookupDefinition(instance.definitionRef, context) : undefined;
    return definition ? types.includes(definition.assetType) : false;
  }).length : composition.instanceRefs.length;
  const cardinality = rule.cardinality;
  if (!cardinality) return;
  if (cardinality.exactly !== undefined && count !== cardinality.exactly) addIssue(issues, { severity: "error", category: "composition", message: "Composition cardinality rule exactly constraint is not satisfied.", assetRef, path: [...path, "cardinality", "exactly"] });
  if (cardinality.min !== undefined && count < cardinality.min) addIssue(issues, { severity: "error", category: "composition", message: "Composition cardinality rule min constraint is not satisfied.", assetRef, path: [...path, "cardinality", "min"] });
  if (cardinality.max !== undefined && count > cardinality.max) addIssue(issues, { severity: "error", category: "composition", message: "Composition cardinality rule max constraint is not satisfied.", assetRef, path: [...path, "cardinality", "max"] });
}

function validateIncompatibleAssetTypes(rule: AssetCompositionRule, composition: AssetComposition, context: AssetValidationContext, issues: AssetValidationIssue[], assetRef: AssetReference, path: readonly string[]): void {
  const incompatible = new Set(rule.incompatibleAssetTypes ?? []);
  forEach(composition.instanceRefs, (instanceRef, index) => {
    const instance = context.instancesById?.get(instanceRef.id);
    const definition = instance ? lookupDefinition(instance.definitionRef, context) : undefined;
    if (definition && incompatible.has(definition.assetType)) addIssue(issues, { severity: "error", category: "composition", message: "Composition contains an incompatible asset type.", assetRef, path: [...path, "incompatibleAssetTypes", String(index)] });
  });
}

export function lookupDefinition(definitionRef: AssetReference | undefined, context: AssetValidationContext | undefined): AssetDefinition | undefined {
  if (!definitionRef) return undefined;
  return context?.definitionsById?.get(definitionRef.id);
}

function resolveDefinitionForRef(assetReference: AssetReference | undefined, context: AssetValidationContext): AssetDefinition | undefined {
  if (!assetReference) return undefined;
  if (assetReference.kind === "asset-definition" || assetReference.kind === "asset-definition-version") return context.definitionsById?.get(assetReference.id);
  if (assetReference.kind === "asset-instance") {
    const instance = context.instancesById?.get(assetReference.id);
    return lookupDefinition(instance?.definitionRef, context);
  }
  return undefined;
}

function findPort(definition: AssetDefinition | undefined, portId: string): AssetPort | undefined {
  return definition?.ports?.find((port) => port.portId === portId);
}

function directionsCompatible(source: string, target: string): boolean {
  if (source === "output" && target === "input") return true;
  if (source === "event" && (target === "event" || target === "control")) return true;
  if (source === "control" && target === "control") return true;
  return false;
}

function valueMatchesKind(value: AssetConfigurationValue, field: AssetConfigurationField): boolean {
  if (!isJsonCompatible(value)) return false;
  switch (field.valueKind) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    case "enum": return (field.options ?? []).some((option) => jsonEquals(option.value, value));
    case "asset-reference":
    case "resource-reference":
    case "artifact-reference":
    case "runtime-capability-reference": return typeof value === "string" || isReferenceLike(value);
    case "json": return true;
    default: return false;
  }
}

function isUsableField(field: AssetConfigurationField): boolean {
  return hasText(field.fieldId) && isAssetConfigurationValueKind(String(field.valueKind)) && (field.valueKind !== "enum" || (field.options?.length ?? 0) > 0);
}

export function result(issues: readonly AssetValidationIssue[], options?: AssetValidationOptions): AssetValidationResult {
  return { status: deriveStatus(issues), issues, validatedAt: options?.validatedAt };
}

export function deriveAssetValidationStatus(issues: readonly AssetValidationIssue[]): AssetValidationSummaryStatus {
  return deriveStatus(issues);
}

function deriveStatus(issues: readonly AssetValidationIssue[]): AssetValidationSummaryStatus {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  if (issues.some((issue) => issue.severity === "warning")) return "valid-with-warnings";
  return "valid";
}

export function addIssue(issues: AssetValidationIssue[], input: IssueInput): void {
  issues.push({ severity: input.severity, category: input.category, message: input.message, assetRef: input.assetRef, path: input.path, details: input.details });
}

export function checkAllowed(value: unknown, guard: (value: string) => boolean, path: string, category: AssetValidationIssueCategory, issues: AssetValidationIssue[], assetRef: AssetReference, message: string): void {
  if (typeof value !== "string" || !guard(value)) addIssue(issues, { severity: "error", category, message, assetRef, path: path.split(".") });
}

export function checkNonEmpty(value: unknown, path: string, category: AssetValidationIssueCategory, issues: AssetValidationIssue[], assetRef: AssetReference, message: string): void {
  if (!hasText(value)) addIssue(issues, { severity: "error", category, message, assetRef, path: path.split(".") });
}

export function validateSafeId(value: unknown, path: string, category: AssetValidationIssueCategory, issues: AssetValidationIssue[], assetRef: AssetReference): void {
  if (typeof value !== "string" || !isAssetId(value)) addIssue(issues, { severity: "error", category, message: "Asset ID must be non-empty, trimmed, transport-neutral, and not a path or provider locator.", assetRef, path: path.split(".") });
}

export function ref(kind: AssetReference["kind"], id: string): AssetReference {
  return { kind, id: isAssetId(id) ? id : "invalid-asset-id" } as AssetReference;
}

export function referenceKey(assetReference: AssetReference): string { return `${assetReference.kind}:${assetReference.id}:${assetReference.version ?? ""}`; }
export function valueAsString(value: unknown): string { return typeof value === "string" ? value : ""; }
function hasText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
export function forEach<T>(items: readonly T[] | undefined, callback: (item: T, index: number) => void): void { items?.forEach(callback); }
function isPlainObject(value: unknown): value is Record<string, AssetConfigurationValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function isReferenceLike(value: AssetConfigurationValue): boolean { return isPlainObject(value) && typeof value.kind === "string" && typeof value.id === "string"; }
function jsonEquals(a: AssetConfigurationValue, b: AssetConfigurationValue): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function isJsonCompatible(value: unknown): value is AssetConfigurationValue {
  if (value === null) return true;
  if (["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (isPlainObject(value)) return Object.values(value).every(isJsonCompatible);
  return false;
}
function looksLikePathOrUrl(value: string): boolean { return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || /^[a-zA-Z]:[\\/]/.test(value) || /^https?:\/\//i.test(value); }
function looksLikeSecret(value: string): boolean { return /(?:secret|token|password|api[_-]?key)[:=]/i.test(value) || value.length > 80; }
