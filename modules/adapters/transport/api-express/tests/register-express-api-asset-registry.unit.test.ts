import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerExpressApi } from "../registerExpressApi";

function baseDependencies(app: any) {
  return {
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
  };
}

describe("registerExpressApi asset registry", () => {
  it("registers asset registry routes only when a read port is supplied", () => {
    const withoutApp: any = { post: testDouble.fn(), get: testDouble.fn(), put: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
    registerExpressApi(baseDependencies(withoutApp) as any);
    expect(withoutApp.get.mock.calls.map((call: any) => call[0]).some((path: string) => path.startsWith("/api/assets"))).toBe(false);

    const withApp: any = { post: testDouble.fn(), get: testDouble.fn(), put: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
    const assetRegistryRead = { listDefinitionCards: testDouble.fn(), readDefinitionDetail: testDouble.fn() };
    registerExpressApi({ ...baseDependencies(withApp), assetRegistryRead } as any);

    const getPaths = withApp.get.mock.calls.map((call: any) => call[0]);
    expect(getPaths).toContain("/api/assets/definitions");
    expect(getPaths).toContain("/api/assets/definitions/:definitionId");
    expect(getPaths).toContain("/api/assets/definitions/:definitionId/versions/:version");
  });

  it("does not register asset mutation methods or require repositories/use cases for asset routes", () => {
    const app: any = { post: testDouble.fn(), get: testDouble.fn(), put: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
    registerExpressApi({ ...baseDependencies(app), assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail: testDouble.fn() } } as any);

    const mutationPaths = [app.post, app.put, app.patch, app.delete].flatMap((method: any) => method.mock.calls.map((call: any) => call[0])).filter((path: string) => path.startsWith("/api/assets"));
    expect(mutationPaths).toEqual([]);
  });

  it("registers approved mutation routes only when narrow mutation use cases are supplied", () => {
    const app: any = { post: testDouble.fn(), get: testDouble.fn(), put: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
    const execute = testDouble.fn();
    registerExpressApi({
      ...baseDependencies(app),
      assetMutationUseCases: {
        registerResourceBackedViewAsAsset: { execute },
        finalizeGeneratedOutputAsAsset: { execute },
        importExternalRepositoryObjectAsAsset: { execute },
        localizeExternalRepositoryObjectAsAsset: { execute },
      },
    } as any);

    const mutationPaths = app.post.mock.calls.map((call: any) => call[0]).filter((path: string) => path.startsWith("/api/assets"));
    expect(mutationPaths).toEqual([
      "/api/assets/register-resource-backed-view",
      "/api/assets/finalize-generated-output",
      "/api/assets/import-external-repository-object",
      "/api/assets/localize-external-repository-object",
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("continues to register existing route families", () => {
    const app: any = { post: testDouble.fn(), get: testDouble.fn(), put: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
    registerExpressApi({
      ...baseDependencies(app),
      assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail: testDouble.fn() },
      runtimeReadiness: { getReadinessSnapshot: testDouble.fn(), getCapabilityStatus: testDouble.fn() },
    } as any);

    const getPaths = app.get.mock.calls.map((call: any) => call[0]);
    expect(getPaths).toContain("/api/runtime/readiness");
    expect(getPaths.some((path: string) => path.startsWith("/api/artifact"))).toBe(true);
    expect(app.post.mock.calls.length > 0).toBe(true);
  });
});
