import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import type { HeadlessCommittedChangesUseCase } from "../../../application/use-cases/system-builder/headless-committed-changes.use-case";
import {
  HEADLESS_CONTRACT_VERSION,
  HEADLESS_READ_OPERATIONS,
  parseHeadlessReadRequest,
  type HeadlessHostIncarnationId,
  type HeadlessReadOperation,
  type HeadlessReadResult,
  type HeadlessSystemSummary,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { isSystemBuilderStatus, isSystemBuilderSystemId, normalizeSystemBuilderRevisionId, type SystemBuilderRecord } from "../../../contracts/system-builder";
import type { WorkspaceId, WorkspaceRecord } from "../../../contracts/workspace";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";

const MAX_READ_ROWS = 128;
const MAX_DISPLAY_LENGTH = 200;

/** Only the trusted connector can supply this result of credential verification. */
export interface DesktopHeadlessReadGrant {
  readonly registeredClientId: string;
  readonly principalId: string;
  readonly organizationId: LocalIdentityProfile["organizationId"];
  readonly workspaceIds: readonly WorkspaceId[];
  readonly operations: readonly HeadlessReadOperation[];
}

export type DesktopHeadlessReadHandler = (
  request: unknown,
  getCurrentGrant: () => Promise<DesktopHeadlessReadGrant | undefined>,
) => Promise<HeadlessReadResult>;

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const tooLarge = { ok: false, code: "headless.result-too-large" } as const;

export function composeDesktopHeadlessReads(dependencies: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: Pick<LocalIdentityProfile, "organizationId" | "principalId">;
  readonly workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly getUseCases: () => Pick<SystemBuilderCompositionRoot["useCases"], "list" | "read" | "listTemplates">;
  readonly committedChanges?: Pick<HeadlessCommittedChangesUseCase, "snapshot" | "changes">;
  readonly isOpen: () => boolean;
}): DesktopHeadlessReadHandler {
  const { hostIncarnationId, identity, workspaceRepository, authorization, getUseCases, committedChanges, isOpen } = dependencies;

  async function authorizedWorkspace(workspaceId: WorkspaceId, operation: HeadlessReadOperation) {
    const workspace = await workspaceRepository.readWorkspace(workspaceId);
    if (workspace?.workspaceId !== workspaceId || workspace.status !== "active" ||
        workspace.organizationId !== identity.organizationId) return undefined;
    try {
      await authorization.authorizeWorkspaceOperation({
        workspace,
        operation: `headless.${operation}`,
        requiredScopes: operation === "workspaces.list" ? ["workspace:read"] : ["workspace:read", "asset:read"],
      });
      return workspace;
    } catch {
      return undefined;
    }
  }

  return async (request, getCurrentGrant) => {
    try {
      const current = async () => {
        if (!isOpen()) return undefined;
        const grant = await getCurrentGrant();
        return isOpen() && grant?.registeredClientId &&
          grant.organizationId === identity.organizationId && grant.principalId === identity.principalId
          ? grant : undefined;
      };
      const grant = await current();
      if (!grant) return forbidden;
      const parsed = parseHeadlessReadRequest(request, hostIncarnationId);
      if (!parsed.ok) return parsed;
      const { operation, input } = parsed.request;
      if (!grant.operations.includes(operation)) return forbidden;
      const usesFeed = operation === "systems.snapshot" || operation === "systems.changes";
      if (usesFeed && !committedChanges) return { ok: false, code: "headless.unsupported-operation" };
      const clientId = grant.registeredClientId;
      const currentScopedGrant = async (workspaces: readonly WorkspaceId[]) => {
        const latest = await current();
        return latest?.registeredClientId === clientId && latest.operations.includes(operation) &&
          workspaces.every((id) => latest.workspaceIds.includes(id)) ? latest : undefined;
      };
      if (operation === "host.describe" || operation === "workspaces.list") {
        if (grant.workspaceIds.length > MAX_READ_ROWS) return tooLarge;
        const permitted = [...new Set(grant.workspaceIds)];
        const workspaces: WorkspaceRecord[] = [];
        for (const workspaceId of permitted) {
          const workspace = await authorizedWorkspace(workspaceId, "workspaces.list");
          if (workspace) workspaces.push(workspace);
        }
        const workspaceIds = workspaces.map((workspace) => workspace.workspaceId);
        for (const workspaceId of workspaceIds) {
          if (!await authorizedWorkspace(workspaceId, "workspaces.list")) return forbidden;
        }
        const latest = await currentScopedGrant(workspaceIds);
        if (!latest) return forbidden;
        if (operation === "host.describe") return {
          ok: true, operation,
          value: {
            version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: workspaceIds,
            operations: HEADLESS_READ_OPERATIONS.filter((op) => latest.operations.includes(op) &&
              (committedChanges || (op !== "systems.snapshot" && op !== "systems.changes"))),
          },
        };
        if (!workspaces.every((workspace) => boundedDisplayName(workspace.displayName))) return tooLarge;
        return { ok: true, operation, value: workspaces.map(({ workspaceId, displayName }) => ({ workspaceId, displayName })) };
      }
      const { workspaceId } = input;
      if (!grant.workspaceIds.includes(workspaceId) || !await authorizedWorkspace(workspaceId, operation) ||
          !await currentScopedGrant([workspaceId])) return forbidden;
      const useCases = getUseCases();
      let response: HeadlessReadResult;
      switch (operation) {
        case "systems.list": {
          const records = await useCases.list.execute({ workspaceId, includeArchived: false });
          response = records.length > MAX_READ_ROWS ? tooLarge
            : records.some((record) => record.targetWorkspaceId !== workspaceId) ? unavailable
              : records.every(validSystemSummary)
                ? { ok: true, operation, value: records.map(systemSummary) } : unavailable;
          break;
        }
        case "systems.read": {
          const { systemId } = input;
          const result = await useCases.read.execute({ workspaceId, systemId });
          response = !result.ok
            ? result.error.code === "system-builder.not-found" ? { ok: false, code: "headless.not-found" } : unavailable
            : result.value.targetWorkspaceId !== workspaceId || result.value.systemId !== systemId ? unavailable
              : validSystemSummary(result.value)
                ? { ok: true, operation, value: systemSummary(result.value) } : unavailable;
          break;
        }
        case "templates.list": {
          const templates = await useCases.listTemplates.execute();
          response = templates.length > MAX_READ_ROWS || !templates.every(({ displayName }) => boundedDisplayName(displayName))
            ? tooLarge : { ok: true, operation, value: templates.map(({ templateId, displayName }) => ({ templateId, displayName })) };
          break;
        }
        case "systems.snapshot":
        case "systems.changes": {
          if (!committedChanges) return unavailable;
          const reader = {
            organizationId: identity.organizationId,
            scopeId: JSON.stringify([identity.principalId, clientId]),
            canRead: async (id: WorkspaceId) => id === workspaceId && Boolean(await currentScopedGrant([id])),
          };
          const failure = (code: string): HeadlessReadResult =>
            code === forbidden.code ? forbidden : code === tooLarge.code ? tooLarge : unavailable;
          if (operation === "systems.snapshot") {
            const result = await committedChanges.snapshot(workspaceId, reader);
            response = result.ok ? { ok: true, operation, value: result.value } : failure(result.error.code);
          } else {
            const result = await committedChanges.changes(workspaceId, input.cursor, reader);
            response = result.ok ? { ok: true, operation, value: result.value } : failure(result.error.code);
          }
          break;
        }
      }
      if (!await authorizedWorkspace(workspaceId, operation) || !await currentScopedGrant([workspaceId])) return forbidden;
      return response;
    } catch {
      return unavailable;
    }
  };
}

function systemSummary(record: SystemBuilderRecord): HeadlessSystemSummary {
  const { systemId, name, status, revision, currentRevisionId } = record;
  return { systemId, name, status, revision, ...(currentRevisionId === undefined ? {} : { currentRevisionId }) };
}

function validSystemSummary(record: SystemBuilderRecord): boolean {
  const { systemId, name, status, revision, currentRevisionId } = record;
  return isSystemBuilderSystemId(systemId) && boundedDisplayName(name) && isSystemBuilderStatus(status) &&
    Number.isSafeInteger(revision) && revision >= 1 &&
    (currentRevisionId === undefined || normalizeSystemBuilderRevisionId(currentRevisionId) === currentRevisionId);
}

function boundedDisplayName(value: string) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_DISPLAY_LENGTH;
}
