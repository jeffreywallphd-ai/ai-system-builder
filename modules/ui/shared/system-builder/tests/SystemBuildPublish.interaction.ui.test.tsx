// @vitest-environment jsdom
import { act, startTransition, StrictMode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SystemBuildRecord,
  SystemBuildResult,
  SystemRelease,
  SystemPublicationWorkspace,
} from "../../../../contracts/system-build";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { SystemBuildTestModal } from "../SystemBuildTestModal";
import { SystemPublishWorkspace } from "../SystemPublishWorkspace";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";
import type { SystemBuildClient } from "../SystemBuildReleaseWorkflow";
import type { SystemPublishedLifecycleClient } from "../SystemPublishedLifecycleClient";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("guided System build and publication interactions", () => {
  it("prepares the exact saved version and requests one host-guided build", async () => {
    const prepare = vi.fn(async (
      _input: Parameters<SystemBuildClient["prepare"]>[0],
    ) => success({
      systemId: "system-1",
      systemRevisionId: "revision-2",
      systemName: "Support assistant",
      revisionNumber: 2,
      targetLabel: "This computer",
      status: "ready" as const,
      checks: [
        {
          id: "current" as const,
          label: "Current version",
          status: "passed" as const,
          message: "This is the current saved version.",
        },
      ],
    }));
    const request = vi.fn(async (
      input: Parameters<SystemBuildClient["request"]>[0],
    ) => success({ ...buildRecord(), buildId: input.buildId } as SystemBuildRecord));
    const client = { prepare, request } as unknown as SystemBuildClient;

    await mount(
      <SystemBuildTestModal
        open
        workspaceId="workspace-a"
        system={{ systemId: "system-1", name: "Support assistant" } as SystemBuilderRecord}
        revision={{ revisionId: "revision-2" } as SystemBuilderRevision}
        buildClient={client}
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      systemId: "system-1",
      systemRevisionId: "revision-2",
    }));
    expect(document.body.textContent).toContain("This computer");
    const buildAction = button(document.body, "Build & test");
    await vi.waitFor(() => expect(document.activeElement).toBe(buildAction));
    await act(async () => buildAction.click());
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      systemRevisionId: "revision-2",
    });
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty("deploymentProfile");
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty("toolchainProfile");
    expect(document.body.textContent).toContain("Build and checks completed");
    expect(document.body.textContent).toContain("ready to review in Publish");
  });

  it("defaults to the newest ready build and publishes only after explicit confirmation", async () => {
    const publicationWorkspace = vi
      .fn()
      .mockResolvedValueOnce(success(publicationFixture()))
      .mockResolvedValueOnce(success(publishedFixture()));
    const approve = vi.fn(async (
      _input: Parameters<SystemBuildClient["approve"]>[0],
    ) => success(releaseFixture()));
    const client = { publicationWorkspace, approve } as unknown as SystemBuildClient;
    const lifecycleClient = {
      read: vi.fn(async () => success({
        schemaVersion: "1.0",
        releaseId: "release-2",
        state: "not-installed",
        revision: "lifecycle-1",
        eligibleActions: ["install"],
        health: "unknown",
        diagnostics: [],
      })),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishWorkspace
        workspaceId="workspace-a"
        buildClient={client}
        lifecycleClient={lifecycleClient}
      />,
    );

    const buildSelect = await vi.waitFor(() => {
      const select = document.body.querySelectorAll<HTMLSelectElement>("select")[1];
      expect(select).not.toBeNull();
      expect(select?.value).toBe("build-2");
      return select!;
    });
    expect(buildSelect.value).toBe("build-2");
    expect(document.body.textContent).toContain("Ready to publish");

    await act(async () => button(document.body, "Publish build").click());
    expect(approve).not.toHaveBeenCalled();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Support assistant");
    expect(dialog?.textContent).toContain("build 2");
    expect(dialog?.textContent).toContain("cannot be changed");

    await act(async () => button(dialog!, "Publish").click());
    await vi.waitFor(() => expect(approve).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      buildId: "build-2",
      expectedLockDigest: digest("2"),
    }));
    expect(publicationWorkspace).toHaveBeenCalledTimes(2);
    expect(readNotificationMessages(document.body)).toContain("Support assistant, build 2, was published.");
    expect(container?.textContent).not.toContain("Support assistant, build 2, was published.");
    expect(document.body.textContent).toContain("Published builds");
    expect(document.body.textContent).toContain("Install");
    expect(document.body.textContent).not.toContain("Deployment identifier");
    expect(document.body.textContent).not.toContain("Open System");
  });
});

