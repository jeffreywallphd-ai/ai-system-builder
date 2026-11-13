import { X509Certificate } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { Duplex } from "node:stream";
import { performance } from "node:perf_hooks";
import selfsigned from "selfsigned";
import {
  parseHeadlessSemanticBatchRequest, parseHeadlessSystemManagementRequest, readHeadlessAuthoringWireResult,
  type HeadlessAuthoringWireResult, type HeadlessHostIncarnationId, type HeadlessReadResult,
  type HeadlessSemanticBatchRequest, type HeadlessSystemManagementRequest,
} from "../../../contracts/headless";
import type { createDesktopHeadlessClientAuthority } from "../../security/headless";

const LOOPBACK = "127.0.0.1";
const PAIR_PATH = "/aisb-headless/v1/pair";
const READ_PATH = "/aisb-headless/v1/read";
const AUTHOR_PATH = "/aisb-headless/v1/author";
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_CONNECTIONS = 16;
const MAX_REQUESTS_PER_SECOND = 128;
const MAX_ACTIVE = 8;
const REQUEST_LIMIT_MS = 5_000;
const TOKEN_PATTERN = /^Bearer ([a-zA-Z0-9_-]{43})$/;

type Registration = ReturnType<typeof createDesktopHeadlessClientAuthority>;
type LegacyGrant = NonNullable<Awaited<ReturnType<Registration["verifyCredential"]>>>;
type Grant = DesktopHeadlessAuthoringWireGrant | undefined;
type AuthoringRequest = HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest;
export interface DesktopHeadlessAuthoringWireGrant extends Pick<LegacyGrant, "organizationId" | "principalId" | "registeredClientId" | "workspaceIds" | "operations"> {
  readonly authoring?: readonly AuthoringRequest["operation"][];
  readonly isCurrent?: () => boolean;
}

export interface DesktopHeadlessLoopback {
  readonly endpoint: string;
  readonly fingerprint: string;
  /** Close local admission and sockets. Host owns subsequent persistence teardown. */
  readonly close: () => Promise<void>;
}

/**
 * The desktop owner starts this only for an explicitly enabled connector.
 * There is no registration/admin/interactive authority route.
 */
