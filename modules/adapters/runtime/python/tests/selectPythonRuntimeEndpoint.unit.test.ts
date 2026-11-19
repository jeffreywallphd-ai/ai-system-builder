import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectPythonRuntimeLoopbackEndpoint } from "../network/selectPythonRuntimeEndpoint";

const fixture = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("node:net", () => ({ createServer: fixture.create, default: { createServer: fixture.create } }));

class Listener extends EventEmitter {
  maxConnections = 0;
  listening = false;
  addressValue: unknown = { address: "127.0.0.1", port: 51234 };
  options: any;
  onListening?: () => void;
  close = vi.fn((done: () => void) => { this.listening = false; queueMicrotask(done); return this; });
  address() { return this.addressValue; }
  listen(options: unknown, callback: () => void) {
    this.options = options; this.onListening = callback; return this;
  }
  admit() { this.listening = true; this.onListening!(); }
}
let listener: Listener;
beforeEach(() => { vi.useFakeTimers(); fixture.create.mockReset(); listener = new Listener(); fixture.create.mockReturnValue(listener); });
afterEach(() => { vi.useRealTimers(); });

describe("host-selected Python runtime endpoint", () => {
  it("preserves explicit canonical endpoints without opening or probing sockets", async () => {
    for (const env of [
      { PYTHON_RUNTIME_BASE_URL: "http://localhost:45111" },
      { PYTHON_RUNTIME_HOST: "::1", PYTHON_RUNTIME_PORT: "45111" },
      { PYTHON_RUNTIME_PORT: "045111", PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:45111" },
    ]) {
      const endpoint = await selectPythonRuntimeLoopbackEndpoint({ env });
      expect(endpoint).toEqual({ host: "127.0.0.1", port: "45111", baseUrl: "http://127.0.0.1:45111" });
      expect(Object.isFrozen(endpoint)).toBe(true);
    }
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it("rejects invalid or conflicting configuration before any allocation", async () => {
    for (const env of [
      { PYTHON_RUNTIME_HOST: "0.0.0.0" },
      { PYTHON_RUNTIME_PORT: "0" }, { PYTHON_RUNTIME_PORT: "65536" },
      { PYTHON_RUNTIME_BASE_URL: "https://127.0.0.1:45111" },
      { PYTHON_RUNTIME_BASE_URL: "http://remote.invalid:45111" },
      { PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:45111", PYTHON_RUNTIME_PORT: "45112" },
    ]) await expect(selectPythonRuntimeLoopbackEndpoint({ env })).rejects.toThrow();
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it("captures one frozen OS-admitted endpoint and closes before resolving", async () => {
    const env = { PYTHON_RUNTIME_HOST: "localhost", PYTHON_RUNTIME_PORT: " " };
    const pending = selectPythonRuntimeLoopbackEndpoint({ env });
    expect(listener.options).toMatchObject({ host: "127.0.0.1", port: 0, exclusive: true });
    expect(listener.maxConnections).toBe(1);
    env.PYTHON_RUNTIME_HOST = "0.0.0.0"; env.PYTHON_RUNTIME_PORT = "9999";
    listener.admit();
    const endpoint = await pending;
    expect(endpoint).toEqual({ host: "127.0.0.1", port: "51234", baseUrl: "http://127.0.0.1:51234" });
    expect(Object.isFrozen(endpoint)).toBe(true);
    expect(listener.close).toHaveBeenCalledTimes(1);
    expect(listener.options.signal.aborted).toBe(true);
    expect(listener.listening).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const incoming = { destroy: vi.fn() };
    fixture.create.mock.calls[0][0](incoming);
    expect(incoming.destroy).toHaveBeenCalledTimes(1);
  });
  it("sanitizes denied bind errors, closes once and clears its deadline", async () => {
    const pending = selectPythonRuntimeLoopbackEndpoint({ env: {} });
    const check = expect(pending).rejects.toThrow(/^Python runtime loopback port selection failed\.$/);
    listener.emit("error", new Error("private native address or path"));
    await check;
    expect(listener.close).toHaveBeenCalledTimes(1);
    expect(listener.options.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    listener.emit("error", new Error("late error"));
    expect(listener.close).toHaveBeenCalledTimes(1);
  });
  it("does not resolve availability until socket retirement is acknowledged", async () => {
    let retired!: () => void;
    listener.close.mockImplementation(done => { retired = () => { listener.listening = false; done(); }; return listener; });
    let settled = false;
    const pending = selectPythonRuntimeLoopbackEndpoint({ env: {} }).then(value => { settled = true; return value; });
    listener.admit(); await Promise.resolve();
    expect(settled).toBe(false);
    retired();
    expect((await pending).port).toBe("51234");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a pending bind and refuses late admission after cancellation", async () => {
    const pending = selectPythonRuntimeLoopbackEndpoint({ env: {} });
    const check = expect(pending).rejects.toThrow(/^Python runtime loopback port selection failed\.$/);
    await vi.advanceTimersByTimeAsync(5000);
    await check;
    expect(listener.options.signal.aborted).toBe(true);
    expect(listener.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    // The platform abort cancels pending listen; its queued callback cannot succeed.
    listener.onListening!();
    expect(listener.close).toHaveBeenCalledTimes(1);
  });
  it("rejects at the deadline when socket close remains unconfirmed and never publishes later", async () => {
    let retired!: () => void;
    listener.close.mockImplementation(done => { retired = () => { listener.listening = false; done(); }; return listener; });
    const pending = selectPythonRuntimeLoopbackEndpoint({ env: {} });
    const check = expect(pending).rejects.toThrow(/^Python runtime loopback port selection failed\.$/);
    listener.admit();
    await vi.advanceTimersByTimeAsync(5000); await check;
    expect(listener.options.signal.aborted).toBe(true);
    expect(listener.close).toHaveBeenCalledTimes(1);
    retired(); await expect(pending).rejects.toThrow("port selection failed");
  });
  it.each([null, "pipe-name", { address: "0.0.0.0", port: 51234 }, { address: "127.0.0.1", port: 80 }, { address: "127.0.0.1", port: 65536 }])(
    "refuses invalid admitted addresses without leaking observations: %j", async address => {
      listener.addressValue = address;
      const pending = selectPythonRuntimeLoopbackEndpoint({ env: {} });
      const check = expect(pending).rejects.toThrow(/^Python runtime loopback port selection failed\.$/);
      listener.admit(); await check;
      expect(listener.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("retires a synchronous listen failure without exposing native error text", async () => {
    listener.listen = () => { throw new Error("private listen error"); };
    await expect(selectPythonRuntimeLoopbackEndpoint({ env: {} })).rejects.toThrow(/^Python runtime loopback port selection failed\.$/);
    expect(listener.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
