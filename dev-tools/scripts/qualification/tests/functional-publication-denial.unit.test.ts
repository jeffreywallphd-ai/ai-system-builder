import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createServer} from "node:http";
import {createHmac} from "node:crypto";
import {createLanBearerTokenVerifierAdapter} from "../../../../modules/adapters/security/lan/createLanBearerTokenVerifierAdapter";
import {createExpressSecurityMiddleware} from "../../../../modules/adapters/transport/api-express/security/createExpressSecurityMiddleware";
import {getExpressAuthContext} from "../../../../modules/adapters/transport/api-express/security/expressAuthContext";
import {registerArtifactRepoApiRoutes} from "../../../../modules/adapters/transport/api-express/artifact-repo/registerArtifactRepoApiRoutes";
import {createTenantPlacementConfig} from "../../../../modules/contracts/config";
import {PublishArtifactToRepoUseCase} from "../../../../modules/application/use-cases/publish-artifact-to-repo.use-case";

/** Real loopback HTTP/HMAC/auth/route denial; positive workspace data is a finite fixture. No TLS or provider pass. */
test("an authenticated read-only LAN identity receives route403 before actual publication delegates",{timeout:15_000},async()=>{
  const secret="public-synthetic-hmac-fixture",readonly="r".repeat(43),primary="p".repeat(43),hash=(v:string)=>createHmac("sha256",secret).update(v).digest("hex"),expiresAt=new Date(Date.now()+60_000).toISOString();
  const records=[{deviceId:"readonly-fixture",deviceName:"Read only",tokenHash:hash(readonly),scopes:["artifact:read","workspace:read"],createdAt:new Date().toISOString(),expiresAt},{deviceId:"primary-fixture",deviceName:"Primary",tokenHash:hash(primary),scopes:["artifact:read","artifact:write","workspace:read"],createdAt:new Date().toISOString(),expiresAt}];
  const verifier=createLanBearerTokenVerifierAdapter({tokenHashSecret:secret,findCredentialByTokenHash:async({tokenHash})=>records.find(r=>r.tokenHash===tokenHash)});
  let effects=0;const forbidden=new Proxy(Object.create(null),{get(){effects++;throw new Error("Unexpected storage/provider delegate.");}}),publish=new PublishArtifactToRepoUseCase({artifactStorage:forbidden,artifactCatalogRead:forbidden,artifactRepoStorage:forbidden,artifactBindingStorage:forbidden});
  const app=express();app.use(express.json({limit:"16kb"}));
  app.use(createExpressSecurityMiddleware({verifyToken:r=>verifier.verifyToken(r),httpsRequired:false,authRequired:true,mode:"lan-https-token",tenantPlacement:createTenantPlacementConfig({mode:"dedicated",organizationId:"qualification.local"})}));
  app.get("/api/workspaces",(req,res)=>{const auth=getExpressAuthContext(req);res.json({authenticated:auth?.authenticated,principalId:auth?.principal.principalId,scopes:auth?.principal.scopes});});
  registerArtifactRepoApiRoutes({app,publishArtifactToRepoUseCase:publish} as unknown as Parameters<typeof registerArtifactRepoApiRoutes>[0]);
  const server=createServer(app);await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.off("error",reject);resolve();});});
  try{
    const address=server.address();assert(address&&typeof address!=="string");const origin=`http://127.0.0.1:${address.port}`;
    const control=await fetch(origin+"/api/workspaces",{headers:{authorization:"Bearer "+readonly},signal:AbortSignal.timeout(5000)});assert.equal(control.status,200);assert.deepEqual(await control.json(),{authenticated:true,principalId:"readonly-fixture",scopes:["artifact:read","workspace:read"]});
    const body={workspaceId:"workspace.artifact-denial",artifactId:"uploads/known-synthetic.json",target:{provider:"huggingface",repository:"OpenFinAL/ai-system-builder-test",path:"qualification/denied.json"}};
    const denied=await fetch(origin+"/api/artifact/publish",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+readonly},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});assert.equal(denied.status,403);const value=await denied.json() as {ok:boolean;error:{code:string;operation:string}};assert.equal(value.ok,false);assert.equal(value.error.code,"forbidden");assert.equal(value.error.operation,"security.forbidden");assert.equal(effects,0);
    const invalid=await fetch(origin+"/api/artifact/publish",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer invalid-synthetic"},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});assert.equal(invalid.status,401);await invalid.arrayBuffer();assert.equal(effects,0);
    const stillValid=await fetch(origin+"/api/workspaces",{headers:{authorization:"Bearer "+primary},signal:AbortSignal.timeout(5000)});assert.equal(stillValid.status,200);assert.equal((await stillValid.json() as {principalId:string}).principalId,"primary-fixture");assert.equal(effects,0);
  }finally{await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
});
