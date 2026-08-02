// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ContextArtifactManifest,
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
} from "../../../../contracts/context-management";
import {
  NotificationProvider,
  useNotificationCenter,
} from "../../notifications/NotificationProvider";
import {
  ContextStudio,
  ContextTaskNotificationBridge,
  type ContextManagementClient,
} from "../ContextStudio";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function NotificationRecordProbe({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const notifications = useNotificationCenter();
  useEffect(
    () => notifications.setActiveWorkspaceId(workspaceId),
    [notifications.setActiveWorkspaceId, workspaceId],
  );
  return (
    <output data-testid="notification-records">
      {notifications.records
        .map((record) => `${record.title}:${record.message}`)
        .join("\n")}
    </output>
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  sessionStorage.clear();
  root = undefined;
  container = undefined;
});

const savedItem = {
  artifactId: "generated/context/support-rag.lancedb.zip",
  storageKey: "generated/context/support-rag.lancedb.zip",
  kind: "rag-database" as const,
  name: "support-rag",
  mediaType:
    "application/vnd.ai-system-builder.rag-database+lancedb+zip" as const,
  sizeBytes: 2048,
  digest: `sha256:${"a".repeat(64)}` as const,
};

const manifest: ContextArtifactManifest = {
  schemaVersion: "1",
  kind: "rag-database",
  name: "support-rag",
  mediaType: "application/vnd.ai-system-builder.rag-database+lancedb+zip",
  createdAt: "2026-08-01T12:00:00.000Z",
  sources: [
    {
      artifactId: "datasets/support.parquet",
      digest: `sha256:${"b".repeat(64)}`,
      mediaType: "application/vnd.apache.parquet",
      originalName: "support.parquet",
      sizeBytes: 512,
      chunkCount: 2,
      chunkingMode: "persisted",
    },
  ],
  manualEntries: [],
  chunking: {
    strategy: "structure-aware",
    chunkCharacters: 1200,
    overlapCharacters: 120,
    textFields: ["question", "answer"],
  },
  embedding: {
    provider: "transformers",
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
  },
};

function button(label: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function buttonContaining(label: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.textContent?.includes(label));
  if (!found) throw new Error(`Missing button containing: ${label}`);
  return found;
}

function setInput(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function renderStudio(
  client: ContextManagementClient,
  props: {
    workspaceId?: string;
    onViewSource?: (artifactId: string) => void;
  } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NotificationProvider>
        <ContextStudio
          workspaceId={props.workspaceId ?? "workspace-a"}
          client={client}
          onViewSource={props.onViewSource}
        />
        <NotificationRecordProbe
          workspaceId={props.workspaceId ?? "workspace-a"}
        />
      </NotificationProvider>,
    );
  });
  return container;
}

