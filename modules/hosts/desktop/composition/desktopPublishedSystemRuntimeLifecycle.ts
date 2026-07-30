import type { SystemPublishedConversationRuntimeQuery } from "../../../application/services/system-deployment";
import type { InvokeSystemPublishedLifecycleUseCase } from "../../../application/use-cases/system-deployment";
import {
  systemDeploymentFailure,
  type InvokeSystemPublishedLifecycleCommand,
} from "../../../contracts/system-deployment";
import type { SystemPublishedConversationRuntimeSession } from "../../shared/composition/composeSystemPublishedConversationRuntime";

export interface PublishedConversationRuntimeControllerPort {
  open(
    query: SystemPublishedConversationRuntimeQuery,
  ): Promise<SystemPublishedConversationRuntimeSession>;
}

export interface DesktopPublishedSystemRuntimeWindowPort {
  open(
    query: SystemPublishedConversationRuntimeQuery,
    controller: PublishedConversationRuntimeControllerPort,
  ): Promise<void>;
  close(query: SystemPublishedConversationRuntimeQuery): Promise<void>;
}

export function createDesktopPublishedSystemRuntimeLifecycle(options: {
  readonly lifecycle: Pick<InvokeSystemPublishedLifecycleUseCase, "execute">;
  readonly windows: DesktopPublishedSystemRuntimeWindowPort;
  readonly controller: PublishedConversationRuntimeControllerPort;
  readonly prepareRuntime: () => Promise<void>;
}): Pick<InvokeSystemPublishedLifecycleUseCase, "execute"> {
  return {
    async execute(command: InvokeSystemPublishedLifecycleCommand) {
      const result = await options.lifecycle.execute(command);
      if (!result.ok) return result;
      const query: SystemPublishedConversationRuntimeQuery = {
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
        releaseId: command.releaseId,
      };
      if (command.action === "start" && result.value.runtimeKind === "visual") {
        if (!result.value.launchDescriptor) {
          await compensateStop(
            options.lifecycle,
            command,
            result.value.revision,
          );
          return systemDeploymentFailure(
            "deployment.runtime-window.unavailable",
            "The published system window could not be opened.",
          );
        }
        try {
          await options.prepareRuntime();
          await options.windows.open(query, options.controller);
        } catch {
          await compensateStop(
            options.lifecycle,
            command,
            result.value.revision,
          );
          return systemDeploymentFailure(
            "deployment.runtime-window.unavailable",
            "The published system window could not be opened.",
          );
        }
      }
      if (
        command.action === "stop" ||
        command.action === "deactivate" ||
        command.action === "uninstall"
      ) {
        await options.windows.close(query).catch(() => undefined);
      }
      return result;
    },
  };
}

async function compensateStop(
  lifecycle: Pick<InvokeSystemPublishedLifecycleUseCase, "execute">,
  command: InvokeSystemPublishedLifecycleCommand,
  expectedRevision: string,
): Promise<void> {
  await lifecycle
    .execute({ ...command, action: "stop", expectedRevision })
    .catch(() => undefined);
}
