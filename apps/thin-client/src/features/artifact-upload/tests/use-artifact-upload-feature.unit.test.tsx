import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useArtifactUploadFeature } from "../hooks/useArtifactUploadFeature";
import type { ApiArtifactUploadClient } from "../api/apiArtifactUploadClient";

interface HookProbeProps {
  client: ApiArtifactUploadClient;
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
  });

  it("tracks selected file and reports success after upload", async () => {
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
      acceptedMediaTypes: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
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

    await act(async () => {
      setInputFiles(input, [file]);
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("success");
    expect(container.querySelector("[data-testid='stored-key']")?.textContent).toBe("uploads/cat.png");
    expect(container.querySelector("[data-testid='accepted-file-types']")?.textContent).toBe(
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

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], "cat.png", { type: "image/png" });

    await act(async () => {
      setInputFiles(input, [file]);
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(uploadArtifact).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid='status']")?.textContent).toBe("error");
    expect(container.querySelector("[data-testid='message']")?.textContent).toBe(
      "Artifact type is not accepted: application/pdf.",
    );
  });
});
