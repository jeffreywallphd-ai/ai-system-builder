import { webcrypto } from "node:crypto";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  IngestionSha256Digest,
  IngestionTaskFileRecord,
  IngestionTaskKind,
  IngestionTaskRecord,
  IngestionTaskStatus,
  IngestionTaskTransportCommand,
  IngestionTaskTransportValue,
} from "../../../../../modules/contracts/ingestion";
import {
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactFromRepoSuccessResult,
  createStoreArtifactSuccessResult,
} from "../../../../../modules/contracts/storage";
import { ArtifactId } from "../../../../../modules/domain/artifact";
import { LocalizeArtifactFromRepoUseCase } from "../../../../../modules/application/use-cases/localize-artifact-from-repo.use-case";
import { RegisterArtifactFromRepoUseCase } from "../../../../../modules/application/use-cases/register-artifact-from-repo.use-case";
import { App } from "../App";

const NOW = "2026-07-30T12:00:00.000Z";
const IMMUTABLE_PROVIDER_REVISION = "0123456789abcdef0123456789abcdef01234567";
const CONTENT_DIGEST = `sha256:${"a".repeat(64)}` as IngestionSha256Digest;

type ArtifactFamily = "structured-text" | "tabular";

interface E2eArtifact {
  readonly workspaceId: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly mediaType: string;
  readonly artifactFamily: ArtifactFamily;
  readonly sourceKind: "upload" | "scrape" | "import" | "generated";
  sizeBytes: number;
  bytes: Uint8Array;
  readonly metadata?: Record<string, unknown>;
}

interface E2eHostHarness {
  readonly artifacts: E2eArtifact[];
  readonly commands: IngestionTaskTransportCommand[];
  readonly detailReads: string[];
  readonly namespaceBrowses: string[];
  readonly datasetFileBrowses: string[];
  readonly localizations: string[];
  readonly desktopApi: unknown;
}

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
Object.defineProperty(window, "crypto", {
  configurable: true,
  value: webcrypto,
});
const deterministicDigest = async () => new Uint8Array(32).buffer;
Object.defineProperty(globalThis.crypto.subtle, "digest", {
  configurable: true,
  value: deterministicDigest,
});
Object.defineProperty(window.crypto.subtle, "digest", {
  configurable: true,
  value: deterministicDigest,
});
const scrollTo = vi.fn();
Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: scrollTo,
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount();
    });
  }
  mountedContainer?.remove();
  mountedRoot = undefined;
  mountedContainer = undefined;
  delete window.desktopApi;
  window.localStorage.clear();
  scrollTo.mockReset();
});

function progressFor(files: readonly IngestionTaskFileRecord[]) {
  const acceptedBytes = files.reduce(
    (total, file) => total + file.acceptedBytes,
    0,
  );
  const totalBytes = files.reduce((total, file) => total + file.totalBytes, 0);
  const completedItems = files.filter(
    (file) => file.status === "finalized",
  ).length;
  return {
    acceptedBytes,
    totalBytes,
    completedItems,
    totalItems: files.length,
    percent:
      totalBytes === 0
        ? Math.floor((completedItems / files.length) * 100)
        : Math.floor((acceptedBytes / totalBytes) * 100),
    message:
      completedItems === files.length
        ? "Data is ready."
        : "Adding selected data.",
  };
}

function taskRecord(input: {
  taskId: string;
  workspaceId: string;
  kind: IngestionTaskKind;
  status: IngestionTaskStatus;
  files: readonly IngestionTaskFileRecord[];
  revision: number;
}): IngestionTaskRecord {
  const terminal = ["succeeded", "failed", "cancelled"].includes(input.status);
  return {
    schemaVersion: "1.0",
    taskId: input.taskId as IngestionTaskRecord["taskId"],
    workspaceId: input.workspaceId as IngestionTaskRecord["workspaceId"],
    kind: input.kind,
    status: input.status,
    files: input.files,
    progress: progressFor(input.files),
    revision: input.revision,
    cleanupPending: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...(terminal ? { completedAt: NOW } : {}),
  };
}

