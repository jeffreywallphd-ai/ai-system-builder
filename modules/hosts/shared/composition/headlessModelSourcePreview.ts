import {createHash} from "node:crypto";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import type {ModelDownloadSourcePort} from "../../../application/ports/model";
import {PreviewHeadlessModelSourceUseCase} from "../../../application/use-cases/model";
import {isOrganizationId} from "../../../contracts/organization";
import {readHeadlessModelSourcePreviewValue, type HeadlessModelSourcePreviewRequest} from "../../../contracts/headless";

/** The provider is host-selected and lazy; this factory reads no file, secret or runtime. */
export function composeHeadlessModelSourcePreview(documents: StructuredDocumentStore, provider: ModelDownloadSourcePort) {
  const organizationId = documents.organizationId;
  if (!isOrganizationId(organizationId)) throw new Error("Model source preview requires an organization partition.");
  return new PreviewHeadlessModelSourceUseCase({organizationId, provider});
}

export function readVerifiedHeadlessModelSourcePreview(value: unknown, target: HeadlessModelSourcePreviewRequest["input"]) {
  const result = readHeadlessModelSourcePreviewValue(value, target);
  return result && result.manifestDigest === "sha256:" + createHash("sha256").update(JSON.stringify(result.source), "utf8").digest("hex")
    ? result : undefined;
}
