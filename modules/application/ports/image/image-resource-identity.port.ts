import type { WorkspaceId } from "../../../contracts/workspace";

export type ImageResourceIdentityKind = "image" | "generated-output" | "artifact" | "image-cursor" | "output-cursor";

/** Private source identifiers stay behind this port; mappings never authorize a source. */
export interface ImageResourceIdentity {
  readonly workspaceId: WorkspaceId;
  readonly kind: ImageResourceIdentityKind;
  readonly sourceId: string;
  readonly publicId: string;
}

export interface ImageResourceIdentityPort {
  getOrCreateIdentity(workspaceId: WorkspaceId, kind: ImageResourceIdentityKind, sourceId: string): Promise<string>;
  resolveIdentity(workspaceId: WorkspaceId, publicId: string): Promise<ImageResourceIdentity | undefined>;
}

export function isImageResourcePublicId(value: unknown): value is string {
  return typeof value === "string" && /^image-resource\.v1\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}
