import { describe, expectTypeOf, it } from "../../../testing/node-test";

import type { ApplicationRequestContext } from "../../ports";
import type {
  BrowseArtifactsUseCasePort,
  ReadArtifactContentUseCasePort,
  ReadArtifactDetailUseCasePort,
} from "../artifact-browser-read.use-case-ports";

describe("artifact browser read use-case ports", () => {
  it("keeps commands separate from application request context", () => {
    expectTypeOf<Parameters<BrowseArtifactsUseCasePort["execute"]>[0]>().toExtend<{
      artifactFamily: string;
    }>();
    expectTypeOf<Parameters<BrowseArtifactsUseCasePort["execute"]>[0]>().not.toExtend<{
      requestId: string;
      correlationId: string;
    }>();
    expectTypeOf<Parameters<BrowseArtifactsUseCasePort["execute"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();

    expectTypeOf<Parameters<ReadArtifactDetailUseCasePort["execute"]>[0]>().toExtend<{
      locator: { storageKey: string };
    }>();
    expectTypeOf<Parameters<ReadArtifactDetailUseCasePort["execute"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();

    expectTypeOf<Parameters<ReadArtifactContentUseCasePort["execute"]>[0]>().toExtend<{
      locator: { storageKey: string };
    }>();
    expectTypeOf<Parameters<ReadArtifactContentUseCasePort["execute"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();
  });
});
