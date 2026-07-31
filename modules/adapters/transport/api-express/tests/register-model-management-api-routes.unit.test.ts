import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { RuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";
import { createRuntimeCapabilityStatus } from "../../../../contracts/runtime";
import { registerModelManagementApiRoutes, type ModelManagementExpressRoutePort } from "../model/registerModelManagementApiRoutes";

function response(){const json=testDouble.fn();const status=testDouble.fn();const res:any={status:status.mockImplementation(()=>res),json};return{res,status,json};}

describe("registerModelManagementApiRoutes",()=>{
  it("registers model management routes and calls use cases", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const deps:any={browseModelsUseCase:{execute:testDouble.fn(async(x)=>x)},getModelDetailsUseCase:{execute:testDouble.fn(async(x)=>x)},listModelsUseCase:{execute:testDouble.fn(async(x)=>x)},saveModelReferenceUseCase:{execute:testDouble.fn(async(x)=>x)},downloadModelUseCase:{execute:testDouble.fn(async(x)=>x)},updateModelRecordUseCase:{execute:testDouble.fn(async(x)=>x)},deleteModelRecordUseCase:{execute:testDouble.fn(async(x)=>x)}};
    registerModelManagementApiRoutes({app,...deps});
    expect([...handlers.keys()]).toEqual(["/api/model/browse","/api/model/details","/api/model/list","/api/model/reference/save","/api/model/download","/api/model/record/update","/api/model/record/delete"]);
    await handlers.get('/api/model/details')({body:{provider:'huggingface',modelId:'a/b'},headers:{}},response().res);
    expect(deps.getModelDetailsUseCase.execute).toHaveBeenCalledWith({provider:'huggingface',modelId:'a/b'});
  });

  it("returns validation and mapped failure statuses", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const deps:any={browseModelsUseCase:{execute:testDouble.fn(async()=>{throw {code:'unavailable',message:'down'};})},getModelDetailsUseCase:{execute:testDouble.fn()},listModelsUseCase:{execute:testDouble.fn()},saveModelReferenceUseCase:{execute:testDouble.fn()},downloadModelUseCase:{execute:testDouble.fn(async()=>{throw {code:'not-found',message:'n'};})},updateModelRecordUseCase:{execute:testDouble.fn()},deleteModelRecordUseCase:{execute:testDouble.fn()}};
    registerModelManagementApiRoutes({app,...deps});
    const a=response(); await handlers.get('/api/model/list')({body:null,headers:{}},a.res); expect(a.status).toHaveBeenCalledWith(400);
    const b=response(); await handlers.get('/api/model/browse')({body:{provider:'huggingface'},headers:{}},b.res); expect(b.status).toHaveBeenCalledWith(503);
    const c=response(); await handlers.get('/api/model/download')({body:{workspaceId:'workspace-a',provider:'huggingface',modelId:'x'},headers:{}},c.res); expect(c.status).toHaveBeenCalledWith(404);
  });


  it("registers optional validation/publish routes and requires workspace ids", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const deps:any={browseModelsUseCase:{execute:testDouble.fn(async(x)=>x)},getModelDetailsUseCase:{execute:testDouble.fn(async(x)=>x)},listModelsUseCase:{execute:testDouble.fn(async(x)=>x)},saveModelReferenceUseCase:{execute:testDouble.fn(async(x)=>x)},downloadModelUseCase:{execute:testDouble.fn(async(x)=>x)},updateModelRecordUseCase:{execute:testDouble.fn(async(x)=>x)},deleteModelRecordUseCase:{execute:testDouble.fn(async(x)=>x)},validateModelUseCase:{execute:testDouble.fn(async(x)=>x)},publishModelUseCase:{execute:testDouble.fn(async(x)=>x)}};
    registerModelManagementApiRoutes({app,...deps});
    expect([...handlers.keys()]).toContain("/api/model/validate");
    expect([...handlers.keys()]).toContain("/api/model/publish");

    const validateMissing=response(); await handlers.get('/api/model/validate')({body:{modelRecordId:'m1'},headers:{}},validateMissing.res);
    const publishMissing=response(); await handlers.get('/api/model/publish')({body:{modelRecordId:'m1',repository:'owner/repo'},headers:{}},publishMissing.res);
    expect(validateMissing.status).toHaveBeenCalledWith(400);
    expect(publishMissing.status).toHaveBeenCalledWith(400);

    const validateOk=response(); await handlers.get('/api/model/validate')({body:{workspaceId:'workspace-a',modelRecordId:'m1'},headers:{}},validateOk.res);
    const publishOk=response(); await handlers.get('/api/model/publish')({body:{workspaceId:'workspace-a',modelRecordId:'m1',repository:'owner/repo'},headers:{}},publishOk.res);
    expect(deps.validateModelUseCase.execute).toHaveBeenCalledWith({workspaceId:'workspace-a',modelRecordId:'m1',modelPath:undefined,reportOutputDirectory:undefined,expectedLoRA:undefined,expectedRecurrentAdditions:undefined,allowWarnings:undefined,validationStrictness:undefined});
    expect(deps.publishModelUseCase.execute).toHaveBeenCalledWith({workspaceId:'workspace-a',modelRecordId:'m1',repository:'owner/repo',owner:undefined,revision:undefined,private:undefined,pathPrefix:undefined,token:undefined,allowWarningValidation:undefined,allowInvalidValidation:undefined,allowInvalid:undefined,forceRevalidate:undefined});
  });

  it("registers the optional server model-file route and requires workspace scope", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const listModelFilesUseCase={execute:testDouble.fn(async(x)=>({modelRecordId:x.modelRecordId,files:[],truncated:false}))};
    const deps:any={browseModelsUseCase:{execute:testDouble.fn()},getModelDetailsUseCase:{execute:testDouble.fn()},listModelsUseCase:{execute:testDouble.fn()},listModelFilesUseCase,saveModelReferenceUseCase:{execute:testDouble.fn()},downloadModelUseCase:{execute:testDouble.fn()},updateModelRecordUseCase:{execute:testDouble.fn()},deleteModelRecordUseCase:{execute:testDouble.fn()}};
    registerModelManagementApiRoutes({app,...deps});
    expect([...handlers.keys()]).toContain('/api/model/files/list');
    const missing=response(); await handlers.get('/api/model/files/list')({body:{modelRecordId:'m1'},headers:{}},missing.res);
    expect(missing.status).toHaveBeenCalledWith(400);
    await handlers.get('/api/model/files/list')({body:{workspaceId:'workspace-a',modelRecordId:'m1'},headers:{}},response().res);
    expect(listModelFilesUseCase.execute).toHaveBeenCalledWith({workspaceId:'workspace-a',modelRecordId:'m1'});
  });

  it("keeps server model inventory responses path-free while reporting local availability", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const deps:any={browseModelsUseCase:{execute:testDouble.fn()},getModelDetailsUseCase:{execute:testDouble.fn()},listModelsUseCase:{execute:testDouble.fn(async()=>({models:[{modelRecordId:'m1',localPath:'C:\\private\\m1',validationReportPath:'C:\\private\\report.json'}]}))},saveModelReferenceUseCase:{execute:testDouble.fn()},downloadModelUseCase:{execute:testDouble.fn()},updateModelRecordUseCase:{execute:testDouble.fn()},deleteModelRecordUseCase:{execute:testDouble.fn()}};
    registerModelManagementApiRoutes({app,...deps});
    const output=response(); await handlers.get('/api/model/list')({body:{workspaceId:'workspace-a'},headers:{}},output.res);
    const serialized=JSON.stringify(output.json.mock.calls[0]?.[0]);
    expect(serialized.includes('C:\\\\private')).toBe(false);
    expect(serialized.includes('localFilesAvailable')).toBe(true);
  });

  it("rejects attempts to replace a stored model path through the server API", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const updateModelRecordUseCase={execute:testDouble.fn()};
    const deps:any={browseModelsUseCase:{execute:testDouble.fn()},getModelDetailsUseCase:{execute:testDouble.fn()},listModelsUseCase:{execute:testDouble.fn()},saveModelReferenceUseCase:{execute:testDouble.fn()},downloadModelUseCase:{execute:testDouble.fn()},updateModelRecordUseCase,deleteModelRecordUseCase:{execute:testDouble.fn()}};
    registerModelManagementApiRoutes({app,...deps});
    const output=response(); await handlers.get('/api/model/record/update')({body:{workspaceId:'workspace-a',modelRecordId:'m1',patch:{localPath:'C:\\private'}},headers:{}},output.res);
    expect(output.status).toHaveBeenCalledWith(400);
    expect(updateModelRecordUseCase.execute).not.toHaveBeenCalled();
  });

  it("registers short model-download lifecycle routes and normalizes workspace task reads", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const tasks={start:testDouble.fn(async(x)=>({activity:{requestId:'download-1',...x,status:'queued'}})),read:testDouble.fn(async(x)=>({activity:{...x,status:'running'}})),list:testDouble.fn(async()=>({activities:[]})),cancel:testDouble.fn(async(x)=>({activity:{...x,status:'cancelled'},cancelled:true}))};
    registerModelManagementApiRoutes({app,browseModelsUseCase:{execute:testDouble.fn()},getModelDetailsUseCase:{execute:testDouble.fn()},listModelsUseCase:{execute:testDouble.fn()},saveModelReferenceUseCase:{execute:testDouble.fn()},downloadModelUseCase:{execute:testDouble.fn()},modelDownloadTasksUseCase:tasks,updateModelRecordUseCase:{execute:testDouble.fn()},deleteModelRecordUseCase:{execute:testDouble.fn()}});
    expect([...handlers.keys()]).toContain('/api/model/download/start');
    expect([...handlers.keys()]).toContain('/api/model/download/read');
    expect([...handlers.keys()]).toContain('/api/model/download/list');
    expect([...handlers.keys()]).toContain('/api/model/download/cancel');
    await handlers.get('/api/model/download/read')({body:{workspaceId:'workspace-a',requestId:'download-1'},headers:{}},response().res);
    expect(tasks.read).toHaveBeenCalledWith({workspaceId:'workspace-a',requestId:'download-1'});
  });

  it("logs browse request lifecycle", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const logger={info:testDouble.fn(),warn:testDouble.fn()};
    registerModelManagementApiRoutes({
      app,logger,
      browseModelsUseCase:{execute:testDouble.fn(async()=>({models:[{id:'a'},{id:'b'}]}))},
      getModelDetailsUseCase:{execute:testDouble.fn(async()=>({}))},listModelsUseCase:{execute:testDouble.fn(async()=>({models:[]}))},saveModelReferenceUseCase:{execute:testDouble.fn(async()=>({}))},downloadModelUseCase:{execute:testDouble.fn(async()=>({}))},updateModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},deleteModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},
    });
    await handlers.get('/api/model/browse')({body:{provider:'huggingface',query:'flux',modelId:'z'},headers:{'x-request-id':'r1','x-correlation-id':'c1'}},response().res);
    const infoCalls = logger.info.mock.calls;
    expect(infoCalls.some((call:any[]) => call[0]==='api.model.request.received' && call[1]?.operation==='model.browse' && call[1]?.provider==='huggingface' && call[1]?.query==='flux' && call[1]?.requestId==='r1' && call[1]?.correlationId==='c1')).toBe(true);
    expect(infoCalls.some((call:any[]) => call[0]==='api.model.request.succeeded' && call[1]?.operation==='model.browse' && call[1]?.resultCount===2 && call[1]?.requestId==='r1' && call[1]?.correlationId==='c1')).toBe(true);
  });

  it("logs download result details from the nested download payload", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const logger={info:testDouble.fn(),warn:testDouble.fn()};
    registerModelManagementApiRoutes({
      app,logger,
      browseModelsUseCase:{execute:testDouble.fn(async()=>({models:[]}))},
      getModelDetailsUseCase:{execute:testDouble.fn(async()=>({}))},
      listModelsUseCase:{execute:testDouble.fn(async()=>({models:[]}))},
      saveModelReferenceUseCase:{execute:testDouble.fn(async()=>({}))},
      downloadModelUseCase:{execute:testDouble.fn(async()=>({model:{modelRecordId:"downloaded-stable-diffusion"},download:{provider:"transformers",modelId:"stabilityai/stable-diffusion-xl-base-1.0",downloaded:true,fromCache:false,localPath:"/models/sdxl"}}))},
      updateModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},
      deleteModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},
    });
    await handlers.get('/api/model/download')({body:{workspaceId:'workspace-a',provider:'huggingface',modelId:'stabilityai/stable-diffusion-xl-base-1.0'},headers:{}},response().res);
    const infoCalls = logger.info.mock.calls;
    expect(infoCalls.some((call:any[]) => call[0]==='api.model.request.succeeded' && call[1]?.operation==='model.download' && call[1]?.modelId==='stabilityai/stable-diffusion-xl-base-1.0' && call[1]?.modelRecordId==='downloaded-stable-diffusion' && call[1]?.downloaded===true && call[1]?.fromCache===false && typeof call[1]?.elapsedMs==="number")).toBe(true);
  });

  it("logs browse failure with mapped code", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const logger={info:testDouble.fn(),warn:testDouble.fn()};
    registerModelManagementApiRoutes({app,logger,browseModelsUseCase:{execute:testDouble.fn(async()=>{throw {code:'unavailable',message:'hf down'};})},getModelDetailsUseCase:{execute:testDouble.fn(async()=>({}))},listModelsUseCase:{execute:testDouble.fn(async()=>({models:[]}))},saveModelReferenceUseCase:{execute:testDouble.fn(async()=>({}))},downloadModelUseCase:{execute:testDouble.fn(async()=>({}))},updateModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},deleteModelRecordUseCase:{execute:testDouble.fn(async()=>({}))}});
    await handlers.get('/api/model/browse')({body:{provider:'huggingface',query:'flux'},headers:{}},response().res);
    const warnCalls = logger.warn.mock.calls;
    expect(warnCalls.some((call:any[]) => call[0]==='api.model.request.failed' && call[1]?.operation==='model.browse' && call[1]?.code==='unavailable' && call[1]?.message==='Required runtime capability is not ready.')).toBe(true);
  });

  it("sanitizes internal model API failures", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    registerModelManagementApiRoutes({app,browseModelsUseCase:{execute:testDouble.fn(async()=>{throw new Error('raw model failure at /tmp/secret\nstack trace');})},getModelDetailsUseCase:{execute:testDouble.fn(async()=>({}))},listModelsUseCase:{execute:testDouble.fn(async()=>({models:[]}))},saveModelReferenceUseCase:{execute:testDouble.fn(async()=>({}))},downloadModelUseCase:{execute:testDouble.fn(async()=>({}))},updateModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},deleteModelRecordUseCase:{execute:testDouble.fn(async()=>({}))}});
    const out=response(); await handlers.get('/api/model/browse')({body:{provider:'huggingface',query:'flux'},headers:{}},out.res);
    expect(out.status).toHaveBeenCalledWith(500);
    expect(out.json.mock.calls[0]?.[0]).toMatchObject({ok:false,error:{code:'internal',message:'Model management request failed.'}});
    expect(JSON.stringify(out.json.mock.calls[0]?.[0])).not.toContain('/tmp/secret');
    expect(JSON.stringify(out.json.mock.calls[0]?.[0])).not.toContain('stack trace');
  });

  it("maps runtime capability unavailable failures to sanitized API details", async()=>{
    const handlers=new Map<string,any>(); const app:ModelManagementExpressRoutePort={post:testDouble.fn((p,h)=>handlers.set(p,h))};
    const unavailable = new RuntimeCapabilityUnavailableError(createRuntimeCapabilityStatus({
      capabilityId: "model-training",
      status: "failed",
      summary: "Model training runtime failed readiness checks.",
      reason: { code: "runtime.python.failed", message: "raw stack /tmp/secret TOKEN=abc", category: "startup", retryable: true },
      recommendedActions: ["retry", "view-logs"],
    }));
    registerModelManagementApiRoutes({app,browseModelsUseCase:{execute:testDouble.fn(async()=>{throw unavailable;})},getModelDetailsUseCase:{execute:testDouble.fn(async()=>({}))},listModelsUseCase:{execute:testDouble.fn(async()=>({models:[]}))},saveModelReferenceUseCase:{execute:testDouble.fn(async()=>({}))},downloadModelUseCase:{execute:testDouble.fn(async()=>({}))},updateModelRecordUseCase:{execute:testDouble.fn(async()=>({}))},deleteModelRecordUseCase:{execute:testDouble.fn(async()=>({}))}});

    const out=response(); await handlers.get('/api/model/browse')({body:{provider:'huggingface',query:'flux'},headers:{'x-request-id':'req-model','x-correlation-id':'corr-model'}},out.res);

    expect(out.status).toHaveBeenCalledWith(503);
    expect(out.json.mock.calls[0]?.[0]).toMatchObject({
      ok:false,
      requestId:"req-model",
      correlationId:"corr-model",
      error:{code:"unavailable",message:"Required runtime capability is not ready.",details:{capabilityId:"model-training",status:"failed",reason:{code:"runtime.python.failed",category:"startup"},recommendedActions:["retry","view-logs"]}},
    });
    const payload = JSON.stringify(out.json.mock.calls[0]?.[0]);
    expect(payload).not.toContain('/tmp/secret');
    expect(payload).not.toContain('TOKEN=abc');
    expect(payload).not.toContain('raw stack');
  });
});
