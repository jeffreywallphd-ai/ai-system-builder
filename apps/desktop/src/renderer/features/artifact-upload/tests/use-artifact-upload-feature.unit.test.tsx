import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useArtifactUploadFeature } from "../hooks/useArtifactUploadFeature";
import type { ArtifactUploadClient } from "../api/desktopArtifactUploadClient";

interface HookProbeProps {
  client: ArtifactUploadClient;
}

function HookProbe({ client }: HookProbeProps) {
  const { selectedFile, viewState, acceptedFileTypes, onFileChange, onUploadSubmit } = useArtifactUploadFeature(client);

  return (
    <form onSubmit={(event) => void onUploadSubmit(event)}>
      <input type="file" onChange={onFileChange} />
      <button type="submit">Upload</button>
      <p data-testid="selected-file">{selectedFile ? selectedFile.name : "none"}</p>
      <p data-testid="status">{viewState.status}</p>
      <p data-testid="message">{viewState.message ?? ""}</p>
      <p data-testid="stored-key">{viewState.key ?? ""}</p>
      <p data-testid="accepted-file-types">{acceptedFileTypes}</p>
    </form>
  );
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });

  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("useArtifactUploadFeature", () => {
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

  it("tracks selected file and reports success state after upload", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        descriptor: {
          key: "uploads/cat.png",
          mediaType: "image/png",
          sizeBytes: 4,
        },
      },
    });
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".png", ".md"],
      acceptedMediaTypes: ["image/png", "text/markdown"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    const file = new File([new Uint8Array([1, 2, 3, 4])], "cat.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });

    await act(async () => {
      setInputFiles(input, [file]);
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector("[data-testid='selected-file']")?.textContent).toBe("cat.png");
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("success");
    expect(container.querySelector("[data-testid='stored-key']")?.textContent).toBe("uploads/cat.png");
    expect(container.querySelector("[data-testid='accepted-file-types']")?.textContent).toBe(
      ".png,.md,image/png,text/markdown",
    );
  });

  it("reports validation error when submit is attempted without selecting a file", async () => {
    const uploadArtifact = vi.fn();
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".pdf"],
      acceptedMediaTypes: ["application/pdf"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const form = container.querySelector("form") as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("error");
    expect(container.querySelector("[data-testid='message']")?.textContent).toBe(
      "Select one artifact file before uploading.",
    );
  });

  it("falls back to text/markdown when browser file type metadata is empty", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        descriptor: {
          key: "uploads/doc.md",
          mediaType: "text/markdown",
          sizeBytes: 4,
        },
      },
    });
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".md"],
      acceptedMediaTypes: ["text/markdown"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;
    const file = new File([new Uint8Array([35, 32, 84, 101])], "doc.md", { type: "" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([35, 32, 84, 101]).buffer,
    });

    await act(async () => {
      setInputFiles(input, [file]);
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("success");
  });

  it("falls back to application/json when browser file type metadata is empty", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        descriptor: {
          key: "uploads/schema.json",
          mediaType: "application/json",
          sizeBytes: 2,
        },
      },
    });
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".json"],
      acceptedMediaTypes: ["application/json"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;
    const file = new File([new Uint8Array([123, 125])], "schema.json", { type: "" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([123, 125]).buffer,
    });

    await act(async () => {
      setInputFiles(input, [file]);
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("success");
  });
});

interface WebsiteHookProbeProps {
  client: ArtifactUploadClient;
  onUploadComplete?: () => void;
  initialBatchInput?: string;
}

