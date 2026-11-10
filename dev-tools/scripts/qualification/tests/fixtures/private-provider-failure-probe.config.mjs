import {defineConfig} from "@playwright/test";
import {lstatSync,realpathSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url)),root=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT;
if(!["control","protected"].includes(process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE)||!root||!path.isAbsolute(root)||realpathSync(root)!==root||!lstatSync(root).isDirectory()||!path.basename(root).startsWith("private-provider-privacy-"))throw new Error("The synthetic failure probe was not admitted.");
process.env.PLAYWRIGHT_NO_COPY_PROMPT="1";
export default defineConfig({testDir:here,testMatch:"private-provider-failure-probe.spec.mjs",outputDir:path.join(root,"output"),workers:1,retries:0,maxFailures:1,timeout:2000,preserveOutput:"always",use:{screenshot:"off",trace:"off",video:"off",acceptDownloads:false},reporter:[[path.join(here,"private-provider-failure-probe-reporter.mjs")]],projects:[{name:"thin-chrome"}]});
