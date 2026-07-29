import type {
  SystemRunWorkflowHandlerPort,
  SystemRunWorkflowRequestContext,
} from "../../ports/system-run-workflow";
import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import type { SystemReviewReleaseDefinitionPort } from "../../ports/system-review";
import type { ReleaseBoundSystemReviewUseCases } from "../../use-cases/system-review";
import {
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  systemRunWorkflowFailure,
  systemRunWorkflowSuccess,
  type InvokeSystemRunWorkflowCommand,
  type ListSystemRunWorkflowProfilesQuery,
  type PrepareSystemRunWorkflowQuery,
  type SystemRunWorkflowArtifactItem,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSnapshot,
} from "../../../contracts/system-run-workflow";
import type {
  SystemReviewArtifactDetail,
  SystemReviewArtifactPage,
  SystemReviewAuditEntry,
  SystemReviewPreview,
} from "../../../contracts/system-review";
import {
  checkExpectedSnapshot,
  mapCapabilityFailure,
  optionalString,
  profileSummary,
  readExactRelease,
  releaseSource,
  requiredString,
  withBlocks,
  workflowPrincipal,
} from "./system-run-workflow-handler-helpers";

export const SYSTEM_REVIEW_WORKFLOW_PROFILE_ID =
  "builtin.workflow.artifact-review@1.0.0";

export interface CreateSystemReviewWorkflowHandlerOptions {
  readonly builds: SystemBuildRepositoryPort;
  readonly definitions: SystemReviewReleaseDefinitionPort;
  readonly runtime: Pick<
    ReleaseBoundSystemReviewUseCases,
    "describe" | "browse" | "detail" | "preview" | "listAudit"
  >;
  readonly profileId?: string;
  readonly now?: () => string;
}