function pendingFile(input: {
  taskId: string;
  index: number;
  fileName: string;
  mediaType: string;
  totalBytes: number;
  providerSource?: IngestionTaskFileRecord["providerSource"];
  websiteSource?: IngestionTaskFileRecord["websiteSource"];
}): IngestionTaskFileRecord {
  return {
    fileId:
      `file.${input.taskId}.${input.index}` as IngestionTaskFileRecord["fileId"],
    checkpointId: `checkpoint.${input.taskId}.${input.index}`,
    fileName: input.fileName,
    mediaType: input.mediaType,
    totalBytes: input.totalBytes,
    status: "pending",
    acceptedBytes: 0,
    nextChunkIndex: 0,
    ...(input.providerSource ? { providerSource: input.providerSource } : {}),
    ...(input.websiteSource ? { websiteSource: input.websiteSource } : {}),
  };
}

function artifactFamily(mediaType: string): ArtifactFamily {
  return /csv|parquet/i.test(mediaType) ? "tabular" : "structured-text";
}

function createE2eHostHarness(): E2eHostHarness {
  const artifacts: E2eArtifact[] = [];
  const commands: IngestionTaskTransportCommand[] = [];
  const detailReads: string[] = [];
  const namespaceBrowses: string[] = [];
  const datasetFileBrowses: string[] = [];
  const localizations: string[] = [];
  const artifactBindings: Array<{
    workspaceId?: string;
    artifactId: string;
    role: string;
    backing: Record<string, unknown>;
    [key: string]: unknown;
  }> = [];
  const workspaces: Array<{
    workspaceId: string;
    displayName: string;
    status: "active";
    createdAt: string;
  }> = [
    {
      workspaceId: "workspace.data-e2e",
      displayName: "Data E2E Workspace",
      status: "active",
      createdAt: NOW,
    },
  ];
  let selectedWorkspaceId: string | undefined = "workspace.data-e2e";
  let activeTask: IngestionTaskRecord | undefined;
  let taskSequence = 0;
  let importedArtifactSequence = 0;

  function addArtifact(artifact: E2eArtifact): void {
    if (!artifacts.some((entry) => entry.storageKey === artifact.storageKey)) {
      artifacts.push(artifact);
    }
  }

  const artifactRepoStorage = {
    hasArtifactInRepo: async () => createHasArtifactInRepoSuccessResult(true),
    retrieveArtifactFromRepo: async (request: {
      target: {
        provider: "huggingface";
        repository: string;
        path: string;
        revision?: string;
      };
    }) =>
      createRetrieveArtifactFromRepoSuccessResult(
        {
          target: request.target,
          mediaType: "application/vnd.apache.parquet",
          sizeBytes: 4,
        },
        new Uint8Array([80, 65, 82, 49]),
      ),
  } as never;

  const artifactBindingStorage = {
    upsertArtifactStorageBinding: async (
      request: {
        binding: {
          workspaceId?: string;
          artifactId: string;
          role: string;
          backing: Record<string, unknown>;
          [key: string]: unknown;
        };
      },
      context?: { workspaceId?: string },
    ) => {
      if (
        !request.binding.workspaceId ||
        request.binding.workspaceId !== context?.workspaceId
      ) {
        throw new Error("Artifact binding was not workspace scoped.");
      }
      const artifact = artifacts.find(
        (entry) => entry.storageKey === request.binding.artifactId,
      );
      if (!artifact) throw new Error("Imported artifact was not cataloged.");
      const existingIndex = artifactBindings.findIndex(
        (binding) =>
          binding.workspaceId === request.binding.workspaceId &&
          binding.artifactId === request.binding.artifactId &&
          binding.role === request.binding.role,
      );
      if (existingIndex >= 0) artifactBindings.splice(existingIndex, 1);
      artifactBindings.push(request.binding);
      if (request.binding.role === "imported-source") {
        artifact.metadata!.importedSourceBacking = request.binding.backing;
      }
      return { ok: true as const, value: { binding: request.binding } };
    },
    readArtifactStorageBindings: async (
      request: { workspaceId?: string; artifactId?: string },
      context?: { workspaceId?: string },
    ) => {
      if (!request.workspaceId || request.workspaceId !== context?.workspaceId) {
        throw new Error("Artifact binding read was not workspace scoped.");
      }
      return {
        ok: true as const,
        value: {
          bindings: artifactBindings.filter(
            (binding) =>
              binding.workspaceId === request.workspaceId &&
              (!request.artifactId || binding.artifactId === request.artifactId),
          ),
        },
      };
    },
  } as never;

  const registerArtifactFromRepo = new RegisterArtifactFromRepoUseCase({
    artifactRepoStorage,
    artifactBindingStorage,
    artifactCatalogAppend: {
      appendArtifactCatalogRecord: async (
        request: {
          record: {
            workspaceId?: string;
            storageKey: string;
            originalName?: string;
            mediaType?: string;
            artifactFamily: ArtifactFamily;
            sourceKind?: "upload" | "generated";
          };
        },
        context?: { workspaceId?: string },
      ) => {
        if (
          !request.record.workspaceId ||
          request.record.workspaceId !== context?.workspaceId
        ) {
          throw new Error(
            "Imported artifact catalog record was not workspace scoped.",
          );
        }
        addArtifact({
          workspaceId: request.record.workspaceId,
          storageKey: request.record.storageKey,
          originalName:
            request.record.originalName ?? request.record.storageKey,
          mediaType: request.record.mediaType ?? "application/octet-stream",
          artifactFamily: request.record.artifactFamily,
          sourceKind: request.record.sourceKind ?? "upload",
          sizeBytes: 0,
          bytes: new Uint8Array([80, 65, 82, 49]),
          metadata: {},
        });
        return {
          ok: true as const,
          value: { storageKey: request.record.storageKey },
        };
      },
    } as never,
    logging: { log: async () => undefined },
    now: () => NOW,
    createArtifactId: () =>
      ArtifactId.from(
        `artifacts/20260730120000-import${++importedArtifactSequence}`,
      ),
  });

  const localizeArtifactFromRepo = new LocalizeArtifactFromRepoUseCase({
    artifactRepoStorage,
    artifactBindingStorage,
    artifactStorage: {
      storeArtifact: async (
        request: {
          content: Uint8Array;
          descriptor: { key?: string; mediaType?: string };
        },
        context?: { workspaceId?: string },
      ) => {
        if (!context?.workspaceId) {
          throw new Error("Localization storage did not receive workspace context.");
        }
        const artifact = artifacts.find(
          (entry) =>
            entry.workspaceId === context.workspaceId &&
            entry.storageKey === request.descriptor.key,
        );
        if (!artifact) throw new Error("Localized artifact was not cataloged.");
        artifact.bytes = request.content;
        artifact.sizeBytes = request.content.byteLength;
        localizations.push(artifact.storageKey);
        return createStoreArtifactSuccessResult({
          key: artifact.storageKey,
          mediaType: request.descriptor.mediaType,
          sizeBytes: request.content.byteLength,
        });
      },
    } as never,
    now: () => NOW,
  });

  function completedFile(
    file: IngestionTaskFileRecord,
    outputKey: string,
  ): IngestionTaskFileRecord {
    return {
      ...file,
      status: "finalized",
      acceptedBytes: activeTask?.kind === "website" ? 0 : file.totalBytes,
      output: {
        key: outputKey,
        mediaType: file.mediaType,
        sizeBytes: file.totalBytes,
        ...(file.providerSource
          ? { providerRevision: file.providerSource.revision }
          : { digest: CONTENT_DIGEST }),
      },
    };
  }

  async function completeManagedTask(
    kind: "website" | "hugging-face",
  ): Promise<IngestionTaskRecord> {
    if (!activeTask || activeTask.kind !== kind) {
      throw new Error(`No active ${kind} task.`);
    }
    const completedFiles = await Promise.all(
      activeTask.files.map(async (file) => {
        if (kind === "website") {
          const requestedUrl = file.websiteSource!.requestedUrl;
          const host = new URL(requestedUrl).hostname;
          const storageKey = `website/${host}/${file.fileName}`;
          addArtifact({
            workspaceId: activeTask!.workspaceId,
            storageKey,
            originalName: file.fileName,
            mediaType: file.mediaType,
            artifactFamily: "structured-text",
            sourceKind: "scrape",
            sizeBytes: 0,
            bytes: new TextEncoder().encode(
              `<html><body><h1>${file.fileName}</h1></body></html>`,
            ),
            metadata: {
              websiteCapture: {
                sourceUrl: requestedUrl,
                resolvedUrl: requestedUrl,
                requestedMode: "automatic",
                acquisitionMechanismUsed: "simple-http",
                retrievedAt: NOW,
                httpStatus: 200,
                contentTypeHeader: "text/html; charset=utf-8",
              },
            },
          });
          return completedFile(file, storageKey);
        }

        const source = file.providerSource!;
        const registration = await registerArtifactFromRepo.execute(
          {
            target: source,
            mediaType: file.mediaType,
          },
          { workspaceId: activeTask!.workspaceId },
        );
        if (!registration.ok) {
          throw new Error(registration.error.message);
        }
        return completedFile(file, registration.value.artifactId);
      }),
    );
    activeTask = taskRecord({
      taskId: activeTask.taskId,
      workspaceId: activeTask.workspaceId,
      kind,
      status: "succeeded",
      files: completedFiles,
      revision: activeTask.revision + 1,
    });
    return activeTask;
  }

  async function executeIngestionTask(input: {
    workspaceId: string;
    command: IngestionTaskTransportCommand;
  }): Promise<IngestionTaskTransportValue> {
    const { command, workspaceId } = input;
    commands.push(command);
    if (command.action === "create-files") {
      const taskId = `ingestion.files.${++taskSequence}`;
      activeTask = taskRecord({
        taskId,
        workspaceId,
        kind: "file-batch",
        status: "queued",
        files: command.files.map((file, index) =>
          pendingFile({
            taskId,
            index,
            fileName: file.fileName,
            mediaType: file.mediaType,
            totalBytes: file.sizeBytes,
          }),
        ),
        revision: 1,
      });
    } else if (command.action === "create-website") {
      const taskId = `ingestion.website.${++taskSequence}`;
      activeTask = taskRecord({
        taskId,
        workspaceId,
        kind: "website",
        status: "queued",
        files: command.scope.urls.map((requestedUrl, index) => {
          const pathName = new URL(requestedUrl).pathname
            .split("/")
            .filter(Boolean)
            .pop();
          const fileName = `${pathName || `page-${index + 1}`}.html`;
          return pendingFile({
            taskId,
            index,
            fileName,
            mediaType: "text/html",
            totalBytes: 0,
            websiteSource: { requestedUrl },
          });
        }),
        revision: 1,
      });
    } else if (command.action === "create-hugging-face") {
      const taskId = `ingestion.hugging-face.${++taskSequence}`;
      activeTask = taskRecord({
        taskId,
        workspaceId,
        kind: "hugging-face",
        status: "queued",
        files: command.files.map((file, index) =>
          pendingFile({
            taskId,
            index,
            fileName: file.path.split("/").pop()!,
            mediaType: file.mediaType ?? "application/vnd.apache.parquet",
            totalBytes: 0,
            providerSource: {
              provider: "huggingface",
              repository: file.repository,
              path: file.path,
              revision: file.revision,
            },
          }),
        ),
        revision: 1,
      });
    } else if (command.action === "append-chunk") {
      if (!activeTask) throw new Error("No active file task.");
      activeTask = taskRecord({
        taskId: activeTask.taskId,
        workspaceId: activeTask.workspaceId,
        kind: activeTask.kind,
        status: "transferring",
        files: activeTask.files.map((file) =>
          file.fileId === command.fileId
            ? {
                ...file,
                status: "transferring",
                acceptedBytes:
                  command.expectedOffset + command.bytes.byteLength,
                nextChunkIndex: command.chunkIndex + 1,
                lastChunk: {
                  index: command.chunkIndex,
                  sizeBytes: command.bytes.byteLength,
                  digest: command.sha256 as IngestionSha256Digest,
                },
              }
            : file,
        ),
        revision: activeTask.revision + 1,
      });
    } else if (command.action === "finalize-file") {
      if (!activeTask || activeTask.kind !== "file-batch") {
        throw new Error("No active file task.");
      }
      const fileTask = activeTask;
      const finalized = fileTask.files.map((file) => {
        if (file.fileId !== command.fileId) return file;
        const storageKey = `uploads/${file.fileName}`;
        addArtifact({
          workspaceId: fileTask.workspaceId,
          storageKey,
          originalName: file.fileName,
          mediaType: file.mediaType,
          artifactFamily: artifactFamily(file.mediaType),
          sourceKind: "upload",
          sizeBytes: file.totalBytes,
          bytes: new TextEncoder().encode(file.fileName),
        });
        return completedFile(file, storageKey);
      });
      const allFinalized = finalized.every(
        (file) => file.status === "finalized",
      );
      activeTask = taskRecord({
        taskId: activeTask.taskId,
        workspaceId: activeTask.workspaceId,
        kind: activeTask.kind,
        status: allFinalized ? "succeeded" : "transferring",
        files: finalized,
        revision: activeTask.revision + 1,
      });
    } else if (command.action === "run-website") {
      activeTask = await completeManagedTask("website");
    } else if (command.action === "run-hugging-face") {
      activeTask = await completeManagedTask("hugging-face");
    } else if (command.action === "read") {
      if (!activeTask) throw new Error("No active ingestion task.");
    } else {
      throw new Error(`Unexpected E2E ingestion command: ${command.action}`);
    }
    return { kind: "task", task: activeTask! };
  }

  const desktopApi = {
    listWorkspaces: async () => ({
      ok: true,
      value: { workspaces },
    }),
    readActiveWorkspaceSelection: async () => ({
      ok: true,
      value: selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {},
    }),
    saveActiveWorkspaceSelection: async (selection: {
      workspaceId?: string;
    }) => {
      selectedWorkspaceId = selection.workspaceId;
      return { ok: true, value: { selection } };
    },
    clearActiveWorkspaceSelection: async () => {
      selectedWorkspaceId = undefined;
      return { ok: true, value: {} };
    },
    createWorkspace: async (input: { command: { displayName: string } }) => {
      const workspace = {
        workspaceId: "workspace.data-e2e",
        displayName: input.command.displayName,
        status: "active" as const,
        createdAt: NOW,
      };
      workspaces.push(workspace);
      selectedWorkspaceId = workspace.workspaceId;
      return { ok: true, value: { workspace } };
    },
    executeIngestionTask: async (input: {
      workspaceId: string;
      command: IngestionTaskTransportCommand;
    }) => ({
      ok: true,
      value: await executeIngestionTask(input),
    }),
    getHuggingFaceTokenStatus: async () => ({
      ok: true,
      value: { configured: false },
    }),
    setHuggingFaceToken: async () => ({
      ok: true,
      value: { configured: true, maskedToken: "********" },
    }),
    clearHuggingFaceToken: async () => ({
      ok: true,
      value: { configured: false },
    }),
    browseHuggingFaceNamespaceDatasets: async (input: {
      namespace: string;
    }) => {
      namespaceBrowses.push(input.namespace);
      return {
        ok: true,
        value: {
          datasets: [
            {
              namespace: "OpenFinAL",
              repository: "OpenFinAL/Reddit",
            },
          ],
        },
      };
    },
    browseHuggingFaceDatasetParquetFiles: async (input: {
      repository: string;
    }) => {
      datasetFileBrowses.push(input.repository);
      return {
        ok: true,
        value: {
          files: [
            {
              repository: input.repository,
              path: "default/train/0000.parquet",
              revision: IMMUTABLE_PROVIDER_REVISION,
              sizeBytes: 160,
            },
          ],
        },
      };
    },
    browseArtifacts: async (input?: {
      workspaceId?: string;
      artifactFamily?: ArtifactFamily;
    }) => ({
      ok: true,
      value: {
        items: artifacts
          .filter(
            (artifact) =>
              artifact.workspaceId ===
                (input?.workspaceId ?? selectedWorkspaceId) &&
              (!input?.artifactFamily ||
                artifact.artifactFamily === input.artifactFamily),
          )
          .map((artifact) => ({
            storageKey: artifact.storageKey,
            originalName: artifact.originalName,
            mediaType: artifact.mediaType,
            artifactFamily: artifact.artifactFamily,
            sourceKind: artifact.sourceKind,
          })),
      },
    }),
    readArtifactDetail: async (locator: { storageKey: string }) => {
      detailReads.push(locator.storageKey);
      const artifact = artifacts.find(
        (entry) =>
          entry.workspaceId === selectedWorkspaceId &&
          entry.storageKey === locator.storageKey,
      );
      if (!artifact) {
        return {
          ok: false,
          error: { code: "not_found", message: "Artifact not found." },
        };
      }
      return {
        ok: true,
        value: {
          artifact: {
            locator,
            originalName: artifact.originalName,
            mediaType: artifact.mediaType,
            artifactFamily: artifact.artifactFamily,
            sourceKind: artifact.sourceKind,
            sizeBytes: artifact.sizeBytes,
            createdAt: NOW,
            metadata: artifact.metadata,
          },
        },
      };
    },
    readArtifactContentDescriptor: async (locator: { storageKey: string }) => {
      const artifact = artifacts.find(
        (entry) => entry.storageKey === locator.storageKey,
      );
      const isRemoteOnly = Boolean(
        artifact?.metadata?.importedSourceBacking &&
          !localizations.includes(locator.storageKey),
      );
      return {
        ok: true,
        value: {
          content: {
            locator,
            availability: isRemoteOnly ? "unavailable" : "available",
            retrieval: "deferred",
            mediaType: artifact?.mediaType,
          },
        },
      };
    },
    readArtifactViewerMedia: async (locator: { storageKey: string }) => {
      const artifact = artifacts.find(
        (entry) => entry.storageKey === locator.storageKey,
      )!;
      return {
        ok: true,
        value: { mediaType: artifact.mediaType, bytes: artifact.bytes },
      };
    },
    localizeArtifactFromRepo: async (input: {
      workspaceId: string;
      artifactId: string;
    }) => {
      const result = await localizeArtifactFromRepo.execute(
        { artifactId: input.artifactId },
        { workspaceId: input.workspaceId },
      );
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error };
    },
    readApplicationSettings: async () => ({
      ok: true,
      value: { values: [] },
    }),
  };

  return {
    artifacts,
    commands,
    detailReads,
    namespaceBrowses,
    datasetFileBrowses,
    localizations,
    desktopApi,
  };
}

function setNativeValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputFiles(input: HTMLInputElement, files: readonly File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function testFile(name: string, type: string, contents: string): File {
  const bytes = new TextEncoder().encode(contents);
  return {
    name,
    type,
    size: bytes.byteLength,
    lastModified: 1,
    slice(start = 0, end = bytes.byteLength) {
      const chunk = bytes.slice(start, end);
      return {
        arrayBuffer: async () =>
          chunk.buffer.slice(
            chunk.byteOffset,
            chunk.byteOffset + chunk.byteLength,
          ),
      } as Blob;
    },
  } as File;
}

async function settle(milliseconds = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
}

async function waitForText(
  container: HTMLElement,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (container.textContent?.includes(expected)) return;
    await settle(5);
  }
  throw new Error(
    `Timed out waiting for "${expected}". Visible text: ${container.textContent?.slice(0, 2_000)}`,
  );
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find button "${label}".`);
  }
  return button;
}

async function clickButton(
  container: HTMLElement,
  label: string,
): Promise<void> {
  await act(async () => {
    findButton(container, label).click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function chooseSource(
  container: HTMLElement,
  label: string,
): Promise<void> {
  const input = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).find((candidate) => candidate.parentElement?.textContent?.includes(label));
  if (!input) throw new Error(`Unable to choose source "${label}".`);
  await act(async () => {
    input.click();
    await Promise.resolve();
  });
}

async function openDataManagement(
  harness: E2eHostHarness,
): Promise<HTMLDivElement> {
  window.desktopApi = harness.desktopApi as never;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;
  await act(async () => {
    root.render(<App />);
  });
  await clickButton(container, "Data");
  await waitForText(container, "Data Management");
  await waitForText(container, "1. Choose a source");
  return container;
}

async function openArtifactDetail(
  container: HTMLElement,
  artifactName: string,
): Promise<string> {
  await clickButton(container, "Artifact Browser");
  await waitForText(container, artifactName);
  const card = Array.from(container.querySelectorAll("article")).find(
    (candidate) => candidate.textContent?.includes(artifactName),
  );
  const details = Array.from(card?.querySelectorAll("button") ?? []).find(
    (button) => button.textContent?.includes("View Details"),
  );
  if (!(details instanceof HTMLButtonElement)) {
    throw new Error(`Unable to view details for "${artifactName}".`);
  }
  await act(async () => {
    details.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  const modalRoot = container.ownerDocument.body;
  await waitForText(modalRoot, "Detail & preview");
  const dialog = Array.from(
    modalRoot.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ).find((candidate) => candidate.textContent?.includes("Detail & preview"));
  if (!dialog) throw new Error("Artifact detail dialog did not open.");
  return dialog.textContent ?? "";
}

function expectSuccessfulAddReset(container: HTMLElement): void {
  const filesChoice = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).find((candidate) =>
    candidate.parentElement?.textContent?.includes("Files"),
  );
  expect(filesChoice?.checked).toBe(true);
  expect(container.textContent).toContain("0 files selected");
  expect(
    container.querySelector("#application-notification-panel"),
  ).not.toBeNull();
  expect(scrollTo).toHaveBeenCalledWith({
    top: 0,
    left: 0,
    behavior: "auto",
  });
}

describe("desktop Data Management functional UI journeys", () => {
  it("adds two selected files and opens one from Artifact Browser", async () => {
    const harness = createE2eHostHarness();
    const container = await openDataManagement(harness);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    await act(async () => {
      setInputFiles(input, [
        testFile("training-a.csv", "text/csv", "prompt,response\na,b"),
        testFile(
          "training-b.jsonl",
          "application/jsonl",
          '{"prompt":"a","response":"b"}',
        ),
      ]);
    });
    expect(container.textContent).toContain("2 files selected");
    await clickButton(container, "Add data");
    await waitForText(container, "Data is ready.");
    expectSuccessfulAddReset(container);
    expect(container.textContent).not.toContain("training-a.csv");
    expect(container.textContent).not.toContain("training-b.jsonl");

    const create = harness.commands.find(
      (command) => command.action === "create-files",
    );
    expect(create?.action === "create-files" && create.files).toHaveLength(2);
    const detailText = await openArtifactDetail(container, "training-b.jsonl");
    expect(detailText).toContain("uploads/training-b.jsonl");
    expect(harness.detailReads).toContain("uploads/training-b.jsonl");
  });

  it("adds two website pages and opens one captured HTML artifact", async () => {
    const harness = createE2eHostHarness();
    const container = await openDataManagement(harness);
    await chooseSource(container, "Website pages");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      setNativeValue(
        textarea,
        "https://example.com/first-page\nhttps://example.com/second-page",
      );
    });
    await clickButton(container, "Add data");
    await waitForText(container, "Data is ready.");
    expectSuccessfulAddReset(container);

    const create = harness.commands.find(
      (command) => command.action === "create-website",
    );
    expect(create?.action === "create-website" && create.scope.urls).toEqual([
      "https://example.com/first-page",
      "https://example.com/second-page",
    ]);
    const detailText = await openArtifactDetail(container, "second-page.html");
    expect(detailText).toContain("website/example.com/second-page.html");
    expect(detailText).toContain("Website capture metadata");
    expect(detailText).toContain("https://example.com/second-page");
  });

  it("imports the selected OpenFinAL/Reddit file and opens its details", async () => {
    const harness = createE2eHostHarness();
    const container = await openDataManagement(harness);
    await chooseSource(container, "Hugging Face dataset");
    await waitForText(container, "Public datasets work without a token.");
    const namespace = container.querySelector<HTMLInputElement>(
      'input[placeholder="Hugging Face name"]',
    )!;
    await act(async () => {
      setNativeValue(namespace, "OpenFinAL");
    });
    await clickButton(container, "Find datasets");
    await waitForText(container, "OpenFinAL/Reddit");

    const datasetChoice = Array.from(container.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("OpenFinAL/Reddit"))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => datasetChoice?.click());
    await clickButton(container, "View files from selected datasets");
    await waitForText(container, "default/train/0000.parquet");

    const fileChoice = Array.from(container.querySelectorAll("label"))
      .find((label) =>
        label.textContent?.includes("default/train/0000.parquet"),
      )
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => fileChoice?.click());
    await clickButton(container, "Add data");
    await waitForText(container, "Data is ready.");
    expectSuccessfulAddReset(container);

    expect(harness.namespaceBrowses).toEqual(["OpenFinAL"]);
    expect(harness.datasetFileBrowses).toEqual(["OpenFinAL/Reddit"]);
    const create = harness.commands.find(
      (command) => command.action === "create-hugging-face",
    );
    expect(create?.action === "create-hugging-face" && create.files).toEqual([
      {
        repository: "OpenFinAL/Reddit",
        path: "default/train/0000.parquet",
        revision: IMMUTABLE_PROVIDER_REVISION,
      },
    ]);
    const detailText = await openArtifactDetail(container, "0000.parquet");
    expect(detailText).toContain("Imported Source Backing");
    expect(detailText).toContain("OpenFinAL/Reddit");
    expect(detailText).toContain(IMMUTABLE_PROVIDER_REVISION);
    const importedArtifact = harness.artifacts.find(
      (artifact) => artifact.originalName.endsWith("0000.parquet"),
    )!;
    const modalRoot = container.ownerDocument.body;
    await clickButton(modalRoot, "Localize artifact");
    await waitForText(
      modalRoot,
      `Localized bytes key: ${importedArtifact.storageKey}`,
    );
    expect(harness.localizations).toEqual([importedArtifact.storageKey]);
  });
});
