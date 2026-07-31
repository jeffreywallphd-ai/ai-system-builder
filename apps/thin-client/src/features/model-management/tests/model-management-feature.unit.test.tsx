// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationTestHarness, readNotificationMessages } from '../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness';
import { ModelManagementFeature } from '../components/ModelManagementFeature';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ModelManagementFeature',()=>{
 let root:Root|undefined; let container:HTMLDivElement|undefined;
 afterEach(async()=>{ if(root){ await act(async()=>{root?.unmount();}); } container?.remove(); vi.restoreAllMocks(); });

 it('renders browse and inventory sections and supported provider only', async()=>{
  const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root.render(<NotificationTestHarness><ModelManagementFeature client={client}/></NotificationTestHarness>);});
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
  await act(async()=>{root.render(<ModelManagementFeature client={client}/>);});
  const deleteButton = Array.from(container.querySelectorAll('button')).find((b)=>b.textContent?.includes('Delete record'));
  await act(async()=>{deleteButton?.dispatchEvent(new Event('click',{bubbles:true}));});
  expect(client.deleteModelRecord).not.toHaveBeenCalled();
 });

 it('renders browse result cards without a routine loaded notification', async()=>{
  const models = Array.from({length:20}).map((_,i)=>({modelId:`m-${i}`,displayName:`Model ${i}`,provider:'huggingface'}));
  const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
  await act(async()=>{root.render(<NotificationTestHarness><ModelManagementFeature client={client}/></NotificationTestHarness>);});
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
  await act(async()=>{root.render(<ModelManagementFeature client={client} workspaceId="workspace-a"/>);});
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
  await act(async()=>{root.render(<NotificationTestHarness><ModelManagementFeature client={client}/></NotificationTestHarness>);});
  const input = container.querySelector('input') as HTMLInputElement;
  await act(async()=>{ Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,'missing'); input.dispatchEvent(new Event('input',{bubbles:true})); });
  const browseButton = Array.from(container.querySelectorAll('button')).find((b)=>b.textContent?.includes('Browse models'));
  await act(async()=>{browseButton?.dispatchEvent(new Event('click',{bubbles:true}));});
  expect(container.textContent).toContain('No model results found.');
  expect(readNotificationMessages(container)).not.toContain('No model results found.');
 });

});