describe("ContextStudio", () => {
  it("reuses persisted chunks, reviews inert output, saves, and opens the new RAG detail", async () => {
    let saved = false;
    let startedCommand:
      | Extract<
          ContextManagementTransportCommand,
          { action: "generation-start" }
        >["command"]
      | undefined;
    let inspectedCommand:
      | Extract<ContextManagementTransportCommand, { action: "source-inspect" }>
      | undefined;
    const onViewSource = vi.fn();
    const execute = vi.fn(
      async ({ command }: { command: ContextManagementTransportCommand }) => {
        let value: ContextManagementTransportValue;
        switch (command.action) {
          case "browser-list":
            value = {
              action: "browser-list",
              items: saved ? [savedItem] : [],
            };
            break;
          case "source-inspect":
            inspectedCommand = command;
            value = {
              action: "source-inspect",
              readiness: {
                artifactId: command.artifactId,
                ready: true,
                locallyReadable: true,
                digest: `sha256:${"b".repeat(64)}`,
                mediaType: "application/vnd.apache.parquet",
                originalName: "support.parquet",
                sizeBytes: 512,
                format: "parquet",
                sourceKind: "structured",
                textFields: ["question", "answer"],
                alreadyChunked: true,
                chunkCount: 2,
                sourceInformation: {
                  author: "Support team",
                  license: "Internal use",
                  language: "en",
                },
                checks: {
                  status: "ready",
                  checkedChunkCount: 2,
                  issueCounts: {
                    exactDuplicate: 0,
                    fuzzyDuplicate: 0,
                    textTooShort: 0,
                    textTooLong: 0,
                    languageNotAllowed: 0,
                    languageUncertain: 0,
                    sensitivePersonalData: 0,
                    secretLikeContent: 0,
                    licenseMetadataMissing: 0,
                    consentMetadataMissing: 0,
                  },
                  checkedSurfaces: ["text length and language"],
                  limitations: ["Review remains required."],
                },
              },
            };
            break;
          case "generation-start":
            startedCommand = command.command;
            value = {
              action: "generation-start",
              value: {
                requestId: "context-request-1",
                taskType: "generate-context-artifact",
                accepted: true,
                status: "running",
              },
            };
            break;
          case "generation-read":
            value = {
              action: "generation-read",
              status: {
                requestId: command.requestId,
                state: "review-required",
                progress: { current: 2, total: 2, percent: 100, unit: "chunk" },
                preview: {
                  kind: "rag-database",
                  name: "support-rag",
                  sourceCount: 1,
                  manualEntryCount: 0,
                  chunkCount: 2,
                  items: [
                    {
                      id: "chunk-1",
                      kind: "chunk",
                      text: "<script>window.compromised = true</script>",
                      citations: [
                        {
                          sourceArtifactId: "datasets/support.parquet",
                          chunkIndex: 0,
                          field: "answer",
                        },
                      ],
                    },
                  ],
                },
              },
            };
            break;
          case "generation-save":
            saved = true;
            value = {
              action: "generation-save",
              status: {
                requestId: command.requestId,
                state: "saved",
                savedArtifact: savedItem,
              },
            };
            break;
          case "browser-detail":
            value = {
              action: "browser-detail",
              detail: {
                item: savedItem,
                manifest,
                freshness: [
                  {
                    artifactId: "datasets/support.parquet",
                    expectedDigest: `sha256:${"b".repeat(64)}`,
                    actualDigest: `sha256:${"b".repeat(64)}`,
                    state: "current",
                  },
                ],
                chunkCount: 2,
                packageEntries: [],
                topics: [],
                rebuildAllowed: true,
              },
            };
            break;
          default:
            throw new Error(`Unexpected command: ${command.action}`);
        }
        return value;
      },
    );
    const client: ContextManagementClient = {
      listSourceArtifacts: vi.fn(async () => [
        {
          artifactId: "uploads/support.parquet",
          label: "support.parquet",
          mediaType: "application/vnd.apache.parquet",
          sourceKind: "upload",
        },
        {
          artifactId: "generated/notes.md",
          label: "notes.md",
          mediaType: "text/markdown",
          sourceKind: "runtime",
        },
      ]),
      execute,
    };

    const mounted = await renderStudio(client, { onViewSource });
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain("support.parquet"),
    );
    expect(
      [...mounted.querySelectorAll(".ui-panel__title")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(
      expect.arrayContaining([
        "RAG Databases",
        "Context Packs",
        "Context Browser",
      ]),
    );
    expect(
      mounted.querySelector(".context-studio__artifact-group"),
    ).not.toBeNull();
    expect(mounted.querySelector(".ui-type-badge")).not.toBeNull();
    const filter = [
      ...mounted.querySelectorAll<HTMLSelectElement>("select"),
    ].find((select) =>
      select.parentElement?.textContent?.includes("Filter artifacts"),
    )!;
    await act(async () => setSelect(filter, "generated"));
    expect(
      [...mounted.querySelectorAll(".context-studio__checkbox-row")].map(
        (row) => row.textContent,
      ),
    ).toEqual(expect.arrayContaining(["MDnotes.md"]));
    await act(async () => setSelect(filter, "uploaded"));
    const sourceCheckbox = mounted.querySelector<HTMLInputElement>(
      ".context-studio__checkbox-row input[type='checkbox']",
    )!;
    await act(async () => sourceCheckbox.click());
    expect(
      [...mounted.querySelectorAll("button")].some(
        (candidate) => candidate.textContent?.trim() === "Check data",
      ),
    ).toBe(false);

    const visiblePanel = mounted.querySelector<HTMLElement>(
      "[role='tabpanel']:not([hidden])",
    )!;
    const saveName = [
      ...visiblePanel.querySelectorAll<HTMLInputElement>("input"),
    ].find((input) => input.placeholder === "product-support-rag")!;
    const chunkingMethod = [
      ...visiblePanel.querySelectorAll<HTMLSelectElement>("select"),
    ].find((select) =>
      select.parentElement?.textContent?.includes("Chunking method"),
    )!;
    await act(async () => {
      setInput(saveName, "support-rag");
      setSelect(chunkingMethod, "topic-aware");
    });
    await act(async () => button("Prepare RAG database").click());
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain(
        "2 persisted chunks will be reused.",
      ),
    );
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain("Approve and save RAG database"),
    );
    expect(button("Prepare RAG database").querySelector("svg")).not.toBeNull();
    expect(inspectedCommand).toMatchObject({
      action: "source-inspect",
      sourceChecks: {
        preset: "recommended",
        allowedLanguages: ["en"],
        requireLicenseMetadata: false,
        requireConsentMetadata: false,
        includeSourceAttribution: true,
      },
    });
    await act(async () => button("Review preview chunks").click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "<script>window.compromised = true</script>",
      ),
    );
    expect(document.querySelector(".dataset-review__modal script")).toBeNull();
    await act(async () => button("Approve chunk").click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>("button[aria-label='Close dialog']")!
        .click(),
    );
    expect(startedCommand).toMatchObject({
      kind: "rag-database",
      name: "support-rag",
      sources: [{ artifactId: "uploads/support.parquet" }],
      chunking: {
        strategy: "topic-aware",
        maximumTokensPerChunk: 320,
        topicBoundarySensitivity: 0.22,
        textFields: ["question", "answer"],
      },
      sourceChecks: {
        preset: "recommended",
        allowedLanguages: ["en"],
        includeSourceAttribution: true,
      },
    });

    await act(async () => button("Approve and save RAG database").click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Source freshness"),
    );
    expect(mounted.textContent).toContain(
      "support-rag is available in Context Browser.",
    );
    expect(document.body.textContent).toContain("support-rag");
    expect(
      mounted.querySelector(".artifact-browser__artifact-card"),
    ).not.toBeNull();
    expect(button("View Details")).not.toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          "button[aria-label='Close context detail and preview']",
        )!
        .click(),
    );
    await act(async () => button("View Details").click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Source freshness"),
    );
    await act(async () => button("View source in Data Management").click());
    expect(onViewSource).toHaveBeenCalledWith("datasets/support.parquet");
  });

  it("blocks RAG generation when automatic source checks find a required metadata issue", async () => {
    const execute = vi.fn(
      async ({ command }): Promise<ContextManagementTransportValue> => {
        if (command.action === "browser-list") {
          return { action: "browser-list", items: [] };
        }
        if (command.action === "source-inspect") {
          return {
            action: "source-inspect",
            readiness: {
              artifactId: command.artifactId,
              ready: false,
              locallyReadable: true,
              digest: `sha256:${"c".repeat(64)}`,
              mediaType: "text/markdown",
              originalName: "notes.md",
              sizeBytes: 128,
              format: "md",
              sourceKind: "document",
              textFields: [],
              alreadyChunked: false,
              chunkCount: 1,
              checks: {
                status: "blocked",
                checkedChunkCount: 1,
                issueCounts: {
                  exactDuplicate: 0,
                  fuzzyDuplicate: 0,
                  textTooShort: 0,
                  textTooLong: 0,
                  languageNotAllowed: 0,
                  languageUncertain: 0,
                  sensitivePersonalData: 0,
                  secretLikeContent: 0,
                  licenseMetadataMissing: 1,
                  consentMetadataMissing: 0,
                },
                checkedSurfaces: ["requested license information"],
                limitations: ["Review remains required."],
              },
              reasonCode: "source-checks-blocked",
              message: "The source did not pass the selected data checks.",
              action: "Add license information or adjust the advanced rule.",
            },
          };
        }
        throw new Error(`Unexpected command: ${command.action}`);
      },
    );
    const mounted = await renderStudio({
      listSourceArtifacts: vi.fn(async () => [
        {
          artifactId: "uploads/notes.md",
          label: "notes.md",
          mediaType: "text/markdown",
          sourceKind: "upload",
        },
      ]),
      listLocalTextModels: vi.fn(async () => [
        {
          modelId: "local/summary-model",
          label: "Summary Model (local/summary-model)",
        },
      ]),
      execute,
    });
    await vi.waitFor(() => expect(mounted.textContent).toContain("notes.md"));
    await act(async () => {
      mounted
        .querySelector<HTMLInputElement>(
          ".context-studio__checkbox-row input[type='checkbox']",
        )!
        .click();
    });
    const visiblePanel = mounted.querySelector<HTMLElement>(
      "[role='tabpanel']:not([hidden])",
    )!;
    const saveName = [
      ...visiblePanel.querySelectorAll<HTMLInputElement>("input"),
    ].find((input) => input.placeholder === "product-support-rag")!;
    await act(async () => {
      setInput(saveName, "blocked-rag");
      const licenseRule = [
        ...visiblePanel.querySelectorAll<HTMLInputElement>(
          "input[type='checkbox']",
        ),
      ].find((input) =>
        input.parentElement?.textContent?.includes("Require license"),
      )!;
      licenseRule.click();
    });
    await act(async () => button("Prepare RAG database").click());
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain(
        "Sources missing required license information: 1",
      ),
    );
    expect(mounted.textContent).toContain(
      "Correct the source data or adjust the advanced data rules",
    );
    expect(
      execute.mock.calls.some(
        ([input]) => input.command.action === "generation-start",
      ),
    ).toBe(false);
  });

  it("validates, renders, reviews, and discards a manual context pack", async () => {
    let startedCommand:
      | Extract<
          ContextManagementTransportCommand,
          { action: "generation-start" }
        >["command"]
      | undefined;
    const client: ContextManagementClient = {
      listSourceArtifacts: vi.fn(async () => []),
      execute: vi.fn(
        async ({ command }): Promise<ContextManagementTransportValue> => {
          if (command.action === "browser-list") {
            return { action: "browser-list", items: [] };
          }
          if (command.action === "generation-start") {
            startedCommand = command.command;
            return {
              action: "generation-start",
              value: {
                requestId: "context-request-2",
                taskType: "generate-context-artifact",
                accepted: true,
                status: "running",
              },
            };
          }
          if (command.action === "generation-read") {
            return {
              action: "generation-read",
              status: {
                requestId: command.requestId,
                state: "review-required",
                preview: {
                  kind: "markdown-context-pack",
                  name: "manual-pack",
                  sourceCount: 0,
                  manualEntryCount: 1,
                  chunkCount: 1,
                  items: [
                    {
                      id: "manual-entry-1",
                      kind: "manual",
                      title: "Manual pack",
                      text: "# Release policy\n\nUse **passing** reviews.",
                      citations: [{ manualEntryId: "manual-entry-1" }],
                    },
                  ],
                },
              },
            };
          }
          if (command.action === "generation-discard") {
            return {
              action: "generation-discard",
              status: { requestId: command.requestId, state: "discarded" },
            };
          }
          throw new Error(`Unexpected command: ${command.action}`);
        },
      ),
    };
    const mounted = await renderStudio(client);
    await act(async () => button("Context Packs").click());
    expect(mounted.textContent).toContain("How will you create the pack?");
    await act(async () => buttonContaining("Manual entry").click());
    const visiblePanel = mounted.querySelector<HTMLElement>(
      "[role='tabpanel']:not([hidden])",
    )!;
    const inputs = [
      ...visiblePanel.querySelectorAll<HTMLInputElement>("input"),
    ];
    const saveName = inputs.find(
      (input) => input.placeholder === "product-support-context",
    )!;
    const manual = visiblePanel.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      setInput(manual, "# Broken\n\n```text\nnot closed");
      setInput(saveName, "manual-pack");
    });
    expect(mounted.textContent).toContain("4 lines");
    await act(async () => button("Prepare context pack").click());
    expect(mounted.textContent).toContain("unclosed fenced code block");
    expect(startedCommand).toBeUndefined();
    await act(async () => {
      setInput(manual, "# Release policy\n\nUse **passing** reviews.");
    });
    expect(mounted.textContent).toContain("3 lines");
    expect(mounted.textContent).not.toContain("Semantic chunking");
    expect(button("Prepare context pack").disabled).toBe(false);
    await act(async () => button("Prepare context pack").click());
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain("Discard context pack"),
    );
    await act(async () => button("Review prepared Markdown").click());
    expect(
      document.querySelector(".dataset-review__modal h1")?.textContent,
    ).toBe("Release policy");
    expect(
      document.querySelector(
        ".dataset-review__modal .artifact-preview__markdown strong",
      )?.textContent,
    ).toContain("passing");
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>("button[aria-label='Close dialog']")!
        .click(),
    );
    expect(startedCommand).toMatchObject({
      kind: "markdown-context-pack",
      sources: [],
      manualEntries: [
        {
          title: "manual-pack",
          content: "# Release policy\n\nUse **passing** reviews.",
        },
      ],
      contextPack: {
        inputMode: "manual",
        method: "none",
      },
    });
    await act(async () => button("Discard context pack").click());
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain(
        "The prepared context artifact was discarded.",
      ),
    );
  });

  it("automatically prepares semantic source materials and discovers context-pack topics", async () => {
    let startedCommand:
      | Extract<
          ContextManagementTransportCommand,
          { action: "generation-start" }
        >["command"]
      | undefined;
    const execute = vi.fn(
      async ({ command }): Promise<ContextManagementTransportValue> => {
        if (command.action === "browser-list") {
          return { action: "browser-list", items: [] };
        }
        if (command.action === "source-inspect") {
          return {
            action: "source-inspect",
            readiness: {
              artifactId: command.artifactId,
              ready: true,
              locallyReadable: true,
              digest: `sha256:${"d".repeat(64)}`,
              mediaType: "text/markdown",
              originalName: "handbook.md",
              sizeBytes: 512,
              format: "md",
              sourceKind: "document",
              textFields: [],
              alreadyChunked: false,
              chunkCount: 3,
            },
          };
        }
        if (command.action === "generation-start") {
          startedCommand = command.command;
          return {
            action: "generation-start",
            value: {
              requestId: "context-request-source-pack",
              taskType: "generate-context-artifact",
              accepted: true,
              status: "running",
            },
          };
        }
        if (command.action === "generation-read") {
          return {
            action: "generation-read",
            status: {
              requestId: command.requestId,
              state: "review-required",
              preview: {
                kind: "markdown-context-pack",
                name: "handbook-pack",
                sourceCount: 1,
                manualEntryCount: 0,
                chunkCount: 3,
                items: [
                  {
                    id: "topic:0",
                    kind: "topic",
                    title: "Release policy",
                    text: "## Release policy\n\nUse **passing** reviews.",
                    citations: [
                      {
                        sourceArtifactId: "uploads/handbook.md",
                        chunkIndex: 0,
                      },
                    ],
                  },
                ],
              },
            },
          };
        }
        if (command.action === "generation-discard") {
          return {
            action: "generation-discard",
            status: { requestId: command.requestId, state: "discarded" },
          };
        }
        throw new Error(`Unexpected command: ${command.action}`);
      },
    );
    const mounted = await renderStudio({
      listSourceArtifacts: vi.fn(async () => [
        {
          artifactId: "uploads/handbook.md",
          label: "handbook.md",
          mediaType: "text/markdown",
          sourceKind: "upload",
        },
      ]),
      listLocalTextModels: vi.fn(async () => [
        {
          modelId: "local/summary-model",
          label: "Summary Model (local/summary-model)",
        },
      ]),
      execute,
    });
    await act(async () => button("Context Packs").click());
    await act(async () => buttonContaining("From source materials").click());
    expect(mounted.textContent).toContain("Semantic chunking");
    expect(mounted.textContent).toContain("Combine related context");
    expect(mounted.textContent).toContain(
      "number of topics is discovered from the source material",
    );
    expect(mounted.querySelector("textarea")).toBeNull();
    await act(async () =>
      mounted
        .querySelector<HTMLInputElement>(
          ".context-studio__checkbox-row input[type='checkbox']",
        )!
        .click(),
    );
    const visiblePanel = mounted.querySelector<HTMLElement>(
      "[role='tabpanel']:not([hidden])",
    )!;
    const packName = [
      ...visiblePanel.querySelectorAll<HTMLInputElement>("input"),
    ].find((input) => input.placeholder === "product-support-context")!;
    expect(mounted.textContent).toContain("No Summarization");
    expect(mounted.textContent).not.toContain("Maximum summary lines");
    const cleaning = [
      ...visiblePanel.querySelectorAll<HTMLSelectElement>("select"),
    ].find((select) =>
      select.parentElement?.textContent?.includes("Cleaning"),
    )!;
    expect(cleaning.value).toBe("standard");
    await act(async () => {
      setSelect(cleaning, "strict");
      setInput(packName, "handbook-pack");
    });
    await act(async () => button("Prepare context pack").click());
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain("Discard context pack"),
    );
    expect(startedCommand).toMatchObject({
      kind: "markdown-context-pack",
      name: "handbook-pack",
      sources: [{ artifactId: "uploads/handbook.md" }],
      chunking: {
        strategy: "topic-aware",
        maximumTokensPerChunk: 320,
        topicBoundarySensitivity: 0.22,
      },
      contextPack: {
        inputMode: "source-materials",
        method: "none",
        cleaningPreset: "strict",
      },
    });
    expect(startedCommand).not.toHaveProperty("manualEntries");
    expect(startedCommand?.contextPack).not.toHaveProperty(
      "maximumSummaryLines",
    );
    expect(
      execute.mock.calls.some(
        ([input]) => input.command.action === "source-inspect",
      ),
    ).toBe(true);
    await act(async () => button("Review prepared Markdown").click());
    expect(
      document.querySelector(
        ".dataset-review__modal .artifact-preview__markdown h2",
      )?.textContent,
    ).toBe("Release policy");
    expect(
      document.querySelector(
        ".dataset-review__modal .artifact-preview__markdown strong",
      )?.textContent,
    ).toContain("passing");
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>("button[aria-label='Close dialog']")!
        .click(),
    );
    await act(async () => button("Discard context pack").click());
    const summaryMethod = [
      ...visiblePanel.querySelectorAll<HTMLSelectElement>("select"),
    ].find((select) =>
      select.parentElement?.textContent?.includes("Summary method"),
    )!;
    await act(async () => setSelect(summaryMethod, "local-model"));
    const summaryModel = [
      ...visiblePanel.querySelectorAll<HTMLSelectElement>("select"),
    ].find((select) =>
      select.parentElement?.textContent?.includes("Local summary model"),
    )!;
    const lineLimit = [
      ...visiblePanel.querySelectorAll<HTMLInputElement>(
        "input[type='number']",
      ),
    ].find((input) =>
      input.parentElement?.textContent?.includes("Maximum summary lines"),
    )!;
    expect(lineLimit.value).toBe("200");
    await act(async () => setSelect(summaryModel, "local/summary-model"));
    await act(async () => button("Prepare context pack").click());
    await vi.waitFor(() =>
      expect(startedCommand?.contextPack).toMatchObject({
        inputMode: "source-materials",
        method: "local-model",
        cleaningPreset: "strict",
        maximumSummaryLines: 200,
        model: {
          provider: "transformers",
          modelId: "local/summary-model",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(mounted.textContent).toContain("Discard context pack"),
    );
    await act(async () => button("Discard context pack").click());
  });

  it("publishes authoritative task progress to workspace notifications", async () => {
    function NotificationProbe() {
      const notifications = useNotificationCenter();
      useEffect(
        () => notifications.setActiveWorkspaceId("workspace-a"),
        [notifications.setActiveWorkspaceId],
      );
      return (
        <output>
          {notifications.records
            .map(
              (record) =>
                `${record.title}:${record.message}:${record.progress?.percent ?? 0}`,
            )
            .join("\n")}
        </output>
      );
    }
    const client: ContextManagementClient = {
      listSourceArtifacts: vi.fn(async () => []),
      execute: vi.fn(
        async ({ command }): Promise<ContextManagementTransportValue> => {
          if (command.action !== "task-list") {
            throw new Error(`Unexpected command: ${command.action}`);
          }
          return {
            action: "task-list",
            tasks: [
              {
                requestId: "context-task-install",
                taskType: "context-generation",
                status: "running",
                progress: {
                  message:
                    "Installing the local vector database. This runs once for the managed Python runtime.",
                  percent: 0,
                },
              },
              {
                requestId: "context-task-1",
                taskType: "context-generation",
                status: "running",
                progress: {
                  message: "Embedding chunk 2 of 4.",
                  current: 2,
                  total: 4,
                  percent: 50,
                  unit: "chunk",
                },
              },
            ],
          };
        },
      ),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <NotificationProvider>
          <NotificationProbe />
          <ContextTaskNotificationBridge
            client={client}
            workspaceId="workspace-a"
          />
        </NotificationProvider>,
      );
    });
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "Context preparation:Installing the local vector database. This runs once for the managed Python runtime.:0",
      ),
    );
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "Context preparation:Embedding chunk 2 of 4.:50",
      ),
    );
  });
});
