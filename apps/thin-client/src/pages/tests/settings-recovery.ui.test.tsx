import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {SettingsPage} from "../SettingsPage";
import type {ApplicationSettingsApiClient} from "../../features/settings/api/apiApplicationSettingsClient";
import {NotificationTestHarness,readNotificationMessages} from "../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";

const key="huggingface.defaultNamespace",privateText="synthetic-private-settings-error";
let client:ReturnType<typeof fakeClient>,root:Root|undefined,container:HTMLDivElement|undefined;
let previousAct:PropertyDescriptor|undefined,actOwned=false;
vi.mock("../../features/settings/api/apiApplicationSettingsClient",async original=>({...await original<typeof import("../../features/settings/api/apiApplicationSettingsClient")>(),createApiApplicationSettingsClient:()=>client}));
vi.mock("../../features/page-dashboard/ThinClientPageDashboard",()=>({ThinClientPageDashboard:()=>null}));
function held<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function rows(value:string){return{values:[{key,configured:true,value}]};}
function fakeClient(initial="original"){
  let value=initial,configured=true;
  return{
    listDefinitions:vi.fn<ApplicationSettingsApiClient["listDefinitions"]>(async()=>({definitions:[{key,category:"huggingface" as const,label:"Namespace",valueKind:"string" as const}]})),
    readSettings:vi.fn<ApplicationSettingsApiClient["readSettings"]>(async()=>({values:[{key,configured,value:configured?value:undefined}]})),
    updateSetting:vi.fn<ApplicationSettingsApiClient["updateSetting"]>(async input=>{value=String(input.value);configured=true;return{value:{key:input.key,configured:true,value}};}),
    clearSetting:vi.fn<ApplicationSettingsApiClient["clearSetting"]>(async input=>{configured=false;return{value:{key:input.key,configured:false}};}),
    restartServer:vi.fn(async()=>({restartRequested:true})),
  } satisfies ApplicationSettingsApiClient;
}
beforeEach(()=>{client=fakeClient();});
afterEach(async()=>{
  try{if(root)await act(async()=>root!.unmount());}
  finally{container?.remove();root=undefined;container=undefined;vi.restoreAllMocks();if(actOwned){if(previousAct)Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",previousAct);else Reflect.deleteProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT");actOwned=false;}}
});
async function mount(strict=false){
  previousAct=Object.getOwnPropertyDescriptor(globalThis,"IS_REACT_ACT_ENVIRONMENT");actOwned=true;Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,writable:true,value:true});
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
  const page=<NotificationTestHarness><SettingsPage/></NotificationTestHarness>;
  await act(async()=>root!.render(strict?<StrictMode>{page}</StrictMode>:page));
}
const messages=()=>readNotificationMessages(container!);
const input=()=>container!.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not([type="password"])')!;
function button(name:string){const result=[...container!.querySelectorAll("button")].find(b=>b.textContent?.trim()===name);expect(result,`Expected ${name} control`).toBeDefined();return result!;}
async function change(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input(),value);input().dispatchEvent(new Event("input",{bubbles:true}));input().dispatchEvent(new Event("change",{bubbles:true}));});}

