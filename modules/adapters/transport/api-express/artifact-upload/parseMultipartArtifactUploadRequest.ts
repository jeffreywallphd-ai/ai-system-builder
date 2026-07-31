import Busboy from "busboy";

import { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../../../../application/use-cases";

export interface MultipartArtifactUploadFile {
  originalName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ParsedMultipartArtifactUploadRequest {
  file: MultipartArtifactUploadFile;
  source?: string;
  workspaceId?: string;
}

interface MultipartRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  pipe?: (destination: NodeJS.WritableStream) => NodeJS.WritableStream;
  on?: (event: string, listener: (chunk?: Buffer | string | Error) => void) => void;
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeBusboyHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const contentType = getHeaderValue(headers, "content-type");
  if (!contentType || !contentType.toLowerCase().includes("multipart/form-data")) {
    throw new Error("multipart artifact upload requires a multipart/form-data content-type.");
  }

  return {
    "content-type": contentType,
  };
}

export async function parseMultipartArtifactUploadRequest(
  request: MultipartRequestLike,
  maximumBytes = ARTIFACT_UPLOAD_MAXIMUM_BYTES,
): Promise<ParsedMultipartArtifactUploadRequest> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("multipart artifact upload maximumBytes must be a positive safe integer.");
  }
  const pipeRequest = request.pipe;
  if (typeof pipeRequest !== "function") {
    throw new Error("multipart artifact upload requires a readable request stream.");
  }

  return await new Promise<ParsedMultipartArtifactUploadRequest>((resolve, reject) => {
    const parser = Busboy({
      headers: normalizeBusboyHeaders(request.headers),
      limits: {
        fileSize: maximumBytes,
        files: 1,
        fields: 2,
        // Busboy observes the closing boundary when enforcing this limit, so
        // allow one sentinel part beyond the accepted file + two fields.
        // The independent files/fields limits still reject any extra payload.
        parts: 4,
        fieldSize: 4 * 1024,
        fieldNameSize: 64,
        headerPairs: 32,
      },
    });

    let parsedFile: MultipartArtifactUploadFile | undefined;
    let parsedSource: string | undefined;
    let parsedWorkspaceId: string | undefined;
    let limitFailureMessage: string | undefined;

    parser.on("file", (fieldName, stream, fileInfo) => {
      if (fieldName !== "file") {
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("limit", () => {
        limitFailureMessage = `multipart artifact upload exceeds the ${maximumBytes}-byte limit.`;
        chunks.splice(0, chunks.length);
      });
      stream.on("data", (chunk) => {
        if (limitFailureMessage) return;
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => {
        if (limitFailureMessage) return;
        parsedFile = {
          originalName: fileInfo.filename.trim(),
          mediaType: fileInfo.mimeType || "application/octet-stream",
          bytes: new Uint8Array(Buffer.concat(chunks)),
        };
      });
      stream.on("error", reject);
    });

    parser.on("field", (fieldName, value, info) => {
      if (info.valueTruncated) {
        limitFailureMessage = "multipart artifact upload field exceeds the allowed size.";
        return;
      }
      if (fieldName === "source") {
        parsedSource = value;
      }
      if (fieldName === "workspaceId") {
        parsedWorkspaceId = value;
      }
    });

    parser.on("filesLimit", () => {
      limitFailureMessage = "multipart artifact upload accepts exactly one file.";
    });
    parser.on("fieldsLimit", () => {
      limitFailureMessage = "multipart artifact upload contains too many fields.";
    });
    parser.on("partsLimit", () => {
      limitFailureMessage = "multipart artifact upload contains too many parts.";
    });

    parser.on("error", reject);
    request.on?.("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));

    parser.on("close", () => {
      if (limitFailureMessage) {
        reject(new Error(limitFailureMessage));
        return;
      }
      if (!parsedFile) {
        reject(new Error("multipart artifact upload requires a file field."));
        return;
      }

      resolve({
        file: parsedFile,
        source: parsedSource,
        workspaceId: parsedWorkspaceId,
      });
    });

    pipeRequest.call(request, parser);
  });
}
