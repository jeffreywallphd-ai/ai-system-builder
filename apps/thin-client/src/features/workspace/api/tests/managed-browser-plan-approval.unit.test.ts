import {createHash} from "node:crypto";
import {expect, test, vi} from "vitest";

import {parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId} from "../../../../../../../modules/contracts/headless";
import {MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH} from "../../../../../../../modules/contracts/headless";
import {MANAGED_BROWSER_PLAN_APPROVAL_PATH, MANAGED_BROWSER_PLAN_CHAT_PATH} from "../../../../../../../modules/contracts/headless";
import {createWorkspaceId} from "../../../../../../../modules/contracts/workspace";
import {normalizeIngestionTaskFileId, normalizeIngestionTaskId} from "../../../../../../../modules/contracts/ingestion";
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

test("the signed-in chat uses its own fixed route with the same live browser proof", async () => {
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response({status:"ready"}, {"X-AISB-Headless-Plan-Approvals":"1", "X-AISB-Headless-Plan-Chat":"1"}))
    .mockResolvedValueOnce(response([{...selection,expiresAt}]));
  const client = createManagedBrowserConsentClient("fixture-org",transport);
  expect(await client.observe(tab,signal)).toMatchObject({status:"ready",planApprovals:true,planChat:true});
  expect(await client.listPlanApprovals(tab,signal,true)).toEqual([{...selection,expiresAt}]);
  const [path,request] = transport.mock.calls[1]!;
  expect(path).toBe(MANAGED_BROWSER_PLAN_CHAT_PATH);
  expect(request!.headers).toMatchObject({[MANAGED_BROWSER_DOCUMENT_HEADER]:tab.proof});
  expect(JSON.parse(request!.body as string)).toEqual({operation:"list",document});
});

test("file preparation retains the browser scope and accepts only a current selection receipt", async () => {
  const file = {workspaceId, registeredClientId:selection.registeredClientId, expectedSelectionRevision:0,
    taskId:normalizeIngestionTaskId("ingestion.browser-fixture"), fileId:normalizeIngestionTaskFileId("file.browser-fixture"), taskRevision:2};
  const receipt = {workspaceId, taskId:file.taskId, fileId:file.fileId, taskRevision:2, selectionRevision:1};
  const retired = new AbortController();
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response([file.registeredClientId]))
    .mockResolvedValueOnce(response([file.registeredClientId, file.registeredClientId]))
    .mockResolvedValueOnce(response({...receipt, path:"synthetic.csv"}))
    .mockResolvedValueOnce(response({...receipt, selectionRevision:2}))
    .mockResolvedValueOnce(response(receipt))
    .mockResolvedValueOnce(response(receipt))
    .mockImplementationOnce(async () => {
      retired.abort();
      return response(receipt);
    });
  const client = createManagedBrowserConsentClient("fixture-org",transport);
  expect(await client.listPlanFileClients(tab,signal)).toEqual([file.registeredClientId]);
  expect(await client.listPlanFileClients(tab,signal)).toEqual([]);
  expect(await client.selectPlanLocalFile(tab,{...file, workspaceId:createWorkspaceId("workspace.foreign")},signal)).toBeUndefined();
  expect(await client.selectPlanLocalFile(tab,file,signal)).toBeUndefined();
  expect(await client.selectPlanLocalFile(tab,file,signal)).toBeUndefined();
  expect(await client.selectPlanLocalFile(tab,file,signal)).toEqual(receipt);
  expect(await client.selectPlanProviderFile(tab,{...file, workspaceId:createWorkspaceId("workspace.foreign")},signal)).toBeUndefined();
  expect(await client.selectPlanProviderFile(tab,file,signal)).toEqual(receipt);
  expect(await client.selectPlanProviderFile(tab,file,retired.signal)).toBeUndefined();
  expect(transport).toHaveBeenCalledTimes(7);
  for (const [path,options] of transport.mock.calls) {
    expect(path).toBe(MANAGED_BROWSER_PLAN_APPROVAL_PATH);
    expect(options!.headers).toMatchObject({"x-organization-id":"fixture-org",[MANAGED_BROWSER_DOCUMENT_HEADER]:tab.proof});
  }
  expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual({operation:"list-file-clients",document});
  expect(JSON.parse(transport.mock.calls[2]![1]!.body as string)).toEqual({operation:"select-file",document,file});
  expect(JSON.parse(transport.mock.calls[5]![1]!.body as string)).toEqual({operation:"select-provider-file",document,file});
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

test("both decision channels show the same exact file-save step and reject an altered revision", async () => {
  const plan = parseHeadlessBuildPlanProposal({hostIncarnationId,workspaceId,steps:[{
    operation:"data.save-local-source",taskId:normalizeIngestionTaskId("ingestion.browser-fixture"),
    fileId:normalizeIngestionTaskFileId("file.browser-fixture"),taskRevision:3,
    idempotencyKey:"d515ff1c-bb55-4984-88ce-2a2a8e9d9e9e",
  }]},hostIncarnationId,{allowLocalFileSave:true});
  if (!plan.ok) throw new Error("The selected-file plan fixture is invalid.");
  const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
  const choice = {...selection,fingerprint};
  const state = {fingerprint,revision:1,stepCount:1,expiresAt,status:"pending",approvedSteps:0};
  const view = {selection:choice,viewId,preview:plan.preview,state};
  const changed = { ...view, preview:{...plan.preview,steps:plan.preview.steps.map(step =>
    ({...step,input:{...step.input,taskRevision:4}}))}};
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response(changed));
  const client = createManagedBrowserConsentClient("fixture-org",transport);
  expect(await client.openPlanApproval(tab,choice,signal)).toEqual(view);
  expect(await client.openPlanApproval(tab,choice,signal,true)).toEqual(view);
  expect(await client.openPlanApproval(tab,choice,signal,true)).toBeUndefined();
  expect(transport.mock.calls.map(([path]) => path)).toEqual([
    MANAGED_BROWSER_PLAN_APPROVAL_PATH, MANAGED_BROWSER_PLAN_CHAT_PATH, MANAGED_BROWSER_PLAN_CHAT_PATH,
  ]);
});

