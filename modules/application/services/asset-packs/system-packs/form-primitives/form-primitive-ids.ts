export const FORM_PRIMITIVE_VERSION = "1.0.0";

export const FORM_PRIMITIVE_IDS = [
  "builtin.form.form",
  "builtin.form.field-group",
  "builtin.form.text-field",
  "builtin.form.number-field",
  "builtin.form.text-area",
  "builtin.form.select-field",
  "builtin.form.checkbox-field",
  "builtin.form.radio-group",
  "builtin.form.date-time-field",
  "builtin.form.validation-message",
  "builtin.form.submit-action",
  "builtin.form.cancel-action",
] as const;

export type FormPrimitiveId = (typeof FORM_PRIMITIVE_IDS)[number];

export const DEFERRED_FORM_PRIMITIVE_IDS = [
  "builtin.form.file-upload-field",
] as const;

export type DeferredFormPrimitiveId =
  (typeof DEFERRED_FORM_PRIMITIVE_IDS)[number];