export async function startDesktopHeadlessLoopback(dependencies: {
  readonly registrations: Pick<Registration, "completePairing"> & { readonly verifyCredential: (credential: unknown) => Promise<Grant> };
  readonly read: (request: unknown, currentGrant: () => Promise<Grant>) => Promise<HeadlessReadResult>;
  readonly authoring?: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly execute: (request: AuthoringRequest, grant: DesktopHeadlessAuthoringWireGrant,
      currentGrant: () => Promise<DesktopHeadlessAuthoringWireGrant | undefined>) => Promise<HeadlessAuthoringWireResult>;
  };
  /** Allows the owning desktop to keep a newly bound listener dormant until confirmed. */
  readonly isAdmitted?: () => boolean;
}): Promise<DesktopHeadlessLoopback> {
  const now = new Date();
  const pems = await selfsigned.generate([{ name: "commonName", value: LOOPBACK }], {
    algorithm: "sha256", keySize: 2048, notBeforeDate: now,
    notAfterDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    extensions: [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true },
      { name: "extKeyUsage", serverAuth: true }, { name: "subjectAltName", altNames: [{ type: 7, ip: LOOPBACK }] }],
  });
  const fingerprint = new X509Certificate(pems.cert).fingerprint256.replaceAll(":", "").toLowerCase();
  let port: number | undefined;
  let open = true;
  const active = new Set<Promise<void>>();
  const sockets = new Set<Duplex>();
  let windowStart = performance.now();
  let admitted = 0;
  let socketsClosed: Promise<void> | undefined;
  const admitting = () => open && (dependencies.isAdmitted?.() ?? true);
  const server = createServer({
    cert: pems.cert,
    key: pems.private,
    minVersion: "TLSv1.3",
    handshakeTimeout: REQUEST_LIMIT_MS,
    headersTimeout: REQUEST_LIMIT_MS,
    requestTimeout: REQUEST_LIMIT_MS,
    connectionsCheckingInterval: 500,
    keepAliveTimeout: 1_000,
    maxHeaderSize: 8 * 1024,
  }, (request, response) => {
    const current = performance.now();
    if (current - windowStart >= 1_000) {
      windowStart = current;
      admitted = 0;
    }
    if (!admitting() || active.size >= MAX_ACTIVE || admitted >= MAX_REQUESTS_PER_SECOND) {
      fail(response, 503, "headless.unavailable");
      return;
    }
    admitted++;
    response.setTimeout(REQUEST_LIMIT_MS, () => response.destroy());
    const task = serve(request, response).catch(() => {
      try { fail(response, 503, "headless.unavailable"); } catch { response.destroy(); }
    });
    active.add(task);
    void task.then(() => { active.delete(task); });
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.on("connection", (socket) => {
    if (!open || sockets.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => { sockets.delete(socket); });
  });
  server.maxRequestsPerSocket = 8;
  server.setTimeout(REQUEST_LIMIT_MS, (socket) => socket.destroy());
  server.on("checkContinue", (_request, response) => fail(response, 417, "headless.invalid-request"));
  server.on("checkExpectation", (_request, response) => fail(response, 417, "headless.invalid-request"));
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());

  async function close(): Promise<void> {
    if (!socketsClosed) {
      open = false;
      socketsClosed = new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(new Error("Desktop connector shutdown could not be confirmed.")) : resolve());
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([socketsClosed, ...active]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Desktop connector shutdown could not be confirmed.")), REQUEST_LIMIT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function serve(request: IncomingMessage, response: ServerResponse) {
    if (port === undefined || request.socket.remoteAddress !== LOOPBACK ||
        uniqueHeader(request, "host") !== `${LOOPBACK}:${port}` ||
        hasHeader(request, "origin") || hasHeader(request, "forwarded") ||
        Object.keys(request.headers).some((name) => name.startsWith("x-forwarded-"))) {
      fail(response, 403, "headless.forbidden");
      return;
    }
    if (request.method !== "POST" || (request.url !== PAIR_PATH && request.url !== READ_PATH &&
        (request.url !== AUTHOR_PATH || !dependencies.authoring))) {
      fail(response, 404, "headless.not-found");
      return;
    }
    if (uniqueHeader(request, "content-type") !== "application/json" || hasHeader(request, "content-encoding") ||
        hasHeader(request, "transfer-encoding")) {
      fail(response, 400, "headless.invalid-request");
      return;
    }
    const declaredLength = uniqueHeader(request, "content-length");
    if (!declaredLength || !/^[1-9][0-9]{0,6}$/.test(declaredLength)) {
      fail(response, 400, "headless.invalid-request");
      return;
    }
    const length = Number(declaredLength);
    if (length > MAX_REQUEST_BYTES) {
      fail(response, 413, "headless.invalid-request");
      return;
    }

    if (request.url === PAIR_PATH) {
      if (hasHeader(request, "authorization")) {
        fail(response, 400, "headless.invalid-request");
        return;
      }
      const body = await decodeRequest(request, length);
      if (!isPairRequest(body)) {
        fail(response, 400, "headless.invalid-request");
        return;
      }
      if (!admitting() || response.destroyed) return;
      const pairing = await dependencies.registrations.completePairing(body.pairingCode);
      if (!admitting() || response.destroyed) return;
      if (pairing.status !== "paired") {
        fail(response, pairing.status === "unavailable" ? 503 : 403,
          pairing.status === "unavailable" ? "headless.unavailable" : "headless.forbidden");
        return;
      }
      const currentGrant = await dependencies.registrations.verifyCredential(pairing.credential);
      if (!admitting() || response.destroyed) return;
      if (currentGrant?.registeredClientId !== pairing.registeredClientId || !grantIsCurrent(currentGrant)) {
        fail(response, 403, "headless.forbidden");
        return;
      }
      send(response, 200, { ok: true, value: {
        credential: pairing.credential,
        registeredClientId: pairing.registeredClientId,
        expiresAt: pairing.expiresAt,
      } });
      return;
    }

    const credential = TOKEN_PATTERN.exec(uniqueHeader(request, "authorization") ?? "")?.[1];
    const initialGrant: DesktopHeadlessAuthoringWireGrant | undefined = credential
      ? await dependencies.registrations.verifyCredential(credential) : undefined;
    if (!credential || !initialGrant || !grantIsCurrent(initialGrant) || !admitting() || response.destroyed) {
      fail(response, 403, "headless.forbidden");
      return;
    }
    const body = await decodeRequest(request, length);
    if (body === undefined) {
      fail(response, 400, "headless.invalid-request");
      return;
    }
    if (!admitting() || response.destroyed) return;
    const requiresFence = request.url === AUTHOR_PATH || initialGrant.isCurrent !== undefined;
    const currentGrant = async (): Promise<DesktopHeadlessAuthoringWireGrant | undefined> => {
      if (!admitting() || response.destroyed) return undefined;
      const current: DesktopHeadlessAuthoringWireGrant | undefined = await dependencies.registrations.verifyCredential(credential);
      if (!admitting() || response.destroyed || !current || current.registeredClientId !== initialGrant.registeredClientId ||
          current.principalId !== initialGrant.principalId || current.organizationId !== initialGrant.organizationId ||
          !sameScope(current, initialGrant) || !grantIsCurrent(current, requiresFence)) return undefined;
      return current;
    };
    let result: HeadlessReadResult | HeadlessAuthoringWireResult;
    if (request.url === AUTHOR_PATH && dependencies.authoring) {
      const { hostIncarnationId, execute } = dependencies.authoring;
      if (!initialGrant.authoring?.length || !initialGrant.isCurrent) { fail(response, 403, "headless.forbidden"); return; }
      const edit = parseHeadlessSemanticBatchRequest(body, hostIncarnationId);
      const management = edit.ok ? undefined : parseHeadlessSystemManagementRequest(body, hostIncarnationId);
      const decoded = edit.ok ? edit.request : management?.ok ? management.request : undefined;
      if (!decoded) {
        const code = !edit.ok && edit.code !== "headless.invalid-request" ? edit.code :
          management && !management.ok ? management.code : "headless.invalid-request";
        fail(response, errorStatus(code), code);
        return;
      }
      if (!initialGrant.authoring.includes(decoded.operation) || !initialGrant.workspaceIds.includes(decoded.input.workspaceId) ||
          !initialGrant.isCurrent()) { fail(response, 403, "headless.forbidden"); return; }
      result = readHeadlessAuthoringWireResult(await execute(decoded, initialGrant, currentGrant));
    } else result = await dependencies.read(body, currentGrant);
    const finalGrant = await currentGrant();
    if (!admitting() || response.destroyed) return;
    if (!finalGrant || !grantIsCurrent(finalGrant, requiresFence)) {
      fail(response, 403, "headless.forbidden");
      return;
    }
    send(response, result.ok ? 200 : errorStatus(result.code), result);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = () => reject(new Error("The desktop connector could not open its loopback listener."));
    server.once("error", onError);
    server.listen(0, LOOPBACK, () => {
      server.off("error", onError);
      server.on("error", () => { void close().catch(() => {}); });
      const address = server.address();
      if (address && typeof address === "object" && address.address === LOOPBACK) {
        port = address.port;
        resolve();
      } else {
        void close().catch(() => {});
        onError();
      }
    });
  });
  return { endpoint: `https://${LOOPBACK}:${port}`, fingerprint, close };
}

