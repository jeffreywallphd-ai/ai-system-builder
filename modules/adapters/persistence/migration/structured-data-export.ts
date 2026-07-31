import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StructuredDocument, StructuredDocumentStore } from "../shared";

export interface StructuredDataExportManifest {
  readonly kind: "ai-system-builder-structured-data-export";
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly documentCount: number;
  readonly sha256: string;
}

export interface StructuredDataExport {
  readonly manifest: StructuredDataExportManifest;
  readonly documents: readonly StructuredDocument[];
}

export async function exportStructuredData(
  documents: StructuredDocumentStore,
  now: () => string = () => new Date().toISOString(),
): Promise<StructuredDataExport> {
  return documents.runInTransaction((transaction) => collectStructuredDataExport(transaction, now));
}

async function collectStructuredDataExport(
  documents: StructuredDocumentStore,
  now: () => string,
): Promise<StructuredDataExport> {
  const exported: StructuredDocument[] = [];
  for (const namespace of await documents.listNamespaces()) {
    exported.push(...await documents.listDocuments(namespace));
  }
  exported.sort((left, right) => left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key));
  const canonicalRecords = exported.map((document) => JSON.stringify(document)).join("\n");
  return {
    manifest: {
      kind: "ai-system-builder-structured-data-export",
      schemaVersion: 1,
      exportedAt: now(),
      documentCount: exported.length,
      sha256: createHash("sha256").update(canonicalRecords).digest("hex"),
    },
    documents: exported,
  };
}

export async function writeStructuredDataExport(
  destinationPath: string,
  value: StructuredDataExport,
): Promise<{ destinationPath: string; documentCount: number; sha256: string }> {
  const destination = path.resolve(destinationPath);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(destination), { recursive: true });
  const contents = [value.manifest, ...value.documents].map((record) => JSON.stringify(record)).join("\n") + "\n";
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {
    destinationPath: destination,
    documentCount: value.manifest.documentCount,
    sha256: value.manifest.sha256,
  };
}
