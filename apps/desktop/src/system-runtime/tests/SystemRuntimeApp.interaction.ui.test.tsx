// @vitest-environment jsdom
import { act, startTransition, StrictMode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS } from "../../../../../modules/contracts/system-deployment";
import { createSystemRuntimePreloadApi, type SystemRuntimePreloadApi } from "../../system-runtime-preload/systemRuntimePreloadApi";
import { DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS, createIpcSuccessResponse } from "../../../../../modules/contracts/ipc";
import { SystemRuntimeApp } from "../SystemRuntimeApp";

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

const originalCryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => {
    passivePhase.paused=false;
    while(passivePhase.cleanups.length) passivePhase.cleanups.shift()!();
    while(passivePhase.setups.length) passivePhase.setups.shift()!();
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
  expect(Object.getOwnPropertyDescriptor(globalThis,"crypto")).toEqual(originalCryptoDescriptor);
});

describe("published system runtime conversation surface", () => {
  it("starts without sample messages and submits a real bounded turn", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "runtime-uuid" });
    const pending = deferred<Awaited<ReturnType<SystemRuntimePreloadApi["submit"]>>>();
    const submit = vi.fn(() => pending.promise);
    const api: SystemRuntimePreloadApi = {
      read: vi.fn<SystemRuntimePreloadApi["read"]>(async () => ({ ok: true, value: readyView([]) })),
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

describe("published conversation request recovery", () => {
  it("retries a typed first connection failure without sending a turn", async () => {
    const read = vi.fn<SystemRuntimePreloadApi["read"]>()
      .mockResolvedValueOnce({ok:false,error:{code:"runtime-unavailable",message:"The published system connection is unavailable."}})
      .mockResolvedValue({ok:true,value:readyView([])});
    const submit=vi.fn<SystemRuntimePreloadApi["submit"]>();
    await mount(<SystemRuntimeApp api={{read,submit}} />);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
    await act(async()=>button("Retry connection").click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("Start a conversation");
  });

  it("rejects an old connection result after its API is replaced", async()=>{
    const old=deferred<Awaited<ReturnType<SystemRuntimePreloadApi["read"]>>>();
    await mount(<SystemRuntimeApp api={{read:()=>old.promise,submit:vi.fn()}} />);
    const replacement:SystemRuntimePreloadApi={read:async()=>({ok:true,value:{...readyView([]),title:"Current conversation"}}),submit:vi.fn()};
    await act(async()=>root?.render(<SystemRuntimeApp api={replacement}/>));
    expect(document.querySelector('h1')?.textContent).toBe("Current conversation");
    await act(async()=>old.resolve({ok:true,value:{...readyView([]),title:"Obsolete conversation"}}));
    expect(document.querySelector('h1')?.textContent).toBe("Current conversation");
    expect(document.body.textContent).not.toContain("Obsolete conversation");
  });

  it("releases Send and retains the draft if the operation ID provider fails",async()=>{
    const submit=vi.fn<SystemRuntimePreloadApi["submit"]>();
    await mount(<SystemRuntimeApp api={{read:async()=>({ok:true,value:readyView([])}),submit}} />);
    const textarea=document.querySelector('textarea')!;
    await act(async()=>setText(textarea,"Preserve this draft"));
    vi.stubGlobal('crypto',{randomUUID:()=>{throw new Error('SYNTHETIC-PRIVATE-UUID-DETAIL');}});
    await act(async()=>button("Send").click());
    expect(submit).not.toHaveBeenCalled();
    expect(button("Send").disabled).toBe(false);
    expect(textarea.value).toBe("Preserve this draft");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to send");
    expect(document.body.textContent).not.toContain('SYNTHETIC-PRIVATE-UUID-DETAIL');
    await act(async()=>retryButton().click());
    expect(submit).not.toHaveBeenCalled();
    vi.stubGlobal('crypto',{randomUUID:()=> 'corrected-runtime-uuid'});
    submit.mockResolvedValue({ok:true,value:readyView([message('corrected','assistant','Corrected accepted turn')])});
    await act(async()=>button('Send').click());
    expect(submit).toHaveBeenCalledExactlyOnceWith({text:'Preserve this draft',operationId:'runtime-turn.corrected-runtime-uuid'});
    expect(textarea.value).toBe('');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="log"]')?.textContent).toContain('Corrected accepted turn');
  });
});

describe("published conversation bounded failure and ownership paths",()=>{
  for(const synchronous of [false,true]) it(`recovers a ${synchronous?'synchronous':'rejected'} read without exposing private details`,async()=>{
    const read=vi.fn<SystemRuntimePreloadApi['read']>().mockImplementationOnce(()=>{
      if(synchronous) throw new Error('SYNTHETIC-PRIVATE-READ');
      return Promise.reject(new Error('SYNTHETIC-PRIVATE-READ'));
    }).mockResolvedValue({ok:true,value:readyView([])});
    const retry=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['read']>>>();
    await mount(<SystemRuntimeApp api={{read,submit:vi.fn()}}/>);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Unable to read');
    expect(document.body.textContent).not.toContain('SYNTHETIC-PRIVATE-READ');
    read.mockImplementationOnce(()=>retry.promise);
    await act(async()=>{const button=retryButton();button.click();button.click();});
    expect(read).toHaveBeenCalledTimes(2);
    expect(document.querySelector('textarea')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Opening the system');
    await act(async()=>retry.resolve({ok:true,value:readyView([])}));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain('Start a conversation');
  });

  for(const synchronous of [false,true]) it(`releases a ${synchronous?'synchronous':'rejected'} turn without replaying it`,async()=>{
    const submit=vi.fn<SystemRuntimePreloadApi['submit']>().mockImplementationOnce(()=>{
      if(synchronous) throw new Error('SYNTHETIC-PRIVATE-TURN');
      return Promise.reject(new Error('SYNTHETIC-PRIVATE-TURN'));
    });
    const read=vi.fn<SystemRuntimePreloadApi['read']>().mockResolvedValue({ok:true,value:readyView([])});
    await mount(<SystemRuntimeApp api={{read,submit}}/>);
    const textarea=document.querySelector('textarea')!;
    await act(async()=>setText(textarea,'Keep my unsent input'));
    await act(async()=>button('Send').click());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(button('Send').disabled).toBe(false);
    expect(textarea.value).toBe('Keep my unsent input');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Unable to send');
    expect(document.body.textContent).not.toContain('SYNTHETIC-PRIVATE-TURN');
    await act(async()=>retryButton().click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe('Keep my unsent input');
  });

  it('uses the real dedicated preload sanitization and retries only its read channel',async()=>{
    const invoke=vi.fn(async(channel:string)=>{
      expect(channel).toBe(DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.read.request.value);
      if(invoke.mock.calls.length===1) throw new Error('SYNTHETIC-PRIVATE-IPC');
      return createIpcSuccessResponse(DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.read.response,{ok:true,value:readyView([])});
    });
    const api=createSystemRuntimePreloadApi({ipcRenderer:{invoke}});
    await mount(<SystemRuntimeApp api={api}/>);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('The published system connection is unavailable.');
    expect(document.body.textContent).not.toContain('SYNTHETIC-PRIVATE-IPC');
    await act(async()=>retryButton().click());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Start a conversation');
  });

  it('keeps a typed denial and draft, then reads status once without resending',async()=>{
    const denied={ok:false as const,error:{code:'runtime-conflict' as const,message:'Refresh the conversation before another turn.'}};
    const submit=vi.fn<SystemRuntimePreloadApi['submit']>().mockResolvedValue(denied);
    const read=vi.fn<SystemRuntimePreloadApi['read']>().mockResolvedValue({ok:true,value:readyView([])});
    await mount(<SystemRuntimeApp api={{read,submit}}/>);
    const textarea=document.querySelector('textarea')!;
    await act(async()=>setText(textarea,'A deliberate message'));
    await act(async()=>button('Send').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(denied.error.message);
    expect(textarea.value).toBe('A deliberate message');
    const pending=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['read']>>>();read.mockImplementationOnce(()=>pending.promise);
    await act(async()=>{const retry=retryButton();retry.click();retry.click();document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(read).toHaveBeenCalledTimes(2);expect(submit).toHaveBeenCalledTimes(1);
    await act(async()=>pending.resolve({ok:true,value:readyView([message('saved','assistant','Already saved reply')])}));
    expect(document.body.textContent).toContain('Already saved reply');expect(textarea.value).toBe('A deliberate message');expect(submit).toHaveBeenCalledTimes(1);
  });

  it('admits one combined form and Enter submission before busy rendering',async()=>{
    const pending=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['submit']>>>();const submit=vi.fn(()=>pending.promise);const api={read:async()=>({ok:true as const,value:readyView([])}),submit};
    await mount(<SystemRuntimeApp api={api}/>);const textarea=document.querySelector('textarea')!;
    await act(async()=>setText(textarea,'Single accepted turn'));
    await act(async()=>{document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));textarea.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
    expect(submit).toHaveBeenCalledTimes(1);expect(retryButtonOrNone()).toBeNull();
    await act(async()=>pending.resolve({ok:true,value:readyView([])}));
  });

  it('keeps old turn settlement from unlocking a new pending turn',async()=>{
    const old=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['submit']>>>(),next=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['submit']>>>();
    const first:SystemRuntimePreloadApi={read:async()=>({ok:true,value:readyView([])}),submit:()=>old.promise};const second:SystemRuntimePreloadApi={read:async()=>({ok:true,value:{...readyView([]),title:'New target'}}),submit:()=>next.promise};
    await mount(<SystemRuntimeApp api={first}/>);await act(async()=>setText(document.querySelector('textarea')!,'Old turn'));await act(async()=>button('Send').click());
    await act(async()=>root?.render(<SystemRuntimeApp api={second}/>));const textarea=document.querySelector('textarea')!;
    expect(textarea.value).toBe('');await act(async()=>setText(textarea,'New turn'));await act(async()=>button('Send').click());
    await act(async()=>old.resolve({ok:true,value:{...readyView([]),title:'Obsolete title'}}));
    expect(button('Sending...').disabled).toBe(true);expect(textarea.value).toBe('New turn');expect(document.querySelector('h1')?.textContent).toBe('New target');
    await act(async()=>next.resolve({ok:true,value:{...readyView([]),title:'New target'}}));expect(textarea.value).toBe('');expect(button('Send').disabled).toBe(true);
  });

  it('does not release replacement loading when an earlier read settles',async()=>{
    const old=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['read']>>>(),next=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['read']>>>();
    await mount(<SystemRuntimeApp api={{read:()=>old.promise,submit:vi.fn()}}/>);await act(async()=>root?.render(<SystemRuntimeApp api={{read:()=>next.promise,submit:vi.fn()}}/>));
    await act(async()=>old.resolve({ok:true,value:{...readyView([]),title:'Old target'}}));expect(document.body.textContent).toContain('Opening the system');expect(document.querySelector('textarea')!.disabled).toBe(true);expect(document.body.textContent).not.toContain('Old target');
    await act(async()=>next.resolve({ok:true,value:readyView([])}));expect(document.body.textContent).not.toContain('Opening the system');
  });

  it('dispatches one initial read during actual StrictMode replay',async()=>{
    const read=vi.fn<SystemRuntimePreloadApi['read']>().mockResolvedValue({ok:true,value:readyView([])});
    await mount(<StrictMode><SystemRuntimeApp api={{read,submit:vi.fn()}}/></StrictMode>);expect(read).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('Start a conversation');
  });

  it('preserves the committed turn when an API replacement render is abandoned',async()=>{
    const turn=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['submit']>>>(),suspended=deferred<void>();
    const first:SystemRuntimePreloadApi={read:async()=>({ok:true,value:readyView([])}),submit:()=>turn.promise};const read=vi.fn<SystemRuntimePreloadApi['read']>().mockResolvedValue({ok:true,value:{...readyView([]),title:'Not committed'}});const replacement:SystemRuntimePreloadApi={read,submit:vi.fn()};
    function Gate():never{throw suspended.promise;}
    function Tree({next}:{next:boolean}){return <Suspense fallback={<p>Waiting replacement</p>}><SystemRuntimeApp api={next?replacement:first}/>{next?<Gate/>:null}</Suspense>;}
    await mount(<Tree next={false}/>);await act(async()=>setText(document.querySelector('textarea')!,'Committed turn'));await act(async()=>button('Send').click());
    await act(async()=>startTransition(()=>root?.render(<Tree next/>)));expect(read).not.toHaveBeenCalled();expect(button('Sending...').disabled).toBe(true);
    await act(async()=>turn.resolve({ok:true,value:readyView([message('kept','assistant','Committed answer')])}));expect(document.body.textContent).toContain('Committed answer');expect(read).not.toHaveBeenCalled();
  });

  for(const operation of ['read','submit'] as const) it(`retires old ${operation} at layout before passive cleanup`,async()=>{
    const held=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['read']>>>();const first:SystemRuntimePreloadApi={read:operation==='read'?()=>held.promise:async()=>({ok:true,value:readyView([])}),submit:()=>held.promise};const next:SystemRuntimePreloadApi={read:async()=>({ok:true,value:{...readyView([]),title:'Current committed target'}}),submit:vi.fn()};
    await mount(<SystemRuntimeApp api={first}/>);
    if(operation==='submit'){await act(async()=>setText(document.querySelector('textarea')!,'Old turn'));await act(async()=>button('Send').click());}
    passivePhase.paused=true;await act(async()=>root?.render(<SystemRuntimeApp api={next}/>));
    await act(async()=>held.resolve({ok:true,value:{...readyView([]),title:'Retired content',messages:[message('old','assistant','Retired reply')]}}));
    expect(document.body.textContent).not.toContain('Retired');expect(document.body.textContent).toContain('Opening the system');
    await act(async()=>{passivePhase.paused=false;while(passivePhase.cleanups.length)passivePhase.cleanups.shift()!();while(passivePhase.setups.length)passivePhase.setups.shift()!();});
    expect(document.querySelector('h1')?.textContent).toBe('Current committed target');
  });

  it('refuses whitespace, over-limit and unavailable submissions through native forms',async()=>{
    const submit=vi.fn<SystemRuntimePreloadApi['submit']>();const api:SystemRuntimePreloadApi={read:async()=>({ok:true,value:readyView([])}),submit};await mount(<SystemRuntimeApp api={api}/>);const textarea=document.querySelector('textarea')!;
    for(const text of ['   ','x'.repeat(SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS+1)]){await act(async()=>setText(textarea,text));expect(button('Send').disabled).toBe(true);await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
    expect(submit).not.toHaveBeenCalled();const unavailable:SystemRuntimePreloadApi={read:async()=>({ok:true,value:{...readyView([]),state:'unavailable',canSubmit:false,statusMessage:'This system cannot accept messages.'}}),submit};await act(async()=>root?.render(<SystemRuntimeApp api={unavailable}/>));expect(document.querySelector('textarea')!.disabled).toBe(true);expect(document.body.textContent).toContain('cannot accept messages');await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(submit).not.toHaveBeenCalled();
  });

  it('renders returned transcript and status as inert text',async()=>{
    const markup='<img src=x onerror="globalThis.syntheticExecuted=true">';await mount(<SystemRuntimeApp api={{read:async()=>({ok:true,value:{...readyView([message('inert','assistant',markup)]),statusMessage:markup,title:markup}}),submit:vi.fn()}}/>);expect(document.querySelector('img')).toBeNull();expect(document.querySelector('[role="log"]')?.textContent).toContain(markup);expect(document.querySelector('h1')?.textContent).toBe(markup);expect(document.querySelectorAll('[role="status"]')[0]?.textContent).toBe(markup);
  });

  it('fails closed with useful guidance when its dedicated bridge is absent',async()=>{
    vi.stubGlobal('systemRuntime',undefined);await mount(<SystemRuntimeApp/>);expect(document.querySelector('[role="alert"]')?.textContent).toContain('start the system from Publish again');expect(button('Send').disabled).toBe(true);expect(retryButtonOrNone()).toBeNull();
  });
});
function retryButtonOrNone(){return Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Retry connection')??null;}
function retryButton(){return button('Retry connection');}

describe('queued conversation edits',()=>{
  for(const operation of ['turn','read'] as const) it(`keeps the accepted draft when input arrives during ${operation} admission`,async()=>{
    const held=deferred<Awaited<ReturnType<SystemRuntimePreloadApi['read']>>>();const read=vi.fn<SystemRuntimePreloadApi['read']>().mockResolvedValueOnce({ok:true,value:readyView([])}).mockImplementation(()=>held.promise);const submit=vi.fn<SystemRuntimePreloadApi['submit']>().mockImplementation(()=>operation==='turn'?held.promise:Promise.resolve({ok:false,error:{code:'runtime-conflict',message:'Read the current conversation.'}}));
    await mount(<SystemRuntimeApp api={{read,submit}}/>);const textarea=document.querySelector('textarea')!;await act(async()=>setText(textarea,'Accepted draft'));
    if(operation==='read')await act(async()=>button('Send').click());
    await act(async()=>{if(operation==='turn')button('Send').click();else retryButton().click();setText(textarea,'Queued edit while locked');});
    expect(textarea.value).toBe('Accepted draft');
    if(operation==='turn')expect(submit).toHaveBeenCalledWith(expect.objectContaining({text:'Accepted draft'}));
    await act(async()=>held.resolve({ok:true,value:readyView([])}));
    expect(textarea.value).toBe(operation==='turn'?'':'Accepted draft');
  });
});

it('does not dispatch an initial read retired before its first promise turn',async()=>{
  const read=vi.fn<SystemRuntimePreloadApi['read']>().mockResolvedValue({ok:true,value:readyView([])});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  act(()=>root?.render(<SystemRuntimeApp api={{read,submit:vi.fn()}}/>));
  act(()=>root?.unmount());root=undefined;
  await act(async()=>{await Promise.resolve();});
  expect(read).not.toHaveBeenCalled();
  expect(container.textContent).toBe('');
});
