import path from "node:path";
import {types} from "node:util";
import {createSettingsHostEnvironment,createSettingsHostLaunchPlan,settingsHostLayout} from "./settings-host-launch-plan.mjs";

// Reuse the reviewed closed OS environment and physical fresh-run layout. The
// wrapper supplies its own truthful purpose, case slot and shutdown entry.
export const functionalHostLayout=settingsHostLayout;
export function createFunctionalHostEnvironment(input,repoRoot,runId,sourceRevision,target,caseId){
  if(caseId!==undefined&&!["model-reference","artifact-local","provider-source","provider-publication"].includes(caseId)||target==="thin-chrome"&&caseId!==undefined)throw new Error("Unsupported functional host case.");
  const env=createSettingsHostEnvironment(input,repoRoot,runId,sourceRevision,target);
  if(caseId)env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT=path.join(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,`functional-${caseId}`);
  // All cache roots must follow this case's actual data root.
  const cache=path.join(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,"controlled-model-cache");
  Object.assign(env,{HF_HUB_CACHE:cache,HF_HOME:path.join(cache,"hf-home"),TRANSFORMERS_CACHE:path.join(cache,"transformers"),HF_DATASETS_CACHE:path.join(cache,"datasets"),TORCH_HOME:path.join(cache,"torch")});
  return env;
}
export async function createFunctionalHostLaunchPlan(options){
  // Project a finite fixture mode through the closed child environment. Provider
  // credentials and arbitrary caller fields still do not cross this boundary.
  const input=options.environment;
  if(!input||typeof input!=="object"||types.isProxy(input))throw new Error("Invalid Functional provider test mode.");
  const fields=Object.getOwnPropertyDescriptors(input);
  const names=["VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT","VISUAL_COMPOSER_FUNCTIONAL_METADATA","VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE","VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION"];
  if(fields.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_TRANSPORT||names.some(key=>fields[key]&&(!("value" in fields[key])||![undefined,"0","1"].includes(fields[key].value))))throw new Error("Invalid Functional provider test mode.");
  const enabled=key=>fields[key]?.value==="1";
  const source=enabled(names[2]),publication=enabled(names[3]);
  if((source||publication)&&(enabled(names[0])||enabled(names[1]))||publication&&options.target==="thin-chrome")throw new Error("Conflicting Functional provider test modes.");
  const plan=await createSettingsHostLaunchPlan(options);
  plan.server.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_TRANSPORT=source&&!publication?"private-source":"deny";
  plan.server.args[plan.server.args.length-1]=path.join(options.repoRoot,"dev-tools/scripts/qualification/visual-composer/functional-host-server-entry.ts");
  return plan;
}