test("Context approval uses both fixed channels and refuses substituted sources, settings or processing limits", async () => {
  const plan = parseHeadlessBuildPlanProposal({hostIncarnationId, workspaceId, steps: [{operation: "context.generate-pack",
    idempotencyKey: "d515ff1c-bb55-4984-88ce-2a2a8e9d9e9e", name: "Support reference",
    sources: [{kind: "ingestion-file", taskId: "ingestion.browser-fixture", fileId: "file.browser-fixture", taskRevision: 3}],
    settings: {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500,
      overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]}}]}, hostIncarnationId,
    {allowLocalFileSave: true, allowContextPackGeneration: true});
  if (!plan.ok) throw new Error("The Context plan fixture is invalid.");
  const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
  const choice = {...selection, fingerprint};
  const state = {fingerprint, revision: 1, stepCount: 1, expiresAt, status: "pending", approvedSteps: 0};
  const view = {selection: choice, viewId, preview: plan.preview, state};
  const first = plan.preview.steps[0];
  if (first.operation !== "context.generate-pack") throw new Error("Expected a Context step.");
  const altered = [
    {...first, input: {...first.input, sources: [{...first.input.sources[0], taskRevision: 4}]}},
    {...first, input: {...first.input, settings: {...first.input.settings, chunkCharacters: 600}}},
    {...first, explicitSaveRequired: false}, {...first, modelCalls: 1},
  ];
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response(view));
  for (const step of altered) transport.mockResolvedValueOnce(response({...view, preview: {...plan.preview, steps: [step]}}));
  const client = createManagedBrowserConsentClient("fixture-org", transport);
  expect(await client.openPlanApproval(tab, choice, signal)).toEqual(view);
  expect(await client.openPlanApproval(tab, choice, signal, true)).toEqual(view);
  for (const _step of altered) expect(await client.openPlanApproval(tab, choice, signal, true)).toBeUndefined();
  expect(transport.mock.calls.map(([path]) => path)).toEqual([
    MANAGED_BROWSER_PLAN_APPROVAL_PATH, ...Array(5).fill(MANAGED_BROWSER_PLAN_CHAT_PATH),
  ]);
  for (const [, options] of transport.mock.calls)
    expect(JSON.parse(options!.body as string)).toEqual({operation: "open", document, selection: choice});
});
