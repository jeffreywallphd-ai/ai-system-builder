export const BUILT_IN_ASSET_DEFINITION_VERSION = "1.0.0";

export const BUILT_IN_ASSET_DEFINITION_IDS = [
  "builtin.image-generation",
  "builtin.dataset-preparation",
  "builtin.model-training",
  "builtin.model-validation",
  "builtin.model-publishing",
  "builtin.artifact",
  "builtin.resource-backed-image",
  "builtin.dataset",
  "builtin.model",
  "builtin.document",
  "builtin.prompt-template",
  "builtin.tool",
  "builtin.workflow",
  "builtin.workflow-step",
  "builtin.feature",
  "builtin.subsystem",
  "builtin.system",
] as const;

export type BuiltInAssetDefinitionId = (typeof BUILT_IN_ASSET_DEFINITION_IDS)[number];
