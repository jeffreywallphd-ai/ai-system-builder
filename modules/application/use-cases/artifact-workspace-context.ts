import { createContractError, createFailureResult, type ContractResult } from "../../contracts/shared";
import { isWorkspaceId, type WorkspaceId } from "../../contracts/workspace";
import type { ApplicationRequestContext } from "../ports";
import type { WorkspaceOperationAuthorizationPort } from "../ports/security";
import type { WorkspaceRepository } from "../ports/workspace";
import type { SecurityScope } from "../../contracts/security";

export type ArtifactWorkspaceFailureCode = "validation" | "not-found" | "unavailable";

export async function resolveArtifactWorkspaceContext(
  context: ApplicationRequestContext | undefined,
  workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">,
  authorization?: {
    readonly port: WorkspaceOperationAuthorizationPort;
    readonly operation: string;
    readonly requiredScopes: readonly SecurityScope[];
  },
): Promise<ContractResult<{ workspaceId: WorkspaceId }>> {
  const requestContext = {
    requestId: context?.requestId,
    correlationId: context?.correlationId,
    workspaceId: context?.workspaceId,
  };

  if (context?.workspaceId === undefined || context.workspaceId === null || context.workspaceId === "") {
    return createFailureResult(
      createContractError("validation", "Workspace id is required for artifact operations.", {
        ...requestContext,
        details: { code: "workspace-required" },
      }),
      requestContext,
    );
  }

  if (!isWorkspaceId(context.workspaceId)) {
    return createFailureResult(
      createContractError("validation", "Workspace id is invalid for artifact operations.", {
        ...requestContext,
        details: { code: "workspace-invalid" },
      }),
      requestContext,
    );
  }

  if (workspaceRepository) {
    const workspace = await workspaceRepository.readWorkspace(context.workspaceId);
    if (!workspace) {
      return createFailureResult(
        createContractError("not-found", "Workspace was not found for artifact operations.", {
          ...requestContext,
          details: { code: "workspace-not-found" },
        }),
        requestContext,
      );
    }
    if (workspace.status !== "active") {
      return createFailureResult(
        createContractError("unavailable", "Workspace is unavailable for artifact operations.", {
          ...requestContext,
          details: { code: "workspace-unavailable" },
        }),
        requestContext,
      );
    }
    if (authorization) {
      try {
        await authorization.port.authorizeWorkspaceOperation({
          workspace,
          operation: authorization.operation,
          requiredScopes: authorization.requiredScopes,
        });
      } catch {
        return createFailureResult(
          createContractError("forbidden", "Workspace access is forbidden.", {
            ...requestContext,
            details: { code: "workspace-forbidden" },
          }),
          requestContext,
        );
      }
    }
  }

  return { ok: true, value: { workspaceId: context.workspaceId }, ...requestContext };
}
