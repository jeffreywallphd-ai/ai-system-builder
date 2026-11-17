export const SETTINGS_HOST_CASES:readonly ["public-values","secret-defaults"];
export function settingsHostLayout(repoRoot:string,runId:string,sourceRevision:string):Readonly<{dataRoot:string;desktopDataRoot:string;serverStorageRoot:string;serverRuntimeRoot:string}>;
export function createSettingsHostEnvironment(input:Record<string,string|undefined>,repoRoot:string,runId:string,sourceRevision:string,target:"packaged-desktop"|"thin-chrome",caseId?:"public-values"|"secret-defaults"):Record<string,string>;
export interface SettingsHostLaunchPlan {
  repoRoot:string;runId:string;
  paths:{qualificationRoot:string;runRoot:string;evidencePath:string;desktopDataRoot:string;thinStorageRoot:string;thinRuntimeRoot:string};
  serverOrigin:URL;thinClientOrigin:URL;runtimeOrigin:URL;
  server:{command:string;args:string[];cwd:string;env:Record<string,string>};
  thinClient:{command:string;args:string[];cwd:string;env:Record<string,string>};
  desktop:{executablePath:string;args:string[];env:Record<string,string>;seed:{command:string;args:string[];cwd:string;env:Record<string,string>}};
}
export function createSettingsHostLaunchPlan(options:{repoRoot:string;runId:string;sourceRevision:string;target:"packaged-desktop"|"thin-chrome";environment:Record<string,string|undefined>}):Promise<SettingsHostLaunchPlan>;
