import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { UiControlInteractiveOwner } from "../../../application/services/ui-control/ui-control-authority.service";
import {
  isUiControlId, readUiControlWindow, type HeadlessHostIncarnationId, type UiControlWindowTarget,
} from "../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../contracts/organization";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import type { ManagedHeadlessBrowserIdentity } from "../security/resolveManagedHeadlessClientPolicy";

const LIVE_MS = 12_000;
const MAX_AUTHORIZATIONS = 16;
const MAX_DOCUMENTS = 32;
const digest = (value: string) => createHash("sha256").update(value).digest();

type Principal = Pick<OrganizationRequestContext, "organizationId" | "principalId">;
type BrowserIdentity = ManagedHeadlessBrowserIdentity;
type DocumentEntry = {
  readonly target: UiControlWindowTarget;
  readonly browser: BrowserIdentity;
  readonly owner: UiControlInteractiveOwner;
  readonly key: Buffer;
  expiresAt: number;
};

/** Owns per-document credentials without persisting them or conflating them with an agent identity. */
export function createManagedHeadlessBrowserDocuments(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly authorize: (principal: Principal, workspaceId: WorkspaceId) => Promise<boolean>;
  readonly register: (target: UiControlWindowTarget, owner: UiControlInteractiveOwner) => boolean;
  readonly retire: (target: UiControlWindowTarget, owner: UiControlInteractiveOwner) => boolean;
  readonly now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  const documents = new Map<string, DocumentEntry>();
  let open = true;
  let activeChecks = 0;
  function remove(entry: DocumentEntry) {
    if (documents.get(entry.target.windowId) !== entry) return false;
    documents.delete(entry.target.windowId);
    return options.retire(entry.target, entry.owner);
  }
  function sweep() {
    for (const entry of documents.values()) if (!entry.owner.isCurrent()) remove(entry);
  }
  function live(browser: BrowserIdentity) {
    try {return open && browser.purpose === "browser" && isUiControlId(browser.registeredClientId) &&
      typeof browser.credentialBinding?.sameCredential === "function" && browser.isCurrent();}
    catch {return false;}
  }
  async function permitted(browser: BrowserIdentity, workspaceId: WorkspaceId) {
    if (!live(browser)) return "denied";
    if (activeChecks >= MAX_AUTHORIZATIONS) return "busy";
    activeChecks++;
    try {
      const allowed = await options.authorize(browser, workspaceId);
      return allowed === true && live(browser) ? "allowed" : "denied";
    } catch {return "denied";}
    finally {activeChecks--;}
  }
  function proofEntry(browser: BrowserIdentity, raw: unknown, proof: unknown) {
    if (!live(browser) || typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return;
    const target = readUiControlWindow(raw);
    if (!target || target.hostIncarnationId !== options.hostIncarnationId) return;
    const entry = documents.get(target.windowId);
    if (!entry || entry.target.uiIncarnationId !== target.uiIncarnationId || entry.target.workspaceId !== target.workspaceId ||
        entry.browser.organizationId !== browser.organizationId || entry.browser.principalId !== browser.principalId ||
        entry.browser.registeredClientId !== browser.registeredClientId ||
        !entry.browser.credentialBinding.sameCredential(browser.credentialBinding) || !timingSafeEqual(entry.key, digest(proof))) return;
    return entry;
  }
  return {
    async register(browser: BrowserIdentity, workspaceId: WorkspaceId, requestIsCurrent = () => true) {
      if (!isWorkspaceId(workspaceId) || !requestIsCurrent() ||
          await permitted(browser, workspaceId) !== "allowed" || !requestIsCurrent() || !live(browser)) return;
      sweep();
      if (documents.size >= MAX_DOCUMENTS) return;
      const target = Object.freeze({hostIncarnationId: options.hostIncarnationId,
        windowId: randomUUID(), uiIncarnationId: randomUUID(), workspaceId});
      if (documents.has(target.windowId)) return;
      const proof = randomBytes(32).toString("base64url");
      const owner: UiControlInteractiveOwner = {
        organizationId: browser.organizationId, principalId: browser.principalId,
        isCurrent: () => documents.get(target.windowId) === entry && now() < entry.expiresAt && live(browser),
      };
      const entry = {target, browser, owner, key: digest(proof), expiresAt: now() + LIVE_MS};
      documents.set(target.windowId, entry);
      if (!options.register(target, owner)) {documents.delete(target.windowId); return;}
      return {target, proof};
    },
    async authenticate(browser: BrowserIdentity, raw: unknown, proof: unknown, requestIsCurrent = () => true) {
      if (!requestIsCurrent()) return;
      sweep();
      const entry = proofEntry(browser, raw, proof);
      if (!entry || !entry.owner.isCurrent()) return;
      const admission = await permitted(browser, entry.target.workspaceId);
      if (!requestIsCurrent()) return;
      if (admission !== "allowed") {
        if (admission === "denied") remove(entry);
        return;
      }
      if (!entry.owner.isCurrent() || !live(browser)) return;
      entry.expiresAt = now() + LIVE_MS;
      return {target: entry.target, owner: entry.owner,
        isCurrent: () => entry.owner.isCurrent() && live(browser)};
    },
    retire(browser: BrowserIdentity, raw: unknown, proof: unknown): boolean {
      const entry = proofEntry(browser, raw, proof);
      return entry ? remove(entry) : false;
    },
    close() {
      open = false;
      for (const entry of documents.values()) remove(entry);
    },
  };
}
