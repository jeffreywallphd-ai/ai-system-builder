import type {
  AssetValidationIssue,
  AssetValidationSummaryStatus,
} from "../asset";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderRevisionId } from "./system-builder-revision";
import type { SystemBuilderSystemId } from "./system-builder-id";

export const SYSTEM_BUILDER_FOUNDATION_UPGRADE_SOURCE_VERSION =
  "2.0.0" as const;
export const SYSTEM_BUILDER_FOUNDATION_UPGRADE_SOURCE_VERSIONS = [
  "1.0.0",
  "2.0.0",
] as const;
export const SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION =
  "3.0.0" as const;

export interface PreviewSystemBuilderFoundationUpgradeCommand {
  readonly workspaceId: WorkspaceId;
  readonly actorId: string;
  readonly systemId: SystemBuilderSystemId;
  readonly expectedRecordRevision: number;
}

export interface UpgradeSystemBuilderFoundationCommand extends PreviewSystemBuilderFoundationUpgradeCommand {
  readonly sourceRevisionId: SystemBuilderRevisionId;
}

export type SystemBuilderFoundationUpgradeIssueCode =
  | "foundation-source-missing"
  | "foundation-source-version-unsupported"
  | "foundation-target-definition-missing"
  | "foundation-configuration-field-unmapped";

export interface SystemBuilderFoundationUpgradeIssue {
  readonly code: SystemBuilderFoundationUpgradeIssueCode;
  readonly message: string;
  readonly path: readonly string[];
  readonly instanceId?: string;
  readonly fieldId?: string;
}

export interface SystemBuilderFoundationUpgradePreview {
  readonly sourceRevisionId: SystemBuilderRevisionId;
  readonly sourceVersion: string;
  readonly targetVersion: typeof SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION;
  readonly eligible: boolean;
  readonly mappedInstanceCount: number;
  readonly mappedConfigurationFieldCount: number;
  readonly issues: readonly SystemBuilderFoundationUpgradeIssue[];
  readonly validationStatus: AssetValidationSummaryStatus;
  readonly validationIssues: readonly AssetValidationIssue[];
}
