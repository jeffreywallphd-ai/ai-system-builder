import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { StructuredDocumentStore } from "../../persistence/shared";
import {
  DESKTOP_HEADLESS_AUTHORING_OPERATIONS, HEADLESS_READ_OPERATIONS, isDesktopHeadlessClientAccess,
  type DesktopHeadlessClientAccess, type HeadlessReadOperation,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import { secureRandomBase64Url } from "../shared/secureRandom";

const NAMESPACE = "headless-client-authority";
const KEY = "clients-v1";
const MAX_CLIENTS = 32;
const PAIRING_TTL_MS = 120_000;
const MAX_PAIRING_ATTEMPTS = 5;
const CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const READ_PERMISSIONS: readonly HeadlessReadOperation[] = HEADLESS_READ_OPERATIONS;

type DesktopIdentity = Pick<LocalIdentityProfile, "organizationId" | "principalId">;
type ClientRecord = {
  readonly registeredClientId: string;
  readonly principalId: string;
  readonly workspaceId: WorkspaceId;
  readonly credentialDigest: string;
  readonly expiresAt: number;
  readonly access?: Exclude<DesktopHeadlessClientAccess, "read">;
};
type Pairing = {
  readonly workspaceId: WorkspaceId;
  readonly access: DesktopHeadlessClientAccess;
  readonly codeDigest: string;
  readonly expiresAt: number;
  remainingAttempts: number;
};

const denied = { status: "denied" } as const;
const unavailable = { status: "unavailable" } as const;

/** Construct only inside the trusted desktop host. No public route is registered here. */
export function createDesktopHeadlessClientAuthority(dependencies: {
  readonly documents: StructuredDocumentStore;
  readonly identity: DesktopIdentity;
  /** Must check current workspace and organization authority. Never trust a UI selection. */
  readonly canReadWorkspace: (workspaceId: WorkspaceId) => Promise<boolean>;
  readonly canAuthorWorkspace?: (workspaceId: WorkspaceId) => Promise<boolean>;
  readonly canRunConversation?: (workspaceId: WorkspaceId) => Promise<boolean>;
  readonly canPresent?: (workspaceId: WorkspaceId) => Promise<boolean>;
  readonly now?: () => number;
}) {
  const { documents, canReadWorkspace, now = Date.now } = dependencies;
  const { organizationId, principalId } = dependencies.identity;
  if (documents.organizationId !== organizationId || !principalId) throw new Error("Desktop client authority is unavailable.");
  let pending: Pairing | undefined;
  let generation = 0;
  let grantGeneration = 0;
  let open = true;
  let completing = false;
  const revoking = new Set<string>();
  const presentationClients = new Map<string, { readonly expiresAt: number }>();
  const canUseWorkspace = (workspaceId: WorkspaceId, access: DesktopHeadlessClientAccess) =>
    access === "author" ? dependencies.canAuthorWorkspace?.(workspaceId) ?? Promise.resolve(false)
      : access === "conversation" ? dependencies.canRunConversation?.(workspaceId) ?? Promise.resolve(false)
      : access === "presentation" ? dependencies.canPresent?.(workspaceId) ?? Promise.resolve(false)
      : canReadWorkspace(workspaceId);

  async function readRegistry(store: StructuredDocumentStore) {
    const saved = await store.readDocument<unknown>(NAMESPACE, KEY);
    const value = saved ? saved.value : [];
    if (!Array.isArray(value) || value.length > MAX_CLIENTS || !value.every(validRecord) ||
        new Set(value.map((client) => client.registeredClientId)).size !== value.length ||
        new Set(value.map((client) => client.credentialDigest)).size !== value.length) {
      throw new Error("Desktop client registry is unavailable.");
    }
    return { clients: value, revision: saved?.revision ?? 0 };
  }

  return {
    /** Trusted, explicit interactive action only. Do not expose to the connector. */
    async beginPairing(workspaceId: WorkspaceId, isStillApproved: () => boolean = () => true, access: DesktopHeadlessClientAccess = "read") {
      if (!open || completing || !isWorkspaceId(workspaceId) || !isStillApproved() ||
          !isDesktopHeadlessClientAccess(access)) return denied;
      const attempt = ++generation;
      pending = undefined;
      try {
        if (!await canUseWorkspace(workspaceId, access) || !open || attempt !== generation || !isStillApproved()) return denied;
        const pairingCode = secureRandomBase64Url(32);
        const expiresAt = now() + PAIRING_TTL_MS;
        pending = {
          workspaceId, access, expiresAt, codeDigest: digest("pairing", pairingCode), remainingAttempts: MAX_PAIRING_ATTEMPTS,
        };
        return { status: "ready", pairingCode, expiresAt } as const;
      } catch {
        return unavailable;
      }
    },
    async completePairing(pairingCode: unknown) {
      const selected = pending;
      if (!open || !selected || selected.expiresAt <= now()) {
        pending = undefined;
        return denied;
      }
      const validCode = isSecret(pairingCode) && digestEqual(selected.codeDigest, digest("pairing", pairingCode));
      if (--selected.remainingAttempts === 0 || validCode) pending = undefined;
      if (!validCode) return denied;
      const attempt = generation;
      completing = true;
      try {
        if (!await canUseWorkspace(selected.workspaceId, selected.access) || !open || generation !== attempt || selected.expiresAt <= now()) return denied;
        const credential = secureRandomBase64Url(32);
        const client: ClientRecord = {
          registeredClientId: randomUUID(),
          principalId,
          workspaceId: selected.workspaceId,
          credentialDigest: digest("credential", credential),
          expiresAt: now() + CREDENTIAL_TTL_MS,
          ...(selected.access !== "read" ? { access: selected.access } : {}),
        };
        const saved = await documents.runInTransaction(async (transaction) => {
          const { clients, revision } = await readRegistry(transaction);
          const active = clients.filter((entry) => entry.expiresAt > now());
          if (!open || generation !== attempt || selected.expiresAt <= now() || active.length >= MAX_CLIENTS) return false;
          await transaction.writeDocument(NAMESPACE, KEY, [...active, client], { expectedRevision: revision });
          return true;
        });
        if (!saved || !open || generation !== attempt || selected.expiresAt <= now()) return denied;
        if (!await canUseWorkspace(selected.workspaceId, selected.access)) return denied;
        const publication = grantGeneration;
        const { clients } = await readRegistry(documents);
        if (!open || generation !== attempt || grantGeneration !== publication || revoking.has(client.registeredClientId) ||
            selected.expiresAt <= now() ||
            !clients.some((entry) => entry.registeredClientId === client.registeredClientId &&
              entry.credentialDigest === client.credentialDigest && entry.principalId === principalId &&
              entry.workspaceId === selected.workspaceId && entry.access === client.access && entry.expiresAt > now())) return denied;
        return { status: "paired", credential, registeredClientId: client.registeredClientId,
          expiresAt: client.expiresAt, access: selected.access } as const;
      } catch {
        return unavailable;
      } finally {
        completing = false;
      }
    },
    /** Current registration only. The application must also check current scope on dispatch and return. */
    async verifyCredential(credential: unknown) {
      if (!open || !isSecret(credential)) return undefined;
      const attempt = grantGeneration;
      try {
        const fingerprint = digest("credential", credential);
        const { clients } = await readRegistry(documents);
        const client = clients.find((entry) => digestEqual(entry.credentialDigest, fingerprint));
        if (!open || grantGeneration !== attempt || !client || revoking.has(client.registeredClientId) ||
            client.principalId !== principalId || client.expiresAt <= now()) return undefined;
        const isCurrent = () => open && grantGeneration === attempt &&
          !revoking.has(client.registeredClientId) && client.expiresAt > now();
        let presentation: { readonly expiresAt: number } | undefined;
        if (client.access === "presentation" && dependencies.canPresent) {
          for (const [id, entry] of presentationClients) if (entry.expiresAt <= now()) presentationClients.delete(id);
          presentation = presentationClients.get(client.registeredClientId);
          if (!presentation) {
            if (presentationClients.size >= MAX_CLIENTS) return undefined;
            presentation = { expiresAt: client.expiresAt };
            presentationClients.set(client.registeredClientId, presentation);
          }
        }
        const isPresentationCurrent = () => !!presentation && open && client.expiresAt > now() &&
          !revoking.has(client.registeredClientId) && presentationClients.get(client.registeredClientId) === presentation;
        if (client.access === "conversation" &&
            (await canUseWorkspace(client.workspaceId, "conversation") !== true || !isCurrent())) return undefined;
        return {
          organizationId, principalId, registeredClientId: client.registeredClientId,
          workspaceIds: [client.workspaceId], operations: READ_PERMISSIONS,
          authoring: client.access === "author" && dependencies.canAuthorWorkspace ? DESKTOP_HEADLESS_AUTHORING_OPERATIONS : [],
          ...(client.access === "conversation" ? { conversation: true as const } : {}),
          ...(presentation ? {
            presentation: true as const, isPresentationCurrent,
          } : {}),
          isCurrent,
        } as const;
      } catch {
        return undefined;
      }
    },
    /** Trusted interactive status projection. Never include codes, hashes or bearer credentials. */
    async listClients() {
      if (!open) return unavailable;
      try {
        const { clients } = await readRegistry(documents);
        if (!open) return unavailable;
        return {
          status: "ready",
          clients: clients.filter((entry) => entry.principalId === principalId && entry.expiresAt > now())
            .map(({ registeredClientId, workspaceId, expiresAt, access }) => ({ registeredClientId, workspaceId, expiresAt, ...(access ? { access } : {}) })),
        } as const;
      } catch {
        return unavailable;
      }
    },
    /** Trusted interactive revocation of one exact identity. */
    async revokeClient(clientId: unknown) {
      if (!open || typeof clientId !== "string" || clientId.length !== 36 || !CLIENT_ID_PATTERN.test(clientId) ||
          revoking.has(clientId) || revoking.size >= MAX_CLIENTS) return false;
      grantGeneration++;
      revoking.add(clientId);
      presentationClients.delete(clientId);
      try {
        const removed = await documents.runInTransaction(async (transaction) => {
          const { clients, revision } = await readRegistry(transaction);
          const active = clients.filter((entry) => !(entry.registeredClientId === clientId && entry.principalId === principalId));
          if (!open || active.length === clients.length) return false;
          await transaction.writeDocument(NAMESPACE, KEY, active, { expectedRevision: revision });
          return true;
        });
        revoking.delete(clientId);
        return removed;
      } catch {
        // The saved outcome is unknown. Refuse this credential until a
        // trusted restart rereads the saved registration.
        return false;
      }
    },
    close() {
      open = false;
      generation++;
      grantGeneration++;
      pending = undefined;
      presentationClients.clear();
    },
  };
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && SECRET_PATTERN.test(value);
}

function digest(purpose: "pairing" | "credential", value: string): string {
  // Both inputs have 256 random bits; the host stores only the domain-separated digest.
  return createHash("sha256").update(`aisb-headless-${purpose}-v1\0`).update(value).digest("hex");
}

function digestEqual(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validRecord(value: unknown): value is ClientRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<Omit<ClientRecord, "access">> & { readonly access?: unknown };
  const keys = Object.keys(value);
  const fields = ["registeredClientId", "principalId", "workspaceId", "credentialDigest", "expiresAt"];
  if (isDesktopHeadlessClientAccess(record.access) && record.access !== "read") fields.push("access");
  if (keys.length !== fields.length || keys.some((field) => !fields.includes(field))) return false;
  return typeof record.registeredClientId === "string" && record.registeredClientId.length === 36 &&
    CLIENT_ID_PATTERN.test(record.registeredClientId) &&
    typeof record.principalId === "string" && record.principalId.length > 0 && record.principalId.length <= 200 &&
    isWorkspaceId(record.workspaceId) && typeof record.credentialDigest === "string" &&
    record.credentialDigest.length === 64 && DIGEST_PATTERN.test(record.credentialDigest) &&
    typeof record.expiresAt === "number" && Number.isSafeInteger(record.expiresAt) && record.expiresAt > 0;
}