describe("Build and Publish request recovery", () => {
  it("recovers a rejected preparation without exposing raw errors", async () => {
    const client = guidedClient();
    vi.mocked(client.prepare).mockRejectedValueOnce(new Error("private transport trace"));
    await mount(buildView(client));
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Checking this saved version"));
    expect(document.body.textContent).not.toContain("private transport trace");
    await act(async () => button(document.body, "Retry checks").click());
    await vi.waitFor(() => expect(button(document.body, "Build & test").disabled).toBe(false));
    expect(client.prepare).toHaveBeenCalledTimes(2);
  });

  it("admits one build request before the busy render", async () => {
    const client = guidedClient();
    const held = heldResult<Awaited<ReturnType<SystemBuildClient["request"]>>>();
    vi.mocked(client.request).mockReturnValue(held.promise);
    await mount(buildView(client));
    const action = await vi.waitFor(() => { const value = button(document.body, "Build & test"); expect(value.disabled).toBe(false); return value; });
    try {
      await act(async () => {action.click();action.click();});
      expect(client.request).toHaveBeenCalledTimes(1);
    } finally {await act(async () => held.resolve(success(buildRecord())));}
  });

  it("does not show a former workspace build in the replacement view", async () => {
    const client = guidedClient();
    const held = heldResult<Awaited<ReturnType<SystemBuildClient["request"]>>>();
    vi.mocked(client.request).mockReturnValue(held.promise);
    await mount(buildView(client));
    await vi.waitFor(() => expect(button(document.body, "Build & test").disabled).toBe(false));
    await act(async () => button(document.body, "Build & test").click());
    try {
      await replaceView(buildView(client, "workspace-b"));
      await act(async () => held.resolve(success(buildRecord())));
      expect(document.body.textContent).not.toContain("Build and checks completed");
      await vi.waitFor(() => expect(button(document.body, "Build & test").disabled).toBe(false));
    } finally {held.resolve(success(buildRecord()));await held.promise;}
  });

  it("offers publication Refresh after the initial list rejects", async () => {
    const client = guidedClient();
    vi.mocked(client.publicationWorkspace).mockRejectedValueOnce(new Error("private publication trace"));
    await mount(publishView(client));
    await vi.waitFor(() => expect(readNotificationMessages(document.body)).toContain("Could not load builds. Select Refresh to try again."));
    expect(document.body.textContent).not.toContain("private publication trace");
    await act(async () => button(document.body, "Refresh").click());
    await vi.waitFor(() => expect(button(document.body, "Publish build").disabled).toBe(false));
  });

  it("releases a rejected approval and permits explicit retry", async () => {
    const client = guidedClient();
    vi.mocked(client.approve).mockRejectedValueOnce(new Error("private approval trace"));
    await mount(publishView(client));
    const dialog = await openPublication();
    await act(async () => button(dialog, "Publish").click());
    await vi.waitFor(() => expect(button(dialog, "Publish").disabled).toBe(false));
    expect(document.body.textContent).not.toContain("private approval trace");
    expect(readNotificationMessages(document.body)).toContain("Could not publish this build. Review the selection and try again.");
    await act(async () => button(dialog, "Publish").click());
    expect(client.approve).toHaveBeenCalledTimes(2);
  });

  it("admits one approval before the busy render", async () => {
    const client = guidedClient();
    const held = heldResult<Awaited<ReturnType<SystemBuildClient["approve"]>>>();
    vi.mocked(client.approve).mockReturnValue(held.promise);
    await mount(publishView(client));
    const dialog = await openPublication();
    try {
      const action = button(dialog, "Publish");
      await act(async () => {action.click();action.click();});
      expect(client.approve).toHaveBeenCalledTimes(1);
    } finally {await act(async () => held.resolve(success(releaseFixture())));}
  });

  it("keeps the confirmed build and lock when selection events are queued", async () => {
    const client = guidedClient();
    const fixture = publicationFixture();
    const exact = fixture.systems[0]!.builds[1]!;
    vi.mocked(client.publicationWorkspace).mockResolvedValueOnce(success({systems:[{...fixture.systems[0]!,builds:[...fixture.systems[0]!.builds,{...exact,buildId:"build-other",versionNumber:1,expectedLockDigest:digest("1")}]}]} as SystemPublicationWorkspace));
    await mount(publishView(client));
    const dialog = await openPublication();
    const select = container!.querySelectorAll<HTMLSelectElement>("select")[1]!;
    await act(async () => {select.value="build-other";select.dispatchEvent(new Event("change",{bubbles:true}));});
    await act(async () => button(dialog,"Publish").click());
    expect(client.approve).toHaveBeenCalledWith({workspaceId:"workspace-a",buildId:"build-2",expectedLockDigest:digest("2")});
  });

  it("keeps saved publication success when its list refresh rejects", async () => {
    const client = guidedClient();
    vi.mocked(client.publicationWorkspace).mockResolvedValueOnce(success(publicationFixture())).mockRejectedValueOnce(new Error("private refresh trace"));
    await mount(publishView(client));
    const dialog = await openPublication();
    await act(async () => button(dialog,"Publish").click());
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(readNotificationMessages(document.body)).toContain("Support assistant, build 2, was published.");
    await vi.waitFor(() => expect(button(document.body,"Refresh").disabled).toBe(false));
    expect(client.approve).toHaveBeenCalledTimes(1);
    expect(readNotificationMessages(document.body).join(" ")).not.toContain("Could not publish this build");
  });
});

