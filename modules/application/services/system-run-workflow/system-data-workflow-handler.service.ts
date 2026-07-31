import type {
  SystemRunWorkflowHandlerPort,
  SystemRunWorkflowRequestContext,
} from "../../ports/system-run-workflow";
import type {
  SystemBuildRepositoryPort,
} from "../../ports/system-build";
import type { SystemDataReleaseDefinitionPort } from "../../ports/system-data";
import type { ReleaseBoundSystemDataUseCases } from "../../use-cases/system-data";
import {
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  systemRunWorkflowFailure,
  systemRunWorkflowSuccess,
  type InvokeSystemRunWorkflowCommand,
  type ListSystemRunWorkflowProfilesQuery,
  type PrepareSystemRunWorkflowQuery,
  type SystemRunWorkflowAction,
  type SystemRunWorkflowField,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSnapshot,
  type SystemRunWorkflowValue,
} from "../../../contracts/system-run-workflow";
import type {
  SystemDataFieldDefinition,
  SystemDataFormDescriptor,
  SystemDataRecord,
  SystemDataValues,
} from "../../../contracts/system-data";
import {
  checkExpectedSnapshot,
  mapCapabilityFailure,
  profileSummary,
  readExactRelease,
  releaseSource,
  requiredInteger,
  requiredString,
  withBlocks,
  workflowPrincipal,
} from "./system-run-workflow-handler-helpers";

export const SYSTEM_DATA_WORKFLOW_PROFILE_ID =
  "builtin.workflow.records.service-request@1.0.0";

export interface CreateSystemDataWorkflowHandlerOptions {
  readonly builds: SystemBuildRepositoryPort;
  readonly definitions: SystemDataReleaseDefinitionPort;
  readonly runtime: Pick<
    ReleaseBoundSystemDataUseCases,
    "describe" | "create" | "read" | "update" | "list" | "listAudit"
  >;
  readonly entityType?: string;
  readonly profileId?: string;
  readonly now?: () => string;
}

