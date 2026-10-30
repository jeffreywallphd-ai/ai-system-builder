import type {Page} from "@playwright/test";
import type {FunctionalHost} from "../functional-host-oracles";

export type ArtifactReadMode="inspect"|"list"|"gone"|"isolated"|"readonly-control"|"deny-publication";
type Input={host:FunctionalHost;workspaceId:string;key:string;mode:ArtifactReadMode;bearer?:string;artifactId?:string};
export async function readArtifactHostState(page:Page,input:Input){return page.evaluate(readArtifactHostStateInBrowser,input);}

/** Self-contained real public reads. A single explicit denied POST is the only write-shaped call. */
export async function readArtifactHostStateInBrowser({host,workspaceId,key,mode,bearer,artifactId}:Input){
  if(host!=="packaged-desktop"&&host!=="thin-chrome"||!/^workspace\.[A-Za-z0-9._:-]{1,160}$/.test(workspaceId)||typeof key!=="string"||key.length>1024||!["inspect","list","gone","isolated","readonly-control","deny-publication"].includes(mode))throw new Error("Invalid artifact read context.");
  const token=host==="thin-chrome"?(bearer??localStorage.getItem("ai-system-builder.paired-device-token")):undefined;
  if(host==="thin-chrome"&&(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)))throw new Error("The isolated artifact credential is unavailable.");
  if((mode==="readonly-control"||mode==="deny-publication")&&(host!=="thin-chrome"||!bearer))throw new Error("The read-only artifact identity is required.");
  const api=host==="packaged-desktop"?(window as unknown as {desktopApi?:{
    browseArtifacts(input:unknown,context:unknown):Promise<unknown>;
    readArtifactDetail(locator:unknown,context:unknown):Promise<unknown>;
    readArtifactContentDescriptor(locator:unknown,context:unknown):Promise<unknown>;
    readArtifactViewerMedia(locator:unknown,context:unknown):Promise<unknown>;
  }}).desktopApi:undefined;
  const operations=mode==="list"?["list"]:mode==="deny-publication"?["deny"]:mode==="readonly-control"?["detail"]:mode==="gone"||mode==="isolated"?["detail","media"]:["detail","content","media"];
  const values:Record<string,unknown>={},statuses:Record<string,number>={};
  for(const operation of operations){
    let envelope:unknown;
    if(host==="packaged-desktop"){
      if(!api)throw new Error("The artifact read bridge is unavailable.");
      if(operation==="list")envelope=await api.browseArtifacts({workspaceId},{workspaceId});
      else if(operation==="detail")envelope=await api.readArtifactDetail({storageKey:key},{workspaceId});
      else if(operation==="content")envelope=await api.readArtifactContentDescriptor({storageKey:key},{workspaceId});
      else envelope=await api.readArtifactViewerMedia({storageKey:key},{workspaceId,maximumBytes:4096});
    }else{
      const route=operation==="list"?"/api/artifact/browse":operation==="detail"?"/api/artifact/read":operation==="content"?"/api/artifact/content/read":operation==="deny"?"/api/artifact/publish":"/api/artifact/media/view";
      if(operation==="deny"&&(typeof artifactId!=="string"||artifactId.length<1||artifactId.length>1024))throw new Error("The owned artifact identifier is required.");
      const query=new URLSearchParams({storageKey:key,workspaceId,maximumBytes:"4096"});
      const body=operation==="list"?{workspaceId}:operation==="deny"?{workspaceId,artifactId,target:{provider:"huggingface",repository:"OpenFinAL/ai-system-builder-test",path:"qualification/denied-local-artifact.json"}}:{workspaceId,locator:{storageKey:key}};
      const response=await fetch(operation==="media"?route+"?"+query:route,{method:operation==="media"?"GET":"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},...(operation!=="media"?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15_000)});
      statuses[operation]=response.status;
      if(operation==="media"&&!response.ok){await response.body?.cancel();values.media={missing:response.status===404,isolated:response.status===403||response.status===404};continue;}
      const reader=response.body?.getReader();if(!reader)throw new Error("The artifact response body is unavailable.");
      const maximum=operation==="media"?4096:65536,chunks:Uint8Array[]=[];let bytes=0;
      try{
        for(;;){const next=await reader.read();if(next.done)break;if(!(next.value instanceof Uint8Array)||next.value.byteLength===0||next.value.byteLength>maximum-bytes||chunks.length>=4096)throw new Error("Artifact response limit.");bytes+=next.value.byteLength;chunks.push(next.value);}
      }catch{await reader.cancel().catch(()=>{});throw new Error("The artifact response exceeded its byte bound or was unavailable.");}finally{reader.releaseLock();}
      const content=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}
      if(operation==="media"){envelope={ok:true,value:{bytes:content}};}
      else{
        if(!response.headers.get("content-type")?.includes("application/json"))throw new Error("The artifact response was not JSON.");
        try{envelope=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(content));}catch{throw new Error("The artifact response JSON was invalid.");}
      }
    }
    if(!envelope||typeof envelope!=="object"||!("ok" in envelope))throw new Error("The artifact response envelope is invalid.");
    const result=envelope as {ok:unknown;value?:unknown;error?:{code?:unknown;operation?:unknown}};
    if(operation==="deny"){
      if(statuses.deny!==403||result.ok!==false||result.error?.code!=="forbidden"||result.error.operation!=="security.forbidden")throw new Error("Publication was not refused by the actual route permission check.");
      return {authenticatedRouteDenied:true,status:403,permission:"artifact:write"};
    }
    if(result.ok!==true){
      const missing=result.error?.code==="not-found"&&(host==="packaged-desktop"||statuses[operation]===404),isolated=missing||(result.error?.code==="forbidden"||result.error?.code==="security.forbidden")&&(host==="packaged-desktop"||statuses[operation]===403);
      if(mode!=="gone"&&mode!=="isolated"||operation!=="detail"&&operation!=="media")throw new Error("The artifact read did not succeed.");
      values[operation]={missing,isolated};continue;
    }
    if(host==="thin-chrome"&&((statuses[operation]??0)<200||(statuses[operation]??0)>=300))throw new Error("The artifact HTTP read did not succeed.");
    if(!result.value||typeof result.value!=="object")throw new Error("The artifact read value is invalid.");
    if(operation==="list"){
      const v=result.value as {items?:unknown;nextCursor?:unknown};if(!Array.isArray(v.items)||v.items.length>20||v.nextCursor!==undefined)throw new Error("The artifact list is incomplete.");
      return v.items.map(item=>{
        if(!item||typeof item!=="object")throw new Error("The artifact item is invalid.");const row=item as Record<string,unknown>;
        for(const field of ["storageKey","artifactId","originalName"])if(typeof row[field]!=="string"||(row[field] as string).length>1024)throw new Error("The artifact item projection is invalid.");
        return {storageKey:row.storageKey as string,artifactId:row.artifactId as string,originalName:row.originalName as string};
      });
    }
    if(operation==="media"){
      const raw=(result.value as {bytes?:unknown}).bytes;
      let bytes:Uint8Array;
      if(raw instanceof ArrayBuffer)bytes=new Uint8Array(raw);
      else if(ArrayBuffer.isView(raw))bytes=new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);
      else if(raw&&typeof raw==="object"){
        const array=Array.isArray(raw);if(array&&raw.length>4096)throw new Error("The artifact media exceeded its bound.");
        const keys=Reflect.ownKeys(raw);if(keys.length>4096+(array?1:0)||!array&&![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new Error("The artifact media bytes are invalid.");
        const fields=Object.getOwnPropertyDescriptors(raw),length=array?raw.length:keys.length;
        if(length>4096||keys.length!==length+(array?1:0))throw new Error("The artifact media bytes are invalid.");
        const captured:number[]=[];
        for(let i=0;i<length;i++){const field=fields[String(i)];if(!field||!("value" in field)||!Number.isInteger(field.value)||field.value<0||field.value>255)throw new Error("The artifact media bytes are invalid.");captured.push(field.value);}
        bytes=new Uint8Array(captured);
      }else throw new Error("The artifact media bytes are invalid.");
      if(bytes.byteLength>4096)throw new Error("The artifact media exceeded its bound.");
      const digest=await crypto.subtle.digest("SHA-256",bytes.slice().buffer);
      values.media={sizeBytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")};
    }else values[operation]=result.value;
  }
  if(mode==="gone"||mode==="isolated"){
    const detail=values.detail as {missing?:boolean;isolated?:boolean},media=values.media as {missing?:boolean;isolated?:boolean};
    if(mode==="gone"?!detail?.missing||!media?.missing:!detail?.isolated||!media?.isolated)throw new Error("The artifact remains readable or its absence is unproved.");
    return {requestedWorkspaceId:workspaceId,storageKey:key,absent:mode==="gone",isolated:mode==="isolated"};
  }
  const detail=(values.detail as {artifact?:Record<string,unknown>})?.artifact,locator=detail?.locator as {storageKey?:unknown}|undefined;
  if(!detail||locator?.storageKey!==key)throw new Error("The artifact detail does not match its requested key.");
  if(mode==="readonly-control")return {authenticatedReadSucceeded:true,storageKey:key};
  const content=(values.content as {content?:{availability?:unknown;locator?:{storageKey?:unknown}}})?.content,media=values.media as {sizeBytes:number;sha256:string},metadata=detail.metadata as {importedSourceBacking?:unknown;publishedBacking?:unknown}|undefined;
  if(metadata!==undefined&&(!metadata||typeof metadata!=="object"||Array.isArray(metadata)))throw new Error("The artifact backing metadata is invalid.");
  if(content?.locator?.storageKey!==key||typeof detail.originalName!=="string"||detail.originalName.length>128||typeof detail.sourceKind!=="string"||detail.sourceKind.length>32||detail.sizeBytes!==media.sizeBytes)throw new Error("The artifact content and detail do not agree.");
  return {requestedWorkspaceId:workspaceId,storageKey:key,originalName:detail.originalName,sourceKind:detail.sourceKind,sizeBytes:media.sizeBytes,sha256:media.sha256,contentAvailable:content.availability==="available",hasImportedBacking:Boolean(metadata?.importedSourceBacking),hasPublishedBacking:Boolean(metadata?.publishedBacking)};
}
