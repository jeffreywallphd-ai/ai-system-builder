import {
  normalizeContextManagementTransportCommand,
  type ContextManagementTransportCommand,
  type ContextManagementTransportValue,
  type ContextTaskSummary,
} from "../../../contracts/context-management";
import {
  createSuccessResult,
  type ContractResult,
} from "../../../contracts/shared";
import { TaskType } from "../../../contracts/runtime";
import type { ApplicationRequestContext } from "../../ports";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";
import type { ContextBrowserUseCases } from "./context-browser.use-cases";
import type { ContextGenerationUseCase } from "./context-generation.use-case";

export interface ContextManagementCommandUseCaseDependencies {
  readonly generation: Pick<
    ContextGenerationUseCase,
    "start" | "read" | "save" | "discard" | "cancel"
  >;
  readonly browser: Pick<
    ContextBrowserUseCases,
    "inspectSource" | "list" | "detail" | "query" | "rebuild" | "delete"
  >;
  readonly runtimeTaskRegistry: RuntimeTaskRegistryPort;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
}

export class ContextManagementCommandUseCase {
  public constructor(
    private readonly dependencies: ContextManagementCommandUseCaseDependencies,
  ) {}

  public async executeCommand(
    commandValue: ContextManagementTransportCommand,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextManagementTransportValue>> {
    const command = normalizeContextManagementTransportCommand(commandValue);
    switch (command.action) {
      case "source-inspect": {
        const result = await this.dependencies.browser.inspectSource(
          {
            artifactId: command.artifactId,
            chunking: command.chunking,
            ...(command.sourceChecks
              ? { sourceChecks: command.sourceChecks }
              : {}),
          },
          context,
        );
        return result.ok
          ? createSuccessResult(
              { action: command.action, readiness: result.value },
              context,
            )
          : result;
      }
      case "generation-start": {
        const result = await this.dependencies.generation.start(
          command.command,
          context,
        );
        return result.ok
          ? createSuccessResult(
              { action: command.action, value: result.value },
              context,
            )
          : result;
      }
      case "generation-read":
      case "generation-save":
      case "generation-discard":
      case "generation-cancel": {
        const method = {
          "generation-read": "read",
          "generation-save": "save",
          "generation-discard": "discard",
          "generation-cancel": "cancel",
        }[command.action] as "read" | "save" | "discard" | "cancel";
        const result = await this.dependencies.generation[method](
          command.requestId,
          context,
        );
        return result.ok
          ? createSuccessResult(
              { action: command.action, status: result.value },
              context,
            )
          : result;
      }
      case "browser-list": {
        const result = await this.dependencies.browser.list(context);
        return result.ok
          ? createSuccessResult(
              { action: command.action, items: result.value.items },
              context,
            )
          : result;
      }
      case "browser-detail": {
        const result = await this.dependencies.browser.detail(
          command.artifactId,
          context,
        );
        return result.ok
          ? createSuccessResult(
              { action: command.action, detail: result.value },
              context,
            )
          : result;
      }
      case "browser-query": {
        const result = await this.dependencies.browser.query(
          command.request,
          context,
        );
        return result.ok
          ? createSuccessResult(
              { action: command.action, result: result.value },
              context,
            )
          : result;
      }
      case "browser-rebuild": {
        const result = await this.dependencies.browser.rebuild(
          command.artifactId,
          context,
        );
        return result.ok
          ? createSuccessResult(
              { action: command.action, value: result.value },
              context,
            )
          : result;
      }
      case "browser-delete": {
        const result = await this.dependencies.browser.delete(
          command.artifactId,
          context,
        );
        return result.ok
          ? createSuccessResult(
              {
                action: command.action,
                storageKey: result.value.storageKey,
              },
              context,
            )
          : result;
      }
      case "task-list":
        return this.listTasks(context);
    }
  }

  private async listTasks(
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextManagementTransportValue>> {
    const workspace = await resolveArtifactWorkspaceContext(
      context ?? {},
      this.dependencies.workspaceRepository,
      this.dependencies.workspaceAuthorization
        ? {
            port: this.dependencies.workspaceAuthorization,
            operation: "context.task.list",
            requiredScopes: ["artifact:read"],
          }
        : undefined,
    );
    if (!workspace.ok) return workspace;
    const result = await this.dependencies.runtimeTaskRegistry.listTasks({
      workspaceId: workspace.value.workspaceId,
      taskTypes: [TaskType.CONTEXT_GENERATION, TaskType.CONTEXT_RETRIEVAL],
      includeCompleted: true,
      limit: 100,
    });
    const tasks: ContextTaskSummary[] = result.tasks.map((task) => ({
      requestId: task.requestId,
      taskType:
        task.taskType === TaskType.CONTEXT_GENERATION
          ? "context-generation"
          : "context-retrieval",
      status: task.status,
      ...(task.progress
        ? {
            progress: {
              message: task.progress.message,
              current: task.progress.current,
              total: task.progress.total,
              unit: task.progress.unit,
              percent: task.progress.percent,
            },
          }
        : {}),
      startedAt: task.startedAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    }));
    return createSuccessResult({ action: "task-list", tasks }, context);
  }
}
