export const ARTIFACT_INTAKE_FAMILIES = [
  "image",
  "text",
  "markdown",
  "json",
  "pdf",
  "document",
  "spreadsheet",
  "binary",
] as const;

export type ArtifactIntakeFamily = (typeof ARTIFACT_INTAKE_FAMILIES)[number];
