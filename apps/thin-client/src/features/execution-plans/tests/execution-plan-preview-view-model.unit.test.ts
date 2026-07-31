import { describe, expect, it } from 'vitest';
import { mapPreview, mapStatus } from '../components/executionPlanPreviewViewModel';

describe('executionPlanPreviewViewModel', ()=>{
  it('maps status labels', ()=>{ expect(mapStatus('ready-for-review')).toBe('Ready for review'); expect(mapStatus('stale')).toBe('Refresh needed'); });
  it('sanitizes preview basics', ()=>{ const vm=mapPreview({executionPlanId:'p1',status:'missing-inputs',counts:{missingInputs:2}},{steps:[{label:'',status:'planned'}],diagnostics:[{message:''}]}); expect(vm.statusLabel).toBe('Missing input'); expect(vm.steps[0].label).toBe('Planned step'); expect(vm.issues[0]).toBe('Needs review');});
  it('maps the first resource estimate into display categories', ()=>{ const vm=mapPreview(undefined,{resourceEstimateSummaries:[{estimate:{compute:'medium',storage:'small',duration:'short'}}]}); expect(vm.estimates).toEqual({computeCategory:'medium',storageCategory:'small',durationCategory:'short'}); });
});
