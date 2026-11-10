import {writeFileSync} from "node:fs";
import path from "node:path";
import FixedPrivateProviderReporter from "../../visual-composer/fixed-private-provider-reporter.mjs";
export default class SyntheticProbeReporter extends FixedPrivateProviderReporter{
  printsToStdio(){return process.env.AISB_PRIVATE_PROVIDER_FALLBACK_CONTROL!=="1";}
  onEnd(result){
    const outcome=super.onEnd(result),root=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT;
    if(!root)throw new Error("The synthetic output root is missing.");
    writeFileSync(path.join(root,"reporter-observation.json"),JSON.stringify({schema_version:"private-provider-synthetic-reporter-v1",suite_status:["passed","failed","timedout","interrupted"].includes(result.status)?result.status:"unknown",cases:this.cases,framework_errors:this.frameworkErrors,raw_error_inspected:false})+"\n",{flag:"wx"});
    return outcome;
  }
}
