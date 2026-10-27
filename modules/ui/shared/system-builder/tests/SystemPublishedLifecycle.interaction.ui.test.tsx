// @vitest-environment jsdom
import { act, startTransition, StrictMode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemPublicationBuildSummary } from "../../../../contracts/system-build";
import type {
  SystemDeploymentLaunchDescriptor,
  SystemPublishedLifecycleAction,
  SystemPublishedLifecycleProjection,
} from "../../../../contracts/system-deployment";
import { SystemPublishedLifecycleCard } from "../SystemPublishedLifecycleCard";
import type { SystemPublishedLifecycleClient } from "../SystemPublishedLifecycleClient";
import {
  NotificationTestHarness,
  readNotificationMessages,
} from "../../notifications/tests/NotificationTestHarness";

const passivePhase = vi.hoisted(() => ({paused: false, setups: [] as Array<() => void>, cleanups: [] as Array<() => void>}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {...actual, useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    actual.useEffect(() => {
      let cleanup: void | (() => void), cancelled = false;
      const setup = () => {if (!cancelled) cleanup = effect();};
      if (passivePhase.paused) passivePhase.setups.push(setup); else setup();
      return () => {
        cancelled = true;
        if (typeof cleanup === "function") {
          if (passivePhase.paused) passivePhase.cleanups.push(cleanup); else cleanup();
        }
      };
    }, dependencies);
  }};
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => {
    passivePhase.paused = false;
    while (passivePhase.cleanups.length) passivePhase.cleanups.shift()!();
    while (passivePhase.setups.length) passivePhase.setups.shift()!();
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("published build lifecycle controls", () => {
  it("installs and activates together, reports host-window start, and exposes Stop only while running", async () => {
    const invoke = vi.fn(
      async (input: {
        action: SystemPublishedLifecycleAction;
        expectedRevision: string;
      }) => {
        if (input.action === "install")
          return deploymentSuccess(
            projection(
              "active-stopped",
              "r2",
              ["start", "deactivate", "uninstall"],
              "visual",
            ),
          );
        if (input.action === "start")
          return deploymentSuccess({
            ...projection("running", "r3", ["stop"], "visual"),
            launchDescriptor,
          });
        if (input.action === "stop")
          return deploymentSuccess(
            projection(
              "active-stopped",
              "r4",
              ["start", "deactivate", "uninstall"],
              "visual",
            ),
          );
        return deploymentSuccess(
          projection("not-installed", "r5", ["install"]),
        );
      },
    );
    const client = {
      read: vi.fn(async () =>
        deploymentSuccess(projection("not-installed", "r1", ["install"])),
      ),
      invoke,
    } as unknown as SystemPublishedLifecycleClient;

    await mount(
      <NotificationTestHarness>
        <SystemPublishedLifecycleCard
          workspaceId="workspace-a"
          build={build}
          client={client}
          visualStartNotice="The system opened in its own window."
        />
      </NotificationTestHarness>,
    );

    await vi.waitFor(() => expect(button("Install")).toBeDefined());
    expect(document.body.textContent).not.toContain("Deployment identifier");
    expect(document.body.textContent).not.toContain("Open System");

    await act(async () => button("Install").click());
    expect(invoke).toHaveBeenLastCalledWith({
      workspaceId: "workspace-a",
      releaseId: "release-2",
      action: "install",
      expectedRevision: "r1",
    });
    expect(readNotificationMessages(document.body)).toContain(
      "Installed and activated.",
    );
    expect(button("Start")).toBeDefined();
    expect(button("Deactivate")).toBeDefined();
    expect(button("Uninstall")).toBeDefined();
    expect(findButton("Activate")).toBeUndefined();

    await act(async () => button("Start").click());
    expect(readNotificationMessages(document.body)).toContain(
      "The system opened in its own window.",
    );
    expect(button("Stop")).toBeDefined();
    expect(findButton("Start")).toBeUndefined();
    expect(findButton("Deactivate")).toBeUndefined();
    expect(findButton("Uninstall")).toBeUndefined();

    await act(async () => button("Stop").click());
    expect(button("Start")).toBeDefined();
    expect(button("Deactivate")).toBeDefined();
    expect(button("Uninstall")).toBeDefined();
  });

  it("binds Activate and Deactivate to the exact release and current revision without duplicate commands", async () => {
    const initial = projection("inactive-stopped", "inactive-r1", ["activate", "uninstall"], "visual");
    const active = projection("active-stopped", "active-r2", ["start", "deactivate", "uninstall"], "visual");
    const inactive = projection("inactive-stopped", "inactive-r3", ["activate", "uninstall"], "visual");
    const activation = deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();
    const deactivation = deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();
    const client = {
      read: vi.fn(async () => deploymentSuccess(initial)),
      invoke: vi.fn<SystemPublishedLifecycleClient["invoke"]>(async input => {
        if (input.action === "activate") return activation.promise;
        if (input.action === "deactivate") return deactivation.promise;
        throw new Error("Unexpected synthetic action.");
      }),
    } satisfies SystemPublishedLifecycleClient;
    await mount(lifecycleView(client));
    try {
      await vi.waitFor(() => expect(button("Activate")).toBeDefined());
      expect(findButton("Start")).toBeUndefined();
      expect(findButton("Deactivate")).toBeUndefined();
      const activate = button("Activate");
      await act(async () => { activate.click(); activate.click(); });
      expect(client.invoke).toHaveBeenCalledTimes(1);
      expect(client.invoke).toHaveBeenNthCalledWith(1, {
        workspaceId: "workspace-a", releaseId: "release-2", action: "activate", expectedRevision: "inactive-r1",
      });
      expect(button("Activate...").disabled).toBe(true);
      expect(button("Uninstall").disabled).toBe(true);
      await act(async () => activation.resolve(deploymentSuccess(active)));
      expect(document.body.textContent).toContain("Active and stopped");
      expect(readNotificationMessages(document.body)).toContain("Activated.");
      expect(button("Start").disabled).toBe(false);
      expect(findButton("Activate")).toBeUndefined();
      const deactivate = button("Deactivate");
      await act(async () => { deactivate.click(); deactivate.click(); });
      expect(client.invoke).toHaveBeenCalledTimes(2);
      expect(client.invoke).toHaveBeenNthCalledWith(2, {
        workspaceId: "workspace-a", releaseId: "release-2", action: "deactivate", expectedRevision: "active-r2",
      });
      expect(button("Deactivate...").disabled).toBe(true);
      expect(button("Start").disabled).toBe(true);
      await act(async () => deactivation.resolve(deploymentSuccess(inactive)));
      expect(document.body.textContent).toContain("Inactive and stopped");
      expect(readNotificationMessages(document.body)).toContain("Deactivated.");
      expect(button("Activate").disabled).toBe(false);
      expect(button("Uninstall").disabled).toBe(false);
      expect(findButton("Start")).toBeUndefined();
      expect(findButton("Stop")).toBeUndefined();
      expect(findButton("Deactivate")).toBeUndefined();
      expect(client.read).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        activation.resolve(deploymentSuccess(active));
        deactivation.resolve(deploymentSuccess(inactive));
      });
    }
  });

  it.each([
    { action: "activate", label: "Activate", code: "deployment.revision-conflict" },
    { action: "deactivate", label: "Deactivate", code: "permission.denied" },
  ] as const)("refreshes a refused $action and retries only with the authoritative revision", async ({ action, label, code }) => {
    const initial = action === "activate"
      ? projection("inactive-stopped", "old-r1", ["activate", "uninstall"], "visual")
      : projection("active-stopped", "old-r1", ["start", "deactivate", "uninstall"], "visual");
    const authoritative = projection(initial.state, "fresh-r7", initial.eligibleActions, "visual");
    const next = action === "activate"
      ? projection("active-stopped", "next-r8", ["start", "deactivate", "uninstall"], "visual")
      : projection("inactive-stopped", "next-r8", ["activate", "uninstall"], "visual");
    const message = "The action was refused. Review the current status before retrying.";
    const refresh = deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>();
    const client = lifecycleClient(initial);
    vi.mocked(client.read).mockResolvedValueOnce(deploymentSuccess(initial)).mockReturnValueOnce(refresh.promise);
    vi.mocked(client.invoke).mockResolvedValueOnce({ ok: false, error: { code, message } }).mockResolvedValueOnce(deploymentSuccess(next));
    await mount(lifecycleView(client));
    try {
      await vi.waitFor(() => expect(button(label)).toBeDefined());
      await act(async () => button(label).click());
      expect(client.invoke).toHaveBeenCalledTimes(1);
      expect(client.invoke).toHaveBeenLastCalledWith({ workspaceId: "workspace-a", releaseId: "release-2", action, expectedRevision: "old-r1" });
      expect(client.read).toHaveBeenCalledTimes(2);
      expect(client.read).toHaveBeenLastCalledWith({ workspaceId: "workspace-a", releaseId: "release-2" });
      expect(document.body.textContent).toContain("Loading controls...");
      for (const control of ["Install", "Activate", "Deactivate", "Start", "Stop", "Uninstall"]) expect(findButton(control)).toBeUndefined();
      expect(readNotificationMessages(document.body)).toEqual([]);
      await act(async () => refresh.resolve(deploymentSuccess(authoritative)));
      expect(button(label).disabled).toBe(false);
      expect(document.body.textContent).toContain(message);
      expect(document.body.textContent).toContain(action === "activate" ? "Inactive and stopped" : "Active and stopped");
      expect(client.invoke).toHaveBeenCalledTimes(1);
      expect(readNotificationMessages(document.body)).toEqual([]);
      await act(async () => button(label).click());
      expect(client.invoke).toHaveBeenCalledTimes(2);
      expect(client.invoke).toHaveBeenLastCalledWith({ workspaceId: "workspace-a", releaseId: "release-2", action, expectedRevision: "fresh-r7" });
      expect(client.read).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).not.toContain(message);
      expect(readNotificationMessages(document.body)).toContain(action === "activate" ? "Activated." : "Deactivated.");
    } finally {
      await act(async () => refresh.resolve(deploymentSuccess(authoritative)));
    }
  });

  it("shows no controls when the lifecycle projection cannot be read", async () => {
    const client = {
      read: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "lifecycle.inactive-source",
          message: "This release is no longer available.",
        },
      })),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={client}
      />,
    );
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("no longer available"),
    );
    expect(findButton("Install")).toBeUndefined();
    expect(findButton("Start")).toBeUndefined();
    expect(findButton("Uninstall")).toBeUndefined();
  });

  it("keeps a failed Start message visible after refreshing authoritative status", async () => {
    const client = {
      read: vi.fn(async () =>
        deploymentSuccess(
          projection(
            "active-stopped",
            "r1",
            ["start", "deactivate", "uninstall"],
            "visual",
          ),
        ),
      ),
      invoke: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "deployment.runtime-window.unavailable",
          message: "The published system window could not be opened.",
        },
      })),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={client}
      />,
    );
    await vi.waitFor(() => expect(button("Start")).toBeDefined());

    await act(async () => button("Start").click());

    expect(document.body.textContent).toContain(
      "The published system window could not be opened.",
    );
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(button("Start")).toBeDefined();
  });

  it("refreshes a running card after its host window stops the build", async () => {
    let current = projection("running", "r2", ["stop"], "visual");
    const client = {
      read: vi.fn(async () => deploymentSuccess(current)),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={client}
      />,
    );
    await vi.waitFor(() => expect(button("Stop")).toBeDefined());

    current = projection(
      "active-stopped",
      "r3",
      ["start", "deactivate", "uninstall"],
      "visual",
    );

    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 1_050));
    });

    expect(client.read).toHaveBeenCalledTimes(2);
    expect(button("Start")).toBeDefined();
  });

  it("discards a late Start response after the selected published build changes", async () => {
    const pendingStart =
      deferred<
        ReturnType<typeof deploymentSuccess<SystemPublishedLifecycleProjection>>
      >();
    const firstClient = {
      read: vi.fn(async () =>
        deploymentSuccess(
          projection(
            "active-stopped",
            "r1",
            ["start", "deactivate", "uninstall"],
            "visual",
          ),
        ),
      ),
      invoke: vi.fn(() => pendingStart.promise),
    } as unknown as SystemPublishedLifecycleClient;
    const secondBuild = {
      ...build,
      buildId: "build-3",
      releaseId: "release-3",
      versionNumber: 3,
    } as unknown as SystemPublicationBuildSummary;
    const secondClient = {
      read: vi.fn(async () =>
        deploymentSuccess({
          ...projection("not-installed", "next-r1", ["install"]),
          releaseId: "release-3",
        }),
      ),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;

    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={firstClient}
      />,
    );
    await vi.waitFor(() => expect(button("Start")).toBeDefined());
    act(() => {
      button("Start").click();
      button("Start").click();
    });
    expect(firstClient.invoke).toHaveBeenCalledOnce();
    await act(async () => {
      root?.render(
        <SystemPublishedLifecycleCard
          workspaceId="workspace-a"
          build={secondBuild}
          client={secondClient}
        />,
      );
    });
    await vi.waitFor(() => expect(button("Install")).toBeDefined());
    await act(async () => {
      pendingStart.resolve(
        deploymentSuccess({
          ...projection("running", "r2", ["stop"], "visual"),
          launchDescriptor,
        }),
      );
      await pendingStart.promise;
    });
    expect(button("Install")).toBeDefined();
  });
});

