import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { ModalDialog } from "../ModalDialog";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
(globalThis as { window?: Window }).window = dom.window as unknown as Window;
(globalThis as { document?: Document }).document = dom.window.document;
(globalThis as { Node?: typeof Node }).Node = dom.window.Node;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ModalDialog", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function render(content: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(content));
    return container;
  }

  it("names the dialog and contains forward and reverse focus", async () => {
    const onClose = testDouble.fn();
    const mounted = await render(
      <ModalDialog open title="Asset details" onClose={onClose}>
        <button type="button" data-modal-initial-focus>
          First action
        </button>
        <button type="button">Last action</button>
      </ModalDialog>,
    );

    const dialog = document.body.querySelector<HTMLElement>("[role='dialog']");
    const buttons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    );
    const closeButton = buttons[0];
    const firstAction = buttons[1];
    const lastAction = buttons[2];

    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(Boolean(dialog?.getAttribute("aria-labelledby"))).toBe(true);
    expect(mounted.querySelector("[role='dialog']")).toBe(null);
    expect(dialog?.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(firstAction);

    lastAction.focus();
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(lastAction);
  });

  it("closes only the topmost dialog on Escape and restores focus", async () => {
    function Harness() {
      const [parentOpen, setParentOpen] = useState(false);
      const [childOpen, setChildOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setParentOpen(true)}>
            Open parent
          </button>
          <ModalDialog
            open={parentOpen}
            title="Parent dialog"
            onClose={() => setParentOpen(false)}
          >
            <button type="button" onClick={() => setChildOpen(true)}>
              Open child
            </button>
            <ModalDialog
              open={childOpen}
              title="Child dialog"
              stacked
              onClose={() => setChildOpen(false)}
            >
              <button type="button">Child action</button>
            </ModalDialog>
          </ModalDialog>
        </>
      );
    }

    const mounted = await render(<Harness />);
    const opener = mounted.querySelector<HTMLButtonElement>("button");
    opener?.focus();
    await act(async () => opener?.click());
    const parentChildOpener = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Open child");
    parentChildOpener?.focus();
    await act(async () => parentChildOpener?.click());
    expect(document.body.querySelectorAll("[role='dialog']").length).toBe(2);

    await act(async () => {
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    expect(document.body.querySelectorAll("[role='dialog']").length).toBe(1);
    expect(document.activeElement).toBe(parentChildOpener);

    await act(async () => {
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    expect(document.body.querySelectorAll("[role='dialog']").length).toBe(0);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus inside the dialog when the preferred action is disabled", async () => {
    await render(
      <ModalDialog open title="Preparing build" onClose={() => undefined}>
        <button type="button" disabled data-modal-initial-focus>
          Build
        </button>
      </ModalDialog>,
    );

    const dialog = document.body.querySelector<HTMLElement>("[role='dialog']");
    const closeButton = document.body.querySelector<HTMLButtonElement>(
      "button[aria-label='Close dialog']",
    );
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeButton);
  });

  it("keeps base and nested modal layers above application chrome", () => {
    const tokens = readFileSync(
      join(process.cwd(), "modules/ui/shared/styles/tokens.css"),
      "utf8",
    );
    const surfaces = readFileSync(
      join(process.cwd(), "modules/ui/shared/styles/components/surfaces.css"),
      "utf8",
    );

    expect(tokens).toMatch(/--z-modal:\s*1100/);
    expect(tokens).toMatch(/--z-modal-stacked:\s*1110/);
    expect(surfaces).toMatch(
      /z-index:\s*var\(--ui-modal-z-index,\s*var\(--z-modal\)\)/,
    );
    expect(surfaces).toMatch(
      /--ui-modal-z-index:\s*var\(--z-modal-stacked\)/,
    );
  });
});
