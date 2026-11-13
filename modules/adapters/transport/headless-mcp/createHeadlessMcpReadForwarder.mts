import { request, type Agent } from "node:https";
import { z } from "zod/v4";
import headless from "../../../contracts/headless/index.js";
import type { HeadlessReadRequest } from "../../../contracts/headless/index.js";
import systemBuilder from "../../../contracts/system-builder/index.js";
import workspace from "../../../contracts/workspace/index.js";
import loopback from "../headless-loopback/index.js";

const { HEADLESS_CONTRACT_VERSION, HEADLESS_READ_OPERATIONS, isDesktopHeadlessEndpoint, isDesktopHeadlessFingerprint, isHeadlessHostIncarnationId } = headless;
const { SYSTEM_BUILDER_TEMPLATE_IDS, isSystemBuilderSystemId, isSystemBuilderStatus, normalizeSystemBuilderRevisionId } = systemBuilder;
const { isWorkspaceId } = workspace;

const MAX_RESULT_BYTES = 128 * 1024;
const MAX_ACTIVE = 4;
const DEADLINE_MS = 5_000;
const deadlineCode = "headless.unavailable";
const text = z.string().min(1).max(200);
const workspaceId = z.string().refine(isWorkspaceId, "Invalid workspace ID");
const systemId = z.string().refine(isSystemBuilderSystemId, "Invalid system ID");
const revisionId = z.string().refine((value) => {
  try { return normalizeSystemBuilderRevisionId(value) === value; } catch { return false; }
});
const operation = z.enum(HEADLESS_READ_OPERATIONS);
const templateId = z.enum(SYSTEM_BUILDER_TEMPLATE_IDS);
const resultError = z.strictObject({ ok: z.literal(false), code: z.enum([
  "headless.invalid-request", "headless.unsupported-version", "headless.unsupported-operation",
  "headless.host-changed", "headless.forbidden", "headless.not-found", "headless.unavailable",
  "headless.result-too-large",
]) });
const system = z.strictObject({
  systemId, name: text, status: z.string().refine(isSystemBuilderStatus),
  revision: z.number().int().positive(), currentRevisionId: revisionId.optional(),
});
const resultValue = {
  "host.describe": z.strictObject({
    version: z.literal(HEADLESS_CONTRACT_VERSION),
    hostIncarnationId: z.string().refine(isHeadlessHostIncarnationId),
    workspaces: z.array(workspaceId).max(128),
    operations: z.array(operation).max(5),
  }),
  "workspaces.list": z.array(z.strictObject({ workspaceId, displayName: text })).max(128),
  "systems.list": z.array(system).max(128),
  "systems.read": system,
  "templates.list": z.array(z.strictObject({ templateId, displayName: text })).max(128),
};

type ReadResult = { ok: true; operation: HeadlessReadRequest["operation"]; value: unknown } |
  { ok: false; code: z.infer<typeof resultError>["code"] };
const unavailable: ReadResult = { ok: false, code: deadlineCode };

export function createHeadlessMcpReadForwarder(endpoint: unknown, fingerprint: unknown, credential: unknown) {
  if (!isDesktopHeadlessEndpoint(endpoint) || !isDesktopHeadlessFingerprint(fingerprint) || typeof credential !== "string" ||
      credential.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return undefined;
  // Build the sole path locally. The pinned Agent attaches HTTP only to
  // the exact verified TLS socket; no proxy or redirect changes the target.
  const address = new URL("/aisb-headless/v1/read", endpoint);
  const agent = loopback.createDesktopPinnedLoopbackAgent(endpoint, fingerprint);
  const authorization = `Bearer ${credential}`;
  let active = 0;
  return async (input: HeadlessReadRequest, signal?: AbortSignal): Promise<ReadResult> => {
    if (active >= MAX_ACTIVE || signal?.aborted) return unavailable;
    active++;
    try {
      const { status, raw } = await sendRead(address, agent, authorization, input, signal);
      if (status >= 400 && status < 600) {
        const error = resultError.safeParse(raw);
        return error.success ? error.data : unavailable;
      }
      if (status !== 200) return unavailable;
      const expected = z.strictObject({ ok: z.literal(true), operation: z.literal(input.operation), value: resultValue[input.operation] });
      const parsed = expected.safeParse(raw);
      if (!parsed.success) return unavailable;
      if (input.operation === "systems.read" &&
          (!parsed.data.value || typeof parsed.data.value !== "object" || !("systemId" in parsed.data.value) ||
            parsed.data.value.systemId !== input.input.systemId)) return unavailable;
      return parsed.data;
    } catch {
      return unavailable;
    } finally {
      active--;
    }
  };
}

function sendRead(address: URL, agent: Agent, authorization: string, input: HeadlessReadRequest, signal?: AbortSignal) {
  const body = JSON.stringify(input);
  return new Promise<{ status: number; raw: unknown }>((resolve, reject) => {
    const client = request(address, {
      method: "POST",
      agent,
      signal,
      headers: { Authorization: authorization, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      if (response.headers["content-type"] !== "application/json" || response.headers["content-encoding"] ||
          response.statusCode === undefined || !response.headers["content-length"] ||
          !/^[1-9][0-9]{0,5}$/.test(response.headers["content-length"])) {
        client.destroy(new Error("Invalid connector response."));
        return;
      }
      const length = Number(response.headers["content-length"]);
      if (length > MAX_RESULT_BYTES) {
        client.destroy(new Error("Invalid connector response."));
        return;
      }
      const bytes = Buffer.allocUnsafe(length);
      let offset = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        if (offset + chunk.length > length) client.destroy(new Error("Invalid connector response."));
        else offset += chunk.copy(bytes, offset);
      });
      response.on("end", () => {
        if (offset !== length) { reject(new Error("Invalid connector response.")); return; }
        try {
          const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          const raw: unknown = JSON.parse(text);
          if (JSON.stringify(raw) !== text) throw new Error("Invalid connector response.");
          resolve({ status: response.statusCode!, raw });
        } catch { reject(new Error("Invalid connector response.")); }
      });
    });
    const timer = setTimeout(() => client.destroy(new Error("Local connector timed out.")), DEADLINE_MS);
    client.on("close", () => clearTimeout(timer));
    client.on("error", reject);
    client.end(body);
  });
}
