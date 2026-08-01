// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DatasetReviewWorkspace,
  type DatasetReviewWorkspaceService,
} from "../DatasetReviewWorkspace";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("DatasetReviewWorkspace", () => {
  it("shows the newest version and saves an exact row edit as a new version", async () => {
    const fingerprint = `sha256:${"a".repeat(64)}` as const;
    const groups = [
      {
        groupId: "dataset:support",
        datasetId: "support" as never,
        name: "Support dataset",
        versions: [
          {
            versionId: "support:v2" as never,
            label: "1.1",
            artifactKey: "datasets/v2.parquet" as never,
            latest: true,
            totalRows: 2,
          },
          {
            versionId: "support:v1" as never,
            label: "1.0",
            artifactKey: "datasets/v1.parquet" as never,
            latest: false,
            totalRows: 3,
          },
        ],
      },
    ] as const;
    const rejectRow = vi.fn(async () => ({
      version: { versionId: "support:v3" } as never,
      versionLabel: "1.2",
      rejectedRowIndex: 0,
    }));
    const editRow = vi.fn(async () => ({
      version: { versionId: "support:v3" } as never,
      versionLabel: "1.2",
      editedRowIndex: 0,
    }));
    const service: DatasetReviewWorkspaceService = {
      listTargets: vi.fn(async () => groups),
      readPage: vi.fn(async () => ({
        artifactKey: "datasets/v2.parquet" as never,
        versionId: "support:v2" as never,
        page: 0,
        pageSize: 10 as const,
        totalRows: 2,
        rows: [
          {
            rowIndex: 0,
            rowFingerprint: fingerprint,
            values: { instruction: "Be concise." },
          },
        ],
      })),
      rejectRow,
      editRow,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(
        <DatasetReviewWorkspace
          workspaceId="workspace-review"
          service={service}
        />,
      ),
    );
    await settle();
    await settle();

    expect(
      container.querySelectorAll(".dataset-review__card-grid article").length,
    ).toBe(1);
    const versionSelect = container.querySelector<HTMLSelectElement>(
      ".dataset-review__card-grid select",
    );
    expect(versionSelect?.value).toBe("support:v2");
    expect(versionSelect?.textContent).toContain("1.1 - Latest");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent === "View table",
      ),
    ).toBe(true);
    const tableApprove = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Approve");
    expect(tableApprove?.disabled).toBe(true);
    expect(
      tableApprove?.closest<HTMLElement>(
        ".dataset-review__locked-approval",
      )?.title,
    ).toBe("This row is already approved.");
    const openReview = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Review rows");
    await act(async () => openReview?.click());
    const modalApprove = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Approve row");
    expect(modalApprove?.disabled).toBe(true);
    const closeReview = document.body.querySelector<HTMLButtonElement>(
      "button[aria-label='Close dialog']",
    );
    await act(async () => closeReview?.click());
    const reject = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Reject");
    await act(async () => reject?.click());
    await settle();
    expect(rejectRow).toHaveBeenCalledWith({
      workspaceId: "workspace-review",
      artifactKey: "datasets/v2.parquet",
      versionId: "support:v2",
      rowIndex: 0,
      rowFingerprint: fingerprint,
    });
    const edit = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Edit");
    await act(async () => edit?.click());
    const editor = document.body.querySelector<HTMLTextAreaElement>(
      ".dataset-review__editor textarea",
    );
    expect(editor?.value).toBe("Be concise.");
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());
    expect(document.body.querySelector(".dataset-review__editor")).toBeNull();
    expect(editRow).not.toHaveBeenCalled();
    const reopenEdit = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (button) =>
        button.textContent === "Edit" &&
        button.closest(".dataset-review__modal") !== null,
    );
    await act(async () => reopenEdit?.click());
    const reopenedEditor = document.body.querySelector<HTMLTextAreaElement>(
      ".dataset-review__editor textarea",
    );
    expect(reopenedEditor?.value).toBe("Be concise.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(reopenedEditor, "Be clear and concise.");
      reopenedEditor?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const approveChanges = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Approve changes");
    await act(async () => approveChanges?.click());
    await settle();

    expect(editRow).toHaveBeenCalledWith({
      workspaceId: "workspace-review",
      artifactKey: "datasets/v2.parquet",
      versionId: "support:v2",
      rowIndex: 0,
      rowFingerprint: fingerprint,
      values: { instruction: "Be clear and concise." },
    });
    expect(rejectRow).toHaveBeenCalledTimes(1);
  });
});
