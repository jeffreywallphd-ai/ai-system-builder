import type {
  AssetAiContext,
  AssetConfigurationField,
  AssetDefinition,
  AssetPort,
  AssetPortContractKind,
  AssetRequirement,
  AssetType,
} from "../../../../contracts/asset";
import type { RuntimeCapabilityId } from "../../../../contracts/runtime";
import type { BuiltInAssetDefinitionSeed } from "../built-in-asset-definition-seeding.service";
import { BUILT_IN_ASSET_DEFINITION_IDS, BUILT_IN_ASSET_DEFINITION_VERSION, type BuiltInAssetDefinitionId } from "./built-in-asset-definition-ids";
import { createBuiltInAssetDefinitionSeed } from "./createBuiltInAssetDefinitionSeed";

const runtimeBackedDefinitionSpecs: readonly DefinitionSpec[] = [
  {
    id: "builtin.image-generation",
    assetType: "tool",
    family: "behavioral",
    displayName: "Image Generation",
    description: "Generates image outputs from prompt and configuration inputs before any output is registered as an image asset.",
    runtimeCapabilityId: "image-generation",
    purpose: "Generate image outputs from prompts and safe generation configuration.",
    userSummary: "Creates generated image outputs from prompt-based requests.",
    developerSummary: "Represents the behavioral image-generation capability without treating generated outputs as registered image assets until finalization.",
    capabilities: ["Accepts prompt and generation configuration inputs.", "Produces generated image output descriptors for later review or finalization."],
    limitations: ["Does not store generated payload content or register finalized image assets by itself."],
    inputSummary: "Prompt text plus optional negative prompt, model reference, dimensions, and seed configuration.",
    outputSummary: "Generated image output reference or descriptor, distinct from a registered resource-backed image asset.",
    configurationFields: [
      field("prompt", "string", true, "Prompt"),
      field("negativePrompt", "string", false, "Negative prompt"),
      field("modelRef", "asset-reference", false, "Model reference"),
      field("width", "integer", false, "Width"),
      field("height", "integer", false, "Height"),
      field("seed", "integer", false, "Seed"),
    ],
    ports: [
      inputPort("prompt", "Prompt input", "text", "Primary prompt text."),
      inputPort("configuration", "Generation configuration", "json", "Safe generation configuration."),
      outputPort("generated-output", "Generated image output", "resource", "Generated output descriptor before asset finalization."),
    ],
    configGuidance: "Provide prompt text and safe generation settings; use model references instead of provider-native locators or auth material.",
    compositionGuidance: "Compose after prompt templates and before review or finalization into a resource-backed image asset.",
    safetyNotes: ["Review prompts and generated outputs for sensitive, private, or unsafe content before finalization."],
  },
  {
    id: "builtin.dataset-preparation",
    assetType: "workflow",
    family: "behavioral",
    displayName: "Dataset Preparation",
    description: "Prepares datasets from source artifact or resource references using declarative transform configuration.",
    runtimeCapabilityId: "dataset-preparation",
    purpose: "Transform source artifacts or resources into dataset outputs.",
    userSummary: "Builds dataset outputs from selected source materials.",
    developerSummary: "Represents dataset preparation behavior while keeping durable dataset registration separate.",
    capabilities: ["Accepts source artifact or resource references.", "Produces dataset descriptors suitable for later registration or training."],
    limitations: ["Does not inspect storage or materialize dataset payload content from the static definition."],
    inputSummary: "Source artifact or resource references plus a transform profile.",
    outputSummary: "Dataset output descriptor or dataset asset reference after explicit registration.",
    configurationFields: [field("sourceArtifactRefs", "array", true, "Source artifact references"), field("transformProfile", "string", false, "Transform profile")],
    ports: [inputPort("source-artifacts", "Source artifacts", "artifact", "Artifact references to prepare."), inputPort("transform-config", "Transform config", "json", "Preparation configuration."), outputPort("dataset-output", "Dataset output", "asset", "Prepared dataset descriptor or asset reference.", "dataset")],
    configGuidance: "Reference source artifacts and select a transform profile without containing raw data or unsafe storage locations.",
    compositionGuidance: "Compose before model training or dataset validation workflows once outputs are registered.",
    safetyNotes: ["Confirm rights and privacy status for source data before preparation."],
  },
  {
    id: "builtin.model-training",
    assetType: "workflow",
    family: "behavioral",
    displayName: "Model Training",
    description: "Coordinates model training from model, dataset, and training configuration inputs.",
    runtimeCapabilityId: "model-training",
    purpose: "Train or fine-tune a model from a base model and dataset inputs.",
    userSummary: "Produces trained model outputs from selected model and dataset inputs.",
    developerSummary: "Represents model-training behavior without adding execution, task, or capability status semantics.",
    capabilities: ["Accepts base model, dataset, and training profile inputs.", "Produces trained model output descriptors for inventory registration."],
    limitations: ["Static catalog entries do not start training tasks or allocate runtimes."],
    inputSummary: "Base model reference, dataset reference, and training profile configuration.",
    outputSummary: "Trained model descriptor or model asset reference after explicit registration.",
    configurationFields: [field("baseModelRef", "asset-reference", true, "Base model reference"), field("datasetRef", "asset-reference", true, "Dataset reference"), field("trainingProfile", "string", false, "Training profile")],
    ports: [inputPort("base-model", "Base model", "asset", "Base model input.", "model"), inputPort("dataset", "Training dataset", "asset", "Dataset input.", "dataset"), inputPort("training-config", "Training config", "json", "Training profile configuration."), outputPort("trained-model", "Trained model", "asset", "Trained model descriptor or asset reference.", "model")],
    configGuidance: "Use registered model and dataset references and a named training profile; do not store auth material or runtime instructions.",
    compositionGuidance: "Compose after dataset preparation and before model validation or publishing.",
    safetyNotes: ["Review data rights, model license terms, and resource impact before execution."],
  },
  {
    id: "builtin.model-validation",
    assetType: "tool",
    family: "behavioral",
    displayName: "Model Validation",
    description: "Validates a model using a validation profile and produces a report output.",
    runtimeCapabilityId: "model-validation",
    purpose: "Evaluate a model against selected validation criteria.",
    userSummary: "Checks model quality and readiness through validation reports.",
    developerSummary: "Represents model-validation behavior as a catalog definition only, without runtime execution wiring.",
    capabilities: ["Accepts model references and validation profiles.", "Produces validation report descriptors."],
    limitations: ["Does not decide publication readiness or run validation by itself."],
    inputSummary: "Model reference and validation profile configuration.",
    outputSummary: "Validation report output descriptor.",
    configurationFields: [field("modelRef", "asset-reference", true, "Model reference"), field("validationProfile", "string", false, "Validation profile")],
    ports: [inputPort("model", "Model", "asset", "Model to validate.", "model"), inputPort("validation-config", "Validation config", "json", "Validation criteria."), outputPort("validation-report", "Validation report", "json", "Validation report descriptor.")],
    configGuidance: "Reference a model and validation profile; keep evaluation data references explicit and safe.",
    compositionGuidance: "Compose after training and before publishing decisions.",
    safetyNotes: ["Validation reports can include sensitive evaluation findings and should be shared intentionally."],
  },
  {
    id: "builtin.model-publishing",
    assetType: "tool",
    family: "behavioral",
    displayName: "Model Publishing",
    description: "Describes publication of a model to an external repository object when an implementation is available.",
    runtimeCapabilityId: "model-publishing",
    purpose: "Prepare model publication metadata for an external repository target.",
    userSummary: "Represents model publishing intent for future publishing workflows.",
    developerSummary: "Placeholder behavioral definition for model-publishing capability; current runtime execution may be unavailable or not implemented until the publishing runtime path exists.",
    capabilities: ["Accepts model references and target repository metadata placeholders.", "Produces external repository object descriptors after explicit implementation."],
    limitations: ["Runtime execution is unavailable or not implemented until the model publishing runtime path exists.", "Does not store provider auth material or mark publishing as executable or ready."],
    inputSummary: "Model reference and target provider or repository metadata placeholders.",
    outputSummary: "External repository object descriptor after an explicit publish operation exists.",
    configurationFields: [field("modelRef", "asset-reference", true, "Model reference"), field("targetProvider", "string", false, "Target provider"), field("repositoryMetadata", "object", false, "Repository metadata")],
    ports: [inputPort("model", "Model", "asset", "Model to publish.", "model"), inputPort("repository-metadata", "Repository metadata", "json", "Target repository metadata without auth material."), outputPort("external-repository-object", "External repository object", "external-repository-object", "Published repository object descriptor.")],
    configGuidance: "Use model references and safe repository metadata only; auth material must remain in host-owned secure configuration.",
    compositionGuidance: "Compose after model validation once a separate publishing implementation is available.",
    safetyNotes: ["Publishing can expose model weights and metadata externally; require user approval and auth handling outside this definition."],
  },
];

