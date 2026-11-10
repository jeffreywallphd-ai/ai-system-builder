/** Fixed metadata only. Never inspect error objects, output chunks or attachments. */
const titles=new Map([
  ["thin client provider source registers an exact reference and optional localized bytes","thin-source"],
  ["packaged desktop provider source registers an exact reference and optional localized bytes","desktop-source"],
  ["packaged desktop private artifact publication records local branch and remote commit","desktop-publication"],
]);
const statuses=new Set(["passed","failed","skipped","timedOut","interrupted"]);
const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000;
export function summarizePrivateProviderRun({mode,host,sourceRequested,publicationRequested,suiteStatus,cases,frameworkErrors}){
  if(!["test","list","merge"].includes(mode)||!["thin-chrome","packaged-desktop","unknown"].includes(host)||typeof sourceRequested!=="boolean"||typeof publicationRequested!=="boolean"||!["passed","failed","timedout","interrupted","unknown"].includes(suiteStatus)||!Array.isArray(cases)||cases.length>3||!validCount(frameworkErrors))throw new Error("The private test summary is invalid.");
  const permitted=host==="thin-chrome"?["thin-source"]:host==="packaged-desktop"?["desktop-source","desktop-publication"]:[];
  const expected=permitted.filter(id=>id.endsWith("source")?sourceRequested:publicationRequested);
  const results=cases.map(value=>{
    if(!value||![...titles.values(),"unknown"].includes(value.id)||!statuses.has(value.status)||!validCount(value.duration_ms))throw new Error("The private test result is invalid.");
    return{id:value.id,status:value.status,duration_ms:value.duration_ms};
  });
  const unique=new Set(results.map(v=>v.id));
  const scopeValid=permitted.length>0&&expected.length>0&&!(host==="thin-chrome"&&publicationRequested);
  const localSatisfied=mode==="test"&&scopeValid&&suiteStatus==="passed"&&frameworkErrors===0&&unique.size===results.length
    &&expected.every(id=>results.some(v=>v.id===id&&v.status==="passed"))
    &&results.every(v=>permitted.includes(v.id)&&(expected.includes(v.id)?v.status==="passed":v.status==="skipped"));
  return{schema_version:"fixed-private-provider-run-v1",mode,host,expected_cases:expected,results,framework_errors:frameworkErrors,suite_status:suiteStatus,executed:results.filter(v=>v.status!=="skipped").length,skipped:results.filter(v=>v.status==="skipped").length,local_case_outcomes_satisfied:localSatisfied,raw_failure_text_recorded:false,raw_output_forwarded:false,qualification_granted:false};
}
export default class FixedPrivateProviderReporter{
  constructor(options={}){
    this.mode=["test","list","merge"].includes(options._mode)?options._mode:"test";
    this.host="unknown";this.cases=[];this.frameworkErrors=0;
    this.sourceRequested=process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE==="1";
    this.publicationRequested=process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION==="1";
  }
  // Returning false makes installed Playwright add a raw line/dot reporter.
  printsToStdio(){return true;}
  onBegin(config){
    if(Array.isArray(config.projects)&&config.projects.length===1&&["thin-chrome","packaged-desktop"].includes(config.projects[0].name))this.host=config.projects[0].name;
  }
  onStdOut(){}
  onStdErr(){}
  onError(){this.frameworkErrors=Math.min(this.frameworkErrors+1,1_000_000);}
  onTestEnd(test,result){
    if(this.cases.length>=3){this.onError();return;}
    try{
      const id=titles.get(test.title)??"unknown",status=statuses.has(result.status)?result.status:"failed";
      const duration_ms=Number.isFinite(result.duration)&&result.duration>=0&&result.duration<=1_000_000?Math.round(result.duration):0;
      this.cases.push({id,status,duration_ms});
    }catch{this.onError();}
  }
  onEnd(result){
    let report;
    try{report=summarizePrivateProviderRun({mode:this.mode,host:this.host,sourceRequested:this.sourceRequested,publicationRequested:this.publicationRequested,suiteStatus:["passed","failed","timedout","interrupted"].includes(result.status)?result.status:"unknown",cases:this.cases,frameworkErrors:this.frameworkErrors});}
    catch{report={schema_version:"fixed-private-provider-run-v1",local_case_outcomes_satisfied:false,raw_failure_text_recorded:false,raw_output_forwarded:false,qualification_granted:false};}
    process.stdout.write(JSON.stringify(report)+"\n");
    if(this.mode==="test"&&!report.local_case_outcomes_satisfied)return{status:"failed"};
  }
}
