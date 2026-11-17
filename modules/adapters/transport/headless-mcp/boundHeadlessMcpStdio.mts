import type { JSONRPCMessage, RequestId, Transport } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { Readable, Writable } from "node:stream";

const MAX_ACTIVE_REQUESTS = 8;
const MAX_PENDING_WRITES = 4;
const MAX_OUTPUT_MESSAGE_BYTES = 256 * 1024;
const MAX_CANCELLATION_NOTIFICATIONS = 8;

/** Bound the work in addition to the official SDK's undecoded input buffer. */
export function boundHeadlessMcpStdio(
  stdin: Readable,
  stdout: Writable,
  onLimit: () => void,
): Transport {
  const underlying = new StdioServerTransport(stdin, stdout, { maxBufferSize: 16 * 1024 });
  const requests = new Set<RequestId>();
  const cancellationIds = new Set<RequestId>();
  let cancelBudget = MAX_CANCELLATION_NOTIFICATIONS;
  let initialized = false;
  let writes = 0;
  let closed = false;
  const deadlineError = () => new Error("Local MCP transport limit reached.");
  const close = () => {
    closed = true;
    requests.clear();
    cancellationIds.clear();
    return underlying.close();
  };
  const limit = () => {
    void close().catch(() => {});
    onLimit();
  };
  const transport: Transport = {
    start: () => underlying.start(),
    close,
    async send(message) {
      if (closed) throw deadlineError();
      if (writes >= MAX_PENDING_WRITES || Buffer.byteLength(JSON.stringify(message)) > MAX_OUTPUT_MESSAGE_BYTES) {
        limit();
        throw deadlineError();
      }
      writes++;
      try {
        await underlying.send(message);
      } finally {
        writes--;
        if ("id" in message && message.id !== undefined && !("method" in message)) {
          requests.delete(message.id);
          cancellationIds.delete(message.id);
          // A sent response proves the SDK pump made progress. This remains
          // finite even while it is waiting on a blocked write.
          cancelBudget = Math.min(MAX_CANCELLATION_NOTIFICATIONS, cancelBudget + 1);
        }
      }
    },
  };
  underlying.onmessage = (message: JSONRPCMessage) => {
    if (closed) return;
    if (!("method" in message)) return; // This adapter never asks its client to act.
    if ("id" in message) {
      if (requests.size >= MAX_ACTIVE_REQUESTS || requests.has(message.id)) {
        limit();
        return;
      }
      requests.add(message.id);
    } else if (message.method === "notifications/initialized") {
      if (initialized) return;
      initialized = true;
    } else if (message.method === "notifications/cancelled") {
      const id: unknown = message.params?.requestId;
      if ((typeof id !== "string" && typeof id !== "number") ||
          !requests.has(id) || cancellationIds.has(id) || cancelBudget < 1) return;
      cancelBudget--;
      cancellationIds.add(id);
    } else {
      return;
    }
    transport.onmessage?.(message);
  };
  underlying.onclose = () => { closed = true; requests.clear(); cancellationIds.clear(); transport.onclose?.(); };
  underlying.onerror = () => { transport.onerror?.(deadlineError()); limit(); };
  return transport;
}
