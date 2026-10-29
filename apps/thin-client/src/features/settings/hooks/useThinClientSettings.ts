import {useCallback,useEffect,useLayoutEffect,useMemo,useState} from "react";
import type {ApplicationSettingDefinition,ApplicationSettingPrimitiveValue,ApplicationSettingValue} from "../../../../../../modules/contracts/settings";
import {captureSettingsRead,type ApplicationSettingsApiClient} from "../api/apiApplicationSettingsClient";
import {normalizeSecurityError,toSecurityGuidance} from "../../../security/securityErrors";

type Action="save"|"clear"|"restart";
interface Scope {client:ApplicationSettingsApiClient;lease?:object;readOwner?:object;actionOwner?:object;ready:boolean;definitions?:Map<string,ApplicationSettingDefinition>;}
interface Readback {definition:ApplicationSettingDefinition;configured:boolean;acknowledgement:{value:ApplicationSettingValue};}
interface View {
  scope:Scope;definitions:ApplicationSettingDefinition[];valuesByKey:Map<string,ApplicationSettingValue>;
  loading:boolean;ready:boolean;busy?:Action;readOwner?:object;actionOwner?:object;errorMessage?:string;successMessage?:string;
}
const initial=(scope:Scope):View=>({scope,definitions:[],valuesByKey:new Map(),loading:true,ready:false});
const message=(error:unknown,fallback:string)=>toSecurityGuidance(normalizeSecurityError(error,fallback))??fallback;

/** Stable comparison of the fields that supported controls actually consume. */
function consumedValue(definition:ApplicationSettingDefinition,value:ApplicationSettingValue["value"]):string|number|boolean|undefined {
  if(definition.valueKind==="secret")return undefined;
  if(definition.valueKind!=="object")return value as string|number|boolean|undefined;
  // Arbitrary object editing is unsupported; Clear confirms configuration only.
  if(!definition.key.includes("default")||!definition.key.includes("model"))return undefined;
  const model=(value??{}) as Record<string,unknown>;
  return JSON.stringify([model.provider??"transformers",model.modelId??"",model.inferenceMode??"auto",model.device??"",model.torchDtype??""]);
}

