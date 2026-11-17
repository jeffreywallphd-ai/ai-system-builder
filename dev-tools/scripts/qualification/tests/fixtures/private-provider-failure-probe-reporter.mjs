import {lstatSync,realpathSync,writeFileSync} from "node:fs";
import path from "node:path";
import FixedPrivateProviderReporter from "../../visual-composer/fixed-private-provider-reporter.mjs";
function syntheticRoot(){
  const root=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT;
  if(!["control","protected"].includes(process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE)||!root||!path.isAbsolute(root)||realpathSync(root)!==root||!lstatSync(root).isDirectory()||!path.basename(root).startsWith("private-provider-privacy-")||process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST==="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG!==undefined)throw new Error("Only isolated synthetic failures may use this reporter.");
  return root;
}
export default class SyntheticProbeReporter extends FixedPrivateProviderReporter{
  constructor(options){super(options);this.expectedBodyErrors=0;this.errorCount=0;}
  onTestEnd(test,result){
    syntheticRoot();
    super.onTestEnd(test,result);
    // This separate, gated synthetic reporter compares only a known fake
    // sentinel. No live reporter reads errors; no raw message is persisted.
    const errors=Object.getOwnPropertyDescriptor(result,"errors")?.value;
    if(!Array.isArray(errors)||errors.length>8)throw new Error("The synthetic failure list is invalid.");
    this.errorCount+=errors.length;
    for(const error of errors){
      const message=error&&Object.getOwnPropertyDescriptor(error,"message")?.value;
      if(message==="SYNTHETIC_PRIVATE_FAILURE_CANARY_NOT_A_CREDENTIAL"||message==="Error: SYNTHETIC_PRIVATE_FAILURE_CANARY_NOT_A_CREDENTIAL")this.expectedBodyErrors++;
    }
  }
  printsToStdio(){return process.env.AISB_PRIVATE_PROVIDER_FALLBACK_CONTROL!=="1";}
  onEnd(result){
    const root=syntheticRoot(),outcome=super.onEnd(result);
    writeFileSync(path.join(root,"reporter-observation.json"),JSON.stringify({schema_version:"private-provider-synthetic-reporter-v1",suite_status:["passed","failed","timedout","interrupted"].includes(result.status)?result.status:"unknown",cases:this.cases,framework_errors:this.frameworkErrors,expected_body_errors:this.expectedBodyErrors,error_count:this.errorCount,synthetic_error_compared:true,raw_error_persisted:false})+"\n",{flag:"wx"});
    return outcome;
  }
}
