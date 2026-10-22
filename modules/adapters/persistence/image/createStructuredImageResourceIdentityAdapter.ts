import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import type { ImageResourceIdentity, ImageResourceIdentityKind, ImageResourceIdentityPort } from "../../../application/ports/image";
import { isImageResourcePublicId } from "../../../application/ports/image";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import { isStructuredDocumentConflict, type StructuredDocumentStore } from "../shared";

const SOURCE_INDEX = "private-image-identities-v1-source";
const PUBLIC_INDEX = "private-image-identities-v1-public";
const KINDS = new Set(["image", "generated-output", "artifact", "image-cursor", "output-cursor"]);
function invalid(): never { throw new Error("Private image resource identity is unavailable."); }

function sourceKey(workspaceId: WorkspaceId, kind: ImageResourceIdentityKind, sourceId: string): string {
  // This hash is a private index key, never a public resource identity.
  return createHash("sha256").update(JSON.stringify([workspaceId, kind, sourceId])).digest("hex");
}
function publicKey(workspaceId: WorkspaceId, publicId: string): string { return `${workspaceId}:${publicId}`; }
function validateSource(workspaceId: unknown, kind: unknown, sourceId: unknown): void {
  if (!isWorkspaceId(workspaceId) || typeof kind !== "string" || !KINDS.has(kind)
    || typeof sourceId !== "string" || !sourceId || sourceId.length > 8192 || Buffer.byteLength(sourceId) > 8192) invalid();
}
type StoredIdentity = ImageResourceIdentity & { readonly publication?: "reserved" | "committed" };
function record(input: unknown, forward = false): StoredIdentity {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(input);
  const allowed = ["workspaceId", "kind", "sourceId", "publicId", ...(forward ? ["publication"] : [])];
  if (keys.length !== allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key))) invalid();
  const value: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    value[key] = descriptor.value;
  }
  validateSource(value.workspaceId, value.kind, value.sourceId);
  if (!isImageResourcePublicId(value.publicId)) invalid();
  if (forward && value.publication !== "reserved" && value.publication !== "committed") invalid();
  return value as unknown as StoredIdentity;
}
function same(a: ImageResourceIdentity, b: ImageResourceIdentity): boolean {
  return a.workspaceId === b.workspaceId && a.kind === b.kind && a.sourceId === b.sourceId && a.publicId === b.publicId;
}

/** Exact indexed CAS publication; only a committed, consistent pair is public. */
export function createStructuredImageResourceIdentityAdapter(documents: StructuredDocumentStore): ImageResourceIdentityPort {
  const owner = (): StructuredDocumentStore => {
    const organizationId = documents.organizationId;
    if (!organizationId) invalid(); // Never assign unowned/legacy records implicitly.
    return documents.forOrganization(organizationId);
  };
  return {
    async getOrCreateIdentity(workspaceId, kind, sourceId) {
      try {
        validateSource(workspaceId, kind, sourceId);
        const scoped = owner();
        const key = sourceKey(workspaceId, kind, sourceId);
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            let current = await scoped.readDocument(SOURCE_INDEX, key);
            if (!current) {
              const mapping = { workspaceId, kind, sourceId, publicId: `image-resource.v1.${randomUUID()}`, publication: "reserved" };
              current = await scoped.writeDocument(SOURCE_INDEX, key, mapping, { expectedRevision: 0 });
            }
            const mapping = record(current.value, true);
            if (mapping.workspaceId !== workspaceId || mapping.kind !== kind || mapping.sourceId !== sourceId) invalid();
            const inverseKey = publicKey(workspaceId, mapping.publicId);
            const inverse = await scoped.readDocument(PUBLIC_INDEX, inverseKey);
            if (inverse && !same(mapping, record(inverse.value))) invalid();
            if (mapping.publication === "committed") {
              if (!inverse) invalid();
              return mapping.publicId;
            }
            const { publication: _publication, ...identity } = mapping;
            // A crash leaves one private reservation, never a second alias or a pass.
            if (!inverse) await scoped.writeDocument(PUBLIC_INDEX, inverseKey, identity, { expectedRevision: 0 });
            await scoped.writeDocument(SOURCE_INDEX, key, { ...identity, publication: "committed" }, { expectedRevision: current.revision });
            return mapping.publicId;
          } catch (error) {
            if (!isStructuredDocumentConflict(error)) throw error;
          }
        }
        return invalid();
      } catch { return invalid(); }
    },
    async resolveIdentity(workspaceId, publicId) {
      if (!isWorkspaceId(workspaceId) || !isImageResourcePublicId(publicId)) return undefined;
      try {
        const scoped = owner();
          const current = await scoped.readDocument(PUBLIC_INDEX, publicKey(workspaceId, publicId));
          if (!current) return undefined;
          const mapping = record(current.value);
          if (mapping.workspaceId !== workspaceId || mapping.publicId !== publicId) invalid();
          const forward = await scoped.readDocument(SOURCE_INDEX, sourceKey(workspaceId, mapping.kind, mapping.sourceId));
          if (!forward) invalid();
          const source = record(forward.value, true);
          if (source.publication !== "committed") return undefined;
          if (!same(mapping, source)) invalid();
          return mapping;
      } catch { return invalid(); }
    },
  };
}
