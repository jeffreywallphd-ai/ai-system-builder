export const DISPLAY_PRIMITIVE_VERSION = "1.0.0";

export const DISPLAY_PRIMITIVE_IDS = [
  "builtin.display.table",
  "builtin.display.list",
  "builtin.display.detail-view",
  "builtin.display.key-value-summary",
  "builtin.display.status-badge",
  "builtin.display.progress-indicator",
  "builtin.display.image-preview-placeholder",
  "builtin.display.resource-preview-placeholder",
] as const;

export type DisplayPrimitiveId = (typeof DISPLAY_PRIMITIVE_IDS)[number];

export const STATE_MESSAGE_PRIMITIVE_IDS = [
  "builtin.state.empty-state",
  "builtin.state.loading-state",
  "builtin.state.error-state",
  "builtin.state.success-message",
] as const;

export type StateMessagePrimitiveId =
  (typeof STATE_MESSAGE_PRIMITIVE_IDS)[number];

export type DisplayStateMessagePrimitiveId =
  | DisplayPrimitiveId
  | StateMessagePrimitiveId;

