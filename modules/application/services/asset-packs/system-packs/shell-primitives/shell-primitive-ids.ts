export const SHELL_PRIMITIVE_VERSION = "1.0.0";

export const PAGE_FEATURE_SHELL_PRIMITIVE_IDS = [
  "builtin.shell.page",
  "builtin.shell.feature",
  "builtin.shell.dashboard-section",
  "builtin.shell.settings-panel",
  "builtin.shell.resource-browser",
  "builtin.shell.detail-page",
  "builtin.shell.wizard-step",
  "builtin.shell.navigation-group",
] as const;

export const WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS = [
  "builtin.workflow.workflow",
  "builtin.workflow.step",
  "builtin.workflow.input-step",
  "builtin.workflow.transform-step",
  "builtin.workflow.validation-step",
  "builtin.workflow.approval-step",
  "builtin.workflow.output-step",
  "builtin.system.system",
  "builtin.system.subsystem",
  "builtin.system.policy-check",
  "builtin.system.test-check",
] as const;

export const SHELL_PRIMITIVE_IDS = [
  ...PAGE_FEATURE_SHELL_PRIMITIVE_IDS,
  ...WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS,
] as const;

export type PageFeatureShellPrimitiveId =
  (typeof PAGE_FEATURE_SHELL_PRIMITIVE_IDS)[number];

export type WorkflowSystemShellPrimitiveId =
  (typeof WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS)[number];

export type ShellPrimitiveId = (typeof SHELL_PRIMITIVE_IDS)[number];

export const DEFERRED_SHELL_PRIMITIVE_IDS = [] as const;