const resourceBackedDefinitionSpecs: readonly DefinitionSpec[] = [
  resourceSpec("builtin.artifact", "data-source", "Artifact", "Stored or managed artifact descriptor or reference", "Represents a stored or managed artifact descriptor/reference that may back assets without being treated as an uploaded document or storing file payload content."),
  resourceSpec("builtin.resource-backed-image", "image", "Resource-backed Image", "Image asset, artifact, or finalized generated output", "Represents a registered image resource after explicit finalization."),
  resourceSpec("builtin.dataset", "dataset", "Dataset", "Dataset descriptor or materialization reference", "Represents a registered dataset resource for preparation, training, or review workflows."),
  resourceSpec("builtin.model", "model", "Model", "Model inventory record and backing artifacts", "Represents a registered model resource without training or validation execution by default."),
  resourceSpec("builtin.document", "document", "Document", "Uploaded or imported document descriptor", "Represents an uploaded or imported document by descriptor/reference only."),
];

const compositionDefinitionSpecs: readonly DefinitionSpec[] = [
  {
    id: "builtin.prompt-template",
    assetType: "prompt-template",
    family: "context",
    displayName: "Prompt Template",
    description: "Reusable prompt template with variables, defaults, and safety guidance.",
    purpose: "Capture reusable prompt text and variable guidance for later future prompt composition work.",
    userSummary: "Stores reusable prompt text and variable descriptions.",
    developerSummary: "Context asset for prompt templates only; it does not assemble or send prompts.",
    capabilities: ["Declares template text, variables, and safe defaults."],
    limitations: ["Does not call models, assemble prompts or create derived context."],
    inputSummary: "Template text and variable definitions.",
    outputSummary: "Configured prompt text for future composition, not an executed prompt.",
    configurationFields: [field("templateText", "string", true, "Template text"), field("variables", "array", false, "Variables"), field("safetyGuidance", "string", false, "Safety guidance")],
    ports: [outputPort("prompt", "Prompt text", "text", "Rendered or selected prompt text for future consumers.")],
    configGuidance: "Use clear variable names and safe defaults; keep safety guidance explicit.",
    compositionGuidance: "Compose before behavioral tools such as image generation when a prompt input is needed.",
    safetyNotes: ["Avoid placing sensitive values, private data, or provider auth material in template defaults."],
  },
  baseSpec("builtin.tool", "tool", "behavioral", "Tool", "Generic behavioral tool definition", "Represents a reusable action-oriented asset without a default runtime requirement."),
  {
    ...baseSpec("builtin.workflow", "workflow", "composition", "Workflow", "Generic workflow composition definition", "Represents an ordered or structured composition of workflow steps."),
    compositionRules: [{ ruleId: "allow-workflow-step-children", ruleKind: "allowed-child", allowedChildTypes: ["workflow-step"], description: "Workflows may compose workflow-step children." }],
    ports: [inputPort("workflow-input", "Workflow input", "json", "Workflow input payload descriptor."), outputPort("workflow-output", "Workflow output", "json", "Workflow output descriptor.")],
  },
  {
    ...baseSpec("builtin.workflow-step", "workflow-step", "behavioral", "Workflow Step", "Generic workflow step definition", "Represents an individual step that can be composed into workflows."),
    compositionRules: [{ ruleId: "allow-workflow-parent", ruleKind: "allowed-parent", allowedParentTypes: ["workflow"], description: "Workflow steps may be composed into workflows." }],
  },
  baseSpec("builtin.feature", "feature", "composition", "Feature", "Generic feature composition definition", "Represents a product feature composed from tools, workflows, and resource-backed assets as future rules allow."),
  baseSpec("builtin.subsystem", "subsystem", "composition", "Subsystem", "Generic subsystem composition definition", "Represents a cohesive subsystem that can collect features and supporting assets."),
  baseSpec("builtin.system", "system", "composition", "System", "Generic system composition definition", "Represents a complete system composed from subsystems, features, workflows, and supporting assets."),
];

