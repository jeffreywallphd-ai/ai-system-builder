import {it as test,afterEach} from "vitest";
import assert from "node:assert/strict";
import {createApiApplicationSettingsClient,captureSettingsRead} from "../api/apiApplicationSettingsClient";

const originalFetch = globalThis.fetch;
afterEach(() => {globalThis.fetch = originalFetch;});
const key = "huggingface.defaultNamespace", privateText = "synthetic-private-settings-value";
const cases = [
  {method:"listDefinitions", suffix:"application-settings/list-definitions", input:undefined, value:{definitions:[]}},
  {method:"readSettings", suffix:"application-settings/read", input:undefined, value:{values:[]}},
  {method:"updateSetting", suffix:"application-settings/update", input:{key,value:"test-team"}, value:{value:{key,configured:true,value:"test-team"}}},
  {method:"clearSetting", suffix:"application-settings/clear", input:{key}, value:{value:{key,configured:false}}},
  {method:"restartServer", suffix:"server/restart", input:undefined, value:{restartRequested:true}},
] as const;
function response(body: unknown, status=200) {
  globalThis.fetch = async () => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}
function call(method: typeof cases[number]["method"], input: unknown) {
  const client=createApiApplicationSettingsClient();
  return (client[method] as (value: unknown)=>Promise<unknown>)(input);
}
for (const row of cases) {
  test(`preserves secured POST and positive ${row.method} contract`,async()=>{
    const captured: {url:string;init?:RequestInit}[]=[];
    globalThis.fetch=async(url,init)=>{captured.push({url:String(url),init});return new Response(JSON.stringify({ok:true,value:row.value}),{status:row.method==="restartServer"?202:200});};
    assert.deepEqual(await call(row.method,row.input),row.value);assert.equal(captured.length,1);
    assert.equal(captured[0]!.url,"/api/"+row.suffix);assert.equal(captured[0]!.init?.method,"POST");
    assert.deepEqual(JSON.parse(captured[0]!.init!.body as string),row.input??{});
    const headers=new Headers(captured[0]!.init?.headers);assert.equal(headers.get("x-client-source"),"thin-client");assert.equal(headers.get("content-type"),"application/json");
  });
  test(`denies HTTP403 independently of success-shaped ${row.method} body`,async()=>{
    response({ok:true,value:row.value},403);
    await assert.rejects(()=>call(row.method,row.input),(error:unknown)=>(error as {status?:number}).status===403);
  });
}
test("keeps canonical authentication status and codes without private response text",async()=>{
  for(const [status,code] of [[401,"security.revoked-token"],[403,"security.forbidden"]] as const){
    response({ok:false,error:{code,message:privateText,details:{payload:privateText}}},status);
    await assert.rejects(()=>createApiApplicationSettingsClient().readSettings(),(error:unknown)=>{
      const value=error as Error & {status?:number;code?:string};assert.equal(value.status,status);assert.equal(value.code,code);
      assert.equal(String(value).includes(privateText),false);assert.equal(JSON.stringify(value).includes(privateText),false);return true;
    });
  }
});
for(const value of [{values:[null]},{values:[{key,configured:"yes"}]},
  {values:[{key:"huggingface.token",configured:true,masked:true,value:privateText,maskedValue:"********"}]},
  {values:[{key:"huggingface.token",configured:true,masked:true,maskedValue:privateText}]}]){
  test(`rejects malformed or unsafe masked settings rows ${JSON.stringify(value).includes("masked")?"masked":"shape"} ${Object.keys(value.values[0]??{}).join("-")}`,async()=>{
    response({ok:true,value});await assert.rejects(()=>createApiApplicationSettingsClient().readSettings());
  });
}
test("accepts masked secret metadata and public model objects without loading or resolving models",async()=>{
  const values=[{key:"huggingface.token",configured:true,masked:true,maskedValue:"********"},
    {key:"models.default",configured:true,value:{provider:"transformers",modelId:"synthetic/model",inferenceMode:"chat"}}];
  response({ok:true,value:{values}});assert.deepEqual(await createApiApplicationSettingsClient().readSettings(),{values});
});
test("rejects malformed consumed definitions and false restart acknowledgements",async()=>{
  response({ok:true,value:{definitions:[{key,category:"huggingface",label:{privateText},valueKind:"string"}]}});
  await assert.rejects(()=>createApiApplicationSettingsClient().listDefinitions());
  response({ok:true,value:{restartRequested:false}},202);await assert.rejects(()=>createApiApplicationSettingsClient().restartServer());
});
for(const method of ["updateSetting","clearSetting"] as const){
  test(`binds ${method} acknowledgement to the captured key and configured state`,async()=>{
    const input=method==="updateSetting"?{key,value:"test-team"}:{key};
    for(const value of [{key:"runtime.python.defaultDevice",configured:method==="updateSetting"},
      {key,configured:method!=="updateSetting"}]){
      response({ok:true,value:{value}});await assert.rejects(()=>call(method,input));
    }
  });
}
test("admits legacy partial model defaults but rejects wrong consumed kinds, foreign values and malformed model fields",()=>{
  const definition={key:"models.default",category:"models",label:"Model",valueKind:"object"};
  const read=(value:unknown)=>captureSettingsRead({definitions:[definition]},{values:[{key:definition.key,configured:true,value}]});
  assert.deepEqual(read({modelId:"synthetic/model",inferenceMode:"chat"}).values[0]!.value,{modelId:"synthetic/model",inferenceMode:"chat"});
  for(const value of [null,{modelId:{payload:privateText}},{inferenceMode:7},{device:{}},{torchDtype:[]},{provider:"unsupported"}])assert.throws(()=>read(value));
  for(const [kind,value] of [["string",false],["select",{}],["number","3"],["boolean","true"]]){
    assert.throws(()=>captureSettingsRead({definitions:[{key,category:"runtime",label:"Field",valueKind:kind}]},{values:[{key,configured:true,value}]}));
  }
  assert.throws(()=>captureSettingsRead({definitions:[definition]},{values:[{key:"foreign.key",configured:true,value:"foreign"}]}));
});
test("owns consumed model fields before a deferred renderer commit and does not invoke model accessors",()=>{
  const definition={key:"models.default",category:"models",label:"Model",valueKind:"object"};
  const model:{modelId:unknown;inferenceMode:unknown}={modelId:"synthetic/original",inferenceMode:"chat"};
  const row={key:definition.key,configured:true,value:model};const result=captureSettingsRead({definitions:[definition]},{values:[row]});
  model.modelId={privateText};model.inferenceMode="unsupported";row.value={modelId:"changed",inferenceMode:"auto"};
  assert.deepEqual(result.values[0]!.value,{modelId:"synthetic/original",inferenceMode:"chat"});
  let calls=0;const accessor=Object.defineProperty({},"modelId",{get(){calls++;return privateText;}});
  assert.throws(()=>captureSettingsRead({definitions:[definition]},{values:[{key:definition.key,configured:true,value:accessor}]}));assert.equal(calls,0);
});
