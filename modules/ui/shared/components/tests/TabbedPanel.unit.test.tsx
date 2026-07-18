import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { TabbedPanel, type TabbedPanelTab } from "../TabbedPanel";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
(globalThis as { window?: Window }).window = dom.window as unknown as Window;
(globalThis as { document?: Document }).document = dom.window.document;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tabs: TabbedPanelTab[] = [
  { id: "first", label: "First", content: <p>First content</p> },
  { id: "second", label: "Second", content: <p>Second content</p> },
  { id: "third", label: "Third", content: <p>Third content</p> },
];

describe("TabbedPanel", () => {
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

  it("links tabs to one attached active panel and supports click activation", async () => {
    const onTabChange = testDouble.fn();
    const mounted = await render(
      <TabbedPanel
        tabs={tabs}
        defaultTabId="second"
        tabListAriaLabel="Example sections"
        onTabChange={onTabChange}
      />,
    );

    const tabList = mounted.querySelector<HTMLElement>("[role='tablist']");
    const tabButtons = Array.from(
      mounted.querySelectorAll<HTMLButtonElement>("[role='tab']"),
    );
    const panel = mounted.querySelector<HTMLElement>("[role='tabpanel']");

    expect(tabList?.getAttribute("aria-label")).toBe("Example sections");
    expect(tabList?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(tabButtons[1].getAttribute("aria-selected")).toBe("true");
    expect(tabButtons[1].tabIndex).toBe(0);
    expect(tabButtons[0].tabIndex).toBe(-1);
    expect(tabButtons[1].getAttribute("aria-controls")).toBe(panel?.id);
    expect(panel?.getAttribute("aria-labelledby")).toBe(tabButtons[1].id);
    expect(panel?.textContent).toBe("Second content");

    await act(async () => tabButtons[2].click());
    expect(tabButtons[2].getAttribute("aria-selected")).toBe("true");
    expect(panel?.textContent).toBe("Third content");
    expect(onTabChange.mock.calls[onTabChange.mock.calls.length - 1]?.[0]).toBe(
      "third",
    );
  });

  it("wraps horizontal arrow focus and supports Home and End activation", async () => {
    const mounted = await render(
      <TabbedPanel tabs={tabs} defaultTabId="second" />,
    );
    const tabButtons = Array.from(
      mounted.querySelectorAll<HTMLButtonElement>("[role='tab']"),
    );

    tabButtons[1].focus();
    await act(async () => {
      tabButtons[1].dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(tabButtons[2]);
    expect(tabButtons[2].getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      tabButtons[2].dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(tabButtons[0]);

    await act(async () => {
      tabButtons[0].dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(tabButtons[2]);

    await act(async () => {
      tabButtons[2].dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Home",
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(tabButtons[0]);
  });

  it("recovers to the next valid default when the active tab is removed", async () => {
    const onTabChange = testDouble.fn();
    const mounted = await render(
      <TabbedPanel
        tabs={tabs}
        defaultTabId="second"
        onTabChange={onTabChange}
      />,
    );
    const originalTabs = Array.from(
      mounted.querySelectorAll<HTMLButtonElement>("[role='tab']"),
    );
    await act(async () => originalTabs[2].click());

    const replacementTabs: TabbedPanelTab[] = [
      {
        id: "replacement",
        label: "Replacement",
        content: "Replacement content",
      },
    ];
    await act(async () => {
      root?.render(
        <TabbedPanel
          tabs={replacementTabs}
          defaultTabId="replacement"
          onTabChange={onTabChange}
        />,
      );
    });

    expect(mounted.querySelector("[role='tabpanel']")?.textContent).toBe(
      "Replacement content",
    );
    expect(onTabChange.mock.calls[onTabChange.mock.calls.length - 1]?.[0]).toBe(
      "replacement",
    );
  });
});
