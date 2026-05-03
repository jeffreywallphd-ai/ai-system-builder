export function copyArtifactMediaBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function normalizeArtifactMediaBytes(bytes: unknown): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return Uint8Array.from(bytes);
  }

  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes.slice(0));
  }

  if (ArrayBuffer.isView(bytes)) {
    const view = bytes as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  if (Array.isArray(bytes)) {
    return Uint8Array.from(bytes);
  }

  if (typeof bytes === "object" && bytes !== null) {
    const values = Object.values(bytes as Record<string, unknown>).filter((v): v is number => typeof v === "number");
    if (values.length > 0) {
      return Uint8Array.from(values);
    }
  }

  throw new Error("Artifact media payload did not contain valid bytes.");
}
