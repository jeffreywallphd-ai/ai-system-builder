import type {SettingsHostLaunchPlan} from "./settings-host-launch-plan.mjs";
export {settingsHostLayout as functionalHostLayout} from "./settings-host-launch-plan.mjs";
export function createFunctionalHostEnvironment(input:Record<string,string|undefined>,repoRoot:string,runId:string,sourceRevision:string,target:"packaged-desktop"|"thin-chrome",caseId?:"model-reference"|"artifact-local"):Record<string,string>;
export function createFunctionalHostLaunchPlan(options:{repoRoot:string;runId:string;sourceRevision:string;target:"packaged-desktop"|"thin-chrome";environment:Record<string,string|undefined>}):Promise<SettingsHostLaunchPlan>;
