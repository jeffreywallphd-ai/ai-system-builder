import {defineConfig} from "@playwright/test";
import {lstatSync,realpathSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url)),root=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT;
if(!["control","protected"].includes(process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE)||!root||!path.isAbsolute(root)||realpathSync(root)!==root||!lstatSync(root).isDirectory()||!path.basename(root).startsWith("private-provider-privacy-")||process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST==="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG!==undefined||![undefined,"1"].includes(process.env.AISB_PRIVATE_PROVIDER_LOADER_PROBE))throw new Error("The synthetic failure probe was not admitted.");
process.env.PLAYWRIGHT_NO_COPY_PROMPT="1";
// Exactly one finite synthetic case. maxFailures:1 adds a runner-level
// stop notice for its intentional failure; that is unrelated fixture noise.
export default defineConfig({build:{external:["**/*.mjs"]},globalSetup:process.env.AISB_PRIVATE_PROVIDER_LOADER_PROBE==="1"?path.join(here,"functional-provider-loader-proof.mjs"):undefined,testDir:here,testMatch:"private-provider-failure-probe.spec.mjs",outputDir:path.join(root,"output"),workers:1,retries:0,maxFailures:0,timeout:2000,preserveOutput:"always",use:{screenshot:"off",trace:"off",video:"off",acceptDownloads:false},reporter:[[path.join(here,"private-provider-failure-probe-reporter.mjs")]],projects:[{name:"thin-chrome"}]});