describe("Exact build and publication ownership", () => {
  it("retries a rejected build request and keeps the exact saved target", async () => {
    const client=guidedClient();vi.mocked(client.request).mockRejectedValueOnce(new Error("private build trace"));
    await mount(buildView(client));await readyBuild();
    await act(async()=>button(document.body,"Build & test").click());
    await readyBuild();expect(readNotificationMessages(document.body)).toContain("Could not build this saved version. Try Build & test again.");
    expect(document.body.textContent).not.toContain("private build trace");
    await act(async()=>button(document.body,"Build & test").click());
    expect(client.request).toHaveBeenCalledTimes(2);expect(document.body.textContent).toContain("Build and checks completed");
    for(const [input] of vi.mocked(client.request).mock.calls) expect(input).toMatchObject({workspaceId:"workspace-a",systemId:"system-1",systemRevisionId:"revision-2"});
  });

  it("rejects another build ID for the same target and can deliberately retry", async()=>{
    const client=guidedClient();vi.mocked(client.request).mockResolvedValueOnce(success(buildRecord()));
    await mount(buildView(client));await readyBuild();await act(async()=>button(document.body,"Build & test").click());
    expect(document.body.textContent).not.toContain("Build and checks completed");expect(document.body.textContent).not.toContain("Cancel build");await readyBuild();
    await act(async()=>button(document.body,"Build & test").click());expect(document.body.textContent).toContain("Build and checks completed");
  });

  it("contains cancellation rejection, admits one retry and cancels the exact build", async()=>{
    const client=guidedClient();vi.mocked(client.request).mockImplementation(async input=>success({...buildRecord(),buildId:input.buildId,status:"running"} as SystemBuildRecord));
    vi.mocked(client.cancel).mockRejectedValueOnce(new Error("private cancel trace"));
    await mount(buildView(client));await readyBuild();await act(async()=>button(document.body,"Build & test").click());
    await act(async()=>button(document.body,"Cancel build").click());
    await vi.waitFor(()=>expect(button(document.body,"Cancel build").disabled).toBe(false));
    expect(readNotificationMessages(document.body)).toContain("Could not cancel this build. Try Cancel build again.");expect(document.body.textContent).not.toContain("private cancel trace");
    const held=heldResult<Awaited<ReturnType<SystemBuildClient["cancel"]>>>();vi.mocked(client.cancel).mockReturnValue(held.promise);
    try {
      const action=button(document.body,"Cancel build");await act(async()=>{action.click();action.click();});expect(client.cancel).toHaveBeenCalledTimes(2);
      const id=vi.mocked(client.request).mock.calls[0]![0].buildId;
      expect(client.cancel).toHaveBeenLastCalledWith({workspaceId:"workspace-a",buildId:id});
      await act(async()=>held.resolve(success({...buildRecord(),buildId:id,status:"cancelled"} as SystemBuildRecord)));
      expect(document.body.textContent).toContain("Build cancelled");
    }finally{held.resolve(success(buildRecord()));await held.promise;}
  });

  it("retains the original build after a mismatched cancellation reply", async()=>{
    const client=guidedClient();vi.mocked(client.request).mockImplementation(async input=>success({...buildRecord(),buildId:input.buildId,status:"running"} as SystemBuildRecord));
    vi.mocked(client.cancel).mockResolvedValueOnce(success({...buildRecord(),buildId:"other-build",status:"cancelled"} as SystemBuildRecord));
    await mount(buildView(client));await readyBuild();await act(async()=>button(document.body,"Build & test").click());await act(async()=>button(document.body,"Cancel build").click());
    expect(document.body.textContent).not.toContain("Build cancelled");expect(button(document.body,"Cancel build").disabled).toBe(false);
    await act(async()=>button(document.body,"Cancel build").click());expect(document.body.textContent).toContain("Build cancelled");
  });

  it("keeps denied readiness and typed stale revision approval denied", async()=>{
    const client=guidedClient();vi.mocked(client.prepare).mockResolvedValueOnce(success({systemId:"system-1",systemRevisionId:"revision-2",systemName:"Support assistant",revisionNumber:2,targetLabel:"This computer",status:"blocked",checks:[{id:"current",label:"Current version",status:"blocked",message:"Save the current version before building."}]} as never));
    await mount(buildView(client));expect(button(document.body,"Build & test").disabled).toBe(true);expect(document.body.textContent).toContain("Save the current version before building.");expect(client.request).not.toHaveBeenCalled();
    vi.mocked(client.approve).mockResolvedValueOnce({ok:false,error:{code:"conflict",message:"The saved build lock changed. Refresh the build list."}});
    await replaceView(publishView(client));const dialog=await openPublication();await act(async()=>button(dialog,"Publish").click());
    expect(readNotificationMessages(document.body)).toContain("The saved build lock changed. Refresh the build list.");expect(readNotificationMessages(document.body).join(" ")).not.toContain("was published");
    expect(client.approve).toHaveBeenCalledWith({workspaceId:"workspace-a",buildId:"build-2",expectedLockDigest:digest("2")});
  });

  it("refuses preparation for another saved revision and retries only checks", async()=>{
    const client=guidedClient();vi.mocked(client.prepare).mockResolvedValueOnce(success({systemId:"system-1",systemRevisionId:"other-revision",status:"ready",checks:[]} as never));
    await mount(buildView(client));expect(button(document.body,"Build & test").disabled).toBe(true);expect(client.request).not.toHaveBeenCalled();
    await act(async()=>button(document.body,"Retry checks").click());await readyBuild();expect(client.request).not.toHaveBeenCalled();
  });

  for(const replacement of ["revision","client","close-and-reopen"] as const) it(`retires old build replies after ${replacement} changes`,async()=>{
    const client=guidedClient(),next=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["request"]>>>();vi.mocked(client.request).mockReturnValue(held.promise);
    await mount(buildView(client));await readyBuild();await act(async()=>button(document.body,"Build & test").click());
    try{
      if(replacement==="close-and-reopen"){await replaceView(buildView(client,"workspace-a","revision-2",false));await replaceView(buildView(client));}
      else await replaceView(buildView(replacement==="client"?next:client,"workspace-a",replacement==="revision"?"revision-3":"revision-2"));
      await act(async()=>held.resolve(success({...buildRecord(),buildId:vi.mocked(client.request).mock.calls[0]![0].buildId} as SystemBuildRecord)));
      expect(document.body.textContent).not.toContain("Build and checks completed");await readyBuild();expect(readNotificationMessages(document.body)).toEqual([]);
    }finally{held.resolve(success(buildRecord()));await held.promise;}
  });

  it("ignores a former workspace list and retains the new system selection",async()=>{
    const client=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["publicationWorkspace"]>>>();vi.mocked(client.publicationWorkspace).mockReturnValueOnce(held.promise);
    await mount(publishView(client));
    try{
      const fixture=publicationFixture();vi.mocked(client.publicationWorkspace).mockResolvedValueOnce(success({systems:[{...fixture.systems[0]!,name:"Current workspace system"}]}));
      await replaceView(publishView(client,"workspace-b"));await vi.waitFor(()=>expect(document.body.textContent).toContain("Current workspace system"));
      await act(async()=>held.resolve(success(publicationFixture())));expect(document.body.textContent).toContain("Current workspace system");expect(container!.textContent).not.toContain("Support assistant");
    }finally{held.resolve(success(publicationFixture()));await held.promise;}
  });

  it("retires an old approval at layout commit before passive setup",async()=>{
    const client=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["approve"]>>>();vi.mocked(client.approve).mockReturnValue(held.promise);
    await mount(publishView(client));const dialog=await openPublication();await act(async()=>button(dialog,"Publish").click());const calls=vi.mocked(client.publicationWorkspace).mock.calls.length;
    try{passivePhase.paused=true;await replaceView(publishView(guidedClient(),"workspace-b"));expect(passivePhase.setups.length).toBeGreaterThan(0);await act(async()=>held.resolve(success(releaseFixture())));
      expect(readNotificationMessages(document.body)).toEqual([]);expect(client.publicationWorkspace).toHaveBeenCalledTimes(calls);expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    }finally{held.resolve(success(releaseFixture()));await held.promise;}
  });

  it("keeps an accepted confirmation locked through same-turn Cancel and selection",async()=>{
    const client=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["approve"]>>>();vi.mocked(client.approve).mockReturnValue(held.promise);
    await mount(publishView(client));const dialog=await openPublication();const select=container!.querySelectorAll<HTMLSelectElement>("select")[1]!;
    try{await act(async()=>{button(dialog,"Publish").click();button(dialog,"Cancel").click();select.value="build-3";select.dispatchEvent(new Event("change",{bubbles:true}));});
      expect(dialog.isConnected).toBe(true);expect(dialog.textContent).toContain("build 2");expect(client.approve).toHaveBeenCalledTimes(1);expect(client.approve).toHaveBeenCalledWith({workspaceId:"workspace-a",buildId:"build-2",expectedLockDigest:digest("2")});
    }finally{await act(async()=>held.resolve(success(releaseFixture())));}
  });

  it("does not approve from a cancelled stale confirmation handler",async()=>{
    const client=guidedClient();await mount(publishView(client));const dialog=await openPublication();const approve=button(dialog,"Publish");
    await act(async()=>{button(dialog,"Cancel").click();approve.click();});expect(client.approve).not.toHaveBeenCalled();expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  for(const field of ["targetWorkspaceId","sourceBuildId","systemId","systemRevisionId","lockDigest"] as const) it(`rejects a publication acknowledgement with another ${field}`,async()=>{
    const client=guidedClient(),release=releaseFixture();vi.mocked(client.approve).mockResolvedValueOnce(success({...release,[field]:field==="lockDigest"?digest("9"):"other-target"} as SystemRelease));
    await mount(publishView(client));const dialog=await openPublication();await act(async()=>button(dialog,"Publish").click());
    expect(readNotificationMessages(document.body).join(" ")).not.toContain("was published");expect(dialog.isConnected).toBe(true);expect(button(dialog,"Publish").disabled).toBe(false);
    expect(client.publicationWorkspace).toHaveBeenCalledTimes(1);await act(async()=>button(dialog,"Publish").click());expect(readNotificationMessages(document.body)).toContain("Support assistant, build 2, was published.");
  });

  for(const view of ["build","publish"] as const) it(`replays StrictMode safely for the ${view} view`,async()=>{
    const client=guidedClient();await mount(<StrictMode>{view==="build"?buildView(client):publishView(client)}</StrictMode>);
    if(view==="build"){await readyBuild();expect(client.prepare).toHaveBeenCalledTimes(1);await act(async()=>button(document.body,"Build & test").click());expect(document.body.textContent).toContain("Build and checks completed");}
    else {const dialog=await openPublication();await act(async()=>button(dialog,"Publish").click());expect(client.approve).toHaveBeenCalledTimes(1);expect(readNotificationMessages(document.body)).toContain("Support assistant, build 2, was published.");}
  });

  for(const view of ["build","publish"] as const) it(`skips a retired ${view} initial read before the first promise turn`,async()=>{
    const {flushSync}=await import("react-dom");const client=guidedClient();container=document.createElement("div");document.body.append(container);root=createRoot(container);
    await act(async()=>{flushSync(()=>root!.render(<NotificationTestHarness>{view==="build"?buildView(client):publishView(client)}</NotificationTestHarness>));root!.unmount();root=undefined;});
    expect(client.prepare).not.toHaveBeenCalled();expect(client.publicationWorkspace).not.toHaveBeenCalled();
  });

  it("preserves a committed pending build after an abandoned client replacement",async()=>{
    const client=guidedClient(),next=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["request"]>>>(),suspension=heldResult<void>(),attempted=vi.fn();vi.mocked(client.request).mockReturnValue(held.promise);
    const tree=(selected:SystemBuildClient,pause:boolean)=><Suspense fallback={<p>Replacing build view</p>}>{buildView(selected)}<SuspendBuildReplacement pause={pause} gate={suspension.promise} attempted={attempted}/></Suspense>;
    await mount(tree(client,false));await readyBuild();await act(async()=>button(document.body,"Build & test").click());
    try{await act(async()=>{startTransition(()=>root!.render(<NotificationTestHarness>{tree(next,true)}</NotificationTestHarness>));});expect(attempted).toHaveBeenCalled();await replaceView(tree(client,false));
      expect(next.prepare).not.toHaveBeenCalled();await act(async()=>held.resolve(success({...buildRecord(),buildId:vi.mocked(client.request).mock.calls[0]![0].buildId} as SystemBuildRecord)));expect(document.body.textContent).toContain("Build and checks completed");
    }finally{await act(async()=>{held.resolve(success(buildRecord()));suspension.resolve();});}
  });

  it("preserves a committed publication confirmation after an abandoned client replacement",async()=>{
    const client=guidedClient(),next=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["approve"]>>>(),suspension=heldResult<void>(),attempted=vi.fn();vi.mocked(client.approve).mockReturnValue(held.promise);
    const tree=(selected:SystemBuildClient,pause:boolean)=><Suspense fallback={<p>Replacing Publish view</p>}>{publishView(selected)}<SuspendBuildReplacement pause={pause} gate={suspension.promise} attempted={attempted}/></Suspense>;
    await mount(tree(client,false));const dialog=await openPublication();await act(async()=>button(dialog,"Publish").click());
    try{await act(async()=>{startTransition(()=>root!.render(<NotificationTestHarness>{tree(next,true)}</NotificationTestHarness>));});expect(attempted).toHaveBeenCalled();await replaceView(tree(client,false));
      expect(next.publicationWorkspace).not.toHaveBeenCalled();await act(async()=>held.resolve(success(releaseFixture())));expect(readNotificationMessages(document.body)).toContain("Support assistant, build 2, was published.");
    }finally{await act(async()=>{held.resolve(success(releaseFixture()));suspension.resolve();});}
  });
});

async function readyBuild(){await vi.waitFor(()=>expect(button(document.body,"Build & test").disabled).toBe(false));}
function SuspendBuildReplacement({pause,gate,attempted}:{pause:boolean;gate:Promise<void>;attempted:()=>void}){if(pause){attempted();throw gate;}return null;}
function releaseFixture():SystemRelease {
  return {releaseId:"release-2" as never,targetWorkspaceId:"workspace-a" as never,systemId:"system-1" as never,systemRevisionId:"revision-2" as never,sourceBuildId:"build-2" as never,lockDigest:digest("2"),releaseDigest:digest("3"),
    lock:{schemaVersion:"1.0",systemId:"system-1" as never,systemRevisionId:"revision-2" as never,systemRevisionDigest:digest("4"),deploymentProfile:"local-desktop",hostApiVersion:"1.0.0",toolchainProfile:"fixture-only",policyCompilerVersion:"1",workflowCompilerVersion:"1",schemaCompilerVersion:"1",resolvedImplementations:[]},
    artifacts:[],compatibility:{deploymentProfiles:["local-desktop"],hostApiVersion:"1.0.0"},assurance:"repeatable",approvedAt:"2026-07-28T12:02:00.000Z",approvedBy:"synthetic-reviewer",createdAt:"2026-07-28T12:02:00.000Z"};
}

describe("Build request admission failure boundaries",()=>{
  it("releases build admission if the browser ID provider throws, then retries",async()=>{
    const client=guidedClient();await mount(buildView(client));await readyBuild();
    const randomUUID=vi.fn().mockImplementationOnce(()=>{throw new Error("private browser trace");}).mockReturnValue("synthetic-retry-id");
    const originalCrypto=Object.getOwnPropertyDescriptor(globalThis,"crypto");
    vi.stubGlobal("crypto",{randomUUID});
    try{
      await act(async()=>button(document.body,"Build & test").click());await readyBuild();expect(client.request).not.toHaveBeenCalled();
      expect(readNotificationMessages(document.body)).toContain("Could not build this saved version. Try Build & test again.");expect(document.body.textContent).not.toContain("private browser trace");
      await act(async()=>button(document.body,"Build & test").click());expect(client.request).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain("Build and checks completed");
    }finally{vi.unstubAllGlobals();expect(Object.getOwnPropertyDescriptor(globalThis,"crypto")).toEqual(originalCrypto);}
  });

  it("admits one Retry checks request before the loading render",async()=>{
    const client=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["prepare"]>>>();
    vi.mocked(client.prepare).mockResolvedValueOnce({ok:false,error:{code:"unavailable",message:"Checks are temporarily unavailable."}}).mockReturnValueOnce(held.promise);
    await mount(buildView(client));
    try{const retry=button(document.body,"Retry checks");await act(async()=>{retry.click();retry.click();});expect(client.prepare).toHaveBeenCalledTimes(2);
      await act(async()=>held.resolve(success({systemId:"system-1",systemRevisionId:"revision-2",systemName:"Support assistant",revisionNumber:2,targetLabel:"This computer",status:"ready",checks:[]} as never)));await readyBuild();
    }finally{held.resolve({ok:false,error:{code:"unavailable",message:"Checks are unavailable."}});await held.promise;}
  });

  it("admits one publication Refresh before the loading render",async()=>{
    const client=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["publicationWorkspace"]>>>();await mount(publishView(client));await vi.waitFor(()=>expect(button(document.body,"Refresh").disabled).toBe(false));
    vi.mocked(client.publicationWorkspace).mockReturnValueOnce(held.promise);
    try{const refresh=button(document.body,"Refresh");await act(async()=>{refresh.click();refresh.click();});expect(client.publicationWorkspace).toHaveBeenCalledTimes(2);
      await act(async()=>held.resolve(success(publicationFixture())));expect(button(document.body,"Refresh").disabled).toBe(false);
    }finally{held.resolve(success(publicationFixture()));await held.promise;}
  });

  it("retires a build acknowledgement at layout commit before passive setup",async()=>{
    const client=guidedClient(),next=guidedClient(),held=heldResult<Awaited<ReturnType<SystemBuildClient["request"]>>>();vi.mocked(client.request).mockReturnValue(held.promise);
    await mount(buildView(client));await readyBuild();await act(async()=>button(document.body,"Build & test").click());
    try{passivePhase.paused=true;await replaceView(buildView(next,"workspace-b"));expect(passivePhase.setups.length).toBeGreaterThan(0);expect(next.prepare).not.toHaveBeenCalled();
      await act(async()=>held.resolve(success({...buildRecord(),buildId:vi.mocked(client.request).mock.calls[0]![0].buildId} as SystemBuildRecord)));
      expect(document.body.textContent).not.toContain("Build and checks completed");expect(readNotificationMessages(document.body)).toEqual([]);
    }finally{held.resolve(success(buildRecord()));await held.promise;}
  });
});

function guidedClient(): SystemBuildClient {
  return {
    prepare:vi.fn(async (input:Parameters<SystemBuildClient["prepare"]>[0]) => success({systemId:input.systemId,systemRevisionId:input.systemRevisionId,systemName:"Support assistant",revisionNumber:2,targetLabel:"This computer",status:"ready",checks:[]})),
    request:vi.fn(async (input:Parameters<SystemBuildClient["request"]>[0]) => success({...buildRecord(),buildId:input.buildId,targetWorkspaceId:input.workspaceId,systemId:input.systemId,systemRevisionId:input.systemRevisionId} as SystemBuildRecord)),cancel:vi.fn(async (input:Parameters<SystemBuildClient["cancel"]>[0]) => success({...buildRecord(),buildId:input.buildId,status:"cancelled"} as SystemBuildRecord)),
    publicationWorkspace:vi.fn(async () => success(publicationFixture())),approve:vi.fn(async () => success(releaseFixture())),
  } as unknown as SystemBuildClient;
}
function buildView(client:SystemBuildClient,workspaceId="workspace-a",revisionId="revision-2",open=true,onClose:()=>void=vi.fn()) {
  return <SystemBuildTestModal open={open} workspaceId={workspaceId} system={{systemId:"system-1",name:"Support assistant"} as SystemBuilderRecord} revision={{revisionId} as SystemBuilderRevision} buildClient={client} onClose={onClose} />;
}
function publishView(client:SystemBuildClient,workspaceId="workspace-a") {
  return <SystemPublishWorkspace workspaceId={workspaceId} buildClient={client} lifecycleClient={{read:vi.fn(async()=>success({schemaVersion:"1.0",releaseId:"release-2",state:"not-installed",revision:"lifecycle-1",eligibleActions:["install"],health:"unknown",diagnostics:[]})),invoke:vi.fn()} as unknown as SystemPublishedLifecycleClient} />;
}
async function replaceView(element:React.ReactElement) {await act(async () => root!.render(<NotificationTestHarness>{element}</NotificationTestHarness>));}
async function openPublication() {
  await vi.waitFor(() => expect(button(document.body,"Publish build").disabled).toBe(false));
  await act(async () => button(document.body,"Publish build").click());
  return await vi.waitFor(() => {const dialog=document.body.querySelector<HTMLElement>('[role="dialog"]');expect(dialog).not.toBeNull();return dialog!;});
}
function heldResult<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};}

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<NotificationTestHarness>{element}</NotificationTestHarness>));
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
}

