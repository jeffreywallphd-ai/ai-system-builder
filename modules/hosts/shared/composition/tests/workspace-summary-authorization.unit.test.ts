import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from '../../../../adapters/persistence/shared';
import { initializeLocalIdentityProfile } from '../../../../adapters/security/local-identity';
import { composeDesktopWorkspaceAuthorization } from '../../../../hosts/desktop/composition/composeDesktopWorkspaceAuthorization';
import { AuthorizeWorkspaceOperationService } from '../../../../application/services/security';
import { ReadWorkspaceSummaryUseCase } from '../../../../application/use-cases/workspace';

test("real organization policy denies missing/foreign summary authority before reads", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let sequence = 0;
  const identity = await initializeLocalIdentityProfile({documents, organizationDisplayName:'Fixture',principalDisplayName:'Fixture',now:()=> '2026-10-21T00:00:00Z',createId:()=>`review-${++sequence}`});
  const workspace: any = {workspaceId:'workspace.a',organizationId:identity.organizationId,status:'active',displayName:'Fixture',createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z'};
  let reads = 0;
  const allowed = composeDesktopWorkspaceAuthorization({documents,localIdentity:identity});
  const unknownActor = composeDesktopWorkspaceAuthorization({documents,localIdentity:{...identity,principalId:'principal.unknown' as any}});
  const missing = new AuthorizeWorkspaceOperationService({organizationContext:{getCurrentOrganizationContext:()=>undefined},authorizer:{async execute(){throw new Error('must not call');}}});
  async function check(authorization: any, record: any) {
    const before = reads;
    const summary = new ReadWorkspaceSummaryUseCase({workspaceRepository:{readWorkspace:async()=>record},authorization,projections:{models:async()=>{reads++; return {modelsInstalled:2,modelsTrained:3};}}});
    try {const result=await summary.execute({workspaceId:workspace.workspaceId,page:'models'});return {accepted:true,modelReads:reads-before,metrics:result.metrics};}
    catch {return {accepted:false,modelReads:reads-before};}
  }
  assert.equal((await check(allowed,workspace)).accepted,true);
  for (const [authorization, record] of [[unknownActor,workspace],[missing,workspace],[allowed,{...workspace,organizationId:'organization.foreign'}],[allowed,{...workspace,status:'archived'}],[allowed,{...workspace,workspaceId:'workspace.b'}]]) {
    assert.deepEqual(await check(authorization,record), {accepted:false,modelReads:0});
  }
});
