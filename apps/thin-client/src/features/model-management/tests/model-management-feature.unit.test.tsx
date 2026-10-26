// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationTestHarness, readNotificationMessages } from '../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness';
import { ModelManagementFeature } from '../components/ModelManagementFeature';
import { createApiModelManagementClient, type ModelManagementApiClient } from '../api/apiModelManagementClient';
import type { ModelInventoryRecord } from '../../../../../../modules/contracts/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ModelManagementFeature',()=>{
 let root:Root|undefined; let container:HTMLDivElement|undefined;
 afterEach(async()=>{ if(root){ await act(async()=>{root?.unmount();}); } container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

 function button(label:string, parent:ParentNode=container!) { const found=[...parent.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent?.trim()===label); expect(found).toBeTruthy(); return found!; }
 async function search() { const input=container!.querySelector('input')!; await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'support');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>button('Browse models').click()); }
 const support={modelId:'example/support',displayName:'Support assistant',provider:'huggingface' as const};
 function fixtureClient(overrides:Partial<ModelManagementApiClient>={}) {
   const unused=vi.fn(async():Promise<never>=>{throw new Error('Unused synthetic operation');});
   const client:ModelManagementApiClient={listModels:vi.fn(async()=>({models:[]})),browseModels:vi.fn(async()=>({models:[support]})),getModelDetails:vi.fn(async()=>({model:support})),listModelFiles:unused,saveModelReference:unused,downloadModel:unused,deleteModelRecord:unused,updateModelRecord:unused,validateModel:unused,publishModel:unused,...overrides};return client;
 }
 async function renderFeature(client:ModelManagementApiClient) {container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await act(async()=>root!.render(<NotificationTestHarness><ModelManagementFeature client={client} workspaceId="workspace-a"/></NotificationTestHarness>));}

 it('keeps real API failure content out of rendered diagnostics and notifications',async()=>{
   const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
   vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>({status:String(url).endsWith('/model/list')?200:400,headers:{get:()=> 'application/json'},json:async()=>String(url).endsWith('/model/list')?{ok:true,value:{models:[]}}:{ok:false,error:{message:'private-api-provider-payload',code:'private-api-provider-code',details:{secret:'private-api-provider-detail'}}}})));
   await renderFeature(createApiModelManagementClient());await search();
   expect(readNotificationMessages(container!)).toEqual(expect.arrayContaining([expect.stringContaining('Unable to browse models')]));
   expect(container!.textContent).not.toContain('private-api-provider');
   expect(JSON.stringify(warn.mock.calls)).not.toContain('private-api-provider');
 });

 it('finds a support model, saves it, downloads it, inspects its files and deletes only its record',async()=>{
   let models:(ModelInventoryRecord&{localFilesAvailable?:boolean})[]=[];
   const saved:ModelInventoryRecord={...support,modelRecordId:'support-record',source:'huggingface',artifactForm:'full-model',lifecycleStatus:'saved-reference',createdAt:'2026-01-01'};
   const client=fixtureClient({listModels:vi.fn(async()=>({models})),saveModelReference:vi.fn(async()=>{models=[saved];return{model:saved};}),downloadModel:vi.fn<ModelManagementApiClient['downloadModel']>(async()=>{const model={...saved,lifecycleStatus:'downloaded' as const,localFilesAvailable:true};models=[model];return{model,download:{provider:'transformers',modelId:support.modelId,downloaded:true,fromCache:false,localPath:'synthetic-unused'}};}),listModelFiles:vi.fn(async input=>({modelRecordId:input.modelRecordId,files:[{relativePath:'config.json',sizeBytes:42}],truncated:false})),deleteModelRecord:vi.fn(async input=>{models=[];return{deletedModelRecordId:input.modelRecordId,deletedRegistryRecord:true,deletedLocalFiles:false,deletedBackingArtifactIds:[]};})});
   await renderFeature(client);await search();
   expect(client.browseModels).toHaveBeenCalledWith({provider:'huggingface',query:'support'});
   await act(async()=>button('Details').click());expect(client.getModelDetails).toHaveBeenCalledWith({provider:'huggingface',modelId:support.modelId});
   await act(async()=>button('Save reference').click());expect(client.saveModelReference).toHaveBeenCalledWith({...support,workspaceId:'workspace-a'});expect(container!.textContent).toContain('Reference saved');
   await act(async()=>button('Download').click());expect(client.downloadModel).toHaveBeenCalledWith({...support,workspaceId:'workspace-a'});expect(container!.textContent).toContain('Downloaded');
   expect(client.listModelFiles).not.toHaveBeenCalled();
   const inventory=[...container!.querySelectorAll('section')].find(value=>value.querySelector('h3')?.textContent==='Server model inventory')!;
   await act(async()=>button('Details',inventory).click());expect(client.listModelFiles).not.toHaveBeenCalled();
   await act(async()=>button('Show model files',document.body).click());expect(client.listModelFiles).toHaveBeenCalledWith({workspaceId:'workspace-a',modelRecordId:'support-record'});expect(document.body.textContent).toContain('config.json');
   await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="Close model details"]')!.click());
   const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);await act(async()=>button('Delete record').click());expect(client.deleteModelRecord).not.toHaveBeenCalled();
   confirm.mockReturnValue(true);await act(async()=>button('Delete record').click());expect(client.deleteModelRecord).toHaveBeenCalledWith({workspaceId:'workspace-a',modelRecordId:'support-record',deleteLocalFiles:false});expect(button('Save reference')).toBeTruthy();expect(container!.textContent).not.toContain('Delete record');
 });

 it('starts one host-owned download without claiming that a queued task has finished',async()=>{
   let resolve!:(value:Awaited<ReturnType<NonNullable<ModelManagementApiClient['startModelDownload']>>>)=>void;
   const pending=new Promise<Awaited<ReturnType<NonNullable<ModelManagementApiClient['startModelDownload']>>>>(done=>{resolve=done;});
   const client=fixtureClient({startModelDownload:vi.fn(async()=>pending)});await renderFeature(client);await search();
   try{await act(async()=>{const download=button('Download');download.click();download.click();});expect(client.startModelDownload).toHaveBeenCalledTimes(1);expect(client.startModelDownload).toHaveBeenCalledWith({...support,workspaceId:'workspace-a'});expect(client.downloadModel).not.toHaveBeenCalled();}
   finally{await act(async()=>resolve({activity:{requestId:'download-1',workspaceId:'workspace-a' as any,modelId:support.modelId,displayName:support.displayName,status:'queued'}}));}
   expect(readNotificationMessages(container!)).not.toContain('Downloaded');expect(button('Download').disabled).toBe(false);
 });

 it('renders browse and inventory sections and supported provider only', async()=>{
  const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root!.render(<NotificationTestHarness><ModelManagementFeature client={client}/></NotificationTestHarness>);});
  expect(container.textContent).toContain('Browse models');
  expect(container.textContent).toContain('Server model inventory');
  const options = Array.from(container.querySelectorAll('option')).map((o)=>o.textContent);
  expect(options).toEqual(['Hugging Face']);
 });

 it('prevents delete when confirmation cancelled', async()=>{
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const client:any={
    listModels:vi.fn().mockResolvedValue({models:[{modelRecordId:'r1',displayName:'M',provider:'huggingface',source:'huggingface',lifecycleStatus:'registered',artifactForm:'full-model',createdAt:'2026-01-01'}]}),
    browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()
  };
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root!.render(<ModelManagementFeature client={client}/>);});
  const deleteButton = Array.from(container.querySelectorAll('button')).find((b)=>b.textContent?.includes('Delete record'));
  await act(async()=>{deleteButton?.dispatchEvent(new Event('click',{bubbles:true}));});
  expect(client.deleteModelRecord).not.toHaveBeenCalled();
 });

 it('renders browse result cards without a routine loaded notification', async()=>{
  const models = Array.from({length:20}).map((_,i)=>({modelId:`m-${i}`,displayName:`Model ${i}`,provider:'huggingface'}));
  const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root!.render(<NotificationTestHarness><ModelManagementFeature client={client}/></NotificationTestHarness>);});
  const input = container.querySelector('input') as HTMLInputElement;
  await act(async()=>{ Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,'gemma'); input.dispatchEvent(new Event('input',{bubbles:true})); });
  const browseButton = Array.from(container.querySelectorAll('button')).find((b)=>b.textContent?.includes('Browse models'));
  await act(async()=>{browseButton?.dispatchEvent(new Event('click',{bubbles:true}));});
  expect(readNotificationMessages(container)).not.toContain('Loaded 20 models.');
  expect(container.textContent).not.toContain('Loaded 20 models.');
  expect(container.querySelectorAll('section ul li.ui-panel').length).toBeGreaterThan(0);
 });

 it('loads server model files only after Show model files is clicked in Details', async()=>{
  const listModelFiles=vi.fn().mockResolvedValue({modelRecordId:'r1',files:[{relativePath:'config.json',sizeBytes:42}],truncated:false});
  const client:any={
    listModels:vi.fn().mockResolvedValue({models:[{modelRecordId:'r1',displayName:'M',provider:'huggingface',source:'huggingface',lifecycleStatus:'downloaded',artifactForm:'full-model',createdAt:'2026-01-01',localFilesAvailable:true}]}),
    listModelFiles,browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()
  };
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root!.render(<ModelManagementFeature client={client} workspaceId="workspace-a"/>);});
  const detailsButton=Array.from(container.querySelectorAll('button')).find((button)=>button.textContent==='Details');
  await act(async()=>{detailsButton?.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  expect(listModelFiles).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('config.json');
  const showFilesButton=Array.from(document.body.querySelectorAll('button')).find((button)=>button.textContent==='Show model files');
  await act(async()=>{showFilesButton?.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  expect(listModelFiles).toHaveBeenCalledWith({workspaceId:'workspace-a',modelRecordId:'r1'});
  expect(document.body.textContent).toContain('config.json');
 });

 it('keeps an empty browse result inline instead of publishing it', async()=>{
  const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root!.render(<NotificationTestHarness><ModelManagementFeature client={client}/></NotificationTestHarness>);});
  const input = container.querySelector('input') as HTMLInputElement;
  await act(async()=>{ Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,'missing'); input.dispatchEvent(new Event('input',{bubbles:true})); });
  const browseButton = Array.from(container.querySelectorAll('button')).find((b)=>b.textContent?.includes('Browse models'));
  await act(async()=>{browseButton?.dispatchEvent(new Event('click',{bubbles:true}));});
  expect(container.textContent).toContain('No model results found.');
  expect(readNotificationMessages(container)).not.toContain('No model results found.');
 });

});
