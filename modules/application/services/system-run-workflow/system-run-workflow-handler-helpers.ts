import type { SystemRunWorkflowRequestContext } from "../../ports/system-run-workflow";
import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import {
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  systemRunWorkflowFailure,
  type PrepareSystemRunWorkflowQuery,
  type SystemRunWorkflowFailureCode,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSnapshot,
  type SystemRunWorkflowSource,
} from "../../../contracts/system-run-workflow";
import type { SystemRelease } from "../../../contracts/system-build";

export const workflowPrincipal = (
  context: SystemRunWorkflowRequestContext,
) => ({
  actorId: context.actorId,
  roles: context.roles,
  authenticated: context.authenticated,
});

export const releaseSource = (
  release: SystemRelease,
  label = `Release ${String(release.releaseId)}`,
): SystemRunWorkflowSource => ({
  kind: "approved-release",
  sourceId: String(release.releaseId),
  sourceDigest: String(release.releaseDigest),
  label,
});

export const profileSummary = (input: {
  profileId: string;
  source: SystemRunWorkflowSource;
  title: string;
  description: string;
  category: string;
  available: boolean;
  blockerCode?: string;
  blockerMessage?: string;
}): SystemRunWorkflowProfileSummary => ({
  schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  profileId: input.profileId,
  source: input.source,
  title: input.title,
  description: input.description,
  category: input.category,
  availability: input.available ? "available" : "blocked",
  blockers: input.available
    ? []
    : [
        {
          code: input.blockerCode ?? "workflow.blocked",
          message:
            input.blockerMessage ??
            "This workflow is not available for the current user.",
        },
      ],
});

export const readExactRelease = async (
  builds: SystemBuildRepositoryPort,
  query: PrepareSystemRunWorkflowQuery,
): Promise<SystemRunWorkflowResult<SystemRelease>> => {
  if (query.source.kind !== "approved-release")
    return systemRunWorkflowFailure(
      "workflow.validation",
      "This workflow requires an approved release.",
      "source",
    );
  const release = await builds.readRelease(
    query.workspaceId as never,
    query.source.sourceId as never,
  );
  if (
    !release ||
    String(release.targetWorkspaceId) !== query.workspaceId ||
    String(release.releaseDigest) !== query.source.sourceDigest
  )
    return systemRunWorkflowFailure(
      "workflow.source-stale",
      "The approved release changed or is no longer available.",
      "source",
    );
  return { ok: true, value: release };
};

export const mapCapabilityFailure = (
  code: string,
  message: string,
  field?: string,
): SystemRunWorkflowResult<never> => {
  const mapped: SystemRunWorkflowFailureCode =
    code.includes("forbidden") || code.includes("denied")
      ? "workflow.unauthorized"
      : code.includes("not-found")
        ? "workflow.source-not-found"
        : code.includes("conflict")
          ? "workflow.conflict"
          : code.includes("unavailable") || code.includes("incompatible")
            ? "workflow.blocked"
            : "workflow.validation";
  return systemRunWorkflowFailure(mapped, message, field);
};

export const checkExpectedSnapshot = (
  expectedSnapshotRevision: string | undefined,
  current: SystemRunWorkflowSnapshot,
): SystemRunWorkflowResult<true> =>
  expectedSnapshotRevision &&
  expectedSnapshotRevision !== current.snapshotRevision
    ? systemRunWorkflowFailure(
        "workflow.conflict",
        "The workflow changed. Review the latest state before continuing.",
        "expectedSnapshotRevision",
      )
    : { ok: true, value: true };

export const withBlocks = (
  snapshot: SystemRunWorkflowSnapshot,
  blocks: SystemRunWorkflowSnapshot["blocks"],
): SystemRunWorkflowSnapshot => ({
  ...snapshot,
  blocks: [...blocks, ...snapshot.blocks],
});

export const valuesAsRecord = (
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> => ({ ...values });

export const requiredString = (
  values: Readonly<Record<string, unknown>>,
  fieldId: string,
): string => {
  const value = values[fieldId];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${fieldId} is required.`);
  return value.trim();
};

export const optionalString = (
  values: Readonly<Record<string, unknown>>,
  fieldId: string,
): string | undefined => {
  const value = values[fieldId];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
};

export const requiredInteger = (
  values: Readonly<Record<string, unknown>>,
  fieldId: string,
): number => {
  const value = values[fieldId];
  if (!Number.isInteger(value)) throw new Error(`${fieldId} must be an integer.`);
  return Number(value);
};

export const splitLines = (
  values: Readonly<Record<string, unknown>>,
  fieldId: string,
  maximum: number,
): readonly string[] => {
  const value = optionalString(values, fieldId);
  if (!value) return [];
  const items = [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
  if (items.length > maximum)
    throw new Error(`${fieldId} contains too many values.`);
  return items;
};
