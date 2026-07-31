import { describe, expect, it } from 'vitest';
import { mapAvailabilityLabel, mapBindingStatusLabel, mapCapabilityLabel, mapReadinessStatusLabel, mapRuntimeSetup } from './runtimeSetupViewModel';

describe('runtimeSetupViewModel',()=>{
 it('maps status labels',()=>{expect(mapReadinessStatusLabel('ready-for-setup')).toBe('Ready for setup'); expect(mapAvailabilityLabel('not-configured')).toBe('Needs configuration'); expect(mapBindingStatusLabel('bound')).toBe('Selected'); expect(mapCapabilityLabel('text-generation')).toBe('Text generation');});
 it('sanitizes unsafe diagnostics',()=>{const vm=mapRuntimeSetup({summary:{readinessStatus:'blocked'},blockers:[{message:'token=abc'}],diagnostics:[{message:'Needs configuration'}],requirements:[],providerCandidates:[],selectedBindings:[]},undefined); expect(vm.issues).toEqual(['Needs configuration']);});
});
