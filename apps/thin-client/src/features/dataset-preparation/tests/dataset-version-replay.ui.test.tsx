// @vitest-environment jsdom
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import { useDatasetVersionReplayHandoff } from "../../../../../../modules/ui/shared/dataset-version/useDatasetVersionReplayHandoff";
import { NotificationProvider } from "../../../../../../modules/ui/shared/notifications/NotificationProvider";
import { fixture } from "./datasetVersionReplayFixture";
import { DATASET_PREPARATION_TASK_OPTIONS } from "../../../../../../modules/ui/shared";
import { createDefaultDatasetPreparationVisualOutputShape } from "../../../../../../modules/contracts/runtime";
import { validateDatasetVersionReplay } from "../../../../../../modules/ui/shared/dataset-version/datasetVersionReplay";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root:Root|undefined,container:HTMLDivElement;
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();root=undefined;localStorage.clear();vi.restoreAllMocks();});
function setup(f=fixture(),options:{rows?:any[];read?:any;workspace?:string}={}){
 const browser={browseArtifacts:vi.fn(async()=>options.rows??[f.source]),readArtifactDetail:options.read??vi.fn(async({storageKey}:any)=>({locator:{storageKey},originalName:f.source.originalName,mediaType:f.source.mediaType}))};
 const preparation={start:vi.fn(async()=>({requestId:"task-1"})),read:vi.fn(async()=>({requestId:"task-1",status:"cancelled"})),cancel:vi.fn()};
 function Harness({workspace=options.workspace??"workspace-a",client=browser}:{workspace?:string;client?:any}){
  const [active,setActive]=useState(true),[ack,setAck]=useState<string>("");
  const h=useDatasetVersionReplayHandoff(workspace,active,()=>setActive(true));
  return <NotificationProvider><button onClick={()=>void h.enqueue(f.reproduction,f.selection).then(value=>setAck(String(value)))}>Restore</button><button onClick={()=>setActive(false)}>Leave</button><output data-ack>{ack}</output>{active&&<DatasetPreparationFeature workspaceId={workspace} artifactClient={client as any} preparationClient={preparation as any} replayHandoff={h}/>}</NotificationProvider>;
 }
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
 return {browser,preparation,Harness};
}
async function click(label:string){await act(async()=>{const b=[...container.querySelectorAll<HTMLButtonElement>("button")].find(x=>x.textContent===label);if(!b)throw new Error(`Missing ${label}`);b.click();});}
async function change(input:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));});}
it("restores represented saved settings together and starts only after explicit user action",async()=>{
 const {Harness,browser,preparation}=setup();await act(async()=>root!.render(<Harness/>));await click("Restore");
 expect(container.querySelector("[data-ack]")?.textContent).toBe("true");
 expect(browser.readArtifactDetail).toHaveBeenCalledExactlyOnceWith({storageKey:"uploads/source.csv"},{workspaceId:"workspace-a"});
 expect(preparation.start).not.toHaveBeenCalled();
 await click("Run checks and prepare");
 expect(preparation.start).toHaveBeenCalledTimes(1);
 const command=preparation.start.mock.calls[0][0].command;
 expect(command.sourceArtifactIds).toEqual(["uploads/source.csv"]);expect(command.split).toEqual({trainRatio:0.6,validationRatio:0.3,testRatio:0.1,shuffle:true});
 expect(command.output).toEqual({format:"jsonl",naming:{baseName:"Saved setup"},destinations:{local:{enabled:true}}});
 expect(command.quality.policy).toMatchObject({preset:"strict",requireLicenseMetadata:true,requireConsentMetadata:true,includeSourceAttribution:true});
});
it("resolves an exact saved source absent from the capped browse page",async()=>{
 const {Harness,preparation}=setup(fixture(),{rows:Array.from({length:250},(_,i)=>({artifactId:`uploads/${i}.csv`,storageKey:`uploads/${i}.csv`,originalName:`${i}.csv`,mediaType:"text/csv"}))});
 await act(async()=>root!.render(<Harness/>));await click("Restore");expect(container.querySelector("[data-ack]")?.textContent).toBe("true");expect(preparation.start).not.toHaveBeenCalled();
 expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some(x=>x.checked)).toBe(true);
});
it.each(DATASET_PREPARATION_TASK_OPTIONS.map(option=>option.taskType))("restores the represented %s training goal from fresh settings",async task=>{
 const f=fixture(task);const {Harness,preparation}=setup(f);await act(async()=>root!.render(<Harness/>));await click("Restore");
 expect(container.querySelector("[data-ack]")?.textContent).toBe("true");expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe(task);expect(preparation.start).not.toHaveBeenCalled();
 await click("Run checks and prepare");expect(preparation.start).toHaveBeenCalledTimes(1);
 const command=preparation.start.mock.calls[0][0].command;
 const context={...f.selection,requestedVersionId:f.version.versionId,sources:{status:"ready" as const,workspaceId:"workspace-a",items:[{artifactId:f.source.artifactId,storageKey:f.source.storageKey,label:f.source.originalName,mediaType:f.source.mediaType}]}};
 const rebuilt={versionId:f.version.versionId,sourceArtifactIds:command.sourceArtifactIds,lineage:f.version.lineage,recipeSnapshot:{recipe:command.recipe,preparation:command.preparation,advanced:command.advanced,split:command.split,output:{format:command.output.format,naming:command.output.naming},effectiveQualityPolicy:command.quality.policy}};
 expect(validateDatasetVersionReplay(JSON.parse(JSON.stringify(rebuilt)),context)).toEqual(validateDatasetVersionReplay(f.reproduction,context));
});
it("restores supported generation and custom prompt without running a model",async()=>{
 const f=fixture("llm-instruction","pdf");f.snapshot.recipe.generation.promptTemplate="Use the source carefully: {context}";
 const {Harness,preparation}=setup(f);await act(async()=>root!.render(<Harness/>));await click("Restore");
 expect(container.querySelector("[data-ack]")?.textContent).toBe("true");expect(preparation.start).not.toHaveBeenCalled();
 await click("Run checks and prepare");expect(preparation.start).toHaveBeenCalledTimes(1);
 expect(preparation.start.mock.calls[0][0].command.recipe.generation).toMatchObject({promptTemplate:"Use the source carefully: {context}",model:{modelId:"fixture/synthetic-model",device:"cpu",torchDtype:"float32"}});
});
it("keeps an explicit saved classification layout after all form effects and explicit Start",async()=>{
 const f=fixture("llm-classification","pdf");f.snapshot.recipe.task.multiLabel=true;
 const singleLabelShape=createDefaultDatasetPreparationVisualOutputShape("llm-classification",{multiLabel:false});
 f.snapshot.recipe.generation.structuredOutput={visualShape:singleLabelShape,constrainedDecoding:false};
 const {Harness,preparation}=setup(f);await act(async()=>root!.render(<Harness/>));await click("Restore");
 expect(container.querySelector("[data-ack]")?.textContent).toBe("true");
 await click("Run checks and prepare");expect(preparation.start).toHaveBeenCalledTimes(1);
 expect(preparation.start.mock.calls[0][0].command.recipe.generation.structuredOutput.visualShape).toEqual(singleLabelShape);
});
it("keeps normal classification layout adaptation for later user edits",async()=>{
 const f=fixture("llm-classification","pdf");f.snapshot.recipe.task.multiLabel=false;
 f.snapshot.recipe.generation.structuredOutput={visualShape:createDefaultDatasetPreparationVisualOutputShape("llm-classification",{multiLabel:false}),constrainedDecoding:false};
 const {Harness,preparation}=setup(f);await act(async()=>root!.render(<Harness/>));await click("Restore");
 expect(container.querySelector("[data-ack]")?.textContent).toBe("true");
 await act(async()=>{const label=[...container.querySelectorAll("label")].find(x=>x.textContent?.includes("Allow more than one label per example"))!;label.querySelector<HTMLInputElement>("input")!.click();});
 await click("Run checks and prepare");expect(preparation.start).toHaveBeenCalledTimes(1);
 expect(preparation.start.mock.calls[0][0].command.recipe.generation.structuredOutput.visualShape).toEqual(createDefaultDatasetPreparationVisualOutputShape("llm-classification",{multiLabel:true}));
});
it("caller mutation during lookup cannot change the captured recipe",async()=>{
 const f=fixture();let finish!:(value:any)=>void;const read=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));const {Harness,preparation}=setup(f,{read});
 await act(async()=>root!.render(<Harness/>));await click("Restore");f.snapshot.split.trainRatio=0.1;f.snapshot.output.naming.baseName="mutated";
 await act(async()=>finish({locator:{storageKey:f.source.storageKey},originalName:f.source.originalName,mediaType:f.source.mediaType}));
 expect(container.querySelector("[data-ack]")?.textContent).toBe("true");await click("Run checks and prepare");expect(preparation.start.mock.calls[0][0].command).toMatchObject({split:{trainRatio:0.6},output:{naming:{baseName:"Saved setup"}}});
});
it("an explicit task start retires a pending restore before its reply",async()=>{
 const f=fixture();let finish!:(value:any)=>void;const read=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));const {Harness,preparation}=setup(f,{read});
 await act(async()=>root!.render(<Harness/>));await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 await click("Restore");await click("Run checks and prepare");expect(preparation.start).toHaveBeenCalledTimes(1);
 await act(async()=>finish({locator:{storageKey:f.source.storageKey},originalName:f.source.originalName,mediaType:f.source.mediaType}));
 expect(container.querySelector("[data-ack]")?.textContent).toBe("false");expect(preparation.start.mock.calls[0][0].command.output.naming.baseName).toBeUndefined();
});
it.each(["seed","shuffle","csv-output","strict-normalization","chunk-boundary","batch"])("rejects unsupported %s without replacing current fields",async variant=>{
 const f=fixture("llm-instruction",variant==="strict-normalization"||variant==="chunk-boundary"||variant==="batch"?"pdf":"csv");
 if(variant==="seed")f.snapshot.split.seed=12;if(variant==="shuffle")f.snapshot.split.shuffle=false;if(variant==="csv-output")f.snapshot.output.format="csv";
 if(variant==="strict-normalization")f.snapshot.recipe.normalization.normalizationMode="strict";
 if(variant==="chunk-boundary")f.snapshot.recipe.chunking.preserveDocumentBoundaries=false;
 if(variant==="batch")f.snapshot.recipe.generation.batchSize=2;
 const {Harness,preparation}=setup(f);await act(async()=>root!.render(<Harness/>));
 const goal=container.querySelector<HTMLSelectElement>("select")!;await change(goal,"llm-extraction");
 await click("Restore");expect(container.querySelector("[data-ack]")?.textContent).toBe("false");expect(goal.value).toBe("llm-extraction");expect(preparation.start).not.toHaveBeenCalled();
});
it("preserves unsupported observed duplicates rather than hiding them with source filtering",async()=>{
 const f=fixture();const read=vi.fn();const {Harness}=setup(f,{rows:[f.source,{...f.source,originalName:"unsupported.exe",mediaType:"application/octet-stream"}],read});
 await act(async()=>root!.render(<Harness/>));await click("Restore");expect(container.querySelector("[data-ack]")?.textContent).toBe("false");expect(read).not.toHaveBeenCalled();
});
it.each(["edit","leave","workspace","client","unmount"])("does not apply a deferred lookup after %s",async variant=>{
 const f=fixture();let finish!:(value:any)=>void;const read=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));const {Harness,browser,preparation}=setup(f,{read});
 await act(async()=>root!.render(<Harness/>));await click("Restore");expect(container.querySelector("[data-ack]")?.textContent).toBe("");
 if(variant==="edit")await change(container.querySelector<HTMLSelectElement>("select")!,"llm-extraction");
 if(variant==="leave")await click("Leave");
 if(variant==="workspace")await act(async()=>root!.render(<Harness workspace="workspace-b"/>));
 if(variant==="client")await act(async()=>root!.render(<Harness client={{...browser,browseArtifacts:vi.fn(async()=>[])}}/>));
 if(variant==="unmount"){await act(async()=>root!.unmount());root=undefined;}
 await act(async()=>{finish({locator:{storageKey:f.source.storageKey},originalName:f.source.originalName,mediaType:f.source.mediaType});});
 expect(container.querySelector("[data-ack]")?.textContent).not.toBe("true");expect(preparation.start).not.toHaveBeenCalled();
});
