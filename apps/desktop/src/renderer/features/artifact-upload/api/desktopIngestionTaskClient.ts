import type { IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../../../../../modules/contracts/ingestion";
import type { DesktopLocalFileSelectionInput } from "../../../../../../../modules/contracts/headless";

export interface DesktopIngestionTaskClient {
  execute(input: { workspaceId: string; command: IngestionTaskTransportCommand }): Promise<IngestionTaskTransportValue>;
}

export function createDesktopIngestionTaskClient(): DesktopIngestionTaskClient {
  return {
    async execute(input) {
      if (!window.desktopApi?.executeIngestionTask) throw new Error("Ingestion tasks are unavailable in this desktop session.");
      const response = await window.desktopApi.executeIngestionTask(input);
      if (!response.ok) throw new Error(response.error.message);
      return response.value;
    },
  };
}

export function createDesktopHeadlessFilePreparationClient() {
  return {
    async listClients(workspaceId: string) {
      const pairing = await window.desktopApi?.readHeadlessPairingStatus?.();
      if (pairing?.status !== "ready" || !pairing.running || !window.desktopApi?.selectHeadlessLocalFile) return [];
      return pairing.clients.filter(client => client.workspaceId === workspaceId &&
        client.access === "plan-review" && client.expiresAt > Date.now()).map(client => client.registeredClientId);
    },
    select(input: DesktopLocalFileSelectionInput) {
      return window.desktopApi?.selectHeadlessLocalFile?.(input) ?? Promise.resolve(undefined);
    },
  };
}
