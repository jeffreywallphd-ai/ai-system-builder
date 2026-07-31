const statusLabels: Record<string,string> = {draft:'Draft',preparing:'Preparing','ready-for-review':'Ready for review','needs-setup':'Needs setup','missing-inputs':'Missing input','missing-outputs':'Missing output','provider-setup-required':'Provider setup required','safety-review-required':'Safety review required',blocked:'Blocked',stale:'Refresh needed',invalid:'Invalid',archived:'Archived'};
export const mapStatus=(s?:string)=>statusLabels[s??'']??'Draft';
export const safeText=(v:unknown,fallback='Not available')=>typeof v==='string'&&v.trim()?v.trim():fallback;

type Counts={steps?:number;missingInputs?:number;missingOutputs?:number;providerSetupRequired?:number;safetyReviewRequired?:number;blockers?:number;diagnostics?:number};
type ResourceEstimate={compute?:string;storage?:string;duration?:string};
type PlanSummary={executionPlanId?:string;plan?:{executionPlanId?:string};executionPlanStatus?:string;status?:string;updatedAt?:string;stepCount?:number;missingInputCount?:number;missingOutputCount?:number;providerSetupRequiredCount?:number;safetyReviewRequiredCount?:number;blockerCount?:number;diagnosticCount?:number;counts?:Counts;resourceEstimateSummary?:ResourceEstimate};
type StepSummary={label?:string;stepStatus?:string;status?:string;summary?:string};
type Detail={summary?:PlanSummary;steps?:StepSummary[];stepSummaries?:StepSummary[];diagnostics?:Array<{message?:string}>;blockers?:Array<{message?:string}>;resourceEstimateSummaries?:Array<{estimate?:ResourceEstimate}>};
const firstEstimate = (summary?: PlanSummary, detail?: Detail) => summary?.resourceEstimateSummary ?? detail?.resourceEstimateSummaries?.find((x)=>x?.estimate)?.estimate ?? {};

export function mapPreview(latest: PlanSummary|undefined, detail: Detail|undefined){
  const summary=detail?.summary ?? latest;
  const steps: StepSummary[]=detail?.stepSummaries ?? detail?.steps ?? [];
  const estimate=firstEstimate(summary, detail);
  return {id:summary?.executionPlanId??summary?.plan?.executionPlanId??'',statusLabel:mapStatus(summary?.executionPlanStatus??summary?.status),updatedAt:summary?.updatedAt??'',counts:{steps:summary?.stepCount??summary?.counts?.steps??0,missingInputs:summary?.missingInputCount??summary?.counts?.missingInputs??0,missingOutputs:summary?.missingOutputCount??summary?.counts?.missingOutputs??0,providerSetupRequired:summary?.providerSetupRequiredCount??summary?.counts?.providerSetupRequired??0,safetyReviewRequired:summary?.safetyReviewRequiredCount??summary?.counts?.safetyReviewRequired??0,blockers:summary?.blockerCount??summary?.counts?.blockers??0,diagnostics:summary?.diagnosticCount??summary?.counts?.diagnostics??0},steps:steps.map((x)=>({label:safeText(x.label,'Planned step'),status:mapStatus(x.stepStatus??x.status),summary:typeof x.summary==='string'?x.summary:''})),issues:[...(detail?.blockers??[]),...(detail?.diagnostics??[])].map((x)=>safeText(x.message,'Needs review')),estimates:{computeCategory:estimate.compute,storageCategory:estimate.storage,durationCategory:estimate.duration}};
}
