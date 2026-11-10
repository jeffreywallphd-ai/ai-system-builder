/** Synthetic-only writer tripwire. Never used by a live/private/browser test. */
import {test as base} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {privateProviderTest} from "../../visual-composer/private-provider-test.mjs";
const mode=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE,root=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT;
if(!["control","protected"].includes(mode)||!root)throw new Error("The synthetic probe input is missing.");
const selected=mode==="protected"?privateProviderTest:base;
const test=selected.extend({
  _syntheticWriteTripwire:[async({},use)=>{
    let writeAttempts=0;
    const original=fs.promises.writeFile;
    fs.promises.writeFile=async function(file,...args){
      if(typeof file==="string"&&path.basename(file)==="error-context.md"){
        writeAttempts++;
        throw new Error("The synthetic failure-context write was refused before persistence.");
      }
      return Reflect.apply(original,fs.promises,[file,...args]);
    };
    // Keep the synthetic-only tripwire armed through the default recorder's
    // later fixture teardown. This one-test worker exits after its failure.
    process.once("exit",()=>{
      try{fs.writeFileSync(path.join(root,"worker-observation.json"),JSON.stringify({schema_version:"private-provider-synthetic-write-tripwire-v1",mode,error_context_write_attempts:writeAttempts,no_browser_requested:true,no_credentials_read:true})+"\n",{flag:"wx"});}
      catch{process.exitCode=1;}
    });
    await use();
  },{auto:"all-hooks-included",timeout:0}],
});
test("thin client provider source registers an exact reference and optional localized bytes",async()=>{
  throw new Error("SYNTHETIC_PRIVATE_FAILURE_CANARY_NOT_A_CREDENTIAL");
});
