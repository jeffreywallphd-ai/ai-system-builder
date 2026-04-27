import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { createContractError } from "../../../../contracts/shared";
import {
  mapApiArtifactUploadRequest,
  mapApiArtifactUploadRequestBody,
  mapStoreArtifactUploadResultToApiResponse,
  registerArtifactUploadApiRoute,
  type ExpressPostRoutePort,
  type StoreArtifactUploadUseCasePort,
} from "../artifact-upload/registerArtifactUploadApiRoute";

function createUseCaseStub(
  executeImpl?: ReturnType<typeof testDouble.fn<StoreArtifactUploadUseCasePort["execute"]>>,
): StoreArtifactUploadUseCasePort {
  return {
    execute:
      executeImpl
      ?? testDouble
        .fn<StoreArtifactUploadUseCasePort["execute"]>()
        .mockRejectedValue(new Error("Missing execute mock implementation.")),
    getAcceptedUploadPolicy: testDouble
      .fn<StoreArtifactUploadUseCasePort["getAcceptedUploadPolicy"]>()
      .mockImplementation(() => ({
        acceptedMediaTypes: ["image/png"],
        acceptedExtensions: [".png"],
      })),
  };
}

function createMultipartRequest(
  boundary: string,
  bytes: number[],
  options?: {
    fileName?: string;
    mediaType?: string;
    source?: string;
  },
): {
  body: undefined;
  headers: Record<string, string>;
  pipe: (destination: NodeJS.WritableStream) => NodeJS.WritableStream;
} {
  const fileName = options?.fileName ?? "cat.png";
  const mediaType = options?.mediaType ?? "image/png";
  const source = options?.source ?? "web.upload.multipart";

  const start =
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="source"\r\n\r\n`
    + `${source}\r\n`
    + `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`
    + `Content-Type: ${mediaType}\r\n\r\n`;
  const end = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(start, "utf8"), Buffer.from(bytes), Buffer.from(end, "utf8")]);

  const request = Readable.from([body]) as Readable & {
    body: undefined;
    headers: Record<string, string>;
  };
  request.body = undefined;
  request.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };

  return request;
}

describe("registerArtifactUploadApiRoute", () => {
  it("maps legacy json api request payload into application command and command context", () => {
    const mapping = mapApiArtifactUploadRequestBody({
      fileName: "cat.png",
      mediaType: "image/png",
      bytes: [137, 80, 78, 71],
      source: "web.upload.form",
    });

    expect(mapping).toEqual({
      command: {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      commandContext: {
        source: "web.upload.form",
      },
    });
  });

  it("maps multipart request payload into application command and command context", async () => {
    const mapping = await mapApiArtifactUploadRequest(
      createMultipartRequest("unit-test-boundary", [137, 80, 78, 71]),
    );

    expect(mapping).toEqual({
      command: {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      commandContext: {
        source: "web.upload.multipart",
      },
    });
  });

  it("maps store-artifact-upload use-case success into an api success envelope", () => {
    const response = mapStoreArtifactUploadResultToApiResponse(
      {
        ok: true,
        value: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
      {
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
    );

    expect(response).toMatchObject({
      ok: true,
      operation: "artifact.upload",
      value: {
        descriptor: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
      },
      requestId: "req-upload-1",
      correlationId: "corr-upload-1",
    });
  });

  it("maps store-artifact-upload use-case failure into an api failure envelope", () => {
    const response = mapStoreArtifactUploadResultToApiResponse(
      {
        ok: false,
        error: createContractError("validation", "Artifact type is not accepted: application/pdf.", {
          details: {
            field: "mediaType",
          },
        }),
        requestId: "req-upload-2",
        correlationId: "corr-upload-2",
      },
      {
        requestId: "req-upload-2",
        correlationId: "corr-upload-2",
      },
    );

    expect(response).toEqual({
      ok: false,
      operation: "artifact.upload",
      error: {
        operation: "artifact.upload",
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
        details: {
          field: "mediaType",
        },
        requestId: "req-upload-2",
        correlationId: "corr-upload-2",
        metadata: undefined,
        kind: "client",
      },
      requestId: "req-upload-2",
      correlationId: "corr-upload-2",
      metadata: undefined,
    });
  });

  it("registers upload route and maps request headers to the use case", async () => {
    let registeredPath: string | undefined;
    let registeredHandler:
      | ((
        request: Parameters<Parameters<ExpressPostRoutePort["post"]>[1]>[0],
        response: Parameters<Parameters<ExpressPostRoutePort["post"]>[1]>[1],
      ) => Promise<void>)
      | undefined;

    const app: ExpressPostRoutePort = {
      get: testDouble.fn(),
      post: testDouble.fn((path, handler) => {
        registeredPath = path;
        registeredHandler = handler;
      }),
    };

    const execute = testDouble.fn<StoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
      ok: true,
      value: {
        storage: {
          key: "uploads/cat.png",
          mediaType: "image/png",
          sizeBytes: 4,
        },
        sourceKind: "upload",
      },
      requestId: "req-upload-3",
      correlationId: "corr-upload-3",
    });

    registerArtifactUploadApiRoute({
      app,
      storeArtifactUploadUseCase: createUseCaseStub(execute),
    });

    expect(app.post).toHaveBeenCalledOnce();
    expect(registeredPath).toBe("/api/artifact/upload");
    expect(registeredHandler).toBeTypeOf("function");

    const json = testDouble.fn();
    const routeResponse = {
      status: testDouble.fn((_: number) => routeResponse),
      json,
    };
    const routeRequest = createMultipartRequest("route-test-boundary", [137, 80, 78, 71], {
      source: "server.web.upload-form",
    });
    routeRequest.headers = {
      "content-type": "multipart/form-data; boundary=route-test-boundary",
      "x-request-id": "req-upload-3",
      "x-correlation-id": "corr-upload-3",
    };

    await registeredHandler?.(
      routeRequest,
      routeResponse,
    );

    expect(execute).toHaveBeenCalledWith(
      {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      {
        source: "server.web.upload-form",
      },
      {
        requestId: "req-upload-3",
        correlationId: "corr-upload-3",
      },
    );
    expect(routeResponse.status).toHaveBeenCalledWith(200);
    const jsonBody = json.mock.calls[0]?.[0];
    expect(jsonBody).toMatchObject({
      ok: true,
      operation: "artifact.upload",
      value: {
        descriptor: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
      },
      requestId: "req-upload-3",
      correlationId: "corr-upload-3",
    });
  });

  it("returns a validation error envelope when multipart file is missing", async () => {
    let registeredHandler:
      | ((request: unknown, response: { status: (statusCode: number) => unknown; json: (body: unknown) => void }) => Promise<void>)
      | undefined;

    const app: ExpressPostRoutePort = {
      get: testDouble.fn(),
      post: testDouble.fn((_path, handler) => {
        registeredHandler = handler as typeof registeredHandler;
      }),
    };

    registerArtifactUploadApiRoute({
      app,
      storeArtifactUploadUseCase: createUseCaseStub(),
    });

    const json = testDouble.fn();
    const routeResponse = {
      status: testDouble.fn((_: number) => routeResponse),
      json,
    };
    const missingFileRequest = Readable.from([Buffer.from("--missing-file-boundary--\r\n")]) as Readable & {
      body: undefined;
      headers: Record<string, string>;
    };
    missingFileRequest.body = undefined;
    missingFileRequest.headers = {
      "content-type": "multipart/form-data; boundary=missing-file-boundary",
    };

    await registeredHandler?.(
      missingFileRequest,
      routeResponse,
    );

    expect(routeResponse.status).toHaveBeenCalledWith(400);
    const jsonBody = json.mock.calls[0]?.[0];
    expect(jsonBody).toMatchObject({
      ok: false,
      operation: "artifact.upload",
      error: {
        code: "validation",
        message: "multipart artifact upload requires a file field.",
      },
    });
  });
});

describe("registerExpressApi top-level aggregator surface", () => {
  it("remains a tiny registration-only aggregator without feature helper re-exports", () => {
    const aggregatorTypeScriptPath = fileURLToPath(new URL("../registerExpressApi.ts", import.meta.url));
    const aggregatorPath = existsSync(aggregatorTypeScriptPath)
      ? aggregatorTypeScriptPath
      : aggregatorTypeScriptPath.replace(/\.ts$/, ".js");
    const source = readFileSync(aggregatorPath, "utf8");

    expect(source).not.toContain("export type");
    expect(source).not.toContain("mapApiArtifactUploadRequestBody");
    expect(source).not.toContain("mapStoreArtifactUploadResultToApiResponse");
  });
});
