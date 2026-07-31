import { describe, expect, it, testDouble } from '../../../../testing/node-test';
import { registerExpressApi } from '../registerExpressApi';

function base(app:unknown){ return { app,
getHuggingFaceTokenStatus:testDouble.fn(), setHuggingFaceToken:testDouble.fn(), clearHuggingFaceToken:testDouble.fn(),
storeArtifactUploadUseCase:{} as never,browseArtifactsUseCase:{} as never,readArtifactDetailUseCase:{} as never,readArtifactContentUseCase:{} as never,artifactMediaViewRetrieval:{} as never,deleteRegisteredArtifactUseCase:{} as never,hasArtifactInRepoUseCase:{} as never,browseHuggingFaceNamespaceDatasetsUseCase:{} as never,browseHuggingFaceDatasetParquetFilesUseCase:{} as never,importHuggingFaceFilesUseCase:{} as never,storeArtifactInRepoUseCase:{} as never,publishArtifactToRepoUseCase:{} as never,verifyPublishedArtifactBackingUseCase:{} as never,verifyImportedArtifactSourceBackingUseCase:{} as never,registerArtifactFromRepoUseCase:{} as never,localizeArtifactFromRepoUseCase:{} as never,generateImageUseCase:{} as never,browseModelsUseCase:{} as never,getModelDetailsUseCase:{} as never,listModelsUseCase:{} as never,saveModelReferenceUseCase:{} as never,downloadModelUseCase:{} as never,updateModelRecordUseCase:{} as never,deleteModelRecordUseCase:{} as never }; }

describe('registerExpressApi conversations', ()=>{
  it('registers conversation execution routes when services provided', ()=>{
    const app={get:testDouble.fn(),post:testDouble.fn()};
    registerExpressApi({ ...base(app), conversationExecutionServices: { conversations: {
      create: { execute: testDouble.fn() }, approve: { execute: testDouble.fn() }, submitTurn: { execute: testDouble.fn() }, cancelTurn: { execute: testDouble.fn() }, retryTurn: { execute: testDouble.fn() },
      readSessions: { listConversationSessions: testDouble.fn(), readDetail: testDouble.fn() }, readTranscript: { readTranscript: testDouble.fn() }, readActivity: { readActivity: testDouble.fn() },
    } } } as never);
    const paths = [...app.get.mock.calls, ...app.post.mock.calls].map((c: readonly unknown[])=>c[0]);
    expect(paths).toContain('/api/conversations/workspaces/:workspaceId/sessions');
    expect(paths).toContain('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/turns');
  });
});
