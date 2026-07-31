import type { IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../../../../modules/contracts/ingestion";
import { parseApiEnvelope, toThinClientApiError } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

export interface ApiIngestionTaskClient {
  execute(input: { workspaceId: string; command: IngestionTaskTransportCommand }): Promise<IngestionTaskTransportValue>;
}

export function createApiIngestionTaskClient(baseUrl = "/api"): ApiIngestionTaskClient {
  const url = `${baseUrl.replace(/\/+$/, "")}/ingestion/tasks/execute`;
  return {
    async execute(input) {
      const response = await secureFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          command: input.command.action === "append-chunk"
            ? { ...input.command, bytes: Array.from(input.command.bytes) }
            : input.command,
          source: "thin-client.data-management",
        }),
      });
      const envelope = parseApiEnvelope(await response.json());
      if (!envelope.ok) {
        const error = toThinClientApiError(response.status, url, envelope as never);
        throw Object.assign(new Error(error.message), error);
      }
      return envelope.value as IngestionTaskTransportValue;
    },
  };
}
