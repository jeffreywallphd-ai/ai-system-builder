import { createStructuredHeadlessOperationStore } from "../../../adapters/persistence/system-builder";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { IpcMainHandlePort, IpcSenderTrustPolicy } from "../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import {
  DESKTOP_SYSTEM_CHANGE_POLL_CHANNEL, readDesktopSystemChangePoll, type DesktopSystemChangeWatermark,
} from "../../../contracts/headless";
import type { OrganizationId } from "../../../contracts/organization";

const unavailable = { status: "unavailable" } as const;

export function registerDesktopSystemChangePoll(options: {
  readonly ipcMain: IpcMainHandlePort;
  readonly senderTrust: IpcSenderTrustPolicy;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly documents: StructuredDocumentStore;
  readonly organizationId: OrganizationId;
  readonly isOpen: () => boolean;
}) {
  const { ipcMain, senderTrust, workspaces, authorization, documents, organizationId, isOpen } = options;
  if (documents.organizationId !== organizationId) return;
  const store = createStructuredHeadlessOperationStore(documents);
  let outstanding = 0;
  ipcMain.handle(DESKTOP_SYSTEM_CHANGE_POLL_CHANNEL, async (event, value: unknown): Promise<DesktopSystemChangeWatermark> => {
    const workspaceId = readDesktopSystemChangePoll(value);
    const trusted = () => isOpen() && senderTrust.isTrustedSender(event);
    if (!workspaceId || !trusted() || outstanding >= 4) return unavailable;
    const allowed = async () => {
      if (!trusted()) return false;
      const workspace = await workspaces.readWorkspace(workspaceId);
      if (workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId || workspace.status !== "active") return false;
      await authorization.authorizeWorkspaceOperation({
        workspace, operation: "headless.systems.observe-saved-changes", requiredScopes: ["workspace:read", "asset:read"],
      });
      return trusted();
    };
    outstanding++;
    try {
      if (!await allowed()) return unavailable;
      const sequence = await store.watermark({ organizationId, workspaceId });
      if (!await allowed() || !trusted()) return unavailable;
      return { status: "ready", sequence };
    } catch { return unavailable; }
    finally { outstanding--; }
  });
}
