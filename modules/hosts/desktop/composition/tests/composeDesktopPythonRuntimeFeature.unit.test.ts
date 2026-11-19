import { afterEach, expect, it, vi } from "vitest";
import { composeDesktopPythonRuntimeFeature } from "../composeDesktopPythonRuntimeFeature";
import { composeDesktopHost } from "../composeDesktopHost";

const fixture = vi.hoisted(() => ({ select: vi.fn(), foundation: vi.fn() }));
vi.mock("../../../../adapters/runtime/python", async original => ({
  ...await original<typeof import("../../../../adapters/runtime/python")>(),
  selectPythonRuntimeLoopbackEndpoint: fixture.select,
  createPythonRuntimeAdapterFoundation: fixture.foundation,
  createPythonRuntimeStartupDiagnostics: () => ({ event: vi.fn(), read: vi.fn() }),
  checkPythonRuntimeInstallationAsync: vi.fn(),
  ensurePythonRuntimeContextDependencies: vi.fn(),
  ensurePythonRuntimeModelTrainingDependencies: vi.fn(),
  preparePythonRuntimeEnvironment: vi.fn(),
}));

const options = () => ({
  launch: { command: "synthetic-worker", cwd: "/fixture", args: ["worker"] },
  loggingPort: {} as never, now: () => "synthetic-time", runtimeLogs: [], recordRuntimeLog: vi.fn(),
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("awaits one endpoint selection and supplies its exact result to both client and worker", async () => {
  vi.stubEnv("PYTHON_RUNTIME_HOST", "localhost");
  vi.stubEnv("PYTHON_RUNTIME_PORT", "45111");
  const endpoint = Object.freeze({ host: "127.0.0.1", port: "52123", baseUrl: "http://127.0.0.1:52123" });
  let resolve!: (value: typeof endpoint) => void;
  fixture.select.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const foundation = { supervisor: { start: vi.fn() }, runtimePort: {} };
  fixture.foundation.mockReturnValueOnce(foundation);
  const pending = composeDesktopPythonRuntimeFeature(options());
  await vi.waitFor(() => expect(fixture.select).toHaveBeenCalledTimes(1));
  expect(fixture.foundation).not.toHaveBeenCalled();
  vi.stubEnv("PYTHON_RUNTIME_HOST", "0.0.0.0"); vi.stubEnv("PYTHON_RUNTIME_PORT", "9999");
  resolve(endpoint);
  const feature = await pending;
  expect(feature.supervisor).toBe(foundation.supervisor);
  const selected = fixture.foundation.mock.calls[0][0];
  expect(selected.client.baseUrl).toBe(endpoint.baseUrl);
  expect(selected.supervisor.env.PYTHON_RUNTIME_HOST).toBe(endpoint.host);
  expect(selected.supervisor.env.PYTHON_RUNTIME_PORT).toBe(endpoint.port);
  expect(selected.supervisor.startupTimeoutMs).toBe(60_000);
  expect(selected.supervisor.verifyRuntimeEnvironment).toBeTypeOf("function");
  expect(fixture.select.mock.calls[0][0].env.PYTHON_RUNTIME_HOST).toBe("localhost");
  expect(process.env.PYTHON_RUNTIME_HOST).toBe("0.0.0.0");
  expect(foundation.supervisor.start).not.toHaveBeenCalled();
});

it("does not create a foundation or start a worker when selection fails", async () => {
  fixture.select.mockRejectedValueOnce(new Error("Python runtime loopback port selection failed."));
  await expect(composeDesktopPythonRuntimeFeature(options())).rejects.toThrow("port selection failed");
  expect(fixture.foundation).not.toHaveBeenCalled();
});

it("actual host coalesces allocation and prevents a late worker start after shutdown", async () => {
  const endpoint = Object.freeze({ host: "127.0.0.1", port: "52124", baseUrl: "http://127.0.0.1:52124" });
  let resolve!: (value: typeof endpoint) => void;
  fixture.select.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const supervisor = { start: vi.fn(), stop: vi.fn(async () => {}), getStatus: () => "stopped" };
  const startOwned = supervisor.start;
  fixture.foundation.mockReturnValueOnce({ supervisor, runtimePort: {} });
  const host = composeDesktopHost({ pythonRuntimeLaunch: options().launch });
  expect((await host.readPythonRuntimeStatus()).supervisorStatus).toBe("stopped");
  expect(fixture.select).not.toHaveBeenCalled();
  const first = host.startPythonRuntime(), second = host.startPythonRuntime();
  // Observe both refusals immediately to avoid an unhandled-rejection false pass.
  const firstRefused = expect(first).rejects.toThrow(), secondRefused = expect(second).rejects.toThrow();
  await vi.waitFor(() => expect(fixture.select).toHaveBeenCalledTimes(1));
  const retired = host.shutdownBackgroundTasks();
  // shutdown first closes admission, then waits for the in-flight foundation.
  resolve(endpoint);
  await Promise.all([firstRefused, secondRefused, retired]);
  expect(fixture.foundation).toHaveBeenCalledTimes(1);
  expect(startOwned).not.toHaveBeenCalled();
  expect(supervisor.stop).toHaveBeenCalledTimes(1);
});
