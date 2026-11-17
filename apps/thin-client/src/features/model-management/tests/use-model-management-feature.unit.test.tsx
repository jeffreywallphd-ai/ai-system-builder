// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModelManagementFeature } from '../hooks/useModelManagementFeature';
import type { ModelManagementApiClient } from '../api/apiModelManagementClient';
import type { ModelBrowseItem, ModelInventoryRecord } from '../../../../../../modules/contracts/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flush() { return new Promise((r) => setTimeout(r, 0)); }

describe('useModelManagementFeature', () => {
  let root: Root | undefined; let container: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async()=>root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

  const item: ModelBrowseItem = { provider: 'huggingface', modelId: 'example/support-model', displayName: 'Support model' };
  const record = (id = 'record-a'): ModelInventoryRecord => ({ modelRecordId: id, modelId: item.modelId, displayName: item.displayName, provider: 'huggingface', source: 'huggingface', artifactForm: 'full-model', lifecycleStatus: 'downloaded', createdAt: '2026-01-01' });
  function deferred<Value>() { let resolve!: (value: Value) => void; const promise = new Promise<Value>(done => { resolve = done; }); return { promise, resolve }; }
  function makeClient(overrides: Partial<ModelManagementApiClient> = {}): ModelManagementApiClient {
    const unused = async (): Promise<never> => { throw new Error('Unused synthetic operation'); };
    return { listModels: vi.fn(async () => ({ models: [] })), browseModels: vi.fn(async () => ({ models: [item] })), getModelDetails: unused, listModelFiles: vi.fn(async input => ({ modelRecordId: input.modelRecordId, files: [], truncated: false })), saveModelReference: vi.fn(async () => ({ model: record() })), downloadModel: vi.fn(async () => ({ model: record(), download: { provider: 'transformers' as const, modelId: item.modelId, downloaded: true, fromCache: false, localPath: 'synthetic-unused' } })), deleteModelRecord: vi.fn(async input => ({ deletedModelRecordId: input.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] })), updateModelRecord: unused, validateModel: unused, publishModel: unused, ...overrides };
  }
  let current: ReturnType<typeof useModelManagementFeature>;
  function Probe({ client, workspace }: {client: ModelManagementApiClient; workspace: string}) { current = useModelManagementFeature(client, workspace); return null; }
  async function mount(client: ModelManagementApiClient, workspace = 'workspace-a') { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root!.render(<Probe client={client} workspace={workspace} />)); }

  it.each(['workspace', 'client'] as const)('does not refresh or announce an old reference save after %s replacement', async changed => {
    const pending = deferred<Awaited<ReturnType<ModelManagementApiClient['saveModelReference']>>>();
    const client = makeClient({ saveModelReference: vi.fn(async () => pending.promise) }), next = changed === 'client' ? makeClient() : client;
    await mount(client); let operation!: Promise<void>;
    await act(async () => { operation = current.saveReference(item); });
    await act(async () => root!.render(<Probe client={next} workspace={changed === 'workspace' ? 'workspace-b' : 'workspace-a'} />));
    const before = vi.mocked(client.listModels).mock.calls.length;
    await act(async () => { pending.resolve({ model: record() }); await operation; });
    expect(client.listModels).toHaveBeenCalledTimes(before);
    expect(current.status).not.toContain('Saved');
  });

  it('does not apply inventory fetched by a replaced client', async () => {
    const pending = deferred<Awaited<ReturnType<ModelManagementApiClient['listModels']>>>();
    const client = makeClient({ listModels: vi.fn(async () => pending.promise) }), next = makeClient();
    await mount(client);
    await act(async () => root!.render(<Probe client={next} workspace="workspace-a" />));
    await act(async () => pending.resolve({ models: [record('old-client')] }));
    expect(next.listModels).toHaveBeenCalledTimes(1);
    expect(current.inventory).toEqual([]);
  });

  it.each(['close', 'selection'] as const)('ignores model files after dialog %s', async changed => {
    const pending = deferred<Awaited<ReturnType<ModelManagementApiClient['listModelFiles']>>>();
    const client = makeClient({ listModelFiles: vi.fn(async () => pending.promise) }); await mount(client);
    await act(async () => current.showInventoryDetails(record())); let operation!: Promise<void>;
    await act(async () => { operation = current.showModelFiles(); });
    await act(async () => changed === 'close' ? current.closeInventoryDetails() : current.showInventoryDetails(record('record-b')));
    await act(async () => { pending.resolve({ modelRecordId: 'record-a', files: [{ relativePath: 'old-config.json', sizeBytes: 42 }], truncated: false }); await operation; });
    expect(current.modelFiles).toBeUndefined(); expect(current.modelFilesLoading).toBe(false);
  });

  it('rejects files for another record', async () => {
    const client = makeClient({ listModelFiles: vi.fn(async () => ({ modelRecordId: 'foreign-record', files: [{ relativePath: 'foreign.json', sizeBytes: 7 }], truncated: false })) }); await mount(client);
    await act(async () => current.showInventoryDetails(record())); await act(async () => current.showModelFiles());
    expect(current.modelFiles).toBeUndefined(); expect(current.error).toContain('model files');
  });

  it.each(['save', 'download', 'delete'] as const)('admits one %s before the busy render', async action => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const pending = deferred<void>(), client = makeClient({
      saveModelReference: vi.fn(async () => { await pending.promise; return { model: record() }; }),
      downloadModel: vi.fn<ModelManagementApiClient['downloadModel']>(async () => { await pending.promise; return { model: record(), download: { provider: 'transformers', modelId: item.modelId, downloaded: true, fromCache: false, localPath: 'synthetic-unused' } }; }),
      deleteModelRecord: vi.fn(async input => { await pending.promise; return { deletedModelRecordId: input.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] }; }),
    }); await mount(client);
    let operations: Promise<void>[] = [];
    try {
      await act(async () => { const dispatch = () => action === 'save' ? current.saveReference(item) : action === 'download' ? current.download(item) : current.deleteRecord('record-a'); operations = [dispatch(), dispatch()]; });
      expect(action === 'save' ? client.saveModelReference : action === 'download' ? client.downloadModel : client.deleteModelRecord).toHaveBeenCalledTimes(1);
    } finally { await act(async () => { pending.resolve(); await Promise.all(operations); }); }
  });

  it('does not repopulate a cleared browse from a late reply', async () => {
    const pending = deferred<Awaited<ReturnType<ModelManagementApiClient['browseModels']>>>();
    const client = makeClient({ browseModels: vi.fn(async () => pending.promise) }); await mount(client);
    await act(async () => current.setQuery('support')); let operation!: Promise<void>;
    await act(async () => { operation = current.browse(); }); await act(async () => current.clear());
    await act(async () => { pending.resolve({ models: [item] }); await operation; });
    expect(current.query).toBe(''); expect(current.browseResults).toEqual([]); expect(current.browsing).toBe(false);
  });

  it.each(['browse', 'details', 'save', 'download', 'files', 'delete'] as const)('uses fixed public %s failure copy and diagnostics', async action => {
    vi.spyOn(window, 'confirm').mockReturnValue(true); const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fail = async (): Promise<never> => { throw new Error('private-provider-payload'); };
    const client = makeClient({ browseModels: fail, getModelDetails: fail, saveModelReference: fail, downloadModel: fail, listModelFiles: fail, deleteModelRecord: fail }); await mount(client);
    await act(async () => current.setQuery('support')); await act(async () => current.showInventoryDetails(record()));
    await act(async () => { if (action === 'browse') await current.browse(); if (action === 'details') await current.viewDetails(item.modelId); if (action === 'save') await current.saveReference(item); if (action === 'download') await current.download(item); if (action === 'files') await current.showModelFiles(); if (action === 'delete') await current.deleteRecord('record-a'); });
    expect(current.error).toBeTruthy(); expect(current.error).not.toContain('private-provider-payload'); expect(JSON.stringify(warning.mock.calls)).not.toContain('private-provider-payload');
  });

  it('does not report deletion for another record', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true); const client = makeClient({ deleteModelRecord: vi.fn(async () => ({ deletedModelRecordId: 'foreign-record', deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] })) }); await mount(client);
    await act(async () => current.deleteRecord('record-a'));
    expect(current.status).not.toContain('deleted'); expect(current.error).toBeTruthy();
  });

  it.each(['model', 'provider'] as const)('rejects substituted %s in remote details',async changed=>{
    const client=makeClient({getModelDetails:vi.fn<ModelManagementApiClient['getModelDetails']>(async()=>({model:{...item,modelId:changed==='model'?'foreign/model':item.modelId,provider:changed==='provider'?'unknown':'huggingface'}}))});await mount(client);
    await act(async()=>current.viewDetails(item.modelId));expect(current.details).toBeUndefined();expect(current.error).toContain('model details');
  });

  it('clears inventory deadlines after settlement and session retirement',async()=>{
    vi.useFakeTimers();
    try{const client=makeClient();await mount(client);expect(vi.getTimerCount()).toBe(0);
      const pending=deferred<Awaited<ReturnType<ModelManagementApiClient['listModels']>>>(),next=makeClient({listModels:vi.fn(async()=>pending.promise)});
      await act(async()=>root!.render(<Probe client={next} workspace="workspace-b"/>));expect(vi.getTimerCount()).toBe(1);
      await act(async()=>root!.unmount());root=undefined;expect(vi.getTimerCount()).toBe(0);await act(async()=>pending.resolve({models:[]}));
    }finally{vi.useRealTimers();}
  });

  it('loads inventory and clears inventoryLoading', async () => {
    const client:any={listModels:vi.fn().mockResolvedValue({models:[{modelRecordId:'1',displayName:'A',provider:'huggingface',source:'huggingface',artifactForm:'checkpoint',lifecycleStatus:'downloaded'}]}),browseModels:vi.fn().mockResolvedValue({models:[]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
    let vm:any; function T(){ vm = useModelManagementFeature(client, 'workspace-1'); return null; }
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    await act(async()=>{root!.render(<T/>); await flush();});
    expect(vm.inventoryLoading).toBe(false);
    expect(vm.inventory).toHaveLength(1);
    expect(vm.diagnostics.some((d:any)=>d.operation==='list' && d.phase==='state.updated')).toBe(true);
  });

  it('browse success sets results without a routine loaded status and logs state.updated', async () => {
    const client:any={listModels:vi.fn().mockResolvedValue({models:[]}),browseModels:vi.fn().mockResolvedValue({models:[{modelId:'m1',displayName:'Model 1',provider:'huggingface'}]}),getModelDetails:vi.fn(),saveModelReference:vi.fn(),downloadModel:vi.fn(),deleteModelRecord:vi.fn()};
    let vm:any; function T(){ vm = useModelManagementFeature(client, 'workspace-1'); return null; }
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    await act(async()=>{root!.render(<T/>);});
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
    await act(async()=>{root!.render(<StrictMode><T/></StrictMode>); await flush();});
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
    await act(async()=>{root!.render(<T/>);});
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
