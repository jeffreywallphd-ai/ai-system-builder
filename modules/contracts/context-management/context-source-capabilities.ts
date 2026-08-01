import {
  resolveDatasetPreparationSourceCapability,
  type DatasetPreparationSourceCapability,
} from "../runtime/dataset-preparation-capabilities";

export interface ContextSourceCapabilityReadiness {
  readonly ready: boolean;
  readonly capability?: Pick<
    DatasetPreparationSourceCapability,
    "format" | "kind" | "label" | "extensions" | "mediaTypes"
  >;
  readonly code?: "source-format-unsupported" | "source-kind-unsupported";
  readonly message?: string;
  readonly action?: string;
}

export function evaluateContextSourceCapability(input: {
  readonly fileName?: string;
  readonly mediaType?: string;
}): ContextSourceCapabilityReadiness {
  const capability = resolveDatasetPreparationSourceCapability(input);
  if (!capability) {
    return {
      ready: false,
      code: "source-format-unsupported",
      message: "This artifact cannot be used as context yet.",
      action:
        "Choose CSV, JSON, JSON Lines, Parquet, TXT, Markdown, HTML, PDF, or DOCX.",
    };
  }
  if (capability.kind === "image") {
    return {
      ready: false,
      capability,
      code: "source-kind-unsupported",
      message: "Image-only artifacts cannot be converted to textual context.",
      action: "Choose an artifact with extractable text.",
    };
  }
  return { ready: true, capability };
}