function success<T>(value: T): SystemBuildResult<T> {
  return { ok: true, value };
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64)}`;
}

function buildRecord(): SystemBuildRecord {
  return {
    buildId: "build-2",
    targetWorkspaceId: "workspace-a",
    systemId: "system-1",
    systemRevisionId: "revision-2",
    status: "succeeded",
    revision: 3,
    lockDigest: digest("2"),
    outputArtifacts: [],
    evidenceArtifacts: [],
    diagnostics: [],
    assurance: "repeatable",
    cancellationRequested: false,
    createdAt: "2026-07-28T12:00:00.000Z",
    completedAt: "2026-07-28T12:01:00.000Z",
    requestedBy: "person-1",
  } as unknown as SystemBuildRecord;
}

function publicationFixture(): SystemPublicationWorkspace {
  return {
    systems: [{
      systemId: "system-1",
      name: "Support assistant",
      builds: [
        {
          buildId: "build-3",
          systemRevisionId: "revision-2",
          versionNumber: 3,
          status: "failed",
          publicationStatus: "unavailable",
          statusMessage: "Build checks did not pass",
          createdAt: "2026-07-28T13:00:00.000Z",
          outputCount: 0,
          evidenceCount: 0,
          diagnosticCount: 1,
        },
        {
          buildId: "build-2",
          systemRevisionId: "revision-2",
          versionNumber: 2,
          status: "succeeded",
          publicationStatus: "ready",
          statusMessage: "Ready to publish",
          expectedLockDigest: digest("2"),
          createdAt: "2026-07-28T12:00:00.000Z",
          outputCount: 2,
          evidenceCount: 1,
          diagnosticCount: 0,
        },
      ],
    }],
  } as unknown as SystemPublicationWorkspace;
}

function publishedFixture(): SystemPublicationWorkspace {
  const fixture = publicationFixture();
  return {
    systems: [{
      ...fixture.systems[0]!,
      builds: fixture.systems[0]!.builds.map((build) =>
        String(build.buildId) === "build-2"
          ? {
              ...build,
              publicationStatus: "published" as const,
              statusMessage: "Published",
              releaseId: "release-2",
              publishedAt: "2026-07-28T12:02:00.000Z",
            }
          : build,
      ),
    }],
  } as unknown as SystemPublicationWorkspace;
}
