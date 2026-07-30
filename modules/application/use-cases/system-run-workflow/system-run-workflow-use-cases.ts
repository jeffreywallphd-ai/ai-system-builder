import type {
  SystemRunWorkflowHandlerPort,
  SystemRunWorkflowRequestContext,
} from "../../ports/system-run-workflow";
import {
  MAX_SYSTEM_RUN_WORKFLOW_PROFILES,
  normalizeSystemRunWorkflowProfile,
  normalizeSystemRunWorkflowSnapshot,
  normalizeSystemRunWorkflowSource,
  normalizeSystemRunWorkflowValues,
  systemRunWorkflowFailure,
  systemRunWorkflowSuccess,
  type InvokeSystemRunWorkflowCommand,
  type ListSystemRunWorkflowProfilesQuery,
  type PrepareSystemRunWorkflowQuery,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSnapshot,
  type SystemRunWorkflowSource,
} from "../../../contracts/system-run-workflow";

const SAFE_OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$/;

const failure = (
  cause: unknown,
  field?: string,
): SystemRunWorkflowResult<never> =>
  systemRunWorkflowFailure(
    "workflow.validation",
    cause instanceof Error ? cause.message : "Workflow input is invalid.",
    field,
  );

const sameSource = (
  left: SystemRunWorkflowSource,
  right: SystemRunWorkflowSource,
): boolean =>
  left.kind === right.kind &&
  left.sourceId === right.sourceId &&
  left.sourceDigest === right.sourceDigest &&
  left.sourceRevision === right.sourceRevision;

const assertWorkspaceId = (workspaceId: string): string => {
  const value = workspaceId.trim();
  if (!SAFE_OPERATION_ID.test(value) || value.includes(".."))
    throw new Error("Workspace id must be a safe identifier.");
  return value;
};

const assertProfileId = (profileId: string): string => {
  const value = profileId.trim();
  if (!SAFE_OPERATION_ID.test(value) || value.includes(".."))
    throw new Error("Workflow profile id must be a safe identifier.");
  return value;
};

const assertOperationId = (operationId: string): string => {
  const value = operationId.trim();
  if (!SAFE_OPERATION_ID.test(value) || value.includes(".."))
    throw new Error("Workflow operation id must be a safe identifier.");
  return value;
};

const normalizeRequestContext = (
  context: SystemRunWorkflowRequestContext,
): SystemRunWorkflowRequestContext => {
  const actorId = assertOperationId(context.actorId);
  const roles = [...new Set(context.roles.map((role) => assertOperationId(role)))];
  if (roles.length > 32) throw new Error("Workflow actor roles exceed the limit.");
  return {
    actorId,
    roles,
    authenticated: context.authenticated === true,
    ...(context.organizationId
      ? { organizationId: assertOperationId(context.organizationId) }
      : {}),
  };
};

class SystemRunWorkflowHandlerRegistry {
  private readonly handlers: ReadonlyMap<string, SystemRunWorkflowHandlerPort>;

  public constructor(handlers: readonly SystemRunWorkflowHandlerPort[]) {
    if (handlers.length > MAX_SYSTEM_RUN_WORKFLOW_PROFILES)
      throw new Error("Too many system run workflow handlers are registered.");
    const mapped = new Map<string, SystemRunWorkflowHandlerPort>();
    for (const handler of handlers) {
      const profileId = assertProfileId(handler.profileId);
      if (mapped.has(profileId))
        throw new Error(`Duplicate system run workflow profile: ${profileId}.`);
      mapped.set(profileId, handler);
    }
    this.handlers = mapped;
  }

  list(): readonly SystemRunWorkflowHandlerPort[] {
    return [...this.handlers.values()];
  }

  read(profileId: string): SystemRunWorkflowHandlerPort | undefined {
    return this.handlers.get(profileId);
  }
}

export interface SystemRunWorkflowUseCaseDependencies {
  readonly handlers: readonly SystemRunWorkflowHandlerPort[];
}

export class ListSystemRunWorkflowProfilesUseCase {
  public constructor(private readonly registry: SystemRunWorkflowHandlerRegistry) {}