export const createSystemDataWorkflowHandler = (
  options: CreateSystemDataWorkflowHandlerOptions,
): SystemRunWorkflowHandlerPort => {
  const entityType = options.entityType ?? "service-request";
  const profileId = options.profileId ?? SYSTEM_DATA_WORKFLOW_PROFILE_ID;
  const now = options.now ?? (() => new Date().toISOString());

  const discover = async (
    query: ListSystemRunWorkflowProfilesQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>> => {
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
        entityType,
      );
      if (!definition) continue;
      const available =
        context.authenticated &&
        context.roles.some((role) =>
          definition.rolesByAction.list.includes(role),
        );
      profiles.push(
        profileSummary({
          profileId,
          source: releaseSource(release),
          title: definition.descriptor.title,
          description: `Create, inspect, and update ${entityType} records through this approved release.`,
          category: "data",
          available,
          blockerCode: "workflow.data.forbidden",
          blockerMessage:
            "You do not have permission to use this release's record workflow.",
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
    const principal = workflowPrincipal(context);
    const base = {
      workspaceId: query.workspaceId as never,
      releaseId: exact.value.releaseId,
      entityType,
      principal,
    };
    const [descriptorResult, recordsResult, auditResult] = await Promise.all([
      options.runtime.describe(base),
      options.runtime.list({ ...base, limit: 100, offset: 0 }),
      options.runtime.listAudit({ ...base, limit: 100 }),
    ]);
    if (!descriptorResult.ok)
      return mapCapabilityFailure(
        descriptorResult.error.code,
        descriptorResult.error.message,
        descriptorResult.error.field,
      );
    if (!recordsResult.ok)
      return mapCapabilityFailure(
        recordsResult.error.code,
        recordsResult.error.message,
        recordsResult.error.field,
      );
    const profile = profileSummary({
      profileId,
      source: releaseSource(exact.value),
      title: descriptorResult.value.title,
      description: `Create, inspect, and update ${entityType} records through this approved release.`,
      category: "data",
      available: true,
    });
    const records = recordsResult.value.items;
    const maximumRevision = records.reduce(
      (maximum, record) => Math.max(maximum, record.revision),
      0,
    );
    const snapshot: SystemRunWorkflowSnapshot = {
      schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
      profile,
      snapshotRevision: `records:${recordsResult.value.total}:${maximumRevision}`,
      refreshedAt: now(),
      blocks: [
        {
          blockId: "records",
          kind: "table",
          title: descriptorResult.value.title,
          columns: [
            { columnId: "recordId", label: "Record" },
            { columnId: "revision", label: "Revision" },
            ...descriptorResult.value.fields.map((field) => ({
              columnId: field.name,
              label: field.label,
            })),
          ],
          rows: records.map(recordRow),
          emptyMessage: "No records have been created.",
        },
        ...(auditResult.ok
          ? [
              {
                blockId: "audit",
                kind: "audit" as const,
                title: "Recent activity",
                items: auditResult.value.map((entry) => ({
                  entryId: String(entry.auditId),
                  action: entry.action,
                  outcome:
                    entry.outcome === "allowed"
                      ? ("allowed" as const)
                      : entry.outcome === "denied"
                        ? ("denied" as const)
                        : ("failed" as const),
                  occurredAt: entry.occurredAt,
                  summary: `${entry.action} ${entry.outcome}${entry.recordId ? ` for ${entry.recordId}` : ""}.`,
                })),
              },
            ]
          : []),
      ],
      actions: actions(descriptorResult.value),
    };
    return systemRunWorkflowSuccess(snapshot);
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
      entityType,
      principal: workflowPrincipal(context),
    };
    try {
      switch (command.actionId) {
        case "refresh":
          return current;
        case "create-record": {
          const recordId = requiredString(command.values, "recordId");
          const result = await options.runtime.create({
            ...base,
            recordId,
            values: dataValues(command.values, ["recordId"]),
          });
          if (!result.ok)
            return mapCapabilityFailure(
              result.error.code,
              result.error.message,
              result.error.field,
            );
          const refreshed = await prepare(command, context);
          return refreshed.ok
            ? systemRunWorkflowSuccess(
                withBlocks(refreshed.value, [recordResult(result.value)]),
              )
            : refreshed;
        }
        case "read-record": {
          const result = await options.runtime.read({
            ...base,
            recordId: requiredString(command.values, "recordId"),
          });
          return result.ok
            ? systemRunWorkflowSuccess(
                withBlocks(current.value, [recordResult(result.value)]),
              )
            : mapCapabilityFailure(
                result.error.code,
                result.error.message,
                result.error.field,
              );
        }
        case "update-record": {
          const result = await options.runtime.update({
            ...base,
            recordId: requiredString(command.values, "recordId"),
            expectedRevision: requiredInteger(
              command.values,
              "expectedRevision",
            ),
            values: dataValues(command.values, [
              "recordId",
              "expectedRevision",
            ]),
          });
          if (!result.ok)
            return mapCapabilityFailure(
              result.error.code,
              result.error.message,
              result.error.field,
            );
          const refreshed = await prepare(command, context);
          return refreshed.ok
            ? systemRunWorkflowSuccess(
                withBlocks(refreshed.value, [recordResult(result.value)]),
              )
            : refreshed;
        }
        default:
          return systemRunWorkflowFailure(
            "workflow.unsupported",
            "The workflow action is not supported.",
            "actionId",
          );
      }
    } catch (cause) {
      return systemRunWorkflowFailure(
        "workflow.validation",
        cause instanceof Error ? cause.message : "Workflow values are invalid.",
      );
    }
  };

  return { profileId, discover, prepare, invoke };
};

const field = (value: SystemDataFieldDefinition): SystemRunWorkflowField => ({
  fieldId: value.name,
  label: value.label,
  kind:
    value.type === "enum"
      ? "select"
      : value.type === "number"
        ? "number"
        : "text",
  required: value.required,
  ...(value.protected ? { sensitive: true } : {}),
  ...(value.minimum !== undefined ? { minimum: value.minimum } : {}),
  ...(value.maximum !== undefined ? { maximum: value.maximum } : {}),
  ...(value.maximumLength !== undefined
    ? { maximumLength: value.maximumLength }
    : {}),
  ...(value.enumValues
    ? {
        options: value.enumValues.map((option) => ({
          value: option,
          label: option,
        })),
      }
    : {}),
});

const actions = (
  descriptor: SystemDataFormDescriptor,
): readonly SystemRunWorkflowAction[] => {
  const fields = descriptor.fields.map(field);
  const recordId: SystemRunWorkflowField = {
    fieldId: "recordId",
    label: "Record identifier",
    kind: "text",
    required: true,
    maximumLength: 160,
  };
  return [
    {
      actionId: "refresh",
      label: "Refresh records",
      description: "Read the latest authorized records.",
      intent: "read",
      emphasis: "normal",
      requiresConfirmation: false,
      enabled: true,
      fields: [],
    },
    {
      actionId: "read-record",
      label: "Open a record",
      description: "Read one authorized record.",
      intent: "read",
      emphasis: "normal",
      requiresConfirmation: false,
      enabled: true,
      fields: [recordId],
    },
    {
      actionId: "create-record",
      label: "Create a record",
      description: "Create one record using the approved release schema.",
      intent: "mutate",
      emphasis: "normal",
      requiresConfirmation: true,
      enabled: true,
      fields: [recordId, ...fields],
    },
    {
      actionId: "update-record",
      label: "Update a record",
      description:
        "Update one record using its current revision and approved schema.",
      intent: "mutate",
      emphasis: "caution",
      requiresConfirmation: true,
      enabled: true,
      fields: [
        recordId,
        {
          fieldId: "expectedRevision",
          label: "Current revision",
          kind: "integer",
          required: true,
          minimum: 1,
        },
        ...fields,
      ],
    },
  ];
};

const dataValues = (
  values: Readonly<Record<string, SystemRunWorkflowValue>>,
  excluded: readonly string[],
): SystemDataValues =>
  Object.fromEntries(
    Object.entries(values).filter(([key]) => !excluded.includes(key)),
  );

const recordRow = (record: SystemDataRecord) => ({
  rowId: String(record.recordId),
  values: {
    recordId: String(record.recordId),
    revision: record.revision,
    ...record.values,
  },
});

const recordResult = (record: SystemDataRecord) =>
  ({
    blockId: "selected-record",
    kind: "key-value",
    title: `Record ${record.recordId}`,
    entries: [
      { key: "recordId", label: "Record", value: String(record.recordId) },
      { key: "revision", label: "Revision", value: record.revision },
      ...Object.entries(record.values).map(([key, value]) => ({
        key,
        label: key,
        value,
      })),
    ],
  }) as const;
