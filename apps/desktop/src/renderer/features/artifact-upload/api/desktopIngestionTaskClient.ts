import type { IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../../../../../modules/contracts/ingestion";

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