const definitions = [...runtimeBackedDefinitionSpecs, ...resourceBackedDefinitionSpecs, ...compositionDefinitionSpecs].map(toDefinition);

export const BUILT_IN_ASSET_DEFINITION_CATALOG: readonly BuiltInAssetDefinitionSeed[] = definitions.map(createBuiltInAssetDefinitionSeed);

export const BUILT_IN_ASSET_DEFINITIONS: readonly AssetDefinition[] = BUILT_IN_ASSET_DEFINITION_CATALOG.map((seed) => seed.definition);

if (BUILT_IN_ASSET_DEFINITION_CATALOG.length !== BUILT_IN_ASSET_DEFINITION_IDS.length) {
  throw new Error("Built-in asset definition catalog does not match the built-in definition ID list.");
}

type DefinitionSpec = {
  readonly id: BuiltInAssetDefinitionId;
  readonly assetType: AssetType;
  readonly family: AssetDefinition["assetFamily"];
  readonly displayName: string;
  readonly description: string;
  readonly runtimeCapabilityId?: RuntimeCapabilityId;
  readonly purpose: string;
  readonly userSummary: string;
  readonly developerSummary: string;
  readonly capabilities: readonly string[];
  readonly limitations: readonly string[];
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly configurationFields?: readonly AssetConfigurationField[];
  readonly ports?: readonly AssetPort[];
  readonly configGuidance: string;
  readonly compositionGuidance: string;
  readonly safetyNotes: readonly string[];
  readonly compositionRules?: AssetDefinition["compositionRules"];
};

