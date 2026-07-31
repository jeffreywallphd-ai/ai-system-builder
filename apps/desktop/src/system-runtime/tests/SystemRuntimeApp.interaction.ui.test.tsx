// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS } from "../../../../../modules/contracts/system-deployment";
import type { SystemRuntimePreloadApi } from "../../system-runtime-preload/systemRuntimePreloadApi";
import { SystemRuntimeApp } from "../SystemRuntimeApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe("published system runtime conversation surface", () => {
  it("starts without sample messages and submits a real bounded turn", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "runtime-uuid" });
    const pending = deferred<Awaited<ReturnType<SystemRuntimePreloadApi["submit"]>>>();
    const submit = vi.fn(() => pending.promise);
    const api: SystemRuntimePreloadApi = {
      read: vi.fn(async () => ({ ok: true, value: readyView([]) })),
      submit,
    };
    await mount(<SystemRuntimeApp api={api} />);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Start a conversation"),
    );
    expect(document.body.textContent).not.toContain("Show a safe preview");
    expect(document.body.querySelectorAll(".system-runtime-message")).toHaveLength(0);

    const textarea = document.body.querySelector("textarea")!;
    await act(async () => {
      setText(textarea, "Hello assistant");
    });
    const send = button("Send");
    await act(async () => send.click());
    expect(submit).toHaveBeenCalledWith({
      text: "Hello assistant",
      operationId: "runtime-turn.runtime-uuid",
    });
    expect(button("Sending...").disabled).toBe(true);
    await act(async () => {
      pending.resolve({
        ok: true,
        value: readyView([
          message("user.1", "user", "Hello assistant"),
          message("assistant.1", "assistant", "Hello from the model"),
        ]),
      });
      await pending.promise;
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Hello from the model"),
    );
    expect(textarea.value).toBe("");
    expect(document.body.querySelector('[role="log"]')).not.toBeNull();
  });

  it("uses Enter to submit, preserves Shift+Enter, and suppresses duplicate work", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "keyboard-uuid" });
    const pending = deferred<Awaited<ReturnType<SystemRuntimePreloadApi["submit"]>>>();
    const submit = vi.fn(() => pending.promise);
    await mount(
      <SystemRuntimeApp
        api={{
          read: async () => ({ ok: true, value: readyView([]) }),
          submit,
        }}
      />,
    );
    await vi.waitFor(() => expect(button("Send").disabled).toBe(true));
    const textarea = document.body.querySelector("textarea")!;
    await act(async () => setText(textarea, "Keyboard message"));
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(submit).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve({ ok: true, value: readyView([]) });
      await pending.promise;
    });
  });
});

function readyView(messages: ReturnType<typeof message>[]) {
  return {
    schemaVersion: "1.0" as const,
    title: "Controlled chatbot",
    state: "ready" as const,
    messages,
    maxInputCharacters: SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
    canSubmit: true,
  };
}

function message(id: string, role: "user" | "assistant", text: string) {
  return { id, role, text, createdAt: "2026-07-29T18:30:00.000Z" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

async function mount(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

function setText(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label} button.`);
  return found;
}
