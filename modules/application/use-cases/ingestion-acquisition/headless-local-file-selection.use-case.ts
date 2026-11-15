import {
  HEADLESS_CONTRACT_VERSION,
  isDesktopHeadlessClientId,
  readHeadlessLocalFileImportRequest,
  readHeadlessProviderFileImportRequest,
  type HeadlessHostIncarnationId,
  type HeadlessLocalFileImportPreview,
  type HeadlessProviderFileImportPreview,
} from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential } from "../../../contracts/shared";
import type { ApplicationRequestContext } from "../../ports";
import type {
  HeadlessFileSelectionPort,
  HeadlessFileSelectionResult,
  HeadlessLocalFileSelection,
  HeadlessLocalFileSelectionPort,
  HeadlessProviderFileSelectionPort,
} from "../../ports/ingestion/headless-local-file-selection.port";
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

type SelectionTarget = HeadlessLocalFileSelection["target"];
type SelectionAccess = Pick<LocalSelectionAuthority, "context" | "stillAllowed">;
type VerifiedSelection = NonNullable<ReturnType<typeof resolveSelection>>;

class HeadlessFileSelectionUseCase<Preview> {
  public constructor(
    private readonly selections: HeadlessFileSelectionPort<Preview>,
    private readonly profile: {
      readonly parse: (raw: unknown, host: HeadlessHostIncarnationId) =>
        { readonly ok: true; readonly request: { readonly input: SelectionTarget } } | { readonly ok: false };
      readonly prepare: (input: SelectionTarget, access: SelectionAccess) => Promise<HeadlessFileSelectionResult<Preview>>;
      readonly deadline: (preview: Preview) => number;
    },
    private readonly now: () => number,
  ) {}

  /** The host calls this only for a verified selection made in the app. */
  public async recordSelectedFile(
    raw: unknown,
    authority: LocalSelectionAuthority & { readonly expectedSelectionRevision: number },
  ) {
    const verified = this.verifySelection(raw, authority);
    const expectedRevision = authority.expectedSelectionRevision;
    if (!verified || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        expectedRevision >= Number.MAX_SAFE_INTEGER) return forbidden;
    const { selection, isCurrent, access } = verified;
    let selectionDeadline: number | undefined;
    try {
      const ready = await this.profile.prepare(selection.target, access);
      if (!ready.ok) return ready;
      const deadline = this.profile.deadline(ready.value);
      selectionDeadline = deadline;
      const canRecord = () => isCurrent() && this.beforeDeadline(deadline);
      if (!await access.stillAllowed() || !isCurrent()) return forbidden;
      if (!canRecord()) return notReady;
      const selectionRevision = await this.selections.record(selection, expectedRevision, canRecord);
      if (!isCurrent()) return forbidden;
      if (!this.beforeDeadline(deadline)) return notReady;
      if (!selectionRevision) return forbidden;
      const observed = await this.readCurrentSelection(verified);
      return observed.ok ? { ...observed, selectionRevision } : observed;
    } catch {
      if (!isCurrent()) return forbidden;
      return selectionDeadline !== undefined && !this.beforeDeadline(selectionDeadline) ? notReady : unavailable;
    }
  }

  /** The agent can preview only the current explicit selection for its own connection. */
  public async previewSelectedFile(raw: unknown, authority: LocalSelectionAuthority) {
    const verified = this.verifySelection(raw, authority);
    return verified ? this.readCurrentSelection(verified) : forbidden;
  }

  private verifySelection(raw: unknown, authority: LocalSelectionAuthority) {
    const parsed = this.profile.parse(raw, authority.hostIncarnationId);
    return parsed.ok ? resolveSelection(parsed.request.input, authority) : undefined;
  }

  private async readCurrentSelection(verified: VerifiedSelection) {
    const { selection, isCurrent, access } = verified;
    try {
      if (!await access.stillAllowed() || !isCurrent() || !await this.selections.matches(selection)) return forbidden;
      const ready = await this.profile.prepare(selection.target, access);
      if (!await access.stillAllowed() || !isCurrent()) return forbidden;
      // Re-read the saved selection and exact source together after the last awaited policy check.
      const observed = await this.selections.observe(selection);
      if (!observed || !isCurrent()) return forbidden;
      if (!ready.ok) return ready;
      if (observed.ok && !this.beforeDeadline(this.profile.deadline(observed.value))) return notReady;
      return observed;
    } catch {
      return isCurrent() ? unavailable : forbidden;
    }
  }

  private beforeDeadline(deadline: number) {
    const observedAt = this.now();
    return Number.isSafeInteger(observedAt) && observedAt > 0 && observedAt < deadline;
  }
}

export class HeadlessLocalFileSelectionUseCase extends HeadlessFileSelectionUseCase<HeadlessLocalFileImportPreview> {
  public constructor(
    selections: HeadlessLocalFileSelectionPort,
    ingestion: Pick<ReadHeadlessIngestionStatusUseCase, "prepareLocalFileImport">,
    now: () => number = Date.now,
  ) {
    super(selections, {
      parse: readHeadlessLocalFileImportRequest,
      prepare: (input, access) => ingestion.prepareLocalFileImport(
        { version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-file", input }, access),
      deadline: preview => preview.checkpointExpiresAt,
    }, now);
  }
}

export class HeadlessProviderFileSelectionUseCase extends HeadlessFileSelectionUseCase<HeadlessProviderFileImportPreview> {
  public constructor(
    selections: HeadlessProviderFileSelectionPort,
    ingestion: Pick<ReadHeadlessIngestionStatusUseCase, "prepareProviderFileImport">,
    now: () => number = Date.now,
  ) {
    super(selections, {
      parse: readHeadlessProviderFileImportRequest,
      prepare: (input, access) => ingestion.prepareProviderFileImport(
        { version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-provider-file", input }, access),
      deadline: preview => preview.selectionExpiresAt,
    }, now);
  }
}

function resolveSelection(target: SelectionTarget, authority: LocalSelectionAuthority) {
  const context = { ...authority.context };
  const { organizationId, principalId } = context;
  const { registeredClientId } = authority;
  if (context.workspaceId !== target.workspaceId ||
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
    selection: { organizationId, principalId, registeredClientId, target },
    isCurrent,
    access: { context, stillAllowed },
  };
}
