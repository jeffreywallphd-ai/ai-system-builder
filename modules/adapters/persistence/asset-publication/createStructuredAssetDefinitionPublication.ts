import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { AssetDefinitionPublicationPort } from "../../../application/ports/asset-publication";
import type { AssetImplementationArtifactPort } from "../../../application/ports/asset-implementation";
import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import { normalizeAssetDerivedCustomizationDraftRecord } from "../../../contracts/asset-authoring";
import { normalizeAssetStudioAssetDraftRecord } from "../../../contracts/asset-studio";
import { isOrganizationId } from "../../../contracts/organization";
import { normalizeAssetImplementationBackingResourceBundle, type AssetImplementationDraftId, type AssetSourceSnapshotId, type AssetImplementationArtifactDescriptor } from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";
import { createLocalAssetDefinitionRepositoryAdapter } from "../asset";
import { createStructuredAssetImplementationRepository, createStructuredAssetImplementationBackingResourceRepository } from "../asset-implementation";
import { cloneStructuredJson, type StructuredDocumentStore } from "../shared";

const STUDIO = "asset-studio/asset-drafts";
const DERIVED = "asset-authoring/derived-customizations";
const RECEIPTS = "asset-publication/receipts";
const conflict = () => new Error("The owning asset review or publication changed or is unavailable.");

