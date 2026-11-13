import { isWorkspaceId, type WorkspaceId } from "../workspace";

export const DESKTOP_HEADLESS_PAIRING_CHANNELS = Object.freeze({
  status: "desktop.headless.pairing.status",
  start: "desktop.headless.pairing.start",
  pair: "desktop.headless.pairing.begin",
  revoke: "desktop.headless.pairing.revoke",
});

export type DesktopHeadlessPairingAction = keyof typeof DESKTOP_HEADLESS_PAIRING_CHANNELS;

export type DesktopHeadlessPairingStatus =
  | {
      readonly status: "ready";
      readonly running: boolean;
      readonly endpoint?: string;
      readonly clients: readonly {
        readonly registeredClientId: string;
        readonly workspaceId: WorkspaceId;
        readonly expiresAt: number;
      }[];
    }
  | { readonly status: "unavailable" };

export type DesktopHeadlessPairingResult = "shown" | "canceled" | "denied" | "unavailable";
export type DesktopHeadlessStartResult = "started" | "canceled" | "denied" | "unavailable";
export type DesktopHeadlessRevokeResult = "revoked" | "denied" | "unavailable";

export function isDesktopHeadlessClientId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function isDesktopHeadlessEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 22) return false;
  const port = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value)?.[1];
  return port !== undefined && Number(port) <= 65_535 && value === `http://127.0.0.1:${port}`;
}

/** Rebuild the allowed result projection before crossing the preload boundary. */
export function readDesktopHeadlessPairingStatus(value: unknown): DesktopHeadlessPairingStatus {
  if (typeof value !== "object" || value === null || !("status" in value) ||
      value.status !== "ready" || !("running" in value) || typeof value.running !== "boolean" ||
      !("clients" in value) || !Array.isArray(value.clients) || value.clients.length > 32) return { status: "unavailable" };
  const endpoint = "endpoint" in value ? value.endpoint : undefined;
  if (value.running ? !isDesktopHeadlessEndpoint(endpoint) : endpoint !== undefined) return { status: "unavailable" };
  const clients = [];
  for (const item of value.clients) {
    if (typeof item !== "object" || item === null || !("registeredClientId" in item) ||
        !isDesktopHeadlessClientId(item.registeredClientId) || !("workspaceId" in item) ||
        !isWorkspaceId(item.workspaceId) || !("expiresAt" in item) || typeof item.expiresAt !== "number" || !Number.isSafeInteger(item.expiresAt) ||
        item.expiresAt <= 0) return { status: "unavailable" };
    const { registeredClientId, workspaceId, expiresAt } = item as {
      registeredClientId: string; workspaceId: WorkspaceId; expiresAt: number;
    };
    clients.push({ registeredClientId, workspaceId, expiresAt });
  }
  return { status: "ready", running: value.running, clients, ...(isDesktopHeadlessEndpoint(endpoint) ? { endpoint } : {}) };
}