function sameScope(left: DesktopHeadlessAuthoringWireGrant, right: DesktopHeadlessAuthoringWireGrant): boolean {
  const equal = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((value) => b.includes(value)) && b.every((value) => a.includes(value));
  return equal(left.workspaceIds, right.workspaceIds) && equal(left.operations, right.operations) &&
    equal(left.authoring ?? [], right.authoring ?? []);
}

function hasHeader(request: IncomingMessage, name: string): boolean {
  return request.headersDistinct[name] !== undefined;
}

function uniqueHeader(request: IncomingMessage, name: string): string | undefined {
  const values = request.headersDistinct[name];
  return values?.length === 1 ? values[0] : undefined;
}

async function decodeRequest(request: IncomingMessage, length: number): Promise<unknown> {
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  try {
    for await (const chunk of request) {
      if (!Buffer.isBuffer(chunk) || offset + chunk.length > length) return undefined;
      offset += chunk.copy(bytes, offset);
    }
    if (offset !== length) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    // Compact JSON from the official adapter only; duplicate object names,
    // leading/trailing input and noncanonical encodings cannot round trip.
    return JSON.stringify(parsed) === text ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPairRequest(value: unknown): value is { readonly pairingCode: string } {
  return typeof value === "object" && value !== null && Object.keys(value).length === 1 &&
    "pairingCode" in value && typeof value.pairingCode === "string" && value.pairingCode.length === 43;
}

function errorStatus(code: Extract<HeadlessReadResult | HeadlessAuthoringWireResult, { ok: false }>["code"]): number {
  switch (code) {
    case "headless.forbidden": return 403;
    case "headless.not-found": return 404;
    case "headless.host-changed": case "headless.stale-revision": case "headless.idempotency-conflict": return 409;
    case "headless.idempotency-expired": return 410;
    case "headless.unavailable": case "headless.operation-unconfirmed": case "headless.operation-capacity": return 503;
    case "headless.result-too-large": return 413;
    default: return 400;
  }
}

function grantIsCurrent(grant: DesktopHeadlessAuthoringWireGrant, required = false): boolean {
  return grant.isCurrent?.() ?? !required;
}

function fail(response: ServerResponse, status: number, code: string): void {
  send(response, status, { ok: false, code });
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  if (response.destroyed || response.headersSent) return;
  let body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    status = 413;
    body = '{"ok":false,"code":"headless.result-too-large"}';
  }
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Connection": "close",
  });
  response.end(body);
}
