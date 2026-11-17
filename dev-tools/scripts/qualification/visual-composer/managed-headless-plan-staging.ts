import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentResult } from "../../../../modules/contracts/headless";
import { MANAGED_HEADLESS_AGENT_PATHS, MANAGED_SAVED_STATE_PATHS } from "../../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import { startManagedReferenceHost } from "./managed-reference-host";

async function main() {
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "",
    {headlessAgent:true, headlessPlanReview:true});
  const checks: Record<string, boolean | number> = {};
  let stage = "startup";
  let passed = false;
  try {
    const {agent, organizationId} = fixture;
    assert.ok(agent?.planReview && agent.ordinaryPlanCredentials?.length === 2);
    const planCredential = agent.planReview;
    const {read, author, window, "plan-review":plan} = MANAGED_HEADLESS_AGENT_PATHS;
    const send = (route: string, body: object, token = planCredential) =>
      fixture.request(route, {method:"POST", body, token, organizationId});
    const discover = {version:HEADLESS_CONTRACT_VERSION, operation:"host.describe", input:{}};
    const described = await send(read, discover);
    assert.equal(described.status, 200);
    const hostIncarnationId = described.body.value.hostIncarnationId;
    assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const scope = {hostIncarnationId, workspaceId:agent.workspaceId};
    const templateId = "reference.secured-data-review@1.0.0";
    const write = {version:HEADLESS_CONTRACT_VERSION, operation:"systems.create",
      input:{...scope, templateId, name:"Synthetic existing system", idempotencyKey:randomUUID()}};
    const saved = await send(author, write, agent.access);
    assert.equal(saved.status, 200);
    assert.ok(saved.body.ok && saved.body.value.kind === "committed");
    const source = saved.body.value.reference;
    const snapshot = () => send(MANAGED_SAVED_STATE_PATHS.snapshot, {workspaceId:scope.workspaceId}, agent.browser);
    const before = await snapshot();
    assert.equal(before.status, 200);

    stage = "verified-route-separation";
    const scopes = [
      ["author", author, write],
      ["window", window, discover],
      ["query", read + "?fixture=extra", discover],
      ["browser_snapshot", MANAGED_SAVED_STATE_PATHS.snapshot, {workspaceId:scope.workspaceId}],
      ["ordinary_edit", "/api/systems/create", {command:{workspaceId:scope.workspaceId, templateId, name:"Synthetic ordinary edit"}}],
      ["ordinary_release_approval", "/api/systems/releases/approve", {command:{workspaceId:scope.workspaceId}}],
    ] as const;
    for (const [label, route, body] of scopes) {
      const response = await send(route, body);
      checks[label + "_status"] = response.status;
      assert.equal(response.status, 403);
      if (label === "ordinary_edit" || label === "ordinary_release_approval") {
        const error = response.body?.error;
        checks[label + "_credential_denial"] = error?.operation === "security.forbidden" &&
          error?.code === "forbidden" && error?.message === "This credential is limited to managed plan review.";
        assert.equal(checks[label + "_credential_denial"], true);
      }
    }
    checks.distinct_plan_credential = true;
    checks.ordinary_edit_route_denied = true;
    stage = "verified-client-identity-across-formats";
    for (const token of agent.ordinaryPlanCredentials) {
      const refused = await send("/api/systems/create",
        {command:{workspaceId:scope.workspaceId, templateId, name:"Synthetic ordinary edit"}}, token);
      assert.equal(refused.status, 403);
      assert.equal(refused.body?.error?.message === "This credential is limited to managed plan review.", true);
      assert.equal((await send(read, discover, token)).status, 403);
    }
    checks.signed_client_id_and_authorized_party_remain_confined = true;

    stage = "exact-proposal-and-replay";
    function proposal(revision: number) {
      const steps = [
        {operation:"systems.create", templateId, name:"Synthetic planned system", idempotencyKey:randomUUID()},
        {operation:"systems.clone", systemId:source.systemId, baseRecordRevision:revision, baseRevisionId:source.revisionId,
          name:"Synthetic planned copy", idempotencyKey:randomUUID()},
      ];
      const decoded = parseHeadlessBuildPlanProposal({...scope, steps}, hostIncarnationId);
      assert.ok(decoded.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(decoded.preview)).digest("hex");
      return {version:HEADLESS_CONTRACT_VERSION, operation:"plan.submit", input:{...scope, steps, fingerprint}};
    }
    const exact = proposal(source.recordRevision);
    const status = {version:HEADLESS_CONTRACT_VERSION, operation:"plan.status", input:{...scope, fingerprint:exact.input.fingerprint}};
    assert.equal((await send(plan, exact, agent.access)).status, 403);
    assert.equal((await send(plan, exact, agent.browser)).status, 403);
    assert.equal((await send(plan, status)).status, 403);
    assert.equal((await send(plan, {...exact, input:{...exact.input, fingerprint:"a".repeat(64)}})).status, 400);
    assert.equal((await send(plan, {...exact, input:{...exact.input, approved:true}})).status, 400);
    assert.equal((await send(plan, proposal(source.recordRevision + 1))).status, 409);
    const staged = await send(plan, exact);
    assert.equal(staged.status, 200);
    const result = readHeadlessPlanReviewAgentResult(staged.body, exact.input.fingerprint, 2);
    assert.ok(result.ok && result.value.revision === 1 && result.value.status === "pending" && result.value.approvedSteps === 0);
    assert.deepEqual((await send(plan, exact)).body, staged.body);
    assert.deepEqual((await send(plan, status)).body, staged.body);
    assert.equal((await send(plan, {...status, input:{...status.input, workspaceId:"workspace.foreign-fixture"}})).status, 403);
    assert.deepEqual((await snapshot()).body, before.body);
    checks.exact_plan_replay_preserves_deadline = true;
    checks.changed_source_and_forged_input_denied = true;
    checks.staging_does_not_edit_saved_systems = true;
    passed = true;
  } finally {
    if (passed) stage = "cleanup";
    await fixture.stop().catch(() => {passed = false;});
    await writeFile(path.join(fixture.runRoot, "managed-headless-plan-staging-evidence.json"), JSON.stringify({
      schema_version:"managed-headless-plan-staging-v1", source_revision:fixture.sourceRevision,
      status:passed ? "passed" : "failed", stage:passed ? "complete" : stage, checks,
    }, null, 2) + "\n", {flag:"wx"});
  }
  process.stdout.write(JSON.stringify({status:passed ? "passed" : "failed", stage:passed ? "complete" : stage,
    source_revision:fixture.sourceRevision, checks}) + "\n");
  if (!passed) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.plan-staging-unqualified"}\n');
  process.exitCode = 1;
});
