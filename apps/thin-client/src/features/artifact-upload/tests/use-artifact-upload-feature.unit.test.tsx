import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactIngestionFeature } from "../components/ArtifactIngestionFeature";
import { useArtifactUploadFeature } from "../hooks/useArtifactUploadFeature";
import type { ApiArtifactUploadClient } from "../api/apiArtifactUploadClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface HookProbeProps {
  client: ApiArtifactUploadClient;
  workspaceId?: string;
}

interface HookProbeActions {
  onFileChange: ReturnType<typeof useArtifactUploadFeature>["onFileChange"];
  onUploadSubmit: ReturnType<typeof useArtifactUploadFeature>["onUploadSubmit"];
  onCancelUpload: ReturnType<typeof useArtifactUploadFeature>["onCancelUpload"];
}

let hookProbeActions: HookProbeActions | undefined;

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function HookProbe({ client, workspaceId = "workspace-a" }: HookProbeProps) {
  const {
    selectedFiles,
    viewState,
    acceptedFileTypes,
    onFileChange,
    onUploadSubmit,
    onCancelUpload,
  } = useArtifactUploadFeature(client, undefined, workspaceId);
  hookProbeActions = { onFileChange, onUploadSubmit, onCancelUpload };

  return (
    <form onSubmit={(event) => void onUploadSubmit(event)}>
      <input type="file" multiple onChange={onFileChange} />
      <button type="submit">Upload</button>
      <button
        type="button"
        data-testid="cancel-upload"
        onClick={onCancelUpload}
      >
        Cancel upload
      </button>
      <p data-testid="selected-files">
        {selectedFiles.length > 0
          ? selectedFiles.map((file) => file.name).join(",")
          : "none"}
      </p>
      <p data-testid="status">{viewState.status}</p>
      <p data-testid="message">{viewState.message ?? ""}</p>
      <p data-testid="stored-key">{viewState.key ?? ""}</p>
      <p data-testid="results">
        {viewState.results
          ?.map(
            (result) => `${result.fileName}:${result.status}:${result.message}`,
          )
          .join("|") ?? ""}
      </p>
      <p data-testid="accepted-file-types">{acceptedFileTypes}</p>
    </form>
  );
}

function createTestFile(
  bytes: Uint8Array,
  fileName: string,
  options: FilePropertyBag,
): File {
  const contents = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const file = new File([contents], fileName, options);
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: vi.fn().mockResolvedValue(contents),
  });

  return file;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function chooseFiles(files: File[]): void {
  hookProbeActions?.onFileChange({
    currentTarget: { files },
  } as never);
}

function chooseFile(file: File): void {
  chooseFiles([file]);
}

function submitUpload(): Promise<void> | undefined {
  return hookProbeActions?.onUploadSubmit({
    preventDefault: vi.fn(),
  } as never);
}

