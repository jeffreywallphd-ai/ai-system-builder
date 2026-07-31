import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEffectiveAssetProjectionValidationService, defaultEffectiveAssetProjectionDiagnosticsService, defaultEffectiveAssetProjectionConflictBlockingService, defaultEffectiveAssetProjectionReadinessService } from '../index';

test('validation passes for safe candidate', ()=>{
  const r = defaultEffectiveAssetProjectionValidationService.validate({targetWorkspaceId:'workspace.main',sourceWorkspaceId:'workspace.main',sourceKind:'workspace-authored',policy:'safe-fields-only'} as any);
  assert.equal(r.ok,true);
});

test('validation fails missing workspace', ()=>{
  const r = defaultEffectiveAssetProjectionValidationService.validate({sourceKind:'workspace-authored',policy:'safe-fields-only'} as any);
  assert.equal(r.ok,false);
});

test('diagnostics are sanitized', ()=>{
  const d = defaultEffectiveAssetProjectionDiagnosticsService.createDiagnostic('effective-projection-source-missing',{danger:'/tmp/path' as any});
  assert.equal(d.message,'Sanitized projection diagnostic.');
});

test('conflict classifier handles missing source', ()=>{
  const r = defaultEffectiveAssetProjectionConflictBlockingService.classify({sourceMissing:true});
  assert.equal(r.status,'source-missing');
});

test('readiness only ready status is consumable for downstream planning', ()=>{
  assert.equal(defaultEffectiveAssetProjectionReadinessService.isProjectionConsumable('ready'), true);
  assert.equal(defaultEffectiveAssetProjectionReadinessService.isProjectionConsumable('blocked'), false);
});
