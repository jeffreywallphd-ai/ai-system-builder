import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { StructuredDocumentStore } from "../../persistence/shared";
import { HEADLESS_READ_OPERATIONS, type HeadlessReadOperation } from "../../../contracts/headless";
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
};
type Pairing = {
  readonly workspaceId: WorkspaceId;
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
  readonly now?: () => number;
}) {
  const { documents, canReadWorkspace, now = Date.now } = dependencies;
  const { organizationId, principalId } = dependencies.identity;
  if (documents.organizationId !== organizationId || !principalId) throw new Error("Desktop client authority is unavailable.");
  let pending: Pairing | undefined;
  let generation = 0;
  let open = true;
  let completing = false;

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
    async beginPairing(workspaceId: WorkspaceId, isStillApproved: () => boolean = () => true) {
      if (!open || completing || !isWorkspaceId(workspaceId) || !isStillApproved()) return denied;
      const attempt = ++generation;
      pending = undefined;
      try {
        if (!await canReadWorkspace(workspaceId) || !open || attempt !== generation || !isStillApproved()) return denied;
        const pairingCode = secureRandomBase64Url(32);
        const expiresAt = now() + PAIRING_TTL_MS;
        pending = {
          workspaceId, expiresAt, codeDigest: digest("pairing", pairingCode), remainingAttempts: MAX_PAIRING_ATTEMPTS,
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
        if (!await canReadWorkspace(selected.workspaceId) || !open || generation !== attempt || selected.expiresAt <= now()) return denied;
        const credential = secureRandomBase64Url(32);
        const client: ClientRecord = {
          registeredClientId: randomUUID(),
          principalId,
          workspaceId: selected.workspaceId,
          credentialDigest: digest("credential", credential),
          expiresAt: now() + CREDENTIAL_TTL_MS,
        };
        const saved = await documents.runInTransaction(async (transaction) => {
          const { clients, revision } = await readRegistry(transaction);
          const active = clients.filter((entry) => entry.expiresAt > now());
          if (!open || generation !== attempt || selected.expiresAt <= now() || active.length >= MAX_CLIENTS) return false;
          await transaction.writeDocument(NAMESPACE, KEY, [...active, client], { expectedRevision: revision });
          return true;
        });
        if (!saved || !open || generation !== attempt || selected.expiresAt <= now()) return denied;
        if (!await canReadWorkspace(selected.workspaceId)) return denied;
        const { clients } = await readRegistry(documents);
        if (!open || generation !== attempt || selected.expiresAt <= now() ||
            !clients.some((entry) => entry.registeredClientId === client.registeredClientId &&
              entry.credentialDigest === client.credentialDigest && entry.principalId === principalId &&
              entry.workspaceId === selected.workspaceId && entry.expiresAt > now())) return denied;
        return { status: "paired", credential, registeredClientId: client.registeredClientId, expiresAt: client.expiresAt } as const;
      } catch {
        return unavailable;
      } finally {
        completing = false;
      }
    },
    /** Current registration only. The application must also check current scope on dispatch and return. */
    async verifyCredential(credential: unknown) {
      if (!open || !isSecret(credential)) return undefined;
      try {
        const fingerprint = digest("credential", credential);
        const { clients } = await readRegistry(documents);
        const client = clients.find((entry) => digestEqual(entry.credentialDigest, fingerprint));
        if (!open || !client || client.principalId !== principalId || client.expiresAt <= now()) return undefined;
        return {
          organizationId, principalId, registeredClientId: client.registeredClientId,
          workspaceIds: [client.workspaceId], operations: READ_PERMISSIONS,
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
            .map(({ registeredClientId, workspaceId, expiresAt }) => ({ registeredClientId, workspaceId, expiresAt })),
        } as const;
      } catch {
        return unavailable;
      }
    },
    /** Trusted interactive revocation of one exact identity. */
    async revokeClient(clientId: unknown) {
      if (!open || typeof clientId !== "string" || clientId.length !== 36 || !CLIENT_ID_PATTERN.test(clientId)) return false;
      try {
        return await documents.runInTransaction(async (transaction) => {
          const { clients, revision } = await readRegistry(transaction);
          const active = clients.filter((entry) => !(entry.registeredClientId === clientId && entry.principalId === principalId));
          if (!open || active.length === clients.length) return false;
          await transaction.writeDocument(NAMESPACE, KEY, active, { expectedRevision: revision });
          return true;
        });
      } catch {
        return false;
      }
    },
    close() {
      open = false;
      generation++;
      pending = undefined;
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
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 5) return false;
  const record = value as Partial<ClientRecord>;
  return typeof record.registeredClientId === "string" && record.registeredClientId.length === 36 &&
    CLIENT_ID_PATTERN.test(record.registeredClientId) &&
    typeof record.principalId === "string" && record.principalId.length > 0 && record.principalId.length <= 200 &&
    isWorkspaceId(record.workspaceId) && typeof record.credentialDigest === "string" &&
    record.credentialDigest.length === 64 && DIGEST_PATTERN.test(record.credentialDigest) &&
    typeof record.expiresAt === "number" && Number.isSafeInteger(record.expiresAt) && record.expiresAt > 0;
}
