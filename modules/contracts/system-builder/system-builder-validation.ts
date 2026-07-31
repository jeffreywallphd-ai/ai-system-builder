import type {
  AssetValidationIssue,
  AssetValidationSummaryStatus,
} from "../asset";

export interface SystemBuilderValidationResult {
  readonly status: AssetValidationSummaryStatus;
  readonly issues: readonly AssetValidationIssue[];
  readonly validatedAt: string;
}
