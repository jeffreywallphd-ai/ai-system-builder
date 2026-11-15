import type { HeadlessLocalFileSelection, HeadlessLocalFileSelectionPort } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import {
  HEADLESS_CONTRACT_VERSION,
  isDesktopHeadlessClientId,
  isHeadlessHostIncarnationId,
  projectHeadlessLocalFileImport,
  readHeadlessLocalFileImportRequest,
} from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import type { StructuredDocumentStore } from "../shared";
import { createStructuredIngestionAcquisitionRepository } from "./createStructuredIngestionAcquisitionRepository";

const namespace = "headless/data/local-file-selections";

/** The file already has one stable private identity in this workspace. Keep one selection per file. */
export function createStructuredHeadlessLocalFileSelectionRepository(
  documents: StructuredDocumentStore,
  now: () => number = Date.now,
  writePolicy?: {
    readonly platform: StructuredDocumentStore;
    readonly allows: (owner: StructuredDocumentStore, selection: HeadlessLocalFileSelection) => Promise<boolean>;
  },
): HeadlessLocalFileSelectionPort {
  const organizationId = documents.organizationId;
  if (!organizationId || !documents.runInOwnedTransaction)
    throw new Error("Local file selection requires an organization transaction owner.");
  const owned = documents.runInOwnedTransaction.bind(documents);
  if (writePolicy && (writePolicy.platform.organizationId !== undefined || !writePolicy.platform.runInOwnedTransaction))
    throw new Error("Local file selection policy requires the platform transaction owner.");
  const ownWrite = writePolicy ? writePolicy.platform.runInOwnedTransaction!.bind(writePolicy.platform) : owned;

  return {
    async record(value, expectedRevision, isCurrent) {
      const selection = validate(value);
      if (selection.organizationId !== organizationId || !isCurrent() ||
          !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return;
      const key = selectionKey(selection);
      return ownWrite(async owner => {
        if (!isCurrent()) return;
        if (writePolicy && (!await writePolicy.allows(owner, selection) || !isCurrent())) return;
        const transaction = writePolicy ? owner.forOrganization(organizationId) : owner;
        if (!(await readPreview(transaction, selection, now)).ok || !isCurrent()) return;
        const found = await transaction.readDocument(namespace, key);
        if (found) {
          const existing = validate(found.value);
          if (selectionKey(existing) !== key || existing.organizationId !== organizationId ||
              existing.principalId !== selection.principalId || existing.target.taskRevision > selection.target.taskRevision)
            return;
          if (sameSelection(existing, selection) &&
              (found.revision === expectedRevision || found.revision === expectedRevision + 1))
            return found.revision;
        }
        if ((found?.revision ?? 0) !== expectedRevision || !isCurrent()) return;
        await transaction.writeDocument(namespace, key, selection, { expectedRevision });
        return expectedRevision + 1;
      }, () => {
        if (!isCurrent()) throw new Error("The app selection authority ended.");
      });
    },
    matches(value) {
      return readMatch(documents, validate(value));
    },
    async observe(value) {
      const selection = validate(value);
      if (selection.organizationId !== organizationId) return;
      return owned(transaction => readStructuredHeadlessLocalFileSelection(transaction, selection, now), () => {});
    },
  };
}

/** Read the exact selection and task through a view supplied by the owning caller. */
export async function readStructuredHeadlessLocalFileSelection(
  transaction: StructuredDocumentStore,
  value: HeadlessLocalFileSelection,
  now: () => number = Date.now,
) {
  const selection = validate(value);
  if (await readMatch(transaction, selection)) return readPreview(transaction, selection, now);
}

/** Check the app's exact stored choice while an approved task advances its staging revision. */
export function matchesStructuredHeadlessLocalFileSelection(
  transaction: StructuredDocumentStore, value: HeadlessLocalFileSelection,
): Promise<boolean> {
  return readMatch(transaction, validate(value));
}

async function readMatch(transaction: StructuredDocumentStore, expected: HeadlessLocalFileSelection) {
  if (expected.organizationId !== transaction.organizationId) return false;
  const found = await transaction.readDocument(namespace, selectionKey(expected));
  return Boolean(found && sameSelection(validate(found.value), expected));
}

async function readPreview(transaction: StructuredDocumentStore, selection: HeadlessLocalFileSelection, now: () => number) {
  const { workspaceId, taskId } = selection.target;
  const source = await createStructuredIngestionAcquisitionRepository(transaction).readTask(workspaceId, taskId);
  return source ? projectHeadlessLocalFileImport(source, selection.target, now()) :
    { ok: false, code: "headless.forbidden" } as const;
}

function selectionKey({ target }: HeadlessLocalFileSelection) {
  return [target.workspaceId, target.taskId, target.fileId].join("/");
}

function sameSelection(a: HeadlessLocalFileSelection, b: HeadlessLocalFileSelection) {
  return a.organizationId === b.organizationId && a.principalId === b.principalId &&
    a.registeredClientId === b.registeredClientId && a.target.hostIncarnationId === b.target.hostIncarnationId &&
    selectionKey(a) === selectionKey(b) && a.target.taskRevision === b.target.taskRevision;
}

function validate(value: unknown): HeadlessLocalFileSelection {
  const { organizationId, principalId, registeredClientId, target } = readStrictPassiveRecord(
    value, ["organizationId", "principalId", "registeredClientId", "target"],
  );
  const { hostIncarnationId } = readStrictPassiveRecord(target, ["hostIncarnationId", "workspaceId", "taskId", "fileId", "taskRevision"]);
  if (!isOrganizationId(organizationId) || !isDesktopHeadlessClientId(registeredClientId) ||
      !isHeadlessHostIncarnationId(hostIncarnationId) || typeof principalId !== "string" ||
      principalId.length === 0 || principalId.length > 160 || principalId.trim() !== principalId ||
      /[\u0000-\u001f\u007f]/.test(principalId) || hasKnownPassiveCredential(principalId))
    throw new Error("The local file selection is unavailable.");
  const parsed = readHeadlessLocalFileImportRequest({
    version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-file", input: target,
  }, hostIncarnationId);
  if (!parsed.ok) throw new Error("The local file selection is unavailable.");
  return { organizationId, principalId, registeredClientId, target: parsed.request.input };
}
