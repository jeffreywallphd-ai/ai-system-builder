import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ArtifactStorageBindingBatchReadPort,
  ArtifactStorageBindingPort,
} from "../../../../application/ports/storage";
import { createContractError, createFailureResult, createSuccessResult } from "../../../../contracts/shared";
import {
  normalizeArtifactStorageBinding,
  type ArtifactStorageBinding,
} from "../../../../contracts/storage";
import { mutateDocumentRecord, readDocumentRecord, type StructuredDocumentStore } from "../../../persistence/shared";

const DEFAULT_BINDINGS_FILE = ".catalog/artifact-storage-bindings.ndjson";

export interface CreateLocalArtifactStorageBindingAdapterOptions {
  rootDirectory: string;
  bindingsFile?: string;
  documents?: StructuredDocumentStore;
}

type ArtifactStorageBindingLine =
  | ArtifactStorageBinding
  | { workspaceId?: ArtifactStorageBinding["workspaceId"]; artifactId: string; deletedAt: string };

function parseBindingLine(line: string): ArtifactStorageBindingLine | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<ArtifactStorageBinding> & { deletedAt?: unknown };
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    if (typeof parsed.deletedAt === "string") {
      if (typeof parsed.artifactId !== "string" || parsed.artifactId.trim().length === 0) {
        return undefined;
      }

      return {
        workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId as ArtifactStorageBinding["workspaceId"] : undefined,
        artifactId: parsed.artifactId.trim(),
        deletedAt: parsed.deletedAt,
      };
    }

    if (
      typeof parsed.artifactId !== "string"
      || typeof parsed.role !== "string"
      || typeof parsed.backing !== "object"
      || parsed.backing === null
    ) {
      return undefined;
    }

    return normalizeArtifactStorageBinding({
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId as ArtifactStorageBinding["workspaceId"] : undefined,
      artifactId: parsed.artifactId,
      role: parsed.role,
      backing: parsed.backing as ArtifactStorageBinding["backing"],
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
    });
  } catch {
    return undefined;
  }
}