export function createStructuredAssetDefinitionPublication(options: {
  readonly documents: StructuredDocumentStore;
  readonly ownerDocuments: Pick<StructuredDocumentStore, "organizationId">;
  readonly artifacts: AssetImplementationArtifactPort;
  /** Existing host definition placement; never selected from a request. */
  readonly definitionScope: "organization" | "platform";
}): AssetDefinitionPublicationPort {
  const captureOwner = () => {
    const organizationId = options.ownerDocuments.organizationId;
    const rootOwner = options.documents.organizationId;
    if (!isOrganizationId(organizationId) || (rootOwner !== undefined && rootOwner !== organizationId) ||
        (options.definitionScope === "platform" && rootOwner !== undefined)) throw conflict();
    return organizationId;
  };
  const scoped = (transaction: StructuredDocumentStore, organizationId: ReturnType<typeof captureOwner>, publishedAt: string) => {
    const owned = transaction.forOrganization(organizationId);
    return {owned, definitions: createLocalAssetDefinitionRepositoryAdapter({rootDir: ".", now: () => publishedAt, documents: options.definitionScope === "platform" ? transaction : owned})};
  };
  return {
    async publishStudio(command) {
      // Capture context and passive values before the first await; no request can change the owner.
      const organizationId = captureOwner();
      const input = cloneStructuredJson(command);
      const expected = cloneStructuredJson(normalizeAssetStudioAssetDraftRecord(input.current));
      const definition = input.definition;
      if (!isDeepStrictEqual(input.current, expected) || !matches(definition, expected.definitionRef) ||
          !expected.review || !["reviewed", "published"].includes(expected.status)) throw conflict();
      await assertReviewedDefinition(options.artifacts, expected.workspaceId, expected.review.sourceArtifact, definition);
      const receiptId = expected.status === "reviewed" ? randomUUID() : undefined;
      const next = expected.status === "published" ? expected : normalizeAssetStudioAssetDraftRecord({
        ...expected, status: "published", revision: expected.revision + 1,
        publication: {definitionRef: expected.definitionRef, implementationDraftId: expected.implementationDraftId,
          sourceSnapshotId: expected.review.sourceSnapshotId, publishedAt: input.publishedAt, publishedBy: input.actorId}, updatedAt: input.publishedAt,
      });
      return options.documents.runInTransaction(async transaction => {
        const {owned, definitions} = scoped(transaction, organizationId, input.publishedAt);
        const key = `${expected.workspaceId}::${expected.draftId}`;
        const record = await owned.readDocument(STUDIO, key);
        if (!record || !isDeepStrictEqual(record.value, expected)) throw conflict();
        const receipt = await owned.readDocument<PublicationReceipt>(RECEIPTS, `studio::${key}`);
        await assertReviewSnapshot(owned, expected.workspaceId, expected.implementationDraftId, expected.definitionRef, expected.review!);
        const existing = await definitions.getDefinition(expected.definitionRef);
        if (expected.status === "published") {
          if (!validReceipt(receipt?.value, organizationId, "studio", expected, definition) || !isDeepStrictEqual(existing, definition) || !expected.publication ||
              expected.publication.implementationDraftId !== expected.implementationDraftId ||
              expected.publication.sourceSnapshotId !== expected.review!.sourceSnapshotId) throw conflict();
          return cloneStructuredJson(expected);
        }
        if (receipt || existing || expected.review!.materializedFromRevision !== expected.revision - 1) throw conflict();
        await definitions.saveDefinitions!([definition], [undefined]);
        await owned.writeDocument(RECEIPTS, `studio::${key}`, {formatVersion: "1.0", receiptId, organizationId, kind: "studio", record: next, definition}, {expectedRevision: 0, updatedAt: input.publishedAt});
        const written = await owned.writeDocument(STUDIO, key, next, {expectedRevision: record.revision, updatedAt: input.publishedAt});
        return normalizeAssetStudioAssetDraftRecord(written.value);
      });
    },
    async publishDerived(command) {
      const organizationId = captureOwner();
      const input = cloneStructuredJson(command);
      const expected = cloneStructuredJson(normalizeAssetDerivedCustomizationDraftRecord(input.current));
      const definition = input.definition;
      if (!isDeepStrictEqual(input.current, expected) || !matches(definition, expected.derivedDefinitionRef) ||
          !expected.review || !["reviewed", "published"].includes(expected.status) ||
          !matches(input.baseDefinition, expected.base.definitionRef)) throw conflict();
      await assertReviewedDefinition(options.artifacts, expected.workspaceId, expected.review.sourceArtifact, definition);
      const receiptId = expected.status === "reviewed" ? randomUUID() : undefined;
      const next = expected.status === "published" ? expected : normalizeAssetDerivedCustomizationDraftRecord({
        ...expected, status: "published", revision: expected.revision + 1,
        publication: {definitionRef: expected.derivedDefinitionRef, implementationDraftId: expected.review.implementationDraftId,
          sourceSnapshotId: expected.review.sourceSnapshotId, publishedAt: input.publishedAt, publishedBy: input.actorId}, updatedAt: input.publishedAt,
      });
      return options.documents.runInTransaction(async transaction => {
        const {owned, definitions} = scoped(transaction, organizationId, input.publishedAt);
        const key = `${expected.workspaceId}::${expected.customizationId}`;
        const record = await owned.readDocument(DERIVED, key);
        if (!record || !isDeepStrictEqual(record.value, expected)) throw conflict();
        const receipt = await owned.readDocument<PublicationReceipt>(RECEIPTS, `derived::${key}`);
        await assertReviewSnapshot(owned, expected.workspaceId, expected.review!.implementationDraftId, expected.derivedDefinitionRef, expected.review!);
        const implementations = createStructuredAssetImplementationRepository(owned);
        const release = await implementations.readRelease(expected.base.implementationReleaseId, expected.workspaceId);
        const backing = await createStructuredAssetImplementationBackingResourceRepository(owned).readByRelease(expected.base.implementationReleaseId, expected.workspaceId);
        const revocations = await implementations.listRevocations([expected.base.implementationReleaseId]);
        if (!release || release.status !== "published" || revocations.length || !sameReference(release.definitionRef, expected.base.definitionRef) ||
            (release.sourceSnapshotId !== undefined && release.sourceSnapshotId !== expected.base.sourceSnapshotId) ||
            !backing || !sameReference(backing.definitionRef, expected.base.definitionRef) || backing.sourceSnapshotId !== expected.base.sourceSnapshotId ||
            !isDeepStrictEqual(backing.artifact, expected.base.sourceArtifact) ||
            !isDeepStrictEqual(await definitions.getDefinition(expected.base.definitionRef), input.baseDefinition)) throw conflict();
        const existing = await definitions.getDefinition(expected.derivedDefinitionRef);
        if (expected.status === "published") {
          if (!validReceipt(receipt?.value, organizationId, "derived", expected, definition) || !isDeepStrictEqual(existing, definition) || !expected.publication ||
              expected.publication.implementationDraftId !== expected.review!.implementationDraftId ||
              expected.publication.sourceSnapshotId !== expected.review!.sourceSnapshotId) throw conflict();
          return cloneStructuredJson(expected);
        }
        if (receipt || existing || expected.review!.materializedFromRevision !== expected.revision) throw conflict();
        await definitions.saveDefinitions!([definition], [undefined]);
        await owned.writeDocument(RECEIPTS, `derived::${key}`, {formatVersion: "1.0", receiptId, organizationId, kind: "derived", record: next, definition}, {expectedRevision: 0, updatedAt: input.publishedAt});
        const written = await owned.writeDocument(DERIVED, key, next, {expectedRevision: record.revision, updatedAt: input.publishedAt});
        return normalizeAssetDerivedCustomizationDraftRecord(written.value);
      });
    },
  };
}

