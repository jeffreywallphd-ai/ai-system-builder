// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetReviewModal } from "../DatasetReviewModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("DatasetReviewModal", () => {
  it("moves through sections and reports exact approve and reject decisions", async () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const change = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <DatasetReviewModal
          open
          title="Review report"
          onClose={vi.fn()}
          items={[
            { id: "one", title: "Summary", content: <p>First section</p> },
            { id: "two", title: "Findings", content: <p>Second section</p> },
          ]}
          currentIndex={0}
          decisions={{}}
          onCurrentIndexChange={change}
          onApprove={approve}
          onReject={reject}
        />,
      ),
    );
    const buttons = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ];
    await act(async () =>
      buttons.find((button) => button.textContent === "Approve")?.click(),
    );
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ id: "one" }),
    );
    await act(async () =>
      buttons.find((button) => button.textContent === "Next")?.click(),
    );
    expect(change).toHaveBeenCalledWith(1);
    await act(async () =>
      buttons.find((button) => button.textContent === "Reject")?.click(),
    );
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });

  it("prevents modal closure while a row change is being saved", async () => {
    const close = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <DatasetReviewModal
          open
          title="Review row"
          onClose={close}
          items={[{ id: "row", title: "Row 1", content: <p>Data</p> }]}
          currentIndex={0}
          decisions={{}}
          busy
          onCurrentIndexChange={vi.fn()}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
      ),
    );
    const closeButton = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.getAttribute("aria-label") === "Close dialog");
    expect(closeButton?.disabled).toBe(true);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("locks approval for a row that already exists in a dataset", async () => {
    const approve = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <DatasetReviewModal
          open
          title="Review row"
          onClose={vi.fn()}
          items={[
            {
              id: "existing-row",
              title: "Row 1",
              content: <p>Existing data</p>,
              approvalLocked: true,
            },
          ]}
          currentIndex={0}
          decisions={{}}
          onCurrentIndexChange={vi.fn()}
          onApprove={approve}
          onReject={vi.fn()}
        />,
      ),
    );

    const approveButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Approve",
    ) as HTMLButtonElement | undefined;
    const lock = approveButton?.closest<HTMLElement>(
      ".dataset-review__locked-approval",
    );
    expect(approveButton?.disabled).toBe(true);
    expect(lock?.title).toBe("This row is already approved.");
    expect(lock?.querySelector("[role='tooltip']")?.textContent).toBe(
      "This row is already approved.",
    );
    expect(document.body.textContent).toContain("Approved");
    await act(async () => approveButton?.click());
    expect(approve).not.toHaveBeenCalled();
  });

  it("keeps row traversal above the data and edit actions below it without page controls", async () => {
    const previous = vi.fn();
    const next = vi.fn();
    const edit = vi.fn();
    const approveChanges = vi.fn();
    const cancelEdit = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <DatasetReviewModal
          open
          title="Review row"
          onClose={vi.fn()}
          items={[{ id: "row", title: "Row 11", content: <p>Data</p> }]}
          currentIndex={0}
          decisions={{}}
          absoluteIndex={10}
          totalItems={30}
          previousDisabled={false}
          nextDisabled={false}
          onPrevious={previous}
          onNext={next}
          onCurrentIndexChange={vi.fn()}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onEdit={edit}
        />,
      ),
    );
    const buttons = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ];
    await act(async () =>
      buttons.find((button) => button.textContent === "Previous")?.click(),
    );
    await act(async () =>
      buttons.find((button) => button.textContent === "Next")?.click(),
    );
    await act(async () =>
      buttons.find((button) => button.textContent === "Edit")?.click(),
    );
    expect(previous).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: "row" }));
    expect(
      buttons.some((button) => button.textContent === "Previous page"),
    ).toBe(false);
    expect(buttons.some((button) => button.textContent === "Next page")).toBe(
      false,
    );
    const item = document.body.querySelector(".dataset-review__item");
    const navigation = document.body.querySelector(
      ".dataset-review__navigation",
    );
    const actions = document.body.querySelector(".dataset-review__actions");
    expect(navigation?.compareDocumentPosition(item!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(item?.compareDocumentPosition(actions!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await act(async () =>
      root?.render(
        <DatasetReviewModal
          open
          title="Edit row"
          onClose={vi.fn()}
          items={[
            {
              id: "row",
              title: "Row 11",
              content: <textarea defaultValue="Data" />,
            },
          ]}
          currentIndex={0}
          decisions={{}}
          editing
          onCurrentIndexChange={vi.fn()}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onApproveChanges={approveChanges}
          onCancelEdit={cancelEdit}
        />,
      ),
    );
    const editingButtons = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ];
    expect(
      editingButtons.some((button) => button.textContent === "Reject"),
    ).toBe(true);
    await act(async () =>
      editingButtons.find((button) => button.textContent === "Cancel")?.click(),
    );
    expect(cancelEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "row" }),
    );
    await act(async () =>
      editingButtons
        .find((button) => button.textContent === "Approve changes")
        ?.click(),
    );
    expect(approveChanges).toHaveBeenCalledWith(
      expect.objectContaining({ id: "row" }),
    );
  });
});
