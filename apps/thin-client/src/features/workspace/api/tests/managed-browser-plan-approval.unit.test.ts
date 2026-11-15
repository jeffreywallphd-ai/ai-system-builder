import {createHash} from "node:crypto";
import {expect, test, vi} from "vitest";

import {parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId} from "../../../../../../../modules/contracts/headless";
import {MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH} from "../../../../../../../modules/contracts/headless/managed-browser-consent";
import {MANAGED_BROWSER_PLAN_APPROVAL_PATH} from "../../../../../../../modules/contracts/headless/managed-browser-plan-approval";
import {createWorkspaceId} from "../../../../../../../modules/contracts/workspace";
import {createManagedBrowserConsentClient} from "../managedBrowserConsentClient";

const hostIncarnationId = "019394de-9fa1-4972-8eb2-454450a3d047" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.approval-fixture");
const document = {hostIncarnationId,workspaceId,windowId:"f57979a4-41e3-489f-b32b-40452707c441",
  uiIncarnationId:"90583b7a-16a2-4478-b28d-ec9f3349175c"};
const tab = {target:document,proof:"a".repeat(43)};
const selection = {workspaceId,registeredClientId:"f34e2fe5-ab55-4c54-ada1-9fbc27552e2a",fingerprint:"b".repeat(64)};
const viewId = "a2d0d416-a564-4ff7-8716-4d3a35513d0f";
const expiresAt = Date.now() + 60_000;
const signal = new AbortController().signal;
const response = (body:unknown, headers:Record<string,string> = {}) => new Response(JSON.stringify(body),
  {headers:{"Content-Type":"application/json",...headers}});

test("a signed-in tab uses the exact plan route and document proof", async () => {
  const transport = vi.fn<typeof fetch>();
  transport.mockResolvedValueOnce(response({status:"ready"},{"X-AISB-Headless-Plan-Approvals":"1"}));
  transport.mockResolvedValueOnce(response([{...selection,expiresAt}]));
  const client = createManagedBrowserConsentClient("fixture-org",transport);
  expect(await client.observe(tab,signal)).toMatchObject({status:"ready", planApprovals:true, delivery:false});
  expect(transport.mock.calls[0]?.[0]).toBe(MANAGED_BROWSER_OBSERVE_PATH);
  expect(await client.listPlanApprovals(tab,signal)).toEqual([{...selection,expiresAt}]);
  const [target,options] = transport.mock.calls[1]!;
  expect(target).toBe(MANAGED_BROWSER_PLAN_APPROVAL_PATH);
  expect(options).toMatchObject({method:"POST",credentials:"same-origin",mode:"same-origin",cache:"no-store",redirect:"error",
    headers:{"Content-Type":"application/json","x-organization-id":"fixture-org",[MANAGED_BROWSER_DOCUMENT_HEADER]:tab.proof}});
  expect(JSON.parse(options!.body as string)).toEqual({operation:"list",document});
});

test("foreign or altered views and receipts that disagree with the displayed decision are refused", async () => {
  const plan = parseHeadlessBuildPlanProposal({hostIncarnationId,workspaceId,steps:[{operation:"systems.create",name:"Synthetic",
    idempotencyKey:"d515ff1c-bb55-4984-88ce-2a2a8e9d9e9e",templateId:"reference.secured-data-review@1.0.0"}]},hostIncarnationId);
  if (!plan.ok) throw new Error("The fixed plan fixture is invalid.");
  const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
  const exactSelection = {...selection,fingerprint};
  const state = {fingerprint,revision:1,stepCount:1,expiresAt,status:"pending",approvedSteps:0} as const;
  const view = {selection:exactSelection,viewId,preview:plan.preview,state};
  const final = {...state,revision:2,status:"approved",mode:"whole-plan",approvedSteps:1};
  const other = "f34e2fe5-ab55-4c54-ada1-9fbc27552e2a";
  const changedSteps = plan.preview.steps.map(step => ({...step,input:{...step.input,name:"Another suggested change"}}));
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response([{...selection,workspaceId:"workspace.foreign",expiresAt}]))
    .mockResolvedValueOnce(response({...view,preview:{...view.preview,hostIncarnationId:other}}))
    .mockResolvedValueOnce(response({...view,preview:{...view.preview,steps:changedSteps}}))
    .mockResolvedValueOnce(response({...final,revision:3}))
    .mockResolvedValueOnce(response({...final,stepCount:2,approvedSteps:2}))
    .mockResolvedValueOnce(response(final))
    .mockResolvedValueOnce(response(view))
    .mockResolvedValueOnce(response(final));
  const client = createManagedBrowserConsentClient("fixture-org",transport);
  const approval = {selection:exactSelection,viewId,expectedRevision:1,decision:{kind:"approve",mode:"whole-plan"}} as const;
  expect(await client.listPlanApprovals(tab,signal)).toBeUndefined();
  expect(await client.openPlanApproval(tab,exactSelection,signal)).toBeUndefined();
  expect(await client.openPlanApproval(tab,exactSelection,signal)).toBeUndefined();
  expect(await client.decidePlanApproval(tab,approval,state,signal)).toBeUndefined();
  expect(await client.decidePlanApproval(tab,approval,state,signal)).toBeUndefined();
  expect(await client.decidePlanApproval(tab,{...approval,decision:{kind:"deny"}},state,signal)).toBeUndefined();
  expect(await client.openPlanApproval(tab,exactSelection,signal)).toEqual(view);
  expect(await client.decidePlanApproval(tab,approval,state,signal)).toEqual(final);
});
