import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerExpressApi } from "../registerExpressApi";

describe('registerExpressApi image generation', ()=>{
  it('registers image generation routes when use case is provided', ()=>{
    const app:any={post:testDouble.fn(),get:testDouble.fn()};
    registerExpressApi({
      app,
      getHuggingFaceTokenStatus: testDouble.fn(), setHuggingFaceToken: testDouble.fn(), clearHuggingFaceToken: testDouble.fn(),
      storeArtifactUploadUseCase: { execute:testDouble.fn(), getAcceptedUploadPolicy:testDouble.fn(()=>({acceptedMediaTypes:[],acceptedExtensions:[]}))},
      browseArtifactsUseCase: { execute:testDouble.fn() }, readArtifactDetailUseCase: { execute:testDouble.fn() }, readArtifactContentUseCase: { execute:testDouble.fn() },
      artifactMediaViewRetrieval: { retrieve:testDouble.fn() }, deleteRegisteredArtifactUseCase:{ execute:testDouble.fn() }, hasArtifactInRepoUseCase:{ execute:testDouble.fn() },
      browseHuggingFaceNamespaceDatasetsUseCase:{ execute:testDouble.fn() }, browseHuggingFaceDatasetParquetFilesUseCase:{ execute:testDouble.fn() }, importHuggingFaceFilesUseCase:{ execute:testDouble.fn() },
      storeArtifactInRepoUseCase:{ execute:testDouble.fn() }, publishArtifactToRepoUseCase:{ execute:testDouble.fn() },
      verifyPublishedArtifactBackingUseCase:{ execute:testDouble.fn() }, verifyImportedArtifactSourceBackingUseCase:{ execute:testDouble.fn() },
      registerArtifactFromRepoUseCase:{ execute:testDouble.fn() }, localizeArtifactFromRepoUseCase:{ execute:testDouble.fn() },
      browseModelsUseCase:{ execute:testDouble.fn() }, getModelDetailsUseCase:{ execute:testDouble.fn() }, listModelsUseCase:{ execute:testDouble.fn() }, saveModelReferenceUseCase:{ execute:testDouble.fn() }, downloadModelUseCase:{ execute:testDouble.fn() }, updateModelRecordUseCase:{ execute:testDouble.fn() }, deleteModelRecordUseCase:{ execute:testDouble.fn() },
      generateImageUseCase: { startImageGeneration:testDouble.fn(), readImageGeneration:testDouble.fn(), cancelImageGeneration:testDouble.fn() },
    } as any);
    const paths = app.post.mock.calls.map((c:any)=>c[0]);
    expect(paths).toContain('/api/image-generation/start');
    expect(paths).toContain('/api/image-generation/read');
    expect(paths).toContain('/api/image-generation/cancel');
    expect(paths).toContain('/api/image-generation/finalize');
  });
});