it("saves and clears through the supported client and displays confirmed readback",async()=>{
  await mount();expect(input().value).toBe("original");await change("new-team");await act(async()=>button("Save").click());
  expect(client.updateSetting).toHaveBeenCalledWith({key,value:"new-team"});expect(input().value).toBe("new-team");expect(messages()).toContain("Setting saved.");
  await act(async()=>button("Clear").click());expect(client.clearSetting).toHaveBeenCalledWith({key});expect(input().value).toBe("");expect(button("Clear").disabled).toBe(true);
});
it("does not report a successful save after failed readback and requires explicit refresh before another mutation",async()=>{
  await mount();await change("new-team");client.readSettings.mockRejectedValueOnce(new Error(privateText));await act(async()=>button("Save").click());
  expect(messages()).not.toContain("Setting saved.");expect(messages().some(m=>m.includes("reload")||m.includes("Refresh"))).toBe(true);
  expect(messages().join(" ")).not.toContain(privateText);expect(button("Save").disabled).toBe(true);expect(button("Clear").disabled).toBe(true);
  await act(async()=>button("Refresh settings").click());expect(input().value).toBe("new-team");expect(button("Save").disabled).toBe(false);
});
it("retains a refused write draft and sends only a fixed safe failure to the real notification center",async()=>{
  await mount();await change("retry-team");client.updateSetting.mockRejectedValueOnce(new Error(privateText));await act(async()=>button("Save").click());
  expect(input().value).toBe("retry-team");expect(messages().join(" ")).not.toContain(privateText);expect(messages().some(m=>m.includes("save")&&m.includes("Try again"))).toBe(true);
  await act(async()=>button("Save").click());expect(client.updateSetting).toHaveBeenCalledTimes(2);expect(input().value).toBe("retry-team");
});
it("recovers an initial read failure by an explicit refresh instead of a false empty successful view",async()=>{
  client.readSettings.mockRejectedValueOnce(new Error(privateText));await mount();expect(container!.textContent).not.toContain("Loading settings");
  expect(messages().join(" ")).not.toContain(privateText);await act(async()=>button("Refresh settings").click());expect(input().value).toBe("original");
});
it("keeps the newer StrictMode read when the first request resolves later",async()=>{
  const old=held<ReturnType<typeof rows>>();client.readSettings.mockImplementationOnce(()=>old.promise).mockResolvedValueOnce(rows("newer"));
  await mount(true);expect(client.readSettings).toHaveBeenCalledTimes(2);expect(input().value).toBe("newer");await act(async()=>old.resolve(rows("stale")));expect(input().value).toBe("newer");
});
it("serializes restart against settings writes and reports only an acknowledged request",async()=>{
  await mount();const pending=held<{restartRequested:boolean}>();client.restartServer.mockReturnValueOnce(pending.promise);
  await act(async()=>button("Restart server").click());expect(button("Save").disabled).toBe(true);expect(button("Clear").disabled).toBe(true);
  await act(async()=>button("Save").click());expect(client.updateSetting).not.toHaveBeenCalled();
  await act(async()=>pending.resolve({restartRequested:true}));expect(messages()).toContain("Server restart requested.");expect(messages().some(m=>/server restarted/i.test(m))).toBe(false);
  expect(button("Save").disabled).toBe(true);expect(button("Restart server").disabled).toBe(true);
  await act(async()=>button("Refresh settings").click());expect(button("Save").disabled).toBe(false);
});
it("denies an unconfirmed restart acknowledgement and retains explicit retry",async()=>{
  client.restartServer.mockResolvedValueOnce({restartRequested:false});await mount();await act(async()=>button("Restart server").click());
  expect(messages()).not.toContain("Server restart requested.");expect(messages().some(m=>m.includes("restart")&&m.includes("Try again"))).toBe(true);
  await act(async()=>button("Restart server").click());expect(client.restartServer).toHaveBeenCalledTimes(2);expect(messages()).toContain("Server restart requested.");
});
it.each([[401,"security.expired-token","This device is not paired with the server. Pair this device to continue."],
  [403,"security.forbidden","This paired device does not have permission for this action."]] as const)("keeps safe guidance for HTTP%s",async(status,code,guidance)=>{
  client.readSettings.mockRejectedValueOnce(Object.assign(new Error(privateText),{status,code}));await mount();
  expect(messages()).toContain(guidance);expect(messages().join(" ")).not.toContain(privateText);expect(button("Restart server").disabled).toBe(true);
});
it("admits only one write and excludes clear and restart before React disables controls",async()=>{
  await mount();await change("one-write");const pending=held<void>(),write=client.updateSetting.getMockImplementation()!;
  client.updateSetting.mockImplementationOnce(async input=>{await pending.promise;return write(input);});
  await act(async()=>{button("Save").click();button("Save").click();button("Clear").click();button("Restart server").click();});
  expect(client.updateSetting).toHaveBeenCalledTimes(1);expect(client.clearSetting).not.toHaveBeenCalled();expect(client.restartServer).not.toHaveBeenCalled();
  await act(async()=>pending.resolve());expect(input().value).toBe("one-write");
});
it("does not read again or publish a late write from an unmounted view",async()=>{
  await mount();const old=client,pending=held<void>(),write=old.updateSetting.getMockImplementation()!;
  old.updateSetting.mockImplementationOnce(async command=>{await pending.promise;return write(command);});
  await change("old-write");await act(async()=>button("Save").click());client=fakeClient("current-view");
  await act(async()=>root!.render(<NotificationTestHarness><SettingsPage key="next-view"/></NotificationTestHarness>));
  expect(input().value).toBe("current-view");await act(async()=>pending.resolve());
  expect(old.readSettings).toHaveBeenCalledTimes(1);expect(input().value).toBe("current-view");expect(messages()).not.toContain("Setting saved.");
});
const tokenKey="huggingface.token",tokenDefinition={key:tokenKey,category:"huggingface" as const,label:"Provider token",valueKind:"secret" as const,sensitive:true};
async function typeSecret(value:string){const element=container!.querySelector<HTMLInputElement>('input[type="password"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));element.dispatchEvent(new Event("change",{bubbles:true}));});return element;}
it.each(["missing","foreign","unconfigured","changed-kind"] as const)("retains a submitted secret and refuses success for %s readback",async mode=>{
  client.listDefinitions.mockResolvedValue({definitions:[tokenDefinition]});client.readSettings.mockResolvedValueOnce({values:[{key:tokenKey,configured:false,masked:false}]});
  client.updateSetting.mockResolvedValueOnce({value:{key:tokenKey,configured:true,masked:true,maskedValue:"********"}});
  await mount();const secret=await typeSecret("synthetic-submitted-secret");
  if(mode==="changed-kind")client.listDefinitions.mockResolvedValueOnce({definitions:[{...tokenDefinition,valueKind:"string",sensitive:false}]});
  client.readSettings.mockResolvedValueOnce({values:mode==="missing"?[]:mode==="foreign"?[{key,configured:true,value:"foreign"}]:mode==="changed-kind"?[{key:tokenKey,configured:true,value:"synthetic-private-value"}]:[{key:tokenKey,configured:false,masked:false}]});
  await act(async()=>button("Save secret").click());expect(secret.value).toBe("synthetic-submitted-secret");expect(messages()).not.toContain("Setting saved.");
  expect(messages().some(m=>m.includes("reload"))).toBe(true);expect(button("Save secret").disabled).toBe(true);expect(messages().join(" ")).not.toContain("synthetic-private-value");
});
it("retains the secret draft and refuses Clear success while readback remains configured",async()=>{
  client.listDefinitions.mockResolvedValue({definitions:[tokenDefinition]});client.readSettings.mockResolvedValue({values:[{key:tokenKey,configured:true,masked:true,maskedValue:"********"}]});
  await mount();const secret=await typeSecret("synthetic-keep-draft");await act(async()=>button("Clear").click());
  expect(secret.value).toBe("synthetic-keep-draft");expect(messages()).not.toContain("Setting cleared.");expect(messages().some(m=>m.includes("reload"))).toBe(true);
});
it("keeps malformed model objects outside render and recovers after an explicit valid read",async()=>{
  client.listDefinitions.mockResolvedValue({definitions:[{key:"models.default",category:"models",label:"Model default",valueKind:"object"}]});
  client.readSettings.mockResolvedValueOnce({values:[{key:"models.default",configured:true,value:{modelId:{privateText},inferenceMode:"chat"}}]});
  await mount();expect(messages().some(m=>m.includes("load settings"))).toBe(true);expect(messages().join(" ")).not.toContain(privateText);
  client.readSettings.mockResolvedValueOnce({values:[{key:"models.default",configured:true,value:{modelId:"synthetic/model",inferenceMode:"chat"}}]});
  await act(async()=>button("Refresh settings").click());expect(container!.querySelector<HTMLInputElement>('[data-testid="model-default-model-id"]')?.value).toBe("synthetic/model");
});

it.each([false,true])("confirms canonical Save readback before success (matches=%s)",async matches=>{
  await mount();await change("submitted-team");const pending=held<ReturnType<typeof rows>>();
  client.updateSetting.mockResolvedValueOnce({value:{key,configured:true,value:"canonical-team"}});client.readSettings.mockReturnValueOnce(pending.promise);
  await act(async()=>button("Save").click());expect(messages()).not.toContain("Setting saved.");expect(button("Save").disabled).toBe(true);
  await act(async()=>pending.resolve(rows(matches?"canonical-team":"original")));
  if(matches){expect(messages()).toContain("Setting saved.");expect(input().value).toBe("canonical-team");}
  else{expect(messages()).not.toContain("Setting saved.");expect(input().value).toBe("submitted-team");expect(button("Save").disabled).toBe(true);expect(messages().some(m=>m.includes("reload"))).toBe(true);}
});
it.each([false,true])("confirms the canonical default returned after Clear (matches=%s)",async matches=>{
  await mount();await change("keep-draft");const pending=held<Awaited<ReturnType<ApplicationSettingsApiClient["readSettings"]>>>();
  client.clearSetting.mockResolvedValueOnce({value:{key,configured:false,value:"default-team"}});client.readSettings.mockReturnValueOnce(pending.promise);
  await act(async()=>button("Clear").click());expect(messages()).not.toContain("Setting cleared.");
  await act(async()=>pending.resolve({values:[{key,configured:false,value:matches?"default-team":"wrong-default"}]}));
  if(matches){expect(messages()).toContain("Setting cleared.");expect(input().value).toBe("default-team");expect(button("Clear").disabled).toBe(true);}
  else{expect(messages()).not.toContain("Setting cleared.");expect(input().value).toBe("keep-draft");expect(button("Save").disabled).toBe(true);}
});
it.each([false,true])("confirms projected partial canonical model defaults (matches=%s)",async matches=>{
  const modelKey="models.default",value={modelId:"synthetic/model",inferenceMode:"chat"};
  client.listDefinitions.mockResolvedValue({definitions:[{key:modelKey,category:"models",label:"Model default",valueKind:"object"}]});
  client.readSettings.mockResolvedValueOnce({values:[{key:modelKey,configured:true,value:{modelId:"synthetic/old",inferenceMode:"auto"}}]});
  await mount();client.updateSetting.mockResolvedValueOnce({value:{key:modelKey,configured:true,value}});
  client.readSettings.mockResolvedValueOnce({values:[{key:modelKey,configured:true,value:{provider:"transformers",inferenceMode:"chat",modelId:matches?"synthetic/model":"synthetic/old",ignoredMetadata:"not consumed"}}]});
  await act(async()=>button("Save model default").click());expect(messages().includes("Setting saved.")).toBe(matches);
  if(matches)expect(container!.querySelector<HTMLInputElement>('[data-testid="model-default-model-id"]')?.value).toBe("synthetic/model");
  else expect(button("Save model default").disabled).toBe(true);
});
it("confirms secret state without comparing or displaying a submitted secret",async()=>{
  client.listDefinitions.mockResolvedValue({definitions:[tokenDefinition]});client.readSettings.mockResolvedValueOnce({values:[{key:tokenKey,configured:false,masked:false}]});
  await mount();const secret=await typeSecret("synthetic-secret-positive");client.updateSetting.mockResolvedValueOnce({value:{key:tokenKey,configured:true,masked:true,maskedValue:"********"}});
  client.readSettings.mockResolvedValueOnce({values:[{key:tokenKey,configured:true,masked:true,maskedValue:"********"}]});
  await act(async()=>button("Save secret").click());expect(messages()).toContain("Setting saved.");expect(secret.value).toBe("");expect(messages().join(" ")).not.toContain("synthetic-secret-positive");
});
