import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { GovernedIngestionTaskUseCases } from "../../../../application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { RegisterArtifactFromRepoUseCase } from "../../../../application/use-cases/register-artifact-from-repo.use-case";
import { createHasArtifactInRepoSuccessResult } from "../../../../contracts/storage";
import { composeIngestionAcquisitionRepository } from "../../../shared/composition/composeIngestionAcquisitionRepository";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../adapters/persistence/sqlite";
import { createStructuredHeadlessOperationStore } from "../../../../adapters/persistence/system-builder";
import { createStructuredHeadlessPlanReviewRepository } from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { createOidcBearerTokenVerifierAdapter, getVerifiedOidcCredentialBinding } from "../../../../adapters/security/oidc/createOidcBearerTokenVerifierAdapter";
import { registerManagedBrowserConsentRoute } from "../../../../adapters/transport/api-express/headless/registerManagedBrowserConsentRoute";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../../../../application/services/asset-packs/system-packs";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../../application/services/security";
import type { AssetReference } from "../../../../contracts/asset";
import { createTenantPlacementConfig } from "../../../../contracts/config";
import { HEADLESS_CONTRACT_VERSION, parseHeadlessBuildPlanProposal, readHeadlessPlanReviewAgentRequest,
  type HeadlessHostIncarnationId } from "../../../../contracts/headless";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createOidcBearerConfig } from "../../../../contracts/security";
import { MANAGED_BROWSER_DOCUMENT_HEADER, parseManagedBrowserRegistration } from "../../../../contracts/headless";
import { MANAGED_BROWSER_PLAN_APPROVAL_PATH } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeSystemBuilder } from "../../../shared/composition/composeSystemBuilder";
import { composeManagedHeadlessAuthoring } from "../composeManagedHeadlessAuthoring";
import { composeManagedHeadlessPlanReview } from "../composeManagedHeadlessPlanReview";
import { composeManagedHeadlessPlanApprovals } from "../composeManagedHeadlessPlanApprovals";
import { composeManagedBrowserConsent } from "../composeManagedBrowserConsent";

const organizationId = createOrganizationId("managed-fixture");
const workspaceId = createWorkspaceId("workspace-fixture");
const principalId = "principal-fixture";
const timestamp = "2026-11-14T12:00:00.000Z";
const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
const definitions = [SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST]
  .flatMap(({ assets }) => assets.map(({ definition }) => definition));
const findDefinition = async ({ id, version }: AssetReference) =>
  definitions.find(row => row.definitionId === id && row.version === version);