describe("published lifecycle target and polling recovery",()=>{
  it("keeps replacement controls enabled while an old Start is still pending",async()=>{
    const first=lifecycleClient(),next=lifecycleClient({...projection("not-installed","next-r1",["install"]),releaseId:"release-3"} as SystemPublishedLifecycleProjection),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();vi.mocked(first.invoke).mockReturnValue(held.promise);
    await mount(lifecycleView(first));await act(async()=>button("Start").click());
    try{
      await replaceLifecycle(lifecycleView(next,"workspace-b",{...build,buildId:"build-3",releaseId:"release-3",versionNumber:3} as SystemPublicationBuildSummary));
      await vi.waitFor(()=>expect(button("Install").disabled).toBe(false));
      await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));
      expect(button("Install").disabled).toBe(false);expect(readNotificationMessages(document.body)).toEqual([]);expect(next.invoke).not.toHaveBeenCalled();
    }finally{await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));}
  });

  it("does not show controls from another release status reply",async()=>{
    const client=lifecycleClient({...projection("not-installed","foreign-r1",["install"]),releaseId:"other-release"} as SystemPublishedLifecycleProjection);
    await mount(lifecycleView(client));expect(findButton("Install")).toBeUndefined();expect(findButton("Start")).toBeUndefined();expect(client.invoke).not.toHaveBeenCalled();
    expect(button("Retry status").disabled).toBe(false);
  });

  it("does not report Start success from another release action reply",async()=>{
    const client=lifecycleClient();vi.mocked(client.invoke).mockResolvedValueOnce(deploymentSuccess({...projection("running","foreign-r2",["stop"],"visual"),releaseId:"other-release"} as SystemPublishedLifecycleProjection));
    await mount(lifecycleView(client));await act(async()=>button("Start").click());
    expect(findButton("Stop")).toBeUndefined();expect(readNotificationMessages(document.body)).not.toContain("The visual system started on its host.");expect(button("Retry status").disabled).toBe(false);
  });

  it("does not let an old background read roll back an accepted Stop",async()=>{
    vi.useFakeTimers();const held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>(),running=projection("running","r1",["stop"],"visual"),stopped=projection("active-stopped","r2",["start"],"visual");const client=lifecycleClient(running);
    vi.mocked(client.read).mockResolvedValueOnce(deploymentSuccess(running)).mockReturnValue(held.promise);vi.mocked(client.invoke).mockResolvedValueOnce(deploymentSuccess(stopped));
    try{
      await mount(lifecycleView(client));await act(async()=>{await vi.advanceTimersByTimeAsync(1_000);});expect(client.read).toHaveBeenCalledTimes(2);
      await act(async()=>button("Stop").click());expect(button("Start").disabled).toBe(false);
      await act(async()=>held.resolve(deploymentSuccess(running)));expect(button("Start").disabled).toBe(false);expect(findButton("Stop")).toBeUndefined();
    }finally{await act(async()=>{held.resolve(deploymentSuccess(stopped));root?.unmount();root=undefined;});vi.useRealTimers();}
  });

  it("does not accumulate slow background status reads",async()=>{
    vi.useFakeTimers();const running=projection("running","r1",["stop"],"visual"),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>(),client=lifecycleClient(running);vi.mocked(client.read).mockResolvedValueOnce(deploymentSuccess(running)).mockReturnValue(held.promise);
    try{await mount(lifecycleView(client));await act(async()=>{await vi.advanceTimersByTimeAsync(3_000);});expect(client.read).toHaveBeenCalledTimes(2);}
    finally{await act(async()=>{held.resolve(deploymentSuccess(projection("active-stopped","r2",["start"],"visual")));root?.unmount();root=undefined;});vi.useRealTimers();}
  });

  it("retires old status at layout commit before passive cleanup",async()=>{
    const first=lifecycleClient(),next=lifecycleClient(projection("not-installed","next-r1",["install"])),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>();vi.mocked(first.read).mockReturnValue(held.promise);
    await mount(lifecycleView(first));
    try{passivePhase.paused=true;await replaceLifecycle(lifecycleView(next,"workspace-b"));expect(passivePhase.setups.length).toBeGreaterThan(0);
      await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));expect(findButton("Stop")).toBeUndefined();expect(next.read).not.toHaveBeenCalled();expect(readNotificationMessages(document.body)).toEqual([]);
    }finally{held.resolve(deploymentSuccess(projection("active-stopped","r1",["start"],"visual")));await held.promise;}
  });
});

