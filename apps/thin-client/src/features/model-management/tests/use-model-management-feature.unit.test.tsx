// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModelManagementFeature } from '../hooks/useModelManagementFeature';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flush() { return new Promise((r) => setTimeout(r, 0)); }

describe('useModelManagementFeature', () => {
  let root: Root | undefined; let container: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async()=>root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

  it('loads inventory and clears inventoryLoading', async () => {
    const client:any={listModels:vi.fn().mockResolvedValue({models:[{modelRecordId:'1',displayName:'A',provider:'huggingface',source:'huggingface',artifactForm:'checkpoint',lifecycleStatus:'downloaded'}]}),browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
    let vm:any; function T(){ vm = useModelManagementFeature(client, 'workspace-1'); return null; }
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    await act(async()=>{root.render(<T/>); await flush();});
    expect(vm.inventoryLoading).toBe(false);
    expect(vm.inventory).toHaveLength(1);
    expect(vm.diagnostics.some((d:any)=>d.operation==='list' && d.phase==='state.updated')).toBe(true);
  });

  it('browse success sets results without a routine loaded status and logs state.updated', async () => {
    const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models:[{modelId:'m1',displayName:'Model 1',provider:'huggingface'}]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
    let vm:any; function T(){ vm = useModelManagementFeature(client, 'workspace-1'); return null; }
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    await act(async()=>{root.render(<T/>);});
    await act(async()=>{ vm.setQuery('gemma'); });
    await act(async()=>{ await vm.browse(); });
    expect(vm.browsing).toBe(false);
    expect(vm.browseResults).toHaveLength(1);
    expect(vm.status).toBe('');
    expect(vm.diagnostics.some((d:any)=>d.operation==='browse' && d.phase==='state.updated')).toBe(true);
  });

  it('strict mode does not permanently ignore accepted responses', async () => {
    const client:any={listModels:vi.fn().mockResolvedValue({models:[{modelRecordId:'1',displayName:'A',provider:'huggingface',source:'huggingface',artifactForm:'checkpoint',lifecycleStatus:'downloaded'}]}),browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
    let vm:any; function T(){ vm = useModelManagementFeature(client, 'workspace-1'); return null; }
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    await act(async()=>{root.render(<StrictMode><T/></StrictMode>); await flush();});
    expect(vm.inventory).toHaveLength(1);
    expect(vm.inventoryLoading).toBe(false);
  });

  it('newer responses win for inventory and browse', async () => {
    let resolveOldList:any; let resolveNewList:any; let resolveOldBrowse:any; let resolveNewBrowse:any;
    const listModels=vi.fn().mockReturnValueOnce(new Promise((r)=>{resolveOldList=r;})).mockReturnValueOnce(new Promise((r)=>{resolveNewList=r;}));
    const browseModels=vi.fn().mockReturnValueOnce(new Promise((r)=>{resolveOldBrowse=r;})).mockReturnValueOnce(new Promise((r)=>{resolveNewBrowse=r;}));
    const client:any={listModels,browseModels,getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
    let vm:any; function T(){ vm = useModelManagementFeature(client, 'workspace-1'); return null; }
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    await act(async()=>{root.render(<T/>);});
    await act(async()=>{void vm.refreshInventory();});
    await act(async()=>{resolveNewList({models:[{modelRecordId:'new',displayName:'N',provider:'huggingface',source:'huggingface',artifactForm:'checkpoint',lifecycleStatus:'downloaded'}]}); await flush();});
    await act(async()=>{resolveOldList({models:[{modelRecordId:'old',displayName:'O',provider:'huggingface',source:'huggingface',artifactForm:'checkpoint',lifecycleStatus:'downloaded'}]}); await flush();});
    expect(vm.inventory[0].modelRecordId).toBe('new');

    await act(async()=>{vm.setQuery('old');});
    await act(async()=>{void vm.browse();});
    await act(async()=>{vm.setQuery('new');});
    await act(async()=>{void vm.browse();});
    await act(async()=>{resolveNewBrowse({models:[{modelId:'new',displayName:'New',provider:'huggingface'}]}); await flush();});
    await act(async()=>{resolveOldBrowse({models:[{modelId:'old',displayName:'Old',provider:'huggingface'}]}); await flush();});
    expect(vm.browseResults[0].modelId).toBe('new');
    expect(vm.diagnostics.some((d:any)=>d.phase==='state.ignored')).toBe(true);
  });
});