export const createSystemReviewWorkflowHandler = (
  options: CreateSystemReviewWorkflowHandlerOptions,
): SystemRunWorkflowHandlerPort => {
  const profileId = options.profileId ?? SYSTEM_REVIEW_WORKFLOW_PROFILE_ID;
  const now = options.now ?? (() => new Date().toISOString());

  const discover = async (
    query: ListSystemRunWorkflowProfilesQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<
    SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>
  > => {
    if (query.sourceKind && query.sourceKind !== "approved-release")
      return systemRunWorkflowSuccess([]);
    const releases = query.sourceId
      ? [
          await options.builds.readRelease(
            query.workspaceId as never,
            query.sourceId as never,
          ),
        ].filter((release): release is NonNullable<typeof release> => !!release)
      : await options.builds.listReleases(query.workspaceId as never);
    const profiles: SystemRunWorkflowProfileSummary[] = [];
    for (const release of releases) {
      if (String(release.targetWorkspaceId) !== query.workspaceId) continue;
      const definition = await options.definitions.resolve(
        query.workspaceId as never,
        release.releaseId,
      );
      if (!definition) continue;
      const available =
        context.authenticated &&
        context.roles.some((role) => definition.allowedRoles.includes(role));
      profiles.push(
        profileSummary({
          profileId,
          source: releaseSource(release),
          title: definition.descriptor.title,
          description:
            "Browse authorized artifacts and inspect safe bounded previews.",
          category: "review",
          available,
          blockerCode: "workflow.review.forbidden",
          blockerMessage:
            "You do not have permission to review artifacts for this release.",
        }),
      );
    }
    return systemRunWorkflowSuccess(profiles);
  };

  const prepare = async (
    query: PrepareSystemRunWorkflowQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> => {
    const exact = await readExactRelease(options.builds, query);
    if (!exact.ok) return exact;
    const base = {
      workspaceId: query.workspaceId as never,
      releaseId: exact.value.releaseId,
      principal: workflowPrincipal(context),
    };
    const [descriptorResult, pageResult, auditResult] = await Promise.all([
      options.runtime.describe(base),
      options.runtime.browse({ ...base, limit: 100 }),
      options.runtime.listAudit({ ...base, limit: 100 }),
    ]);
    if (!descriptorResult.ok)
      return mapCapabilityFailure(
        descriptorResult.error.code,
        descriptorResult.error.message,
      );
    if (!pageResult.ok)
      return mapCapabilityFailure(
        pageResult.error.code,
        pageResult.error.message,
      );
    const profile = profileSummary({
      profileId,
      source: releaseSource(exact.value),
      title: descriptorResult.value.title,
      description:
        "Browse authorized artifacts and inspect safe bounded previews.",
      category: "review",
      available: true,
    });
    return systemRunWorkflowSuccess({
      schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
      profile,
      snapshotRevision: `review:${pageResult.value.total}:${auditResult.ok ? auditResult.value.length : 0}`,
      refreshedAt: now(),
      blocks: [
        artifactPageBlock(pageResult.value),
        ...(auditResult.ok ? [auditBlock(auditResult.value)] : []),
      ],
      actions: [
        {
          actionId: "refresh",
          label: "Refresh artifacts",
          description: "Read the latest authorized artifact list.",
          intent: "read",
          emphasis: "normal",
          requiresConfirmation: false,
          enabled: true,
          fields: [],
        },
        {
          actionId: "search",
          label: "Search artifacts",
          description: "Filter the authorized artifact list by name.",
          intent: "read",
          emphasis: "normal",
          requiresConfirmation: false,
          enabled: true,
          fields: [
            {
              fieldId: "nameQuery",
              label: "Name contains",
              kind: "text",
              required: false,
              maximumLength: 240,
            },
          ],
        },
        {
          actionId: "open-artifact",
          label: "Open an artifact",
          description: "Read metadata and a safe bounded preview.",
          intent: "read",
          emphasis: "normal",
          requiresConfirmation: false,
          enabled: true,
          fields: [
            {
              fieldId: "artifactRef",
              label: "Artifact reference",
              kind: "text",
              required: true,
              maximumLength: 200,
            },
          ],
        },
      ],
    });
  };

  const invoke = async (
    command: InvokeSystemRunWorkflowCommand,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> => {
    const current = await prepare(command, context);
    if (!current.ok) return current;
    const expected = checkExpectedSnapshot(
      command.expectedSnapshotRevision,
      current.value,
    );
    if (!expected.ok) return expected;
    const exact = await readExactRelease(options.builds, command);
    if (!exact.ok) return exact;
    const base = {
      workspaceId: command.workspaceId as never,
      releaseId: exact.value.releaseId,
      principal: workflowPrincipal(context),
    };
    try {
      if (command.actionId === "refresh") return current;
      if (command.actionId === "search") {
        const nameQuery = optionalString(command.values, "nameQuery");
        const result = await options.runtime.browse({
          ...base,
          ...(nameQuery ? { nameQuery } : {}),
          limit: 100,
        });
        return result.ok
          ? systemRunWorkflowSuccess(
              withBlocks(current.value, [artifactPageBlock(result.value)]),
            )
          : mapCapabilityFailure(result.error.code, result.error.message);
      }
      if (command.actionId === "open-artifact") {
        const artifactRef = requiredString(command.values, "artifactRef");
        const [detail, preview] = await Promise.all([
          options.runtime.detail({ ...base, artifactRef }),
          options.runtime.preview({ ...base, artifactRef }),
        ]);
        if (!detail.ok)
          return mapCapabilityFailure(detail.error.code, detail.error.message);
        if (!preview.ok)
          return mapCapabilityFailure(preview.error.code, preview.error.message);
        return systemRunWorkflowSuccess(
          withBlocks(current.value, [
            {
              blockId: "selected-artifact",
              kind: "artifacts",
              title: detail.value.displayName,
              items: [artifactItem(detail.value, preview.value)],
            },
          ]),
        );
      }
      return systemRunWorkflowFailure(
        "workflow.unsupported",
        "The workflow action is not supported.",
        "actionId",
      );
    } catch (cause) {
      return systemRunWorkflowFailure(
        "workflow.validation",
        cause instanceof Error ? cause.message : "Workflow values are invalid.",
      );
    }
  };

  return { profileId, discover, prepare, invoke };
};

const artifactPageBlock = (page: SystemReviewArtifactPage) =>
  ({
    blockId: "artifacts",
    kind: "artifacts",
    title: "Artifacts",
    items: page.items.map((item) => ({
      artifactRef: item.artifactRef,
      label: item.displayName,
      ...(item.mediaType ? { mediaType: item.mediaType } : {}),
      summary: `${item.artifactFamily}${item.sizeBytes !== undefined ? ` · ${item.sizeBytes} bytes` : ""}`,
    })),
  }) as const;

const auditBlock = (entries: readonly SystemReviewAuditEntry[]) =>
  ({
    blockId: "audit",
    kind: "audit",
    title: "Recent activity",
    items: entries.map((entry) => ({
      entryId: entry.auditId,
      action: entry.action,
      outcome:
        entry.outcome === "allowed"
          ? ("allowed" as const)
          : entry.outcome === "denied"
            ? ("denied" as const)
            : ("failed" as const),
      occurredAt: entry.occurredAt,
      summary: `${entry.action} ${entry.outcome}${entry.artifactRef ? ` for ${entry.artifactRef}` : ""}.`,
    })),
  }) as const;

const artifactItem = (
  detail: SystemReviewArtifactDetail,
  preview: SystemReviewPreview,
): SystemRunWorkflowArtifactItem => ({
  artifactRef: detail.artifactRef,
  label: detail.displayName,
  ...(detail.mediaType ? { mediaType: detail.mediaType } : {}),
  summary: Object.entries(detail.metadata)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n"),
  previewKind: preview.kind,
  previewStatus: preview.status,
  ...(preview.text ? { previewText: preview.text } : {}),
  ...(preview.table ? { previewTable: preview.table } : {}),
  ...(preview.bytes ? { previewBytes: Array.from(preview.bytes) } : {}),
  ...(preview.truncated ? { truncated: true } : {}),
});
