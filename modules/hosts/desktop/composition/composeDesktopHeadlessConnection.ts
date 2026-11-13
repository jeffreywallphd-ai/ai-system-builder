import { createDesktopHeadlessClientAuthority } from "../../../adapters/security/headless";
import { startDesktopHeadlessLoopback, type DesktopHeadlessLoopback } from "../../../adapters/transport/headless-loopback";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import type { DesktopHeadlessPairingStatus } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import type { DesktopHeadlessReadHandler } from "./composeDesktopHeadlessReads";

export type DesktopHeadlessConnection = ReturnType<typeof composeDesktopHeadlessConnection>;
const MAX_MANAGEMENT_OPERATIONS = 4;

export function composeDesktopHeadlessConnection(dependencies: {
  readonly documents: StructuredDocumentStore;
  readonly identity: LocalIdentityProfile;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly read: DesktopHeadlessReadHandler;
}) {
  let open = true;
  let start: Promise<DesktopHeadlessLoopback> | undefined;
  let endpoint: string | undefined;
  const operations = new Set<Promise<unknown>>();

  function track<T>(whenBusy: T, work: () => Promise<T>): Promise<T> {
    if (!open || operations.size >= MAX_MANAGEMENT_OPERATIONS) return Promise.resolve(whenBusy);
    const task = Promise.resolve().then(() => open ? work() : whenBusy);
    operations.add(task);
    const settled = () => { operations.delete(task); };
    void task.then(settled, settled);
    return task;
  }

  async function readWorkspaceLabel(workspaceId: WorkspaceId): Promise<string | undefined> {
    if (!open || !isWorkspaceId(workspaceId)) return undefined;
    try {
      const workspace = await dependencies.workspaces.readWorkspace(workspaceId);
      if (workspace?.workspaceId !== workspaceId || workspace.organizationId !== dependencies.identity.organizationId ||
          workspace.status !== "active" || typeof workspace.displayName !== "string" ||
          workspace.displayName.length < 1 || workspace.displayName.length > 200) return undefined;
      await dependencies.authorization.authorizeWorkspaceOperation({
        operation: "headless.pairing.begin", workspace, requiredScopes: ["workspace:read", "asset:read"],
      });
      return open ? workspace.displayName : undefined;
    } catch {
      return undefined;
    }
  }

  const registrations = createDesktopHeadlessClientAuthority({
    documents: dependencies.documents,
    identity: dependencies.identity,
    canReadWorkspace: async (id) => (await readWorkspaceLabel(id)) !== undefined,
  });

  async function startConnector(isStillApproved: () => boolean) {
    if (!open || !isStillApproved()) return undefined;
    if (endpoint) return endpoint;
    if (start) return undefined;
    const socket = start = startDesktopHeadlessLoopback({
      registrations, read: dependencies.read, isAdmitted: () => open && endpoint !== undefined,
    });
    let connector: DesktopHeadlessLoopback;
    try {
      connector = await socket;
    } catch {
      if (start === socket) start = undefined;
      return undefined;
    }
    if (!open) return undefined;
    if (!isStillApproved()) {
      try {
        await connector.close();
        if (start === socket) start = undefined;
      } catch {
        // Keep the owned listener for a later explicit shutdown retry.
      }
      return undefined;
    }
    endpoint = connector.endpoint;
    return endpoint;
  }

  return {
    readWorkspaceLabel: (id: WorkspaceId) => track<string | undefined>(undefined, () => readWorkspaceLabel(id)),
    async status(): Promise<DesktopHeadlessPairingStatus> {
      if (!open) return { status: "unavailable" };
      return track<DesktopHeadlessPairingStatus>({ status: "unavailable" }, async () => {
        const value = await registrations.listClients();
        if (value.status !== "ready" || !open) return { status: "unavailable" };
        return { status: "ready", running: endpoint !== undefined, endpoint, clients: value.clients };
      });
    },
    async startExistingClients(isStillApproved: () => boolean) {
      if (!open || !isStillApproved()) return "unavailable" as const;
      return track<"started" | "denied" | "unavailable">("unavailable", async () => {
        const clients = await registrations.listClients();
        if (clients.status !== "ready") return "unavailable" as const;
        if (!clients.clients.length) return "denied" as const;
        for (const workspaceId of new Set(clients.clients.map((client) => client.workspaceId))) {
          if (await readWorkspaceLabel(workspaceId)) {
            if (!isStillApproved()) return "denied" as const;
            return await startConnector(isStillApproved) ? "started" as const : "unavailable" as const;
          }
        }
        return "denied" as const;
      });
    },
    async beginPairing(workspaceId: WorkspaceId, isStillApproved: () => boolean) {
      if (!open || !isStillApproved()) return { status: "denied" } as const;
      type Result = { readonly status: "denied" | "unavailable" } |
        { readonly status: "ready"; readonly endpoint: string; readonly pairingCode: string };
      return track<Result>({ status: "unavailable" }, async () => {
        if (!await readWorkspaceLabel(workspaceId) || !isStillApproved()) return { status: "denied" } as const;
        const address = await startConnector(isStillApproved);
        if (!address || !open) return { status: "unavailable" } as const;
        const code = await registrations.beginPairing(workspaceId, isStillApproved);
        if (!open) return { status: "unavailable" } as const;
        if (code.status !== "ready") return code;
        return { status: "ready", endpoint: address, pairingCode: code.pairingCode } as const;
      });
    },
    async revoke(clientId: string) {
      return open && await track(false, () => registrations.revokeClient(clientId));
    },
    async close() {
      open = false;
      endpoint = undefined;
      registrations.close();
      const closing = start?.then((connector) => connector.close(), () => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([closing, ...operations]),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Desktop connector shutdown could not be confirmed.")), 5_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