function toDefinition(spec: DefinitionSpec): AssetDefinition {
  const requirements = spec.runtimeCapabilityId ? [runtimeRequirement(spec.runtimeCapabilityId)] : resourceRequirementIfNeeded(spec);
  return {
    definitionId: spec.id,
    assetType: spec.assetType,
    assetFamily: spec.family,
    version: BUILT_IN_ASSET_DEFINITION_VERSION,
    displayName: spec.displayName,
    description: spec.description,
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: { sourceKind: "system-generated", authorship: "human-authored" },
    ...(spec.configurationFields ? { configurationSchema: { schemaId: `${spec.id}.configuration`, schemaVersion: BUILT_IN_ASSET_DEFINITION_VERSION, fields: spec.configurationFields, requiredFieldIds: spec.configurationFields.filter((item) => item.required).map((item) => item.fieldId), strict: false, description: `${spec.displayName} configuration placeholders.` } } : {}),
    aiContext: aiContext(spec),
    ...(requirements.length > 0 ? { requirements } : {}),
    ...(spec.ports ? { ports: spec.ports } : {}),
    ...(spec.compositionRules ? { compositionRules: spec.compositionRules } : {}),
    metadata: {
      catalog: "asset-kernel-built-ins",
      catalogVersion: BUILT_IN_ASSET_DEFINITION_VERSION,
    },
  };
}

function aiContext(spec: DefinitionSpec): AssetAiContext {
  return {
    purpose: spec.purpose,
    userFacingSummary: spec.userSummary,
    developerFacingSummary: spec.developerSummary,
    capabilities: spec.capabilities.map((summary, index) => ({ capabilityId: `${spec.id}.capability.${index + 1}`, summary })),
    limitations: spec.limitations.map((summary, index) => ({ limitationId: `${spec.id}.limitation.${index + 1}`, summary })),
    inputSummary: { summary: spec.inputSummary, required: spec.configurationFields?.some((item) => item.required) ?? false },
    outputSummary: { summary: spec.outputSummary },
    configurationGuidance: { summary: spec.configGuidance, ...(spec.configurationFields ? { requiredConfiguration: spec.configurationFields.filter((item) => item.required).map((item) => item.fieldId) } : {}) },
    compositionGuidance: { summary: spec.compositionGuidance },
    safetyNotes: spec.safetyNotes.map((summary, index) => ({ safetyNoteId: `${spec.id}.safety.${index + 1}`, category: spec.runtimeCapabilityId ? "runtime-execution" : "operational", severity: "info", summary })),
  };
}

