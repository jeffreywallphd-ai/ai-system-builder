// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest';
import { createApiModelManagementClient, ModelManagementApiError } from '../api/apiModelManagementClient';

describe('api model management client',()=>{
 it('calls browse endpoint and parses success', async()=>{
  const fetchMock=vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{models:[{modelId:'a',displayName:'A',provider:'huggingface'}]}})});
  vi.stubGlobal('fetch', fetchMock);
  const client=createApiModelManagementClient();
  const res=await client.browseModels({provider:'huggingface',query:'a'});
  expect(fetchMock.mock.calls[0][0]).toBe('/api/model/browse');
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).not.toHaveProperty('source', 'thin-client.model-management');
  expect(res.models).toHaveLength(1);
 });
 it('listModels provider filter does not inject telemetry source', async()=>{
  const fetchMock=vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{models:[]}})});
  vi.stubGlobal('fetch', fetchMock);
  await createApiModelManagementClient().listModels({provider:'huggingface'});
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({provider:'huggingface'});
 });
 it('listModels preserves valid contract source filter', async()=>{
  const fetchMock=vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{models:[]}})});
  vi.stubGlobal('fetch', fetchMock);
  await createApiModelManagementClient().listModels({source:'huggingface'});
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({source:'huggingface'});
 });
 it('loads a path-free model file list on the server files endpoint', async()=>{
  const fetchMock=vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{modelRecordId:'m1',files:[{relativePath:'tokenizer/vocab.json',sizeBytes:12}],truncated:false}})});
  vi.stubGlobal('fetch', fetchMock);
  const result=await createApiModelManagementClient().listModelFiles({workspaceId:'workspace-a' as never,modelRecordId:'m1'});
  expect(fetchMock.mock.calls[0][0]).toBe('/api/model/files/list');
  expect(result.files).toEqual([{relativePath:'tokenizer/vocab.json',sizeBytes:12}]);
  expect(JSON.stringify(result)).not.toContain('C:\\');
 });
 it('throws on failure envelope with code/details', async()=>{
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:400,json:vi.fn().mockResolvedValue({ok:false,error:{message:'bad',code:'validation',details:{field:'provider'}}})}));
  await expect(createApiModelManagementClient().listModels()).rejects.toMatchObject({message:'bad', code:'validation', details:{field:'provider'}});
 });
 it('throws on non-json response', async()=>{
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({headers:{get:()=> 'text/plain'},status:500,json:vi.fn().mockRejectedValue(new Error('x'))}));
  await expect(createApiModelManagementClient().listModels()).rejects.toBeInstanceOf(ModelManagementApiError);
 });
 it('throws on malformed success payload', async()=>{
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{models:'oops'}})}));
  await expect(createApiModelManagementClient().listModels()).rejects.toThrow('missing models array');
 });
});


it('preserves security status/code for unauthorized errors', async()=>{
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({headers:{get:()=> 'application/json'},status:401,json:vi.fn().mockResolvedValue({ok:false,error:{message:'Missing bearer token.',code:'security.unauthenticated',details:{}}})}));
  await expect(createApiModelManagementClient().listModels()).rejects.toMatchObject({status:401, code:'security.unauthenticated'});
});

it('passes workspace id for thin-client validation and publishing requests', async()=>{
  const fetchMock=vi.fn()
    .mockResolvedValueOnce({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{modelRecordId:'m1',status:'valid'}})})
    .mockResolvedValueOnce({headers:{get:()=> 'application/json'},status:200,json:vi.fn().mockResolvedValue({ok:true,value:{modelRecordId:'m1',published:true,provider:'huggingface',repository:'owner/repo'}})});
  vi.stubGlobal('fetch', fetchMock);
  const client=createApiModelManagementClient();
  await client.validateModel({workspaceId:'workspace-a' as never, modelRecordId:'m1'});
  await client.publishModel({workspaceId:'workspace-a' as never, modelRecordId:'m1', repository:'owner/repo'});
  expect(fetchMock.mock.calls[0][0]).toBe('/api/model/validate');
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({workspaceId:'workspace-a', modelRecordId:'m1'});
  expect(fetchMock.mock.calls[1][0]).toBe('/api/model/publish');
  expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({workspaceId:'workspace-a', modelRecordId:'m1', repository:'owner/repo'});
});
