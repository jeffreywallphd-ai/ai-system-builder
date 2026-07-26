// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetDerivedCustomizationDraftRecord } from "../../../../contracts/asset-authoring";
import {
  AssetDerivedCustomizationEditor,
  type AssetDerivedCustomizationClient,
} from "../AssetDerivedCustomizationEditor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const summary = {
  workspaceId: "workspace-1",
  sourceKind: "system-owned-asset",
  definitionRef: {
    kind: "asset-definition-version",
    id: "builtin.button",
    version: "1.0.0",
  },
  implementationReleaseId: "implementation-release.button.1",
  displayName: "Button",
  description: "Reusable button",
  eligibility: { eligible: true, code: "eligible", message: "Eligible" },
  resources: {
    total: 3,
    editable: 3,
    frontendStructure: 1,
    frontendStyle: 1,
    backendLogic: 1,
    other: 0,
  },
} as const;

const detail = {
  ...summary,
  definition: {
    definitionId: "builtin.button",
    assetType: "ui-component",
    assetFamily: "structural",
    version: "1.0.0",
    displayName: "Button",
    description: "Reusable button",
    lifecycleStatus: "published",
    provenance: {},
    ports: [],
    requirements: [],
    compositionRules: [],
    dependencies: [],
  },
  backingResources: [
    {
      path: "frontend/Button.tsx",
      role: "frontend-structure",
      mediaType: "text/typescript",
      sizeCharacters: 10,
      editable: true,
      content: "export const Button = 1;",
    },
    {
      path: "styles/button.css",
      role: "frontend-style",
      mediaType: "text/css",
      sizeCharacters: 9,
      editable: true,
      content: ".button{}",
    },
    {
      path: "backend/button.json",
      role: "backend-logic",
      mediaType: "application/json",
      sizeCharacters: 2,
      editable: true,
      content: "{}",
    },
  ],
  protectedFields: ["asset-identity", "ownership"],
} as any;

const secondSummary = {
  ...summary,
  definitionRef: {
    kind: "asset-definition-version",
    id: "builtin.card",
    version: "1.0.0",
  },
  implementationReleaseId: "implementation-release.card.1",
  displayName: "Card",
  description: "Reusable card",
} as const;

const secondDetail = {
  ...detail,
  ...secondSummary,
  definition: {
    ...detail.definition,
    definitionId: "builtin.card",
    displayName: "Card",
    description: "Reusable card",
  },
} as any;

function record(
  status: "draft" | "reviewed" | "published" | "abandoned",
  revision: number,
): AssetDerivedCustomizationDraftRecord {
  return {
    customizationId: "customization.button.1",
    workspaceId: "workspace-1",
    base: {
      definitionRef: summary.definitionRef,
      implementationReleaseId: summary.implementationReleaseId,
      sourceSnapshotId: "source.button.1",
      sourceArtifact: {},
    },
    derivedDefinitionRef: {
      kind: "asset-definition-version",
      id: "builtin.button.custom",
      version: "1.0.0",
    },
    semanticPatch: { "display-name": "Button (Custom)" },
    status,
    revision,
    provenance: {},
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    createdBy: "user",
    ...(status === "reviewed" || status === "published" ? { review: {} } : {}),
    ...(status === "published" ? { publication: {} } : {}),
  } as unknown as AssetDerivedCustomizationDraftRecord;
}

function topmostDialog(): HTMLElement {
  const dialogs =
    document.body.querySelectorAll<HTMLElement>("[role='dialog']");
  return dialogs[dialogs.length - 1]!;
}