export function useThinClientSettings(client:ApplicationSettingsApiClient) {
  const scope=useMemo<Scope>(()=>({client,ready:false}),[client]);
  const [view,setView]=useState(()=>initial(scope));
  useLayoutEffect(()=>{
    const lease={};scope.lease=lease;scope.readOwner=scope.actionOwner=undefined;scope.definitions=undefined;scope.ready=false;setView(initial(scope));
    return()=>{if(scope.lease===lease){scope.lease=undefined;scope.readOwner=scope.actionOwner=undefined;scope.definitions=undefined;scope.ready=false;}};
  },[scope]);
  const load=useCallback(async(lease:object,afterChange=false,expected?:Readback):Promise<boolean>=>{
    if(scope.lease!==lease)return false;
    const owner={};scope.readOwner=owner;scope.ready=false;
    const current=()=>scope.lease===lease&&scope.readOwner===owner;
    setView(previous=>scope.lease===lease?{...previous,scope,readOwner:owner,loading:true,ready:false,errorMessage:undefined,successMessage:undefined}:previous);
    try {
      // Capture the canonical acknowledgement before starting the later read.
      // Compare consumed public values only; secret contents are never compared.
      const acknowledged=expected?captureSettingsRead({definitions:[expected.definition]},{values:[expected.acknowledgement.value]}).values[0]:undefined;
      if(expected&&(!acknowledged||acknowledged.configured!==expected.configured))throw new Error("unconfirmed acknowledgement");
      const acknowledgedValue=expected?consumedValue(expected.definition,acknowledged?.value):undefined;
      const [definitions,values]=await Promise.all([scope.client.listDefinitions(),scope.client.readSettings()]);
      if(!current())return false;
      const captured=captureSettingsRead(definitions,values),valuesByKey=new Map(captured.values.map(row=>[row.key,row]));
      if(expected){
        const definition=captured.definitions.find(row=>row.key===expected.definition.key),value=valuesByKey.get(expected.definition.key);
        if(!definition||definition.valueKind!==expected.definition.valueKind||!value||value.configured!==expected.configured
          ||!Object.is(consumedValue(definition,value.value),acknowledgedValue))throw new Error("unconfirmed readback");
      }
      if(!current())return false;scope.definitions=new Map(captured.definitions.map(row=>[row.key,row]));scope.ready=true;
      setView(previous=>previous.scope===scope&&previous.readOwner===owner?{...previous,definitions:captured.definitions,valuesByKey,ready:true}:previous);
      return true;
    } catch(error) {
      if(current())setView(previous=>previous.scope===scope&&previous.readOwner===owner?{...previous,ready:false,errorMessage:message(error,afterChange
        ?"Could not reload settings after the change. Refresh settings before trying again."
        :"Could not load settings. Refresh settings to try again.")}:previous);
      return false;
    } finally {
      if(current()){
        scope.readOwner=undefined;
        setView(previous=>previous.scope===scope&&previous.readOwner===owner?{...previous,readOwner:undefined,loading:false}:previous);
      }
    }
  },[scope]);
  const refresh=useCallback(async()=>{
    const lease=scope.lease;if(lease&&!scope.actionOwner&&!scope.readOwner)await load(lease);
  },[scope,load]);
  useEffect(()=>{void refresh();},[refresh]);
  const actOnSetting=useCallback(async(kind:Action,key?:string,value?:ApplicationSettingPrimitiveValue):Promise<boolean>=>{
    const lease=scope.lease;
    if(!lease||!scope.ready||scope.readOwner||scope.actionOwner)return false;
    const target=key?.trim(),definition=target?scope.definitions?.get(target):undefined;
    if(kind!=="restart"&&(!target||!definition))return false;
    const owner={};scope.actionOwner=owner;scope.ready=false;
    const current=()=>scope.lease===lease&&scope.actionOwner===owner;
    setView(previous=>scope.lease===lease?{...previous,scope,actionOwner:owner,busy:kind,ready:false,errorMessage:undefined,successMessage:undefined}:previous);
    try {
      if(kind==="restart"){
        const result=await scope.client.restartServer();
        if(!current())return false;if(result.restartRequested!==true)throw new Error("unconfirmed acknowledgement");
        setView(previous=>previous.scope===scope&&previous.actionOwner===owner?{...previous,successMessage:"Server restart requested."}:previous);
        // An acknowledgement is not reconnection proof. An explicit read must
        // succeed before this view can change settings or restart again.
        return true;
      }
      const acknowledgement=kind==="save"?await scope.client.updateSetting({key:target!,value:value!}):await scope.client.clearSetting({key:target!});
      if(!current()||!await load(lease,true,{definition:definition!,configured:kind==="save",acknowledgement})||!current())return false;
      setView(previous=>previous.scope===scope&&previous.actionOwner===owner?{...previous,successMessage:kind==="save"?"Setting saved.":"Setting cleared."}:previous);
      return true;
    } catch(error) {
      if(current()){
        scope.ready=true;
        const fallback=kind==="save"?"Could not save setting. Try again.":kind==="clear"?"Could not clear setting. Try again.":"Could not confirm server restart request. Try again.";
        setView(previous=>previous.scope===scope&&previous.actionOwner===owner?{...previous,ready:true,errorMessage:message(error,fallback)}:previous);
      }
      return false;
    } finally {
      if(current()){
        scope.actionOwner=undefined;
        setView(previous=>previous.scope===scope&&previous.actionOwner===owner?{...previous,actionOwner:undefined,busy:undefined}:previous);
      }
    }
  },[scope,load]);
  const current=view.scope===scope?view:initial(scope);
  return {definitions:current.definitions,valuesByKey:current.valuesByKey,loading:current.loading,ready:current.ready,busy:current.busy,
    errorMessage:current.errorMessage,successMessage:current.successMessage,refresh,updateSetting:(key:string,value:ApplicationSettingPrimitiveValue)=>actOnSetting("save",key,value),
    clearSetting:(key:string)=>actOnSetting("clear",key),restartServer:()=>actOnSetting("restart")};
}
