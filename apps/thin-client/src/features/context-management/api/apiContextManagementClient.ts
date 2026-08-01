import type {
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
} from "../../../../../../modules/contracts/context-management";
import {
  parseApiEnvelope,
  toThinClientApiError,
} from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

export interface ContextManagementApiClient {
  execute(input: {
    readonly workspaceId: string;
    readonly command: ContextManagementTransportCommand;
  }): Promise<ContextManagementTransportValue>;
}

const WRITE_ACTIONS = new Set<ContextManagementTransportCommand["action"]>([
  "generation-save",
  "generation-discard",
  "generation-cancel",
  "browser-delete",
]);

export function createApiContextManagementClient(
  baseUrl = "/api",
): ContextManagementApiClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async execute(input) {
      const path = WRITE_ACTIONS.has(input.command.action) ? "write" : "read";
      const url = root + "/context-management/" + path;
      const response = await secureFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const envelope = parseApiEnvelope(await response.json());
      if (!envelope.ok) {
        const error = toThinClientApiError(
          response.status,
          url,
          envelope as never,
        );
        throw Object.assign(new Error(error.message), error);
      }
      return envelope.value as ContextManagementTransportValue;
    },
  };
}
