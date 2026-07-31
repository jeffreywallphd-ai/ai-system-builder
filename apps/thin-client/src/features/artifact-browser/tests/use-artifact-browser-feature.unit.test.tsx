// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotificationTestHarness,
  readNotificationMessages,
} from "../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { ArtifactBrowserFeature } from "../components/ArtifactBrowserFeature";

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ArtifactBrowserFeature", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }

    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  it("hides token and publish controls while showing published backing details", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
          mediaType: "image/png",
        },
        {
          storageKey: "workspaces/workspace-a/system-builds/evidence/internal-digest",
          artifactFamily: "structured-text" as const,
          mediaType: "application/vnd.ai-system-builder.build-evidence+json",
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
        mediaType: "image/png",
        sizeBytes: 4,
        metadata: {
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
              locator: "openai/demo/images/cat.png",
            },
            verification: {
              exists: false,
            },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        mediaType: "image/png",
        sizeBytes: 4,
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockReturnValue(
          "/api/artifact/media/view?storageKey=uploads%2Fcat.png",
        ),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-17T00:00:00.000Z",
        },
      }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-17T00:00:00.000Z",
        },
      }),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <NotificationTestHarness>
          <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />
        </NotificationTestHarness>,
      );
    });

    const artifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("uploads/cat.png"),
    ) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    expect(document.body.textContent).not.toContain("Hugging Face token");
    expect(document.body.textContent).not.toContain("Publish to Hugging Face");
    expect(document.body.textContent).toContain("Published Backing");
    expect(document.body.textContent).toContain("openai/demo");
    expect(document.body.textContent).toContain("Not yet verified");
    expect(document.body.textContent).not.toContain("internal-digest");
  });

  it("deletes a selected artifact after confirmation", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockReturnValue(
          "/api/artifact/media/view?storageKey=uploads%2Fcat.png",
        ),
      deleteRegisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/cat.png" }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("uploads/cat.png"),
    ) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });
    const deleteButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete artifact",
    ) as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
    });

    const confirmationInput = Array.from(
      document.body.querySelectorAll("input"),
    ).find(
      (input) => input.getAttribute("placeholder") === "Delete",
    ) as HTMLInputElement;
    setInputValue(confirmationInput, "Delete");

    const confirmButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Confirm delete",
    ) as HTMLButtonElement;
    await act(async () => {
      confirmButton.click();
    });

    expect(client.deleteRegisteredArtifact).toHaveBeenCalledWith(
      { storageKey: "uploads/cat.png" },
      { workspaceId: "workspace-a" },
    );
    expect(document.body.textContent).not.toContain("Deleted uploads/cat.png.");
  });

  it("deletes selected artifacts in bulk after Delete All confirmation", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        { storageKey: "uploads/a.png", artifactFamily: "image" as const },
        { storageKey: "uploads/b.png", artifactFamily: "image" as const },
      ]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn().mockResolvedValue({}),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });
    const artifactCheckboxes = Array.from(
      document.body.querySelectorAll("li:not(:first-child) input[type='checkbox']"),
    ) as HTMLInputElement[];
    await act(async () => {
      artifactCheckboxes[0]?.click();
      artifactCheckboxes[1]?.click();
    });
    const deleteAllInput = Array.from(document.body.querySelectorAll("input")).find(
      (input) => input.getAttribute("placeholder") === "Delete All",
    ) as HTMLInputElement;
    setInputValue(deleteAllInput, "Delete All");
    const deleteSelected = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Delete Selected"),
    ) as HTMLButtonElement;
    await act(async () => {
      deleteSelected.click();
    });
    expect(client.deleteRegisteredArtifact).toHaveBeenCalledWith(
      { storageKey: "uploads/a.png" },
      { workspaceId: "workspace-a" },
    );
    expect(client.deleteRegisteredArtifact).toHaveBeenCalledWith(
      { storageKey: "uploads/b.png" },
      { workspaceId: "workspace-a" },
    );
  });

  it("selects and deselects every listed artifact from the bulk checkbox", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        { storageKey: "uploads/a.png", artifactFamily: "image" as const },
        { storageKey: "uploads/b.png", artifactFamily: "image" as const },
      ]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn().mockResolvedValue({}),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const [selectAllCheckbox, ...artifactCheckboxes] = Array.from(
      document.body.querySelectorAll("input[type='checkbox']"),
    ) as HTMLInputElement[];
    expect(selectAllCheckbox?.checked).toBe(false);
    expect(artifactCheckboxes.map((checkbox) => checkbox.checked)).toEqual([
      false,
      false,
    ]);

    await act(async () => {
      selectAllCheckbox?.click();
    });
    expect(selectAllCheckbox?.checked).toBe(true);
    expect(artifactCheckboxes.map((checkbox) => checkbox.checked)).toEqual([
      true,
      true,
    ]);
    expect(document.body.textContent).toContain("Delete Selected (2)");

    await act(async () => {
      selectAllCheckbox?.click();
    });
    expect(selectAllCheckbox?.checked).toBe(false);
    expect(artifactCheckboxes.map((checkbox) => checkbox.checked)).toEqual([
      false,
      false,
    ]);
    expect(document.body.textContent).toContain("Delete Selected (0)");
  });

  it("does not render Hugging Face token settings", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••9999" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    expect(document.body.textContent).not.toContain("Hugging Face token");
    expect(document.body.querySelector("input[type='password']")).toBe(null);
    return;

    const tokenInput = document.body.querySelector(
      "input[type='password']",
    ) as HTMLInputElement;
    setInputValue(tokenInput, "hf_9999");
    const saveButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Save token",
    ) as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });
    expect(client.setHuggingFaceToken).toHaveBeenCalledWith({
      token: "hf_9999",
    });
    expect(document.body.textContent).toContain("Hugging Face token saved.");

    const clearButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Clear token",
    ) as HTMLButtonElement;
    await act(async () => {
      clearButton.click();
    });
    expect(client.clearHuggingFaceToken).toHaveBeenCalled();
  });

  it("does not render thin-client artifact publish controls", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockReturnValue(
          "/api/artifact/media/view?storageKey=uploads%2Fcat.png",
        ),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("uploads/cat.png"),
    ) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    expect(document.body.textContent).toContain("Delete artifact");
    expect(document.body.textContent).not.toContain("Publish to Hugging Face");
    return;

    const publishToggle = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish to Hugging Face",
    ) as HTMLButtonElement;
    await act(async () => {
      publishToggle.click();
    });
    const repositoryInput = Array.from(
      document.body.querySelectorAll("input"),
    ).find(
      (input) => input.getAttribute("placeholder") === "owner/repository",
    ) as HTMLInputElement;
    setInputValue(repositoryInput, "openai/demo");
    const publishButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish",
    ) as HTMLButtonElement;
    await act(async () => {
      publishButton.click();
    });
    expect(client.publishArtifactToHuggingFace).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      artifactId: "uploads/cat.png",
      repository: "openai/demo",
      path: "cat.png",
      revision: "main",
      mediaType: "",
    });
  });

  it("traverses selected image previews with previous and next controls", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat-1.png",
          artifactFamily: "image" as const,
          mediaType: "image/png",
        },
        {
          storageKey: "uploads/cat-2.png",
          artifactFamily: "image" as const,
          mediaType: "image/png",
        },
      ]),
      readArtifactDetail: vi.fn(
        async ({ storageKey }: { storageKey: string }) => ({
          locator: { storageKey },
          artifactFamily: "image" as const,
          mediaType: "image/png",
        }),
      ),
      readArtifactContent: vi.fn(
        async ({ storageKey }: { storageKey: string }) => ({
          locator: { storageKey },
          mediaType: "image/png",
          availability: "available" as const,
          retrieval: "deferred" as const,
        }),
      ),
      createArtifactMediaViewUrl: vi.fn(
        ({ storageKey }: { storageKey: string }) =>
          `/api/artifact/media/view?storageKey=${encodeURIComponent(storageKey)}`,
      ),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const firstArtifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("uploads/cat-1.png"),
    ) as HTMLButtonElement;
    await act(async () => {
      firstArtifactButton.click();
    });

    expect(document.body.textContent).toContain(
      "Image preview for uploads/cat-1.png",
    );
    const nextButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Next",
    ) as HTMLButtonElement;
    await act(async () => {
      nextButton.click();
    });
    expect(document.body.textContent).toContain(
      "Image preview for uploads/cat-2.png",
    );

    const previousButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Previous") as HTMLButtonElement;
    await act(async () => {
      previousButton.click();
    });
    expect(document.body.textContent).toContain(
      "Image preview for uploads/cat-1.png",
    );
  });

  it("re-checks published backing existence from the artifact detail panel", async () => {
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValue([
          { storageKey: "uploads/cat.png", artifactFamily: "image" as const },
        ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
        metadata: {
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              locator: "openai/demo/images/cat.png",
            },
            verification: { exists: false },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockReturnValue(
          "/api/artifact/media/view?storageKey=uploads%2Fcat.png",
        ),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("uploads/cat.png"),
    ) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    const recheckButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Re-check published backing",
    ) as HTMLButtonElement;
    await act(async () => {
      recheckButton.click();
    });

    expect(client.verifyPublishedArtifactBacking).toHaveBeenCalledWith({
      artifactId: "uploads/cat.png",
    });
    expect(document.body.textContent).toContain("Last checked:");
  });

  it("registers an artifact from Hugging Face and selects it", async () => {
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            storageKey: "imports/huggingface/openai/demo/main/images/cat.png",
            artifactFamily: "image" as const,
          },
        ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: {
          storageKey: "imports/huggingface/openai/demo/main/images/cat.png",
        },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi
        .fn()
        .mockRejectedValue(new Error("missing local bytes")),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({
        artifactId: "imports/huggingface/openai/demo/main/images/cat.png",
        backing: {
          role: "imported-source" as const,
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            revision: "main",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true as const,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const registerToggle = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Register from Hugging Face",
    ) as HTMLButtonElement;
    await act(async () => {
      registerToggle.click();
    });

    const inputs = Array.from(document.body.querySelectorAll("input"));
    setInputValue(inputs[1] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[2] as HTMLInputElement, "images/cat.png");

    const registerButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Register") as HTMLButtonElement;
    await act(async () => {
      registerButton.click();
    });

    expect(client.registerArtifactFromRepo).toHaveBeenCalledWith({
      repository: "openai/demo",
      path: "images/cat.png",
      revision: "main",
      mediaType: undefined,
    });
    expect(document.body.textContent).not.toContain(
      "Registered imports/huggingface/openai/demo/main/images/cat.png from Hugging Face.",
    );
  });

  it("renders dataset cards with per-card file viewer and register actions", async () => {
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            storageKey:
              "imports/huggingface/openai/demo/main/data/train.parquet",
            artifactFamily: "image" as const,
          },
        ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: {
          storageKey: "imports/huggingface/openai/demo/main/data/train.parquet",
        },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi
        .fn()
        .mockRejectedValue(new Error("missing local bytes")),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      browseHuggingFaceNamespaceDatasets: vi
        .fn()
        .mockResolvedValue([
          { namespace: "openai", repository: "openai/demo" },
        ]),
      browseHuggingFaceDatasetParquetFiles: vi
        .fn()
        .mockResolvedValue([
          {
            repository: "openai/demo",
            path: "data/train.parquet",
            revision: "main",
          },
        ]),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({
        artifactId: "imports/huggingface/openai/demo/main/data/train.parquet",
        backing: {
          role: "imported-source" as const,
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "data/train.parquet",
            revision: "main",
            locator: "openai/demo/data/train.parquet",
          },
          verification: {
            exists: true as const,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const registerToggle = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Register from Hugging Face",
    ) as HTMLButtonElement;
    await act(async () => {
      registerToggle.click();
    });

    const namespaceInput = Array.from(
      document.body.querySelectorAll("input"),
    )[0] as HTMLInputElement;
    setInputValue(namespaceInput, "openai");
    const registerNamespaceButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Register namespace",
    ) as HTMLButtonElement;
    await act(async () => {
      registerNamespaceButton.click();
    });

    const datasetButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "View Files",
    ) as HTMLButtonElement;
    await act(async () => {
      datasetButton.click();
    });

    expect(client.browseHuggingFaceDatasetParquetFiles).toHaveBeenCalledWith({
      repository: "openai/demo",
      revision: "main",
    });
    expect(document.body.textContent).toContain("Dataset files");
    expect(document.body.textContent).toContain("data/train.parquet");

    const registerFileButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Register") as HTMLButtonElement;
    await act(async () => {
      registerFileButton.click();
    });

    expect(client.registerArtifactFromRepo).toHaveBeenCalledWith({
      repository: "openai/demo",
      path: "data/train.parquet",
      revision: "main",
      mediaType: undefined,
    });

    const closeButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Close",
    ) as HTMLButtonElement;
    await act(async () => {
      closeButton.click();
    });

    expect(document.body.textContent).not.toContain("Dataset files");
  });

  it("renders per-card dataset file errors", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      browseHuggingFaceNamespaceDatasets: vi
        .fn()
        .mockResolvedValue([
          { namespace: "openai", repository: "openai/demo" },
        ]),
      browseHuggingFaceDatasetParquetFiles: vi
        .fn()
        .mockRejectedValue(new Error("Failed to load dataset files.")),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const registerToggle = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Register from Hugging Face",
    ) as HTMLButtonElement;
    await act(async () => {
      registerToggle.click();
    });

    const namespaceInput = Array.from(
      document.body.querySelectorAll("input"),
    )[0] as HTMLInputElement;
    setInputValue(namespaceInput, "openai");
    const registerNamespaceButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Register namespace",
    ) as HTMLButtonElement;
    await act(async () => {
      registerNamespaceButton.click();
    });

    const datasetButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "View Files",
    ) as HTMLButtonElement;
    await act(async () => {
      datasetButton.click();
    });

    expect(document.body.textContent).toContain("Failed to load dataset files.");
  });

  it("localizes imported artifact bytes from the artifact panel", async () => {
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValue([
          {
            storageKey: "artifacts/20260418000000-local01",
            artifactFamily: "image" as const,
          },
        ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        artifactFamily: "image" as const,
        metadata: {
          importedSourceBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
            },
            verification: { exists: true },
          },
        },
      }),
      readArtifactContent: vi
        .fn()
        .mockResolvedValueOnce({
          locator: { storageKey: "artifacts/20260418000000-local01" },
          availability: "unavailable" as const,
          retrieval: "deferred" as const,
        })
        .mockResolvedValueOnce({
          locator: { storageKey: "artifacts/20260418000000-local01" },
          availability: "available" as const,
          retrieval: "deferred" as const,
        }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockReturnValue(
          "/api/artifact/media/view?storageKey=artifacts%2F20260418000000-local01",
        ),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        artifactId: "artifacts/20260418000000-local01",
        localObject: {
          key: "artifacts/20260418000000-local01",
          mediaType: "image/png",
          sizeBytes: 3,
        },
        source: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          locator: "openai/demo/images/cat.png",
        },
        localizedAt: "2026-04-18T00:00:00.000Z",
      }),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <NotificationTestHarness>
          <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />
        </NotificationTestHarness>,
      );
    });

    const artifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("artifacts/20260418000000-local01"),
    ) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    const localizeButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Localize artifact",
    ) as HTMLButtonElement;
    await act(async () => {
      localizeButton.click();
    });

    expect(client.localizeArtifactFromRepo).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(readNotificationMessages(container)).toContain(
      "Localized artifacts/20260418000000-local01 to local object storage.",
    );
    expect(document.body.textContent).not.toContain(
      "Localized artifacts/20260418000000-local01 to local object storage.",
    );
  });

  it("shows source verification and remote-only/localized state cues based on backing state", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "artifacts/20260418000000-local01",
          artifactFamily: "image" as const,
          metadata: {
            backingState: {
              hasImportedSourceBacking: true,
              hasPublishedBacking: true,
              hasLocalObjectAvailable: false,
              isLocalized: false,
              isRemoteOnly: true,
            },
          },
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        artifactFamily: "image" as const,
        metadata: {
          importedSourceBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
            },
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo-public",
              path: "images/cat.png",
              revision: "main",
            },
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        availability: "unavailable" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      deleteRegisteredArtifact: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      verifyImportedSourceBacking: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
        },
        verification: { exists: true, verifiedAt: "2026-04-19T00:00:00.000Z" },
      }),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    expect(document.body.textContent).toContain("Remote only");
    expect(document.body.textContent).toContain("Published");

    const artifactButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("artifacts/20260418000000-local01"),
    ) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    expect(document.body.textContent).toContain(
      "Remote-only artifact. Local preview is unavailable until localization.",
    );
    expect(document.body.textContent).toContain("Re-check source backing");
    expect(document.body.textContent).toContain("Localize artifact");
  });
});