  async execute(
    query: ListSystemRunWorkflowProfilesQuery,
    requestContext: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>> {
    let workspaceId: string;
    let context: SystemRunWorkflowRequestContext;
    try {
      workspaceId = assertWorkspaceId(query.workspaceId);
      context = normalizeRequestContext(requestContext);
      if (
        query.sourceKind !== undefined &&
        query.sourceKind !== "approved-release" &&
        query.sourceKind !== "reviewed-execution-plan"
      )
        throw new Error("Workflow source kind is unsupported.");
      if (query.sourceId !== undefined) assertProfileId(query.sourceId);
    } catch (cause) {
      return failure(cause);
    }

    const profiles: SystemRunWorkflowProfileSummary[] = [];
    for (const handler of this.registry.list()) {
      const result = await handler.discover(
        {
          workspaceId,
          ...(query.sourceKind ? { sourceKind: query.sourceKind } : {}),
          ...(query.sourceId ? { sourceId: query.sourceId.trim() } : {}),
        },
        context,
      );
      if (!result.ok) return result;
      for (const candidate of result.value) {
        let profile: SystemRunWorkflowProfileSummary;
        try {
          profile = normalizeSystemRunWorkflowProfile(candidate);
        } catch (cause) {
          return failure(cause);
        }
        if (profile.profileId !== handler.profileId)
          return systemRunWorkflowFailure(
            "workflow.failed",
            "A workflow handler returned an inconsistent profile.",
          );
        if (
          (query.sourceKind && profile.source.kind !== query.sourceKind) ||
          (query.sourceId && profile.source.sourceId !== query.sourceId)
        )
          continue;
        profiles.push(profile);
        if (profiles.length > MAX_SYSTEM_RUN_WORKFLOW_PROFILES)
          return systemRunWorkflowFailure(
            "workflow.failed",
            "The workflow profile result exceeds the supported limit.",
          );
      }
    }

    const keys = profiles.map(
      (profile) =>
        `${profile.profileId}|${profile.source.kind}|${profile.source.sourceId}|${profile.source.sourceDigest ?? ""}|${profile.source.sourceRevision ?? ""}`,
    );
    if (new Set(keys).size !== keys.length)
      return systemRunWorkflowFailure(
        "workflow.failed",
        "Workflow discovery returned duplicate profiles.",
      );
    return systemRunWorkflowSuccess(
      profiles.sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.source.label.localeCompare(right.source.label),
      ),
    );
  }
}

export class PrepareSystemRunWorkflowUseCase {
  public constructor(private readonly registry: SystemRunWorkflowHandlerRegistry) {}

  async execute(
    query: PrepareSystemRunWorkflowQuery,
    requestContext: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> {
    let normalized: PrepareSystemRunWorkflowQuery;
    let context: SystemRunWorkflowRequestContext;
    try {
      context = normalizeRequestContext(requestContext);
      normalized = {
        workspaceId: assertWorkspaceId(query.workspaceId),
        profileId: assertProfileId(query.profileId),
        source: normalizeSystemRunWorkflowSource(query.source),
      };
    } catch (cause) {
      return failure(cause);
    }
    const handler = this.registry.read(normalized.profileId);
    if (!handler)
      return systemRunWorkflowFailure(
        "workflow.unsupported",
        "The workflow profile is not supported by this host.",
        "profileId",
      );
    return validateSnapshot(
      await handler.prepare(normalized, context),
      normalized,
    );
  }
}

export class InvokeSystemRunWorkflowUseCase {
  public constructor(private readonly registry: SystemRunWorkflowHandlerRegistry) {}

  async execute(
    command: InvokeSystemRunWorkflowCommand,
    requestContext: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> {
    let normalized: InvokeSystemRunWorkflowCommand;
    let context: SystemRunWorkflowRequestContext;
    try {
      context = normalizeRequestContext(requestContext);
      normalized = {
        workspaceId: assertWorkspaceId(command.workspaceId),
        profileId: assertProfileId(command.profileId),
        source: normalizeSystemRunWorkflowSource(command.source),
        actionId: assertProfileId(command.actionId),
        operationId: assertOperationId(command.operationId),
        ...(command.expectedSnapshotRevision
          ? {
              expectedSnapshotRevision: assertOperationId(
                command.expectedSnapshotRevision,
              ),
            }
          : {}),
        values: normalizeSystemRunWorkflowValues(command.values),
      };
    } catch (cause) {
      return failure(cause);
    }
    const handler = this.registry.read(normalized.profileId);
    if (!handler)
      return systemRunWorkflowFailure(
        "workflow.unsupported",
        "The workflow profile is not supported by this host.",
        "profileId",
      );
    return validateSnapshot(
      await handler.invoke(normalized, context),
      normalized,
    );
  }
}

const validateSnapshot = (
  result: SystemRunWorkflowResult<SystemRunWorkflowSnapshot>,
  expected: PrepareSystemRunWorkflowQuery,
): SystemRunWorkflowResult<SystemRunWorkflowSnapshot> => {
  if (!result.ok) return result;
  let snapshot: SystemRunWorkflowSnapshot;
  try {
    snapshot = normalizeSystemRunWorkflowSnapshot(result.value);
  } catch (cause) {
    return failure(cause);
  }
  if (
    snapshot.profile.profileId !== expected.profileId ||
    !sameSource(snapshot.profile.source, expected.source)
  )
    return systemRunWorkflowFailure(
      "workflow.failed",
      "The workflow handler returned an inconsistent source.",
    );
  return systemRunWorkflowSuccess(snapshot);
};

export const createSystemRunWorkflowUseCases = (
  dependencies: SystemRunWorkflowUseCaseDependencies,
) => {
  const registry = new SystemRunWorkflowHandlerRegistry(dependencies.handlers);
  return {
    listProfiles: new ListSystemRunWorkflowProfilesUseCase(registry),
    prepare: new PrepareSystemRunWorkflowUseCase(registry),
    invoke: new InvokeSystemRunWorkflowUseCase(registry),
  };
};

export type SystemRunWorkflowUseCases = ReturnType<
  typeof createSystemRunWorkflowUseCases
>;
