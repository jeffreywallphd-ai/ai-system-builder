import path from "node:path";
import {createSettingsHostEnvironment,createSettingsHostLaunchPlan,settingsHostLayout} from "./settings-host-launch-plan.mjs";

// Reuse the reviewed closed OS environment and physical fresh-run layout. The
// wrapper supplies its own truthful purpose, case slot and shutdown entry.
export const functionalHostLayout=settingsHostLayout;
export function createFunctionalHostEnvironment(input,repoRoot,runId,sourceRevision,target,caseId){
  if(caseId!==undefined&&!["model-reference","artifact-local"].includes(caseId)||target==="thin-chrome"&&caseId!==undefined)throw new Error("Unsupported functional host case.");
  const env=createSettingsHostEnvironment(input,repoRoot,runId,sourceRevision,target);
  if(caseId)env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT=path.join(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,`functional-${caseId}`);
  // All cache roots must follow this case's actual data root.
  const cache=path.join(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,"controlled-model-cache");
  Object.assign(env,{HF_HUB_CACHE:cache,HF_HOME:path.join(cache,"hf-home"),TRANSFORMERS_CACHE:path.join(cache,"transformers"),HF_DATASETS_CACHE:path.join(cache,"datasets"),TORCH_HOME:path.join(cache,"torch")});
  return env;
}
export async function createFunctionalHostLaunchPlan(options){
  const plan=await createSettingsHostLaunchPlan(options);
  plan.server.args[plan.server.args.length-1]=path.join(options.repoRoot,"dev-tools/scripts/qualification/visual-composer/functional-host-server-entry.ts");
  return plan;
}