test("managed edits and retry receipts require current workspace permission within the owned transaction", async t => {
  const fixture = await mkdtemp(path.join(await realpath(tmpdir()), "managed-author-"));
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: fixture})});
  try {
    const root = db.documents;
    const documents = root.forOrganization(organizationId);
    const repositories = createStructuredOrganizationRepositories(root);
    await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: timestamp, updatedAt: timestamp});
    const membership = {organizationId, principalId, role: "operator" as const, status: "active" as const, createdAt: timestamp, updatedAt: timestamp};
    await repositories.memberships.saveMembership(membership);
    const workspace = {workspaceId, organizationId, displayName: "Synthetic workspace", status: "active" as const, createdAt: timestamp, updatedAt: timestamp};
    const workspaces = createLocalWorkspaceRepository({rootDirectory: fixture, documents});
    await workspaces.saveWorkspace(workspace);
    let context = {organizationId, principalId};
    const contexts = {getCurrentOrganizationContext: () => context};
    const placement = createTenantPlacementConfig();
    const policy = createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement});
    let authorizationCompleted: (() => void) | undefined;
    const authorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {
      async execute(input) {
        const decision = await policy.authorize(input);
        if (!decision.allowed) throw new Error("Fixture policy denied.");
        authorizationCompleted?.();
        return decision;
      },
    }});
    const systems = composeSystemBuilder({documents, generateSystemId: () => `system.${randomUUID()}`,
      definitions: {readExactDefinition: findDefinition},
      assetRegistryRead: {
        async listDefinitionCards() { return {items: []}; },
        async readDefinitionDetail(reference, options) {
          assert.equal(options?.workspaceId, workspaceId);
          const definition = await findDefinition(reference);
          return definition ? {definition, builtIn: true} : undefined;
        },
      },
    });
    let beforeOwner: (() => Promise<unknown>) | undefined;
    let atCommit: (() => void) | undefined;
    const platform: StructuredDocumentStore = {...root,
      async runInOwnedTransaction(transaction, beforeCommit) {
        const before = beforeOwner;
        beforeOwner = undefined;
        await before?.();
        return root.runInOwnedTransaction!(transaction, () => {atCommit?.(); beforeCommit?.();});
      },
    };
    const service = composeManagedHeadlessAuthoring({hostIncarnationId, platform, rootDirectory: fixture,
      contexts, workspaces, authorization, placement, systems});
    let current = true;
    const registration = {purpose: "agent" as const, organizationId, principalId, registeredClientId: randomUUID(), isCurrent: () => current};
    const command = {version: HEADLESS_CONTRACT_VERSION, operation: "systems.create", input: {hostIncarnationId, workspaceId,
      name: "Synthetic portal", idempotencyKey: randomUUID(), templateId: "reference.secured-data-review@1.0.0"}};
    const execute = (request = command) => service.execute(request, registration, () => true);
    const denied = {ok: false, code: "headless.forbidden"};

    context = {...context, principalId: "foreign-principal"};
    assert.deepEqual(await execute(), denied);
    context = {...context, principalId};
    beforeOwner = () => repositories.memberships.saveMembership({...membership, status: "removed"});
    assert.deepEqual(await execute(), denied);
    assert.equal((await systems.useCases.list.execute({workspaceId})).length, 0);
    await repositories.memberships.saveMembership(membership);
    atCommit = () => {current = false;};
    assert.deepEqual(await execute(), denied);
    atCommit = undefined;
    assert.equal((await systems.useCases.list.execute({workspaceId})).length, 0);
    assert.equal(await createStructuredHeadlessOperationStore(root).watermark({organizationId, workspaceId}), 0);

    current = true;
    const saved = await execute();
    assert.ok(saved.ok && saved.value.kind === "committed");
    assert.deepEqual(await execute(), {ok: true, value: {...saved.value, kind: "replayed"}});
    assert.equal((await systems.useCases.list.execute({workspaceId})).length, 1);
    assert.equal(await createStructuredHeadlessOperationStore(root).watermark({organizationId, workspaceId}), 1);
    let expireAfterCheck = false;
    let observedReplayTransaction = false;
    let postTransactionAuthorizations = 0;
    atCommit = () => { observedReplayTransaction = true; };
    authorizationCompleted = () => {
      if (observedReplayTransaction && ++postTransactionAuthorizations === 2) expireAfterCheck = true;
    };
    const atEgress = {...registration, isCurrent() {
      if (expireAfterCheck) {
        expireAfterCheck = false;
        queueMicrotask(() => { current = false; });
      }
      return current;
    }};
    assert.deepEqual(await service.execute(command, atEgress, () => true), denied);
    assert.equal(observedReplayTransaction, true);
    assert.equal(postTransactionAuthorizations, 2);
    assert.equal(current, false);
    atCommit = undefined;
    authorizationCompleted = undefined;
    current = true;
    beforeOwner = () => workspaces.updateWorkspace({...workspace, status: "archived"});
    assert.deepEqual(await execute(), denied);

    await t.test("a dedicated managed client stages the exact plan without changing saved systems", async () => {
      await workspaces.updateWorkspace(workspace);
      const review = composeManagedHeadlessPlanReview({hostIncarnationId, platform, rootDirectory:fixture,
        contexts, workspaces, authorization, placement});
      const client = {...registration, purpose:"plan-review" as const};
      const scope = {hostIncarnationId, workspaceId};
      const decode = (operation: "plan.submit" | "plan.status", input: object) => {
        const parsed = readHeadlessPlanReviewAgentRequest({version:HEADLESS_CONTRACT_VERSION, operation, input}, hostIncarnationId);
        assert.ok(parsed.ok);
        return parsed.request;
      };
      const build = (steps: readonly unknown[]) => {
        const proposed = parseHeadlessBuildPlanProposal({...scope, steps}, hostIncarnationId);
        assert.ok(proposed.ok);
        const fingerprint = createHash("sha256").update(JSON.stringify(proposed.preview)).digest("hex");
        const input = {...scope, fingerprint, steps};
        return {input, submit:decode("plan.submit", input), status:decode("plan.status", {...scope, fingerprint})};
      };
      const ordinary = build([{operation:"systems.create", name:"Synthetic approved work",
        templateId:"reference.secured-data-review@1.0.0", idempotencyKey:randomUUID()}]);
      const fresh = () => true;
      assert.deepEqual(await review(ordinary.submit, client, () => false), denied);
      context = {...context, principalId:"foreign-principal"};
      assert.deepEqual(await review(ordinary.submit, client, fresh), denied);
      context = {...context, principalId};
      beforeOwner = () => repositories.memberships.saveMembership({...membership, status:"removed"});
      assert.deepEqual(await review(ordinary.submit, client, fresh), denied);
      await repositories.memberships.saveMembership(membership);
      assert.deepEqual(await review(ordinary.status, client, fresh), denied);
      atCommit = () => {current = false;};
      assert.deepEqual(await review(ordinary.submit, client, fresh), denied);
      atCommit = undefined;
      current = true;
      assert.deepEqual(await review(ordinary.status, client, fresh), denied);
      assert.deepEqual(await review(decode("plan.submit", {...ordinary.input, fingerprint:"a".repeat(64)}), client, fresh),
        {ok:false, code:"headless.invalid-request"});
      const invalidSource = build([{operation:"systems.clone", systemId:"system.missing-fixture",
        baseRecordRevision:1, baseRevisionId:"system.missing-fixture.r1", name:"Synthetic copy", idempotencyKey:randomUUID()}]);
      assert.deepEqual(await review(invalidSource.submit, client, fresh), {ok:false, code:"headless.stale"});
      assert.deepEqual(await review(invalidSource.status, client, fresh), denied);
      const staged = await review(ordinary.submit, client, fresh);
      assert.ok(staged.ok && staged.value.status === "pending" && staged.value.approvedSteps === 0);
      assert.deepEqual(await review(ordinary.submit, client, fresh), staged);
      assert.deepEqual(await review(ordinary.status, client, fresh), staged);
      assert.deepEqual(await review(ordinary.status, {...client, registeredClientId:randomUUID()}, fresh), denied);
      assert.deepEqual(await review(decode("plan.status", {...scope, fingerprint:ordinary.input.fingerprint,
        workspaceId:"another-workspace"}), client, fresh), denied);
      assert.equal((await systems.useCases.list.execute({workspaceId})).length, 1);
      assert.equal(await createStructuredHeadlessOperationStore(root).watermark({organizationId, workspaceId}), 1);
    });

    await t.test("managed approvals use only the exact requested document and one live plan revision", async () => {
      const client = {...registration, purpose:"plan-review" as const};
      const review = composeManagedHeadlessPlanReview({hostIncarnationId, platform, rootDirectory:fixture,
        contexts, workspaces, authorization, placement});
      const approval = composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId:client.registeredClientId,
        platform, rootDirectory:fixture, contexts, placement});
      const document = {hostIncarnationId, workspaceId, windowId:randomUUID(), uiIncarnationId:randomUUID()};
      const otherDocument = {...document, windowId:randomUUID(), uiIncarnationId:randomUUID()};
      const scope = {hostIncarnationId, workspaceId};
      const steps = ["First synthetic change", "Second synthetic change"].map(name => ({operation:"systems.create", name,
        templateId:"reference.secured-data-review@1.0.0", idempotencyKey:randomUUID()}));
      const proposal = parseHeadlessBuildPlanProposal({...scope, steps}, hostIncarnationId);
      assert.ok(proposal.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(proposal.preview)).digest("hex");
      const target = {...scope, fingerprint};
      const submit = readHeadlessPlanReviewAgentRequest({version:HEADLESS_CONTRACT_VERSION,
        operation:"plan.submit", input:{...target,steps}}, hostIncarnationId);
      assert.ok(submit.ok);
      const staged = await review(submit.request, client, () => true);
      assert.ok(staged.ok);
      const selection = {workspaceId, fingerprint, registeredClientId:client.registeredClientId};
      let live = true;
      const caller = {organizationId, principalId};
      const invoke = (request:Parameters<typeof approval>[0]) => approval(request, caller, () => live, () => true);
      const listed = await invoke({operation:"list", document});
      assert.ok(listed.ok && Array.isArray(listed.value) && listed.value.some(row =>
        row.fingerprint === selection.fingerprint && row.registeredClientId === selection.registeredClientId &&
        row.workspaceId === workspaceId));
      assert.deepEqual(await invoke({operation:"open", document, selection:{...selection, registeredClientId:randomUUID()}}),
        {ok:false, code:"forbidden"});
      const open = () => invoke({operation:"open", document, selection});
      const seen = await open();
      assert.ok(seen.ok && typeof seen.value === "object" && "viewId" in seen.value);
      const first = {operation:"decide", document, decision:{selection, viewId:seen.value.viewId,
        expectedRevision:1, decision:{kind:"approve", mode:"each-change", step:1}}} as const;
      assert.deepEqual(await invoke({...first, document:otherDocument}), {ok:false, code:"forbidden"});
      assert.deepEqual(await invoke({...first, decision:{...first.decision, expectedRevision:2}}), {ok:false, code:"forbidden"});
      const reopened = await open();
      assert.ok(reopened.ok && typeof reopened.value === "object" && "viewId" in reopened.value);
      assert.notEqual(reopened.value.viewId, seen.value.viewId);
      assert.deepEqual(await invoke(first), {ok:false, code:"forbidden"});
      const currentFirst = {...first, decision:{...first.decision, viewId:reopened.value.viewId}};
      const decided = await invoke(currentFirst);
      assert.ok(decided.ok && typeof decided.value === "object" && "revision" in decided.value);
      assert.equal(decided.value.revision, 2);
      assert.equal(decided.value.approvedSteps, 1);
      assert.deepEqual(await invoke(currentFirst), {ok:false, code:"forbidden"});
      const next = await open();
      assert.ok(next.ok && typeof next.value === "object" && "viewId" in next.value);
      const second = {...first, decision:{...first.decision, viewId:next.value.viewId, expectedRevision:2,
        decision:{kind:"approve", mode:"each-change", step:2}}} as const;
      await invoke({operation:"dismiss", document, viewId:next.value.viewId});
      assert.deepEqual(await invoke(second), {ok:false, code:"forbidden"});
      const fresh = await open();
      assert.ok(fresh.ok && typeof fresh.value === "object" && "viewId" in fresh.value);
      live = false;
      assert.deepEqual(await invoke({...second, decision:{...second.decision, viewId:fresh.value.viewId}}),
        {ok:false, code:"forbidden"});
      live = true;
      const beforeCommit = await open();
      assert.ok(beforeCommit.ok && typeof beforeCommit.value === "object" && "viewId" in beforeCommit.value);
      let commits = 0;
      atCommit = () => { if (++commits === 2) live = false; };
      assert.deepEqual(await invoke({...second, decision:{...second.decision, viewId:beforeCommit.value.viewId}}),
        {ok:false, code:"forbidden"});
      atCommit = undefined;
      assert.equal(commits, 2);
      live = true;
      const after = await open();
      assert.ok(after.ok && typeof after.value === "object" && "viewId" in after.value);
      assert.equal(after.value.state.revision, 2);
      assert.equal(after.value.state.approvedSteps, 1);
      assert.equal((await systems.useCases.list.execute({workspaceId})).length, 1);

      const chat = (request:Parameters<typeof approval>[0]) => approval(request, caller, () => live, () => true, "authenticated-chat");
      const chatView = await chat({operation:"open", document, selection});
      assert.ok(chatView.ok && typeof chatView.value === "object" && "viewId" in chatView.value);
      assert.notEqual(chatView.value.viewId, after.value.viewId);
      const popupChoice = {...second, decision:{...second.decision, viewId:after.value.viewId}};
      const chatChoice = {...second, decision:{...second.decision, viewId:chatView.value.viewId}};
      assert.deepEqual(await chat(popupChoice), {ok:false, code:"forbidden"});
      assert.deepEqual(await invoke(chatChoice), {ok:false, code:"forbidden"});
      const outcomes = await Promise.all([chat(chatChoice), invoke(popupChoice)]);
      assert.equal(outcomes.filter(outcome => outcome.ok).length, 1);
      const latest = await open();
      assert.ok(latest.ok && typeof latest.value === "object" && "viewId" in latest.value);
      assert.equal(latest.value.state.revision, 3);
      assert.equal(latest.value.state.approvedSteps, 2);
      assert.equal(latest.value.state.status, "approved");
      assert.equal((await systems.useCases.list.execute({workspaceId})).length, 1);
    });

    await t.test("Managed provider preview rechecks its selected task and tenant access at publication", async () => {
      const tasks = createStructuredIngestionAcquisitionRepository(documents);
      const taskId = normalizeIngestionTaskId("ingestion.managed-provider-choice");
      const fileId = normalizeIngestionTaskFileId("file.managed-provider-choice");
      const createdAt = new Date().toISOString();
      const providerRevision = "c".repeat(40);
      const task = await tasks.createTask({schemaVersion:"1.0", organizationId, workspaceId, taskId, kind:"hugging-face",
        status:"queued", revision:1, cleanupPending:false, createdAt, updatedAt:createdAt,
        files:[{fileId, checkpointId:"checkpoint.fixture", fileName:"synthetic.parquet", mediaType:"application/vnd.apache.parquet",
          status:"pending", totalBytes:0, acceptedBytes:0, nextChunkIndex:0, providerSource:{provider:"huggingface",
            repository:"synthetic/private", path:"data/private.parquet", revision:providerRevision}}],
        progress:{totalItems:1, completedItems:0, totalBytes:0, acceptedBytes:0, percent:0}});
      const client = {...registration, purpose:"plan-review" as const, isCurrent:() => true};
      const document = {hostIncarnationId, workspaceId, windowId:randomUUID(), uiIncarnationId:randomUUID()};
      const target = {workspaceId,taskId,fileId,taskRevision:1};
      const selection = {...target,registeredClientId:client.registeredClientId,expectedSelectionRevision:0};
      const caller = {organizationId,principalId};
      let hold: {entered:PromiseWithResolvers<void>; release:PromiseWithResolvers<void>} | undefined;
      const stable: StructuredDocumentStore = {...platform, async publishWithStableReads(check,publish) {
        hold?.entered.resolve();
        await hold?.release.promise;
        return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
      }};
      const approval = composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId:client.registeredClientId,
        platform:stable, rootDirectory:fixture, contexts, placement, localIngestion:{
          async executeCommand(command, context) {
            assert.deepEqual(command,{action:"read",taskId});
            assert.deepEqual(context,{...caller,workspaceId});
            return {ok:true,value:{kind:"task",task:(await tasks.readTask(workspaceId,taskId))!}};
          },
        }});
      const review = composeManagedHeadlessPlanReview({hostIncarnationId, platform:stable, rootDirectory:fixture,
        contexts, workspaces, authorization, placement, enableFilePreview:true});
      assert.ok(review.previewSelectedProviderFile);
      assert.ok(review.previewSelectedFile);
      const query = {version:HEADLESS_CONTRACT_VERSION, operation:"data.prepare-provider-file", input:{hostIncarnationId,...target}} as const;
      const input = {operation:"select-provider-file",document,file:selection} as const;
      const admit = (command = input, channel?: "authenticated-chat") =>
        approval(command,caller,() => true,() => true,channel);
      assert.deepEqual((await review.previewSelectedProviderFile(query,client,() => true)).result,denied);
      assert.deepEqual(await admit(input,"authenticated-chat"),{ok:false,code:"forbidden"});
      assert.deepEqual(await admit({...input,file:{...selection,registeredClientId:randomUUID()}}),{ok:false,code:"forbidden"});
      const prepared = await admit();
      assert.ok(prepared.ok && "publishIfCurrent" in prepared && prepared.publishIfCurrent);
      assert.deepEqual(prepared.value,{...target,selectionRevision:1});
      assert.equal(await prepared.publishIfCurrent(() => true),true);
      const pending = await review.previewSelectedProviderFile(query,client,() => true);
      assert.ok(pending.result.ok && pending.publishIfCurrent);
      assert.equal(pending.result.value.providerRevision,providerRevision);
      assert.equal(pending.result.value.externalProviderCalls,0);
      assert.deepEqual((await review.previewSelectedFile({...query,operation:"data.prepare-local-file"},client,() => true)).result,denied);
      hold = {entered:Promise.withResolvers<void>(),release:Promise.withResolvers<void>()};
      let sent = 0;
      const publish = () => {sent++; return true;};
      const response = pending.publishIfCurrent(publish);
      await hold.entered.promise;
      try {
        await repositories.memberships.saveMembership({...membership,status:"removed"});
        hold.release.resolve();
        assert.equal(await response,false);
        assert.equal(sent,0);
      } finally {
        hold.release.resolve();
        hold = undefined;
        await repositories.memberships.saveMembership(membership);
      }
      await tasks.saveTask({...task,status:"cancelled",revision:2,updatedAt:createdAt,completedAt:createdAt},1);
      assert.equal(await pending.publishIfCurrent(publish),false);
      assert.equal(await prepared.publishIfCurrent(publish),false);
      assert.equal(sent,0);
    });

    for (const channel of ["app-popup", "authenticated-chat"] as const) await t.test(
      `Managed provider saves use their exact ${channel} decision and replay with current authority`, async () => {
      let providerChecks = 0;
      const providerRevision = "b".repeat(40);
      const ingestion = new GovernedIngestionTaskUseCases({
        repository: composeIngestionAcquisitionRepository(fixture, documents),
        checkpoints: {} as never, streamStorage: {} as never, artifactCleanup: {} as never,
        workspaceRepository: workspaces, workspaceAuthorization: authorization, organizationContextProvider: contexts,
        registerArtifactFromRepo: new RegisterArtifactFromRepoUseCase({
          artifactRepoStorage: { async hasArtifactInRepo() {
            providerChecks++;
            return createHasArtifactInRepoSuccessResult(true);
          } } as never,
          readDatasetRevisionLicense: async () => ({ repository: "example/synthetic", revision: providerRevision, licenseIds: ["mit"] }),
          artifactBindingStorage: {} as never, artifactCatalogAppend: {} as never, logging: { log() {} },
        }),
      });
      const stable: StructuredDocumentStore = { ...platform, async publishWithStableReads(check, publish) {
        return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
      } };
      const client = { ...registration, purpose: "plan-review" as const, isCurrent: () => true };
      const review = composeManagedHeadlessPlanReview({ hostIncarnationId, platform: stable, rootDirectory: fixture,
        contexts, workspaces, authorization, placement, systems, enableFilePreview: true,
        finalizeApprovedProviderFile: ingestion.finalizeApprovedProviderFile.bind(ingestion) });
      const approval = composeManagedHeadlessPlanApprovals({ hostIncarnationId, planClientId: client.registeredClientId,
        platform: stable, rootDirectory: fixture, contexts, placement, localIngestion: ingestion, allowProviderFileSave: true });
      const created = await ingestion.executeCommand({ action: "create-hugging-face",
        files: [{ repository: "example/synthetic", path: "data/train.parquet", revision: providerRevision }] },
      { organizationId, principalId, workspaceId });
      assert.ok(created.ok && created.value.kind === "task");
      const task = created.value.task;
      const selected = { workspaceId, taskId: task.taskId, fileId: task.files[0]!.fileId, taskRevision: task.revision };
      const document = { hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID() };
      const chosen = await approval({ operation: "select-provider-file", document,
        file: { ...selected, registeredClientId: client.registeredClientId, expectedSelectionRevision: 0 } },
      { organizationId, principalId }, () => true, () => true);
      assert.ok(chosen.ok);
      const input = { hostIncarnationId, workspaceId, steps: [{
        operation: "data.save-provider-source", taskId: selected.taskId, fileId: selected.fileId,
        taskRevision: selected.taskRevision, idempotencyKey: randomUUID(),
      }] };
      const parsed = parseHeadlessBuildPlanProposal(input, hostIncarnationId, { allowLocalFileSave: false, allowProviderFileSave: true });
      assert.ok(parsed.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
      const submit = readHeadlessPlanReviewAgentRequest({ version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
        input: { ...input, fingerprint } }, hostIncarnationId, { allowLocalFileSave: false, allowProviderFileSave: true });
      assert.ok(submit.ok);
      assert.ok((await review(submit.request, client, () => true)).ok);
      const execute = () => review.runStep!({ version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step",
        input: { hostIncarnationId, workspaceId, fingerprint, approvalRevision: 2, step: 1 } }, client, () => true);
      assert.deepEqual((await execute()).result, denied);
      assert.equal(providerChecks, 0);
      const selection = { workspaceId, fingerprint, registeredClientId: client.registeredClientId };
      const opened = await approval({ operation: "open", document, selection },
        { organizationId, principalId }, () => true, () => true, channel);
      assert.ok(opened.ok && typeof opened.value === "object" && "viewId" in opened.value);
      const choice = await approval({ operation: "decide", document,
        decision: { selection, viewId: opened.value.viewId, expectedRevision: 1,
          decision: { kind: "approve", mode: "whole-plan" } } },
      { organizationId, principalId }, () => true, () => true, channel);
      assert.ok(choice.ok);
      const saved = await execute();
      assert.ok(saved.result.ok && saved.result.value.kind === "committed");
      assert.equal(await saved.publishIfCurrent?.(() => true), true);
      const retried = await execute();
      assert.deepEqual(retried.result, { ok: true, value: { ...saved.result.value, kind: "replayed" } });
      assert.equal(providerChecks, 1);
      const snapshot = await ingestion.readTask(task.taskId, { organizationId, principalId, workspaceId });
      assert.ok(snapshot.ok && snapshot.value.status === "succeeded");
      assert.deepEqual(snapshot.value.files[0]!.output?.providerLicenseIds, ["mit"]);
      try {
        await repositories.memberships.saveMembership({ ...membership, status: "removed" });
        assert.deepEqual((await execute()).result, denied);
        assert.equal(await saved.publishIfCurrent?.(() => true), false);
        assert.equal(providerChecks, 1);
      } finally { await repositories.memberships.saveMembership(membership); }
    });

    await t.test("mixed-file approval views and committed decisions require permission at publication", async () => {
      const document = {hostIncarnationId, workspaceId, windowId:randomUUID(), uiIncarnationId:randomUUID()};
      const scope = {organizationId, principalId, workspaceId, registeredClientId:registration.registeredClientId};
      const proposal = {hostIncarnationId, workspaceId, steps:[{operation:"data.save-local-source", taskId:"ingestion.held",
        fileId:"file.held", taskRevision:2, idempotencyKey:randomUUID()}]};
      const parsed = parseHeadlessBuildPlanProposal(proposal, hostIncarnationId, {allowLocalFileSave:true});
      assert.ok(parsed.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
      const target = {hostIncarnationId, fingerprint, scope};
      const plans = createStructuredHeadlessPlanReviewRepository(platform, async () => true, Date.now,
        async () => true, true);
      assert.ok((await plans.propose({target,isCurrent:() => true,proposal})).ok);

      let hold: {entered:PromiseWithResolvers<void>; release:PromiseWithResolvers<void>} | undefined;
      const checkpoint: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
        const pending = hold;
        pending?.entered.resolve();
        await pending?.release.promise;
        return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
      }};
      const approval = composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId:scope.registeredClientId,
        platform:checkpoint, rootDirectory:fixture, contexts, placement, allowLocalFileSave:true});
      const selection = {workspaceId,fingerprint,registeredClientId:scope.registeredClientId};
      const open = () => approval({operation:"open",document,selection},{organizationId,principalId},() => true,() => true);
      let sent = 0;
      async function retireBeforeSend(publish: (send: () => boolean) => Promise<boolean>) {
        const checkpoint = {entered:Promise.withResolvers<void>(),release:Promise.withResolvers<void>()};
        hold = checkpoint;
        const pending = publish(() => {sent++; return true;});
        await checkpoint.entered.promise;
        try {
          await repositories.memberships.saveMembership({...membership,status:"removed"});
          checkpoint.release.resolve();
          assert.equal(await pending,false);
          assert.equal(sent,0);
        } finally {
          checkpoint.release.resolve();
          hold = undefined;
          await repositories.memberships.saveMembership(membership);
        }
      }
      const first = await open();
      assert.ok(first.ok && "publishIfCurrent" in first && first.publishIfCurrent);
      await retireBeforeSend(first.publishIfCurrent);
      const second = await open();
      assert.ok(second.ok && typeof second.value === "object" && "viewId" in second.value &&
        "publishIfCurrent" in second && second.publishIfCurrent);
      assert.equal(await second.publishIfCurrent(() => true),true);
      const decision = {operation:"decide",document,decision:{selection,viewId:second.value.viewId,
        expectedRevision:1,decision:{kind:"approve",mode:"whole-plan"}}} as const;
      const decided = await approval(decision,{organizationId,principalId},() => true,() => true);
      assert.ok(decided.ok && "publishIfCurrent" in decided && decided.publishIfCurrent);
      await retireBeforeSend(decided.publishIfCurrent);
      assert.deepEqual(await approval(decision,{organizationId,principalId},() => true,() => true),
        {ok:false,code:"forbidden"});
      const saved = await plans.read({target,isCurrent:() => true});
      assert.ok(saved.ok);
      assert.equal(saved.snapshot.state.status,"approved");
      assert.equal(saved.snapshot.state.revision,2);
    });

    await t.test("managed HTTP approval hides replies that expire during delivery while retaining the committed decision", async () => {
      const client = {...registration, purpose:"plan-review" as const};
      const stage = composeManagedHeadlessPlanReview({hostIncarnationId, platform, rootDirectory:fixture,
        contexts, workspaces, authorization, placement});
      const scope = {hostIncarnationId, workspaceId};
      const steps = [{operation:"systems.create", name:"Synthetic deadline case", idempotencyKey:randomUUID(),
        templateId:"reference.secured-data-review@1.0.0"}];
      const parsed = parseHeadlessBuildPlanProposal({...scope, steps}, hostIncarnationId);
      assert.ok(parsed.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
      const decode = (operation:"plan.submit" | "plan.status", input:object) => {
        const result = readHeadlessPlanReviewAgentRequest({version:HEADLESS_CONTRACT_VERSION, operation, input}, hostIncarnationId);
        assert.ok(result.ok);
        return result.request;
      };
      const staged = await stage(decode("plan.submit", {...scope,fingerprint,steps}), client, () => true);
      assert.ok(staged.ok);
      const deadline = staged.value.expiresAt;
      let clock = deadline - 1;
      const approvals = composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId:client.registeredClientId,
        platform, rootDirectory:fixture, contexts, placement, now:() => clock});

      const origin = "https://fixture.invalid";
      const clientId = "synthetic-browser";
      const verifier = createOidcBearerTokenVerifierAdapter({
        config:createOidcBearerConfig({issuer:origin, jwksUri:origin + "/keys", audience:"fixture", algorithms:["RS256"]}),
        jwtVerifier:{async verify() {return {iss:origin, sub:"fixture", exp:2, accessTokenClientId:clientId};}},
      });
      const credentialBinding = getVerifiedOidcCredentialBinding(await verifier.verifyToken({token:"signed-test-browser", now:new Date(1_000)}));
      assert.ok(credentialBinding);
      const browser = {purpose:"browser" as const, organizationId, principalId, registeredClientId:randomUUID(),
        credentialBinding, isCurrent:() => true};
      const consent = composeManagedBrowserConsent({hostIncarnationId, authorize:async () => true,
        planApprovals:approvals, now:() => 1_000});
      const tab = parseManagedBrowserRegistration(await consent.register(browser, workspaceId, () => true));
      assert.ok(tab);
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let commitReadyBeforeDeadline = false;
      const app = express();
      const retire = registerManagedBrowserConsentRoute(app, origin, () => ({
        ...consent, hostIncarnationId, identify:() => browser, isCurrent: identity => identity.isCurrent(),
        async planApproval(document, request, current) {
          const result = await consent.planApproval!(document, request, current);
          if (request.operation === "list") {
            assert.equal(result?.canPublish(), true);
            held.resolve();
            await release.promise;
          }
          if (request.operation === "decide") {
            commitReadyBeforeDeadline = result?.canPublish() === true;
            clock = deadline;
            release.resolve();
          }
          return result;
        },
      }));
      const server = app.listen(0, "127.0.0.1");
      try {
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const url = `http://127.0.0.1:${address.port}${MANAGED_BROWSER_PLAN_APPROVAL_PATH}`;
        const send = (request:object) => fetch(url, {method:"POST",
          headers:{"Content-Type":"application/json", origin, "sec-fetch-site":"same-origin", [MANAGED_BROWSER_DOCUMENT_HEADER]:tab.proof},
          body:JSON.stringify({...request, document:tab.target})});
        const selection = {workspaceId, fingerprint, registeredClientId:client.registeredClientId};
        const issued = await send({operation:"open", selection});
        assert.equal(issued.status, 200);
        const view = await issued.json();
        const pendingList = send({operation:"list"});
        const outcome = await Promise.race([held.promise.then(() => "held"), pendingList.then(() => "early")]);
        assert.equal(outcome, "held");
        const response = await send({operation:"decide",decision:{selection, viewId:view.viewId, expectedRevision:1,
          decision:{kind:"approve", mode:"whole-plan"}}});
        assert.equal(commitReadyBeforeDeadline,true);
        assert.equal(response.status,403);
        const list = await pendingList;
        assert.equal(list.status,403);
        assert.equal(JSON.stringify(await list.json()).includes(fingerprint),false);
        const recorded = await stage(decode("plan.status", {...scope,fingerprint}), client, () => true);
        assert.ok(recorded.ok && recorded.value.status === "approved" && recorded.value.revision === 2);
      } finally {
        release.resolve();
        retire();
        consent.close();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  } finally {
    await db.close();
    await rm(fixture, {recursive: true, force: false});
  }
});