export function createLocalArtifactStorageBindingAdapter(
  options: CreateLocalArtifactStorageBindingAdapterOptions,
): ArtifactStorageBindingPort & ArtifactStorageBindingBatchReadPort {
  const rootDirectory = path.resolve(options.rootDirectory);
  const bindingsFile = options.bindingsFile ?? DEFAULT_BINDINGS_FILE;
  const bindingsPath = path.join(rootDirectory, bindingsFile);

  async function readBindings(): Promise<ArtifactStorageBinding[]> {
    if (options.documents) {
      const stored = (await readDocumentRecord({ rootDirectory, documents: options.documents }, bindingsFile, [] as ArtifactStorageBindingLine[])).value;
      return stored.map((entry) => parseBindingLine(JSON.stringify(entry))).filter((entry): entry is ArtifactStorageBinding => Boolean(entry && !("deletedAt" in entry)));
    }
    const content = await readFile(bindingsPath, "utf8").catch(() => "");
    if (!content.trim()) {
      return [];
    }

    const latestByCompositeKey = new Map<string, ArtifactStorageBinding>();
    const keysByArtifactId = new Map<string, Set<string>>();
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const parsed = parseBindingLine(line);
      if (!parsed) {
        continue;
      }

      if ("deletedAt" in parsed) {
        const tombstoneKey = parsed.workspaceId ? `${parsed.workspaceId}::${parsed.artifactId}` : parsed.artifactId;
        const existingKeys = keysByArtifactId.get(tombstoneKey);
        if (!existingKeys) {
          continue;
        }

        for (const key of existingKeys) {
          latestByCompositeKey.delete(key);
        }
        keysByArtifactId.delete(tombstoneKey);
        continue;
      }

      const artifactKey = parsed.workspaceId ? `${parsed.workspaceId}::${parsed.artifactId}` : parsed.artifactId;
      const key = `${artifactKey}::${parsed.role}::${parsed.backing.provider}::${parsed.backing.locator}`;
      latestByCompositeKey.set(key, parsed);
      let artifactKeys = keysByArtifactId.get(artifactKey);
      if (!artifactKeys) {
        artifactKeys = new Set<string>();
        keysByArtifactId.set(artifactKey, artifactKeys);
      }
      artifactKeys.add(key);
    }

    return Array.from(latestByCompositeKey.values());
  }

  async function mutateBindings<TResult>(
    mutation: (bindings: ArtifactStorageBinding[]) => { bindings: ArtifactStorageBinding[]; result: TResult },
  ): Promise<TResult> {
    if (!options.documents) throw new Error("Structured document storage is required for atomic binding mutation.");
    return mutateDocumentRecord(
      { rootDirectory, documents: options.documents },
      bindingsFile,
      [] as ArtifactStorageBindingLine[],
      (stored) => {
        const bindings = stored
          .map((entry) => parseBindingLine(JSON.stringify(entry)))
          .filter((entry): entry is ArtifactStorageBinding => Boolean(entry && !("deletedAt" in entry)));
        const next = mutation(bindings);
        return { value: next.bindings, result: next.result };
      },
    );
  }

  return {
    async upsertArtifactStorageBinding(request, context = {}) {
      try {
        const normalizedBinding = normalizeArtifactStorageBinding(request.binding);
        if (options.documents) {
          await mutateBindings((bindings) => ({
            bindings: [...bindings.filter((entry) => !(
              entry.workspaceId === normalizedBinding.workspaceId &&
              entry.artifactId === normalizedBinding.artifactId &&
              entry.role === normalizedBinding.role &&
              entry.backing.provider === normalizedBinding.backing.provider &&
              entry.backing.locator === normalizedBinding.backing.locator
            )), normalizedBinding],
            result: undefined,
          }));
          return createSuccessResult({ binding: normalizedBinding }, context);
        }
        await mkdir(path.dirname(bindingsPath), { recursive: true });
        await appendFile(bindingsPath, `${JSON.stringify(normalizedBinding)}\n`, "utf8");
        return createSuccessResult({ binding: normalizedBinding }, context);
      } catch (error) {
        return createFailureResult(
          createContractError("unavailable", "Failed to persist artifact storage binding.", {
            details: {
              reason: error instanceof Error ? error.message : String(error),
            },
          }),
          context,
        );
      }
    },

    async readArtifactStorageBindings(request, context = {}) {
      const artifactId = request.artifactId?.trim();
      if (!artifactId) {
        return createFailureResult(
          createContractError("validation", "artifactId must be a non-empty string."),
          context,
        );
      }

      const workspaceId = request.workspaceId?.trim();
      const bindings = (await readBindings()).filter((entry) => entry.artifactId === artifactId && (!workspaceId || entry.workspaceId === workspaceId));
      return createSuccessResult({ bindings }, context);
    },

    async readArtifactStorageBindingsBatch(request, context = {}) {
      const artifactIds = [...new Set(request.artifactIds.map((value) => value.trim()))];
      if (
        artifactIds.length === 0
        || artifactIds.length > 250
        || artifactIds.some((artifactId) => artifactId.length === 0)
      ) {
        return createFailureResult(
          createContractError(
            "validation",
            "artifactIds must contain between 1 and 250 unique non-empty identifiers.",
          ),
          context,
        );
      }

      const selectedIds = new Set(artifactIds);
      const workspaceId = request.workspaceId?.trim();
      const bindings = (await readBindings()).filter((entry) => (
        selectedIds.has(entry.artifactId)
        && (!workspaceId || entry.workspaceId === workspaceId)
      ));
      return createSuccessResult({ bindings }, context);
    },

    async deleteArtifactStorageBindings(request, context = {}) {
      const artifactId = request.artifactId?.trim();
      if (!artifactId) {
        return createFailureResult(
          createContractError("validation", "artifactId must be a non-empty string."),
          context,
        );
      }

      try {
        const workspaceId = request.workspaceId?.trim();
        if (options.documents) {
          const deleted = await mutateBindings((bindings) => ({
            bindings: bindings.filter((entry) => entry.artifactId !== artifactId || (workspaceId && entry.workspaceId !== workspaceId)),
            result: bindings.some((entry) => entry.artifactId === artifactId && (!workspaceId || entry.workspaceId === workspaceId)),
          }));
          return createSuccessResult({ deleted }, context);
        }

        const bindings = await readBindings();
        const exists = bindings.some((entry) => entry.artifactId === artifactId && (!workspaceId || entry.workspaceId === workspaceId));
        if (!exists) return createSuccessResult({ deleted: false }, context);

        await mkdir(path.dirname(bindingsPath), { recursive: true });
        await appendFile(bindingsPath, `${JSON.stringify({ workspaceId, artifactId, deletedAt: new Date().toISOString() })}\n`, "utf8");
        return createSuccessResult({ deleted: true }, context);
      } catch (error) {
        return createFailureResult(
          createContractError("unavailable", "Failed to delete artifact storage bindings.", {
            details: {
              reason: error instanceof Error ? error.message : String(error),
            },
          }),
          context,
        );
      }
    },
  };
}