describe("thin-client useArtifactUploadFeature", () => {
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
    window.sessionStorage.clear();
    hookProbeActions = undefined;
  });

  it("uploads the selected file without requiring a separate submit", async () => {
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
      acceptedExtensions: [".csv", ".xlsx"],
      acceptedMediaTypes: [
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const file = createTestFile(new Uint8Array([1, 2, 3, 4]), "cat.png", {
      type: "image/png",
    });

    await act(async () => {
      chooseFile(file);
      await flushMicrotasks();
    });

    expect(uploadArtifact).toHaveBeenCalledOnce();
    expect(uploadArtifact).toHaveBeenCalledWith({
      fileName: "cat.png",
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
      workspaceId: "workspace-a",
    });
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "success",
    );
    expect(
      container.querySelector("[data-testid='selected-files']")?.textContent,
    ).toBe("cat.png");
    expect(
      container.querySelector("[data-testid='stored-key']")?.textContent,
    ).toBe("uploads/cat.png");
    expect(
      container.querySelector("[data-testid='accepted-file-types']")
        ?.textContent,
    ).toBe(
      ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("shows an error when submit is attempted before selecting a file", async () => {
    const uploadArtifact = vi.fn();
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".txt"],
      acceptedMediaTypes: ["text/plain"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    await act(async () => {
      await submitUpload();
    });

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "error",
    );
    expect(
      container.querySelector("[data-testid='message']")?.textContent,
    ).toBe("Select one or more artifact files before uploading.");
  });

  it("renders server validation feedback when upload fails", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
      },
    });
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".png"],
      acceptedMediaTypes: ["image/png"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const file = createTestFile(new Uint8Array([1, 2, 3, 4]), "cat.png", {
      type: "image/png",
    });

    await act(async () => {
      chooseFile(file);
      await flushMicrotasks();
    });

    expect(uploadArtifact).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "error",
    );
    expect(
      container.querySelector("[data-testid='message']")?.textContent,
    ).toBe("Artifact type is not accepted: application/pdf.");
  });

  it("continues automatic upload after one selected file fails", async () => {
    const uploadArtifact = vi.fn(
      async (
        input: Parameters<ApiArtifactUploadClient["uploadArtifact"]>[0],
      ) => {
        if (input.fileName === "blocked.exe") {
          return {
            ok: false,
            error: {
              code: "validation",
              message:
                "Artifact type is not accepted: application/octet-stream.",
            },
          } as const;
        }

        return {
          ok: true,
          value: {
            descriptor: {
              key: `uploads/${input.fileName}`,
              mediaType: input.mediaType,
              sizeBytes: input.bytes.byteLength,
            },
          },
        } as const;
      },
    );
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

    await act(async () => {
      chooseFiles([
        createTestFile(new Uint8Array([1]), "cat.png", { type: "image/png" }),
        createTestFile(new Uint8Array([2]), "blocked.exe", { type: "" }),
        createTestFile(new Uint8Array([3]), "notes.md", { type: "" }),
      ]);
      await flushMicrotasks();
    });

    expect(uploadArtifact).toHaveBeenCalledTimes(3);
    expect(uploadArtifact).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        fileName: "notes.md",
        mediaType: "text/markdown",
      }),
    );
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "partial",
    );
    expect(
      container.querySelector("[data-testid='message']")?.textContent,
    ).toBe("Stored 2 of 3 files. 1 failed.");
    expect(
      container.querySelector("[data-testid='results']")?.textContent,
    ).toContain("blocked.exe:error:Artifact type is not accepted");
    expect(
      container.querySelector("[data-testid='results']")?.textContent,
    ).toContain("notes.md:success:Stored notes.md.");
  });

  it("ignores manual submit while automatic upload is already in progress", async () => {
    const uploadResult =
      createDeferred<
        Awaited<ReturnType<ApiArtifactUploadClient["uploadArtifact"]>>
      >();
    const uploadArtifact = vi.fn().mockReturnValue(uploadResult.promise);
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".png"],
      acceptedMediaTypes: ["image/png"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    const file = createTestFile(new Uint8Array([1, 2, 3, 4]), "cat.png", {
      type: "image/png",
    });

    await act(async () => {
      chooseFile(file);
      await flushMicrotasks();
    });

    await act(async () => {
      await submitUpload();
    });

    expect(uploadArtifact).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "uploading",
    );

    await act(async () => {
      uploadResult.resolve({
        ok: true,
        value: {
          descriptor: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
        },
      });
    });

    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "success",
    );
  });

  it("cancels an automatic upload batch after the current file finishes", async () => {
    const firstUpload =
      createDeferred<
        Awaited<ReturnType<ApiArtifactUploadClient["uploadArtifact"]>>
      >();
    const uploadArtifact = vi.fn(
      (input: Parameters<ApiArtifactUploadClient["uploadArtifact"]>[0]) => {
        if (input.fileName === "first.png") {
          return firstUpload.promise;
        }

        return Promise.resolve({
          ok: true,
          value: {
            descriptor: {
              key: `uploads/${input.fileName}`,
              mediaType: input.mediaType,
              sizeBytes: input.bytes.byteLength,
            },
          },
        } as const);
      },
    );
    const getAcceptedTypes = vi.fn().mockResolvedValue({
      acceptedExtensions: [".png"],
      acceptedMediaTypes: ["image/png"],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={{ uploadArtifact, getAcceptedTypes }} />);
    });

    await act(async () => {
      chooseFiles([
        createTestFile(new Uint8Array([1]), "first.png", { type: "image/png" }),
        createTestFile(new Uint8Array([2]), "second.png", {
          type: "image/png",
        }),
      ]);
      await flushMicrotasks();
    });

    expect(uploadArtifact).toHaveBeenCalledOnce();

    await act(async () => {
      hookProbeActions?.onCancelUpload();
    });
    expect(
      container.querySelector("[data-testid='message']")?.textContent,
    ).toBe("Canceling upload after the current file finishes...");

    await act(async () => {
      firstUpload.resolve({
        ok: true,
        value: {
          descriptor: {
            key: "uploads/first.png",
            mediaType: "image/png",
            sizeBytes: 1,
          },
        },
      });
      await flushMicrotasks();
    });

    expect(uploadArtifact).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe(
      "canceled",
    );
    expect(
      container.querySelector("[data-testid='message']")?.textContent,
    ).toBe("Upload canceled after 1 of 2 files. 1 stored, 0 failed.");
  });

  it("renders only the guided ingestion workflow", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactIngestionFeature
          ingestionClient={
            {
              getHuggingFaceTokenStatus: vi
                .fn()
                .mockResolvedValue({ configured: false }),
              browseHuggingFaceNamespaceDatasets: vi.fn(),
              browseHuggingFaceDatasetParquetFiles: vi.fn(),
            } as never
          }
        />,
      );
    });

    expect(container.textContent).toContain("1. Choose a source");
    expect(container.textContent).toContain("2. Select the data");
    expect(container.textContent).toContain("3. Add data");
    expect(container.textContent).not.toContain("Other import tools");
    expect(container.textContent).not.toContain("Upload data");
    expect(container.textContent).not.toContain("Scrape web data");
    expect(container.textContent).not.toContain("Import from Hugging Face");
  });
});