async function assertReviewSnapshot(
  owned: StructuredDocumentStore, workspaceId: WorkspaceId,
  draftId: AssetImplementationDraftId, reference: AssetReference,
  review: {readonly sourceSnapshotId: AssetSourceSnapshotId; readonly sourceArtifact: AssetImplementationArtifactDescriptor},
): Promise<void> {
  const snapshot = await createStructuredAssetImplementationRepository(owned).readSourceSnapshot(workspaceId, review.sourceSnapshotId);
  const draft = await createStructuredAssetImplementationRepository(owned).readDraft(workspaceId, draftId);
  if (!snapshot || !draft || snapshot.draftId !== draftId || !sameReference(draft.definitionRef, reference) ||
      !isDeepStrictEqual(snapshot.artifact, review.sourceArtifact)) throw conflict();
}
interface PublicationReceipt {
  readonly formatVersion: "1.0";
  readonly receiptId: string;
  readonly organizationId: string;
  readonly kind: "studio" | "derived";
  readonly record: unknown;
  readonly definition: AssetDefinition;
}
function validReceipt(receipt: PublicationReceipt | undefined, organizationId: string, kind: "studio" | "derived", record: unknown, definition: AssetDefinition): boolean {
  return Boolean(receipt && Object.keys(receipt).sort().join() === "definition,formatVersion,kind,organizationId,receiptId,record" && receipt.formatVersion === "1.0" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.receiptId) && receipt.organizationId === organizationId && receipt.kind === kind &&
    isDeepStrictEqual(receipt.record, record) && isDeepStrictEqual(receipt.definition, definition));
}
async function assertReviewedDefinition(artifacts: AssetImplementationArtifactPort, workspaceId: WorkspaceId, source: AssetImplementationArtifactDescriptor, definition: AssetDefinition): Promise<void> {
  try {
    const bytes = await artifacts.readVerified<Uint8Array>(workspaceId, source);
    const bundle = normalizeAssetImplementationBackingResourceBundle(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
    const semantic = bundle.files.find(file => file.path === "other/definition.json");
    if (!semantic || !isDeepStrictEqual(JSON.parse(semantic.content), definition)) throw conflict();
  } catch {throw conflict();}
}
function matches(definition: AssetDefinition, reference: AssetReference): boolean {
  return definition?.definitionId === reference.id && definition.version === reference.version;
}
function sameReference(left: AssetReference, right: AssetReference): boolean {
  return left.kind === right.kind && left.id === right.id && left.version === right.version;
}