describe("published lifecycle admission and failure paths",()=>{
  for(const synchronous of [false,true]) it(`recovers a ${synchronous?"synchronous":"rejected"} status failure through one retry`,async()=>{
    const client=lifecycleClient(),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>();
    if(synchronous)vi.mocked(client.read).mockImplementationOnce(()=>{throw new Error("private status trace");});else vi.mocked(client.read).mockRejectedValueOnce(new Error("private status trace"));
    await mount(lifecycleView(client));expect(document.body.textContent).toContain("Unable to read the published build status.");expect(document.body.textContent).not.toContain("private status trace");expect(findButton("Start")).toBeUndefined();
    vi.mocked(client.read).mockReturnValueOnce(held.promise);
    try{const retry=button("Retry status");await act(async()=>{retry.click();retry.click();});expect(client.read).toHaveBeenCalledTimes(2);
      await act(async()=>held.resolve(deploymentSuccess(projection("active-stopped","r2",["start"],"visual"))));expect(button("Start").disabled).toBe(false);
      expect(client.read).toHaveBeenLastCalledWith({workspaceId:"workspace-a",releaseId:"release-2"});
    }finally{held.resolve(deploymentSuccess(projection("not-installed","r2",["install"])));await held.promise;}
  });

  for(const synchronous of [false,true]) it(`recovers a ${synchronous?"synchronous":"rejected"} action failure with its exact revision`,async()=>{
    const client=lifecycleClient();if(synchronous)vi.mocked(client.invoke).mockImplementationOnce(()=>{throw new Error("private action trace");});else vi.mocked(client.invoke).mockRejectedValueOnce(new Error("private action trace"));
    await mount(lifecycleView(client));await act(async()=>button("Start").click());expect(document.body.textContent).toContain("Unable to update the published build status.");expect(document.body.textContent).not.toContain("private action trace");expect(button("Start").disabled).toBe(false);
    await act(async()=>button("Start").click());expect(client.invoke).toHaveBeenCalledTimes(2);for(const [input] of vi.mocked(client.invoke).mock.calls)expect(input).toEqual({workspaceId:"workspace-a",releaseId:"release-2",action:"start",expectedRevision:"r1"});expect(button("Stop").disabled).toBe(false);
  });

  it("admits one same-turn Start command",async()=>{
    const client=lifecycleClient(),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();vi.mocked(client.invoke).mockReturnValue(held.promise);await mount(lifecycleView(client));
    try{const start=button("Start");await act(async()=>{start.click();start.click();});expect(client.invoke).toHaveBeenCalledTimes(1);expect(button("Start...").disabled).toBe(true);
      await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));expect(button("Stop").disabled).toBe(false);
    }finally{await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));}
  });

  it("keeps a new target action locked after an old target action settles",async()=>{
    const old=lifecycleClient(),next=lifecycleClient(projection("not-installed","next-r1",["install"])),oldAction=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>(),newAction=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();vi.mocked(old.invoke).mockReturnValue(oldAction.promise);vi.mocked(next.invoke).mockReturnValue(newAction.promise);
    await mount(lifecycleView(old));await act(async()=>button("Start").click());
    try{await replaceLifecycle(lifecycleView(next,"workspace-b"));await act(async()=>button("Install").click());await act(async()=>oldAction.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));
      expect(button("Install...").disabled).toBe(true);expect(next.invoke).toHaveBeenCalledTimes(1);expect(readNotificationMessages(document.body)).toEqual([]);
      await act(async()=>newAction.resolve(deploymentSuccess(projection("active-stopped","next-r2",["start"],"visual"))));expect(button("Start").disabled).toBe(false);expect(next.invoke).toHaveBeenCalledWith({workspaceId:"workspace-b",releaseId:"release-2",action:"install",expectedRevision:"next-r1"});
    }finally{await act(async()=>{oldAction.resolve(deploymentSuccess(projection("active-stopped","r2",["start"],"visual")));newAction.resolve(deploymentSuccess(projection("active-stopped","next-r2",["start"],"visual")));});}
  });

  it("does not clear a replacement status read when an old status settles",async()=>{
    const old=lifecycleClient(),next=lifecycleClient(),oldRead=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>(),newRead=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>();vi.mocked(old.read).mockReturnValue(oldRead.promise);vi.mocked(next.read).mockReturnValue(newRead.promise);await mount(lifecycleView(old));
    try{await replaceLifecycle(lifecycleView(next,"workspace-b"));await act(async()=>oldRead.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));expect(document.body.textContent).toContain("Loading controls...");expect(findButton("Stop")).toBeUndefined();expect(findButton("Start")).toBeUndefined();
      await act(async()=>newRead.resolve(deploymentSuccess(projection("not-installed","next-r1",["install"]))));expect(button("Install").disabled).toBe(false);expect(next.read).toHaveBeenCalledTimes(1);
    }finally{await act(async()=>{oldRead.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual")));newRead.resolve(deploymentSuccess(projection("not-installed","next-r1",["install"])));});}
  });

  it("queues one authoritative read after a denied action and held poll settle",async()=>{
    vi.useFakeTimers();const running=projection("running","r1",["stop"],"visual"),client=lifecycleClient(running),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>();vi.mocked(client.read).mockResolvedValueOnce(deploymentSuccess(running)).mockReturnValueOnce(held.promise).mockResolvedValue(deploymentSuccess(projection("active-stopped","r3",[],"visual")));vi.mocked(client.invoke).mockResolvedValue({ok:false,error:{code:"forbidden",message:"This release is no longer active."}});
    try{await mount(lifecycleView(client));await act(async()=>{await vi.advanceTimersByTimeAsync(1_000);});await act(async()=>button("Stop").click());
      expect(client.read).toHaveBeenCalledTimes(2);expect(document.body.textContent).toContain("This release is no longer active.");expect(button("Retry status").disabled).toBe(true);expect(readNotificationMessages(document.body)).toEqual([]);
      await act(async()=>held.resolve(deploymentSuccess(running)));expect(client.read).toHaveBeenCalledTimes(3);expect(button("Retry status").disabled).toBe(false);expect(document.body.textContent).toContain("This release is no longer active.");expect(findButton("Stop")).toBeUndefined();expect(findButton("Start")).toBeUndefined();expect(client.invoke).toHaveBeenCalledTimes(1);
    }finally{await act(async()=>{held.resolve(deploymentSuccess(running));root?.unmount();root=undefined;});vi.useRealTimers();}
  });

  it("does not let completion of a retired poll unlock a pending Stop",async()=>{
    vi.useFakeTimers();const running=projection("running","r1",["stop"],"visual"),client=lifecycleClient(running),read=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>(),action=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();vi.mocked(client.read).mockResolvedValueOnce(deploymentSuccess(running)).mockReturnValue(read.promise);vi.mocked(client.invoke).mockReturnValue(action.promise);
    try{await mount(lifecycleView(client));await act(async()=>{await vi.advanceTimersByTimeAsync(1_000);});await act(async()=>button("Stop").click());await act(async()=>read.resolve(deploymentSuccess(running)));
      expect(button("Stop...").disabled).toBe(true);expect(client.invoke).toHaveBeenCalledTimes(1);await act(async()=>action.resolve(deploymentSuccess(projection("active-stopped","r2",["start"],"visual"))));expect(button("Start").disabled).toBe(false);
    }finally{await act(async()=>{read.resolve(deploymentSuccess(running));action.resolve(deploymentSuccess(projection("active-stopped","r2",["start"],"visual")));root?.unmount();root=undefined;});vi.useRealTimers();}
  });

  it("replays StrictMode without dispatching the retired initial read",async()=>{
    const client=lifecycleClient();await mount(<StrictMode>{lifecycleView(client)}</StrictMode>);expect(client.read).toHaveBeenCalledTimes(1);await act(async()=>button("Start").click());expect(client.invoke).toHaveBeenCalledTimes(1);expect(button("Stop").disabled).toBe(false);
  });

  it("skips initial status dispatch when retired before the first promise turn",async()=>{
    const {flushSync}=await import("react-dom"),client=lifecycleClient();container=document.createElement("div");document.body.append(container);root=createRoot(container);
    await act(async()=>{flushSync(()=>root!.render(lifecycleView(client)));root!.unmount();root=undefined;});expect(client.read).not.toHaveBeenCalled();expect(client.invoke).not.toHaveBeenCalled();
  });

  it("preserves a pending Start when a client replacement render is abandoned",async()=>{
    const client=lifecycleClient(),next=lifecycleClient(),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>(),gate=deferred<void>(),attempted=vi.fn();vi.mocked(client.invoke).mockReturnValue(held.promise);
    const tree=(selected:SystemPublishedLifecycleClient,pause:boolean)=><NotificationTestHarness><Suspense fallback={<p>Replacing controls</p>}><SystemPublishedLifecycleCard workspaceId="workspace-a" build={build} client={selected}/><SuspendLifecycleReplacement pause={pause} gate={gate.promise} attempted={attempted}/></Suspense></NotificationTestHarness>;
    await mount(tree(client,false));await act(async()=>button("Start").click());
    try{await act(async()=>{startTransition(()=>root!.render(tree(next,true)));});expect(attempted).toHaveBeenCalled();await replaceLifecycle(tree(client,false));expect(next.read).not.toHaveBeenCalled();expect(button("Start...").disabled).toBe(true);
      await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));expect(button("Stop").disabled).toBe(false);expect(client.invoke).toHaveBeenCalledTimes(1);expect(readNotificationMessages(document.body)).toContain("The visual system started on its host.");
    }finally{await act(async()=>{held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual")));gate.resolve();});}
  });

  it("retires an old Start before passive cleanup can publish a notice",async()=>{
    const client=lifecycleClient(),next=lifecycleClient(projection("not-installed","next-r1",["install"])),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>>();vi.mocked(client.invoke).mockReturnValue(held.promise);await mount(lifecycleView(client));await act(async()=>button("Start").click());
    try{passivePhase.paused=true;await replaceLifecycle(lifecycleView(next,"workspace-b"));expect(passivePhase.setups.length).toBeGreaterThan(0);await act(async()=>held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual"))));expect(readNotificationMessages(document.body)).toEqual([]);expect(findButton("Stop")).toBeUndefined();expect(next.read).not.toHaveBeenCalled();}
    finally{held.resolve(deploymentSuccess(projection("running","r2",["stop"],"visual")));await held.promise;}
  });
});

describe("retired lifecycle reconciliation",()=>{
  it("does not dispatch a denied action refresh after its owner retires",async()=>{
    vi.useFakeTimers();const running=projection("running","r1",["stop"],"visual"),client=lifecycleClient(running),next=lifecycleClient(projection("not-installed","next-r1",["install"])),held=deferred<Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>>();vi.mocked(client.read).mockResolvedValueOnce(deploymentSuccess(running)).mockReturnValue(held.promise);vi.mocked(client.invoke).mockResolvedValue({ok:false,error:{code:"forbidden",message:"Old release denied."}});
    try{await mount(lifecycleView(client));await act(async()=>{await vi.advanceTimersByTimeAsync(1_000);});await act(async()=>button("Stop").click());expect(client.read).toHaveBeenCalledTimes(2);
      await replaceLifecycle(lifecycleView(next,"workspace-b"));await act(async()=>held.resolve(deploymentSuccess(running)));expect(client.read).toHaveBeenCalledTimes(2);expect(next.read).toHaveBeenCalledTimes(1);expect(button("Install").disabled).toBe(false);expect(document.body.textContent).not.toContain("Old release denied.");expect(readNotificationMessages(document.body)).toEqual([]);
    }finally{await act(async()=>{held.resolve(deploymentSuccess(running));root?.unmount();root=undefined;});vi.useRealTimers();}
  });
  it("never reads or acts without an exact published release reference",async()=>{
    const client=lifecycleClient();await mount(lifecycleView(client,"workspace-a",{...build,releaseId:undefined}));expect(client.read).not.toHaveBeenCalled();expect(client.invoke).not.toHaveBeenCalled();expect(document.body.textContent).toContain("does not have a release reference");expect(findButton("Install")).toBeUndefined();expect(findButton("Start")).toBeUndefined();
  });
});

function SuspendLifecycleReplacement({pause,gate,attempted}:{pause:boolean;gate:Promise<void>;attempted:()=>void}){if(pause){attempted();throw gate;}return null;}

function lifecycleClient(initial=projection("active-stopped","r1",["start"],"visual")):SystemPublishedLifecycleClient {
  return {read:vi.fn(async()=>deploymentSuccess(initial)),invoke:vi.fn(async()=>deploymentSuccess(projection("running","r2",["stop"],"visual")))};
}
function lifecycleView(client:SystemPublishedLifecycleClient,workspaceId="workspace-a",record=build){return <NotificationTestHarness><SystemPublishedLifecycleCard workspaceId={workspaceId} build={record} client={client}/></NotificationTestHarness>;}
async function replaceLifecycle(element:React.ReactElement){await act(async()=>root!.render(element));}

const build = {
  buildId: "build-2",
  systemRevisionId: "revision-2",
  versionNumber: 2,
  status: "succeeded",
  publicationStatus: "published",
  statusMessage: "Published",
  releaseId: "release-2",
  publishedAt: "2026-07-28T12:02:00.000Z",
  createdAt: "2026-07-28T12:00:00.000Z",
  outputCount: 2,
  evidenceCount: 1,
  diagnosticCount: 0,
} as unknown as SystemPublicationBuildSummary;

const launchDescriptor = {
  schemaVersion: "1.0",
  kind: "trusted-declarative",
  releaseId: "release-2",
  releaseDigest: `sha256:${"2".repeat(64)}`,
  runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
} as unknown as SystemDeploymentLaunchDescriptor;

function projection(
  state: SystemPublishedLifecycleProjection["state"],
  revision: string,
  eligibleActions: readonly SystemPublishedLifecycleAction[],
  runtimeKind?: SystemPublishedLifecycleProjection["runtimeKind"],
): SystemPublishedLifecycleProjection {
  return {
    schemaVersion: "1.0",
    releaseId: "release-2",
    state,
    revision,
    eligibleActions,
    health:
      state === "running"
        ? "ready"
        : state === "not-installed"
          ? "unknown"
          : "stopped",
    runtimeKind,
    diagnostics: [],
  } as unknown as SystemPublishedLifecycleProjection;
}

function deploymentSuccess<T>(value: T) {
  return { ok: true as const, value };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === label);
}

function button(label: string): HTMLButtonElement {
  const result = findButton(label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
}
