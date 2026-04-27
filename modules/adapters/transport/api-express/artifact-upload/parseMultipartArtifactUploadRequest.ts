import Busboy from "busboy";

export interface MultipartArtifactUploadFile {
  originalName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ParsedMultipartArtifactUploadRequest {
  file: MultipartArtifactUploadFile;
  source?: string;
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
): Promise<ParsedMultipartArtifactUploadRequest> {
  if (typeof request.pipe !== "function") {
    throw new Error("multipart artifact upload requires a readable request stream.");
  }

  return await new Promise<ParsedMultipartArtifactUploadRequest>((resolve, reject) => {
    const parser = Busboy({
      headers: normalizeBusboyHeaders(request.headers),
    });

    let parsedFile: MultipartArtifactUploadFile | undefined;
    let parsedSource: string | undefined;

    parser.on("file", (fieldName, stream, fileInfo) => {
      if (fieldName !== "file") {
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => {
        parsedFile = {
          originalName: fileInfo.filename.trim(),
          mediaType: fileInfo.mimeType || "application/octet-stream",
          bytes: new Uint8Array(Buffer.concat(chunks)),
        };
      });
      stream.on("error", reject);
    });

    parser.on("field", (fieldName, value) => {
      if (fieldName === "source") {
        parsedSource = value;
      }
    });

    parser.on("error", reject);
    request.on?.("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));

    parser.on("close", () => {
      if (!parsedFile) {
        reject(new Error("multipart artifact upload requires a file field."));
        return;
      }

      resolve({
        file: parsedFile,
        source: parsedSource,
      });
    });

    request.pipe(parser);
  });
}
