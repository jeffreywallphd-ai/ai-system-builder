export const UI_STRUCTURAL_PRIMITIVE_VERSION = "1.0.0";

export const UI_STRUCTURAL_PRIMITIVE_IDS = [
  "builtin.ui.container",
  "builtin.ui.section",
  "builtin.ui.panel",
  "builtin.ui.card",
  "builtin.ui.stack",
  "builtin.ui.grid",
  "builtin.ui.tabs",
  "builtin.ui.collapsible-section",
] as const;

export type UiStructuralPrimitiveId =
  (typeof UI_STRUCTURAL_PRIMITIVE_IDS)[number];

export const DEFERRED_UI_STRUCTURAL_PRIMITIVE_IDS = [
  "builtin.ui.dialog",
  "builtin.ui.drawer",
  "builtin.ui.toolbar",
  "builtin.ui.navigation-item",
] as const;

export type DeferredUiStructuralPrimitiveId =
  (typeof DEFERRED_UI_STRUCTURAL_PRIMITIVE_IDS)[number];
