import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolveVisualComposerQualificationPaths} from "./visual-composer-qualification-core.mjs";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../..");
const {createThinClientViteConfig}=await import(pathToFileURL(path.join(repoRoot,"apps/thin-client/vite.config.ts")).href);

/** Test-only config: use the real UI and proxy without loading operator files. */
export default async function qualificationThinConfig({command}){
  if(command!=="serve")throw new Error("Thin-client qualification configuration is only for the local test server.");
  const runId=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  const proxy=process.env.AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET;
  const managed=runId?.startsWith("managed-");
  const runPattern=managed ? /^managed-[a-f0-9]{32}$/ : /^[a-z0-9-]{20,80}$/;
  const proxyPattern=managed ? /^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/ : /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
  if(!runPattern.test(runId??"")||!/^source\.[a-f0-9]{64}$/.test(source??"")||!proxyPattern.test(proxy??"")){
    throw new Error("The thin-client test needs its fixed source and loopback API proxy.");
  }
  const layout=resolveVisualComposerQualificationPaths(repoRoot,runId);
  const config=await createThinClientViteConfig({
    AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED:"false",
    AI_SYSTEM_BUILDER_HTTPS_ENABLED:"false",
    AI_SYSTEM_BUILDER_TLS_CERT_MODE:"manual",
    AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET:proxy,
  },"serve");
  return {...config,envFile:false,cacheDir:path.join(layout.thinRuntimeRoot,"vite-cache")};
}
