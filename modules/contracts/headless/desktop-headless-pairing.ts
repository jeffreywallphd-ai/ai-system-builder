import { isWorkspaceId, type WorkspaceId } from "../workspace";

export const DESKTOP_HEADLESS_PAIRING_CHANNELS = Object.freeze({
  status: "desktop.headless.pairing.status",
  start: "desktop.headless.pairing.start",
  pair: "desktop.headless.pairing.begin",
  revoke: "desktop.headless.pairing.revoke",
});

export type DesktopHeadlessPairingAction = keyof typeof DESKTOP_HEADLESS_PAIRING_CHANNELS;
export type DesktopHeadlessClientAccess = "read" | "author" | "conversation" | "presentation";

export function isDesktopHeadlessClientAccess(value: unknown): value is DesktopHeadlessClientAccess {
  return value === "read" || value === "author" || value === "conversation" || value === "presentation";
}

export const DESKTOP_HEADLESS_AUTHORING_OPERATIONS = Object.freeze([
  "systems.preview-edits", "systems.apply-edits", "systems.create", "systems.rename", "systems.clone",
] as const);
export type DesktopHeadlessAuthoringOperation = typeof DESKTOP_HEADLESS_AUTHORING_OPERATIONS[number];

/** The previous workspace-only IPC shape remains explicitly read-only. */
export function readDesktopHeadlessPairingRequest(value: unknown): {
  readonly workspaceId: WorkspaceId;
  readonly access: DesktopHeadlessClientAccess;
} | undefined {
  if (isWorkspaceId(value)) return { workspaceId: value, access: "read" };
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 2) return undefined;
    const workspace = Object.getOwnPropertyDescriptor(value, "workspaceId");
    const mode = Object.getOwnPropertyDescriptor(value, "access");
    if (!workspace?.enumerable || !("value" in workspace) || !isWorkspaceId(workspace.value) ||
        !mode?.enumerable || !("value" in mode) || !isDesktopHeadlessClientAccess(mode.value)) return undefined;
    return { workspaceId: workspace.value, access: mode.value };
  } catch { return undefined; }
}

export type DesktopHeadlessPairingStatus =
  | {
      readonly status: "ready";
      readonly running: boolean;
      readonly endpoint?: string;
      readonly fingerprint?: string;
      readonly conversationAvailable?: true;
      readonly presentationAvailable?: true;
      readonly clients: readonly {
        readonly registeredClientId: string;
        readonly workspaceId: WorkspaceId;
        readonly expiresAt: number;
        readonly access?: DesktopHeadlessClientAccess;
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
  if (typeof value !== "string" || value.length > 23) return false;
  const port = /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value)?.[1];
  return port !== undefined && Number(port) <= 65_535 && value === `https://127.0.0.1:${port}`;
}

export function isDesktopHeadlessFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
}

/** Rebuild the allowed result projection before crossing the preload boundary. */
export function readDesktopHeadlessPairingStatus(value: unknown): DesktopHeadlessPairingStatus {
  if (typeof value !== "object" || value === null || !("status" in value) ||
      value.status !== "ready" || !("running" in value) || typeof value.running !== "boolean" ||
      !("clients" in value) || !Array.isArray(value.clients) || value.clients.length > 32) return { status: "unavailable" };
  const endpoint = "endpoint" in value ? value.endpoint : undefined;
  const fingerprint = "fingerprint" in value ? value.fingerprint : undefined;
  const address = isDesktopHeadlessEndpoint(endpoint) && isDesktopHeadlessFingerprint(fingerprint) ? { endpoint, fingerprint } : undefined;
  if (value.running ? !address : endpoint !== undefined || fingerprint !== undefined) return { status: "unavailable" };
  const clients = [];
  for (const item of value.clients) {
    if (typeof item !== "object" || item === null || !("registeredClientId" in item) ||
        !isDesktopHeadlessClientId(item.registeredClientId) || !("workspaceId" in item) ||
        !isWorkspaceId(item.workspaceId) || !("expiresAt" in item) || typeof item.expiresAt !== "number" || !Number.isSafeInteger(item.expiresAt) ||
        item.expiresAt <= 0) return { status: "unavailable" };
    const { registeredClientId, workspaceId, expiresAt } = item as {
      registeredClientId: string; workspaceId: WorkspaceId; expiresAt: number;
    };
    const access = "access" in item ? item.access : undefined;
    if (access !== undefined && !isDesktopHeadlessClientAccess(access)) return { status: "unavailable" };
    clients.push({ registeredClientId, workspaceId, expiresAt, ...(access && access !== "read" ? { access } : {}) });
  }
  return { status: "ready", running: value.running, clients, ...address,
    ...("conversationAvailable" in value && value.conversationAvailable === true ? { conversationAvailable: true as const } : {}),
    ...("presentationAvailable" in value && value.presentationAvailable === true ? { presentationAvailable: true as const } : {}) };
}
