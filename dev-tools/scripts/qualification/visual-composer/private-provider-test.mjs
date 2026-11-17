import {test} from "@playwright/test";
import playwrightPackage from "@playwright/test/package.json" with {type:"json"};
import {runPrivateProviderArtifactBoundary} from "./private-provider-artifact-boundary.mjs";

if(playwrightPackage.version!=="1.61.1")throw new Error("Private-provider tests require review of the installed recording fixture before use.");

// Playwright 1.61.1's _setupArtifacts also installs context-option forwarding
// and resets the timeout. Preserve those functions, but never construct its
// recorder or diagnostic hooks. Ordinary browser/context/request fixtures own
// closure and remain unchanged. Focused supplier tests pin this private seam.
export const privateProviderTest=test.extend({
  _setupArtifacts:[async({playwright,_combinedContextOptions},use,testInfo)=>{
    await runPrivateProviderArtifactBoundary(playwright,_combinedContextOptions,use,testInfo);
  },{auto:"all-hooks-included",title:"private test context options",box:true,timeout:0}],
});