function runtimeRequirement(runtimeCapabilityId: RuntimeCapabilityId): AssetRequirement {
  return {
    requirementId: `${runtimeCapabilityId}.runtime-capability`,
    requirementKind: "runtime-capability",
    required: true,
    runtimeCapabilityId,
    permissionKind: "runtime-execution",
    safetyStatus: runtimeCapabilityId === "model-publishing" ? "requires-review" : "unknown",
    summary: `Requires the shared ${runtimeCapabilityId} runtime capability when execution is implemented and requested.`,
  };
}

function resourceRequirementIfNeeded(spec: DefinitionSpec): readonly AssetRequirement[] {
  if (spec.family !== "resource-backed") return [];
  return [{ requirementId: `${spec.id}.resource-backing`, requirementKind: "resource", required: false, safetyStatus: "safe", summary: "Uses descriptor or reference metadata for resource backing and does not store payload content." }];
}

function field(fieldId: string, valueKind: AssetConfigurationField["valueKind"], required: boolean, label: string): AssetConfigurationField {
  return { fieldId, valueKind, required, label };
}

function inputPort(portId: string, displayName: string, contractKind: AssetPortContractKind, description: string, assetType?: AssetType): AssetPort {
  return { portId, direction: "input", displayName, description, contract: { contractKind, ...(assetType ? { assetType } : {}), description }, cardinality: { preset: "optional" } };
}

function outputPort(portId: string, displayName: string, contractKind: AssetPortContractKind, description: string, assetType?: AssetType): AssetPort {
  return { portId, direction: "output", displayName, description, contract: { contractKind, ...(assetType ? { assetType } : {}), description }, cardinality: { preset: "optional" } };
}

function resourceSpec(id: BuiltInAssetDefinitionId, assetType: AssetType, displayName: string, backingSummary: string, description: string): DefinitionSpec {
  return {
    id,
    assetType,
    family: "resource-backed",
    displayName,
    description,
    purpose: `Represent ${backingSummary} as a resource-backed asset descriptor.`,
    userSummary: `${displayName} assets describe registered resources without containing resource payloads.`,
    developerSummary: `${displayName} built-in keeps resource identity and backing references separate from storage inspection or transport surfaces.`,
    capabilities: ["Provides stable resource-backed asset semantics.", "Can be composed with behavioral assets after explicit registration."],
    limitations: ["Does not store payload content, unsafe storage locations, or provider auth material.", "Does not inspect resources or create durable mappings by itself."],
    inputSummary: "Resource descriptor, display metadata, and safe backing reference placeholders.",
    outputSummary: "Registered resource-backed asset descriptor for future registry reads and composition.",
    configurationFields: [field("displayMetadata", "object", false, "Display metadata"), field("resourceRef", "resource-reference", false, "Resource reference")],
    ports: [outputPort("resource-backed-asset", displayName, "asset", "Resource-backed asset descriptor.", assetType)],
    configGuidance: "Use safe descriptors and resource references only; use descriptors only and omit sensitive values or unsafe storage locations.",
    compositionGuidance: "Compose as an input to tools or workflows after the resource is explicitly registered.",
    safetyNotes: ["Confirm resource access rights and sensitivity before use in workflows."],
  };
}

function baseSpec(id: BuiltInAssetDefinitionId, assetType: AssetType, family: AssetDefinition["assetFamily"], displayName: string, description: string, purpose: string): DefinitionSpec {
  return {
    id,
    assetType,
    family,
    displayName,
    description,
    purpose,
    userSummary: `${displayName} is a generic built-in definition for composition and future specialization.`,
    developerSummary: `${displayName} is an application-owned seed definition, not a UI surface, transport contract, or execution implementation.`,
    capabilities: ["Provides stable base semantics for future asset registration and composition."],
    limitations: ["Does not execute workflows, start runtimes, expose transports, or inspect resources."],
    inputSummary: "Configuration and bindings supplied by concrete asset instances or future definitions.",
    outputSummary: "Composable asset semantics for registry and validation workflows.",
    configGuidance: "Add concrete configuration only in specialized definitions or instances.",
    compositionGuidance: "Use as a base semantic concept and keep concrete bindings explicit.",
    safetyNotes: ["Review specialized instances for permissions, data sensitivity, and execution risk."],
  };
}