describe("AssetDerivedCustomizationEditor interactions", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("selects a base, saves changed backing source, reviews, and publishes the copy", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ok: true, value: record("draft", 1) });
    const review = vi
      .fn()
      .mockResolvedValue({ ok: true, value: record("reviewed", 2) });
    const publish = vi
      .fn()
      .mockResolvedValue({ ok: true, value: record("published", 3) });
    const client: AssetDerivedCustomizationClient = {
      listCustomizationTargets: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [summary as any] } }),
      readCustomizationTarget: vi
        .fn()
        .mockResolvedValue({ ok: true, value: detail }),
      listDerivedCustomizations: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      createDerivedCustomization: create,
      updateDerivedCustomization: vi.fn(),
      reviewDerivedCustomization: review,
      publishDerivedCustomization: publish,
      abandonDerivedCustomization: vi.fn(),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <AssetDerivedCustomizationEditor
          workspaceId="workspace-1"
          client={client}
        />,
      ),
    );
    await vi.waitFor(() => expect(container?.textContent).toContain("Button"));

    const targetButton = container.querySelector<HTMLButtonElement>(
      ".asset-customizer__target",
    )!;
    await act(async () => targetButton.click());
    await vi.waitFor(() =>
      expect(
        container?.querySelector(".asset-customizer__source"),
      ).not.toBeNull(),
    );

    const source = container.querySelector<HTMLTextAreaElement>(
      ".asset-customizer__source",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(source, "export const Button = 2;");
      source.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create customization draft",
    )!;
    await act(async () => createButton.click());
    await vi.waitFor(() => expect(create).toHaveBeenCalled());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        baseDefinitionRef: summary.definitionRef,
        baseImplementationReleaseId: summary.implementationReleaseId,
        derivedDefinitionRef: {
          kind: "asset-definition-version",
          id: "builtin.button.custom",
          version: "1.0.0",
        },
        sourceChanges: [
          {
            operation: "upsert",
            path: "frontend/Button.tsx",
            role: "frontend-structure",
            mediaType: "text/typescript",
            content: "export const Button = 2;",
          },
        ],
      }),
    );

    const reviewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Materialize review snapshot",
    )!;
    await act(async () => reviewButton.click());
    await vi.waitFor(() =>
      expect(review).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        customizationId: "customization.button.1",
        expectedRevision: 1,
      }),
    );
    const publishButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish customized copy",
    )!;
    await act(async () => publishButton.click());
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        customizationId: "customization.button.1",
        expectedRevision: 2,
      }),
    );
    expect(container.textContent).toContain("published - revision 3");
  });

  it("confirms target changes and supports searchable, recoverable history abandonment", async () => {
    const listHistory = vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [record("draft", 1)] },
    });
    const readTarget = vi.fn().mockImplementation(({ definitionRef }) =>
      Promise.resolve({
        ok: true,
        value: definitionRef.id === "builtin.card" ? secondDetail : detail,
      }),
    );
    const abandon = vi
      .fn()
      .mockResolvedValue({ ok: true, value: record("abandoned", 2) });
    const client: AssetDerivedCustomizationClient = {
      listCustomizationTargets: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [summary as any, secondSummary as any] },
      }),
      readCustomizationTarget: readTarget,
      listDerivedCustomizations: listHistory,
      createDerivedCustomization: vi.fn(),
      updateDerivedCustomization: vi.fn(),
      reviewDerivedCustomization: vi.fn(),
      publishDerivedCustomization: vi.fn(),
      abandonDerivedCustomization: abandon,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <AssetDerivedCustomizationEditor
          workspaceId="workspace-1"
          client={client}
        />,
      ),
    );
    await vi.waitFor(() => expect(container?.textContent).toContain("Card"));
    expect(container.textContent).toContain("draft - revision 1");

    const historyInput = container.querySelector<HTMLInputElement>(
      "input[placeholder='Name, definition ID, or customization ID']",
    )!;
    const historyStatus = Array.from(container.querySelectorAll("select")).find(
      (select) => select.querySelector("option[value='published']"),
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(historyInput, "button");
      historyInput.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )?.set?.call(historyStatus, "draft");
      historyStatus.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const searchHistory = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Search history",
    )!;
    await act(async () => searchHistory.click());
    await vi.waitFor(() =>
      expect(listHistory).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        text: "button",
        status: "draft",
      }),
    );

    const targetButtons = container.querySelectorAll<HTMLButtonElement>(
      ".asset-customizer__target",
    );
    await act(async () => targetButtons[0]!.click());
    await vi.waitFor(() => expect(readTarget).toHaveBeenCalledTimes(1));
    await act(async () => targetButtons[1]!.click());
    expect(topmostDialog().textContent).toContain(
      "Change customization target?",
    );
    expect(readTarget).toHaveBeenCalledTimes(1);
    const changeAsset = Array.from(
      topmostDialog().querySelectorAll("button"),
    ).find((button) => button.textContent === "Change asset")!;
    await act(async () => changeAsset.click());
    await vi.waitFor(() =>
      expect(readTarget).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        definitionRef: secondSummary.definitionRef,
        implementationReleaseId: secondSummary.implementationReleaseId,
      }),
    );
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Card is ready to customize"),
    );

    const abandonButton = Array.from(
      container.querySelectorAll(".asset-customizer__history button"),
    ).find((button) => button.textContent === "Abandon")!;
    await act(async () => abandonButton.click());
    expect(topmostDialog().textContent).toContain(
      "Abandon this customization?",
    );
    const confirmAbandon = Array.from(
      topmostDialog().querySelectorAll("button"),
    ).find((button) => button.textContent === "Abandon customization")!;
    await act(async () => confirmAbandon.click());
    await vi.waitFor(() =>
      expect(abandon).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        customizationId: "customization.button.1",
        expectedRevision: 1,
      }),
    );
    expect(container.textContent).toContain("abandoned - revision 2");
  });
});