function WebsiteHookProbe({ client, onUploadComplete, initialBatchInput }: WebsiteHookProbeProps) {
  const {
    websiteSingleUrl,
    websiteBatchInput,
    websiteSingleViewState,
    websiteBatchViewState,
    setWebsiteSingleUrl,
    setWebsiteBatchInput,
    ingestWebsiteSingle,
    ingestWebsiteBatch,
  } = useArtifactUploadFeature(client, onUploadComplete);

  useEffect(() => {
    if (initialBatchInput) {
      setWebsiteBatchInput(initialBatchInput);
    }
  }, [initialBatchInput, setWebsiteBatchInput]);

  return (
    <div>
      <input data-testid="single-url" value={websiteSingleUrl} onChange={(event) => setWebsiteSingleUrl(event.target.value)} />
      <textarea data-testid="batch-urls" value={websiteBatchInput} onChange={(event) => setWebsiteBatchInput(event.target.value)} />
      <button data-testid="set-single" type="button" onClick={() => setWebsiteSingleUrl("https://example.com")}>set-single</button>
      <button data-testid="set-batch" type="button" onClick={() => setWebsiteBatchInput("https://example.com/a\n\nhttps://example.com/b")}>set-batch</button>
      <button data-testid="ingest-single" type="button" onClick={() => void ingestWebsiteSingle()}>single</button>
      <button data-testid="ingest-batch" type="button" onClick={() => void ingestWebsiteBatch()}>batch</button>
      <p data-testid="single-status">{websiteSingleViewState.status}</p>
      <p data-testid="batch-status">{websiteBatchViewState.status}</p>
      <p data-testid="batch-message">{websiteBatchViewState.message ?? ""}</p>
    </div>
  );
}

it("submits single website ingestion and refreshes upload browser on success", async () => {
  const onUploadComplete = vi.fn();
  const ingestWebsitePage = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      target: { url: "https://example.com" },
      resolvedUrl: "https://example.com",
      acquisitionMechanismUsed: "simple-http",
      stagedArtifact: { sourceKind: "scrape", storage: { key: "staged/website/example.com/index.html" } },
    },
  });
  const client: ArtifactUploadClient = {
    uploadArtifact: vi.fn(),
    getAcceptedTypes: vi.fn().mockResolvedValue({ acceptedExtensions: [".html"], acceptedMediaTypes: ["text/html"] }),
    ingestWebsitePage,
    ingestWebsitePagesBatch: vi.fn(),
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<WebsiteHookProbe client={client} onUploadComplete={onUploadComplete} />);
  });

  await act(async () => {
    (container.querySelector("[data-testid='set-single']") as HTMLButtonElement).click();
  });
  await act(async () => {
    (container.querySelector("[data-testid='ingest-single']") as HTMLButtonElement).click();
  });

  expect(ingestWebsitePage).toHaveBeenCalledWith({ url: "https://example.com", mode: "automatic" });
  expect(onUploadComplete).toHaveBeenCalledTimes(1);

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

it("submits website batch ingestion, renders summary message, and triggers one refresh callback", async () => {
  const onUploadComplete = vi.fn();
  const ingestWebsitePagesBatch = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      items: [
        { target: { url: "https://example.com/a" }, ok: true, result: { target: { url: "https://example.com/a" }, resolvedUrl: "https://example.com/a", acquisitionMechanismUsed: "simple-http", stagedArtifact: { sourceKind: "scrape", storage: { key: "staged/website/example.com/a.html" } } } },
        { target: { url: "https://example.com/b" }, ok: true, result: { target: { url: "https://example.com/b" }, resolvedUrl: "https://example.com/b", acquisitionMechanismUsed: "simple-http", stagedArtifact: { sourceKind: "scrape", storage: { key: "staged/website/example.com/b.html" } } } },
      ],
      summary: { attempted: 2, succeeded: 2, failed: 0 },
    },
  });
  const client: ArtifactUploadClient = {
    uploadArtifact: vi.fn(),
    getAcceptedTypes: vi.fn().mockResolvedValue({ acceptedExtensions: [".html"], acceptedMediaTypes: ["text/html"] }),
    ingestWebsitePage: vi.fn(),
    ingestWebsitePagesBatch,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<WebsiteHookProbe client={client} onUploadComplete={onUploadComplete} initialBatchInput={"https://example.com/a\n\nhttps://example.com/b"} />);
  });

  await act(async () => {
    const textarea = container.querySelector("[data-testid='batch-urls']") as HTMLTextAreaElement;
    textarea.value = "https://example.com/a\n\nhttps://example.com/b";
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    (container.querySelector("[data-testid='ingest-batch']") as HTMLButtonElement).click();
  });

  expect(ingestWebsitePagesBatch).toHaveBeenCalledWith({
    targets: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
    mode: "automatic",
  });
  expect(container.querySelector("[data-testid='batch-message']")?.textContent).toContain("2/2 succeeded");
  expect(onUploadComplete).toHaveBeenCalledTimes(1);

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
