import { describe, expect, it, testDouble } from '../../../../testing/node-test';
import { registerExecutionPlanApiRoutes, type ExpressRoutePort } from '../execution-plans/registerExecutionPlanApiRoutes';

function response() { const json = testDouble.fn(); const status = testDouble.fn(); const res: any = { status: status.mockImplementation(() => res), json }; return { res, json, status }; }

describe('registerExecutionPlanApiRoutes', () => {
  it('registers full route family and returns api-success envelope', async () => {
    const gets = new Map<string, any>(); const posts = new Map<string, any>();
    const app: ExpressRoutePort = { get: testDouble.fn((p, h) => gets.set(p, h)), post: testDouble.fn((p, h) => posts.set(p, h)) };
    const readModel = {
      listExecutionPlanSummaries: testDouble.fn(async () => ({ summaries: [] })), readExecutionPlanDetail: testDouble.fn(async () => ({})),
      listExecutionPlansForCompositionPlan: testDouble.fn(async () => []), readLatestExecutionPlanForCompositionPlan: testDouble.fn(async () => undefined),
      listExecutionPlansForRuntimeReadinessBinding: testDouble.fn(async () => []), readLatestExecutionPlanForRuntimeReadinessBinding: testDouble.fn(async () => undefined),
      listExecutionPlansNeedingAttention: testDouble.fn(async () => []), summarizeWorkspaceExecutionPlans: testDouble.fn(async () => ({ total: 0 })),
    } as any;
    registerExecutionPlanApiRoutes({ app, executionPlans: { create: { execute: testDouble.fn(async (x) => x) } as any, validate: { execute: testDouble.fn(async (x) => x) } as any, readModel } });

    expect(posts.has('/api/execution-plans/workspaces/:workspaceId/plans/:executionPlanId/archive')).toBe(true);
    expect(gets.has('/api/execution-plans/workspaces/:workspaceId/runtime-readiness-bindings/:runtimeReadinessBindingId/latest')).toBe(true);

    const r = response();
    await gets.get('/api/execution-plans/workspaces/:workspaceId/summary')({ params: { workspaceId: 'ws.1' } }, r.res);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json.mock.calls[0][0]).toMatchObject({ ok: true, operation: 'execution-plans.preview' });
  });

  it('returns validation on workspace mismatch, validation on bad limit, unavailable on missing archive, and sanitized internal on throw', async () => {
    const gets = new Map<string, any>(); const posts = new Map<string, any>();
    const app: ExpressRoutePort = { get: testDouble.fn((p, h) => gets.set(p, h)), post: testDouble.fn((p, h) => posts.set(p, h)) };
    registerExecutionPlanApiRoutes({ app, executionPlans: {
      create: { execute: testDouble.fn() } as any,
      validate: { execute: testDouble.fn(async () => { throw new Error('/tmp/token'); }) } as any,
      readModel: { listExecutionPlanSummaries: testDouble.fn(async () => ({ summaries: [] })) } as any,
    } });

    const a = response();
    await posts.get('/api/execution-plans/workspaces/:workspaceId/plans')({ params: { workspaceId: 'ws.1' }, body: { workspaceId: 'ws.2', runtimeReadinessBindingId: 'rr.1' } }, a.res);
    expect(a.status).toHaveBeenCalledWith(400);

    const b = response();
    await gets.get('/api/execution-plans/workspaces/:workspaceId/plans')({ params: { workspaceId: 'ws.1' }, query: { limit: 'x' } }, b.res);
    expect(b.status).toHaveBeenCalledWith(400);

    const c = response();
    await posts.get('/api/execution-plans/workspaces/:workspaceId/plans/:executionPlanId/archive')({ params: { workspaceId: 'ws.1', executionPlanId: 'ep.1' } }, c.res);
    expect(c.status).toHaveBeenCalledWith(501);

    const d = response();
    await posts.get('/api/execution-plans/workspaces/:workspaceId/plans/:executionPlanId/validate')({ params: { workspaceId: 'ws.1', executionPlanId: 'ep.1' }, body: { workspaceId: 'ws.1', executionPlanId: 'ep.1' } }, d.res);
    expect(d.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(d.json.mock.calls[0][0])).not.toContain('/tmp/token');
  });
});
