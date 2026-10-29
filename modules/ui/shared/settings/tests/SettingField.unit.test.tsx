import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {SettingField} from "../SettingField";
import type {ApplicationSettingDefinition,ApplicationSettingValue} from "../../../../contracts/settings";

let root:Root|undefined,container:HTMLDivElement|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();root=undefined;container=undefined;});
async function render(definition:ApplicationSettingDefinition,value?:ApplicationSettingValue){
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
  const onSave=vi.fn(async()=>true),onClear=vi.fn(async()=>true);
  await act(async()=>root!.render(<SettingField definition={definition} value={value} onSave={onSave} onClear={onClear}/>));
  return {onSave,onClear};
}
const definitions:ApplicationSettingDefinition[]=[
  {key:"huggingface.defaultNamespace",category:"huggingface",label:"Namespace",valueKind:"string"},
  {key:"runtime.python.defaultDevice",category:"runtime",label:"Device",valueKind:"select",options:[{value:"cpu"}]},
  {key:"runtime.enabled",category:"runtime",label:"Enabled",valueKind:"boolean"},
  {key:"huggingface.token",category:"huggingface",label:"Provider token",valueKind:"secret",sensitive:true},
  {key:"models.sharedStorageDirectory",category:"models",label:"Model folder",valueKind:"folder"},
  {key:"models.default",category:"models",label:"Default model",valueKind:"object"},
  {key:"runtime.limit",category:"runtime",label:"Limit",valueKind:"number"},
];
it.each(definitions)("binds $valueKind field labels to controls and keeps interactive help outside labels",async definition=>{
  const value=definition.valueKind==="object"?{provider:"transformers",modelId:"synthetic/model",inferenceMode:"chat"}:
    definition.valueKind==="boolean"?true:definition.valueKind==="secret"?undefined:definition.valueKind==="number"?42:"cpu";
  await render(definition,{key:definition.key,configured:true,value,maskedValue:definition.valueKind==="secret"?"********":undefined});
  const labels=[...container!.querySelectorAll("label")];expect(labels.length).toBeGreaterThan(0);
  for(const label of labels){expect(label.control?.tagName).toMatch(/^(INPUT|SELECT)$/);expect(label.querySelector("button")).toBeNull();}
  expect(container!.querySelectorAll(".ui-glossary-hint__button").length).toBeGreaterThan(0);
  const hint=container!.querySelector<HTMLButtonElement>(".ui-glossary-hint__button")!;
  await act(async()=>hint.click());expect(hint.getAttribute("aria-expanded")).toBe("true");
  await act(async()=>hint.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(hint.getAttribute("aria-expanded")).toBe("false");
  if(definition.valueKind==="secret"){const input=container!.querySelector<HTMLInputElement>('input[type="password"]');expect(input?.value).toBe("");expect(container!.textContent).not.toContain("synthetic/model");}
});
it("does not turn an empty numeric draft into an unintended zero",async()=>{
  const definition=definitions.find(d=>d.valueKind==="number")!;
  const {onSave}=await render(definition,{key:definition.key,configured:false});
  const save=container!.querySelector<HTMLButtonElement>(`[data-testid="setting-${definition.key}-save"]`)!;
  expect(save.disabled).toBe(true);await act(async()=>save.click());expect(onSave).not.toHaveBeenCalled();
  const input=container!.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"3");input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(save.disabled).toBe(false);await act(async()=>save.click());expect(onSave).toHaveBeenCalledWith(3);
});
it.each(definitions.filter(d=>["select","boolean","object"].includes(d.valueKind)))("retains existing Thin Clear capability for $valueKind fields",async definition=>{
  const {onClear}=await render(definition,{key:definition.key,configured:true,value:definition.valueKind==="boolean"?true:definition.valueKind==="object"?{provider:"transformers",modelId:"synthetic/model",inferenceMode:"chat"}:"cpu"});
  const clear=[...container!.querySelectorAll("button")].find(button=>button.textContent?.trim()==="Clear");expect(clear).toBeDefined();await act(async()=>clear!.click());expect(onClear).toHaveBeenCalledTimes(1);
});
