import {
  isDesktopHeadlessClientId,
  readHeadlessLocalFileImportRequest,
  type HeadlessHostIncarnationId,
} from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential } from "../../../contracts/shared";
import type { ApplicationRequestContext } from "../../ports";
import type { HeadlessLocalFileSelectionPort } from "../../ports/ingestion/headless-local-file-selection.port";
import type { ReadHeadlessIngestionStatusUseCase } from "./headless-ingestion-status.use-case";

interface LocalSelectionAuthority {
  readonly context: ApplicationRequestContext;
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly registeredClientId: string;
  readonly stillAllowed: () => Promise<boolean>;
  readonly isCurrent: () => boolean;
}

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const notReady = { ok: false, code: "headless.source-not-ready" } as const;

export class HeadlessLocalFileSelectionUseCase {
  public constructor(
    private readonly selections: HeadlessLocalFileSelectionPort,
    private readonly ingestion: Pick<ReadHeadlessIngestionStatusUseCase, "prepareLocalFileImport">,
    private readonly now: () => number = Date.now,
  ) {}

  /** The host calls this only for a verified selection made in the app. */
  public async recordSelectedFile(
    raw: unknown,
    authority: LocalSelectionAuthority & { readonly expectedSelectionRevision: number },
  ) {
    const verified = resolveSelection(raw, authority);
    const expectedRevision = authority.expectedSelectionRevision;
    if (!verified || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        expectedRevision >= Number.MAX_SAFE_INTEGER) return forbidden;
    const { selection, request, isCurrent, access } = verified;
    let checkpointDeadline: number | undefined;
    try {
      const ready = await this.ingestion.prepareLocalFileImport(request, access);
      if (!ready.ok) return ready;
      checkpointDeadline = ready.value.checkpointExpiresAt;
      const canRecord = () => isCurrent() && this.beforeCheckpointDeadline(ready.value.checkpointExpiresAt);
      if (!await access.stillAllowed() || !isCurrent()) return forbidden;
      if (!canRecord()) return notReady;
      const selectionRevision = await this.selections.record(selection, expectedRevision, canRecord);
      if (!isCurrent()) return forbidden;
      if (!this.beforeCheckpointDeadline(checkpointDeadline)) return notReady;
      if (!selectionRevision) return forbidden;
      const observed = await this.readCurrentSelection(verified);
      return observed.ok ? { ...observed, selectionRevision } : observed;
    } catch {
      if (!isCurrent()) return forbidden;
      return checkpointDeadline !== undefined && !this.beforeCheckpointDeadline(checkpointDeadline) ? notReady : unavailable;
    }
  }

  /** The agent can preview only the current explicit selection for its own connection. */
  public async previewSelectedFile(raw: unknown, authority: LocalSelectionAuthority) {
    const verified = resolveSelection(raw, authority);
    return verified ? this.readCurrentSelection(verified) : forbidden;
  }

  private async readCurrentSelection(verified: NonNullable<ReturnType<typeof resolveSelection>>) {
    const { selection, request, isCurrent, access } = verified;
    try {
      if (!await access.stillAllowed() || !isCurrent() || !await this.selections.matches(selection)) return forbidden;
      const ready = await this.ingestion.prepareLocalFileImport(request, access);
      if (!await access.stillAllowed() || !isCurrent()) return forbidden;
      // Re-read the saved selection and exact upload together after the last awaited policy check.
      const observed = await this.selections.observe(selection);
      if (!observed || !isCurrent()) return forbidden;
      if (!ready.ok) return ready;
      if (observed.ok && !this.beforeCheckpointDeadline(observed.value.checkpointExpiresAt)) return notReady;
      return observed;
    } catch {
      return isCurrent() ? unavailable : forbidden;
    }
  }

  private beforeCheckpointDeadline(deadline: number) {
    const observedAt = this.now();
    return Number.isSafeInteger(observedAt) && observedAt > 0 && observedAt < deadline;
  }
}

function resolveSelection(raw: unknown, authority: LocalSelectionAuthority) {
  const context = { ...authority.context };
  const { organizationId, principalId } = context;
  const { registeredClientId } = authority;
  const parsed = readHeadlessLocalFileImportRequest(raw, authority.hostIncarnationId);
  if (!parsed.ok || context.workspaceId !== parsed.request.input.workspaceId ||
      !isOrganizationId(organizationId) || typeof principalId !== "string" ||
      principalId.length === 0 || principalId.length > 160 || principalId.trim() !== principalId ||
      /[\u0000-\u001f\u007f]/.test(principalId) || hasKnownPassiveCredential(principalId) ||
      !isDesktopHeadlessClientId(registeredClientId)) return;
  const isCurrent = () => {
    try { return authority.isCurrent() === true; }
    catch { return false; }
  };
  const stillAllowed = async () => {
    try { return isCurrent() && await authority.stillAllowed() === true && isCurrent(); }
    catch { return false; }
  };
  return {
    selection: { organizationId, principalId, registeredClientId, target: parsed.request.input },
    request: parsed.request,
    isCurrent,
    access: { context, stillAllowed },
  };
}
