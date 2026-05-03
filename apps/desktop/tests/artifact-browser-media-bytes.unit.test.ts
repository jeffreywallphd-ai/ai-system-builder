import { describe, expect, expectTypeOf, it } from "../../../modules/testing/node-test";
import { copyArtifactMediaBytesToArrayBuffer } from "../src/renderer/features/artifact-browser/helpers/artifactMediaBytes";

describe("artifact browser media byte helpers", () => {
  it("returns an ArrayBuffer BlobPart-compatible copy for typed-array views", () => {
    const backingBytes = new Uint8Array([9, 1, 2, 3, 7]);
    const slicedBytes = backingBytes.subarray(1, 4);

    const copiedBuffer = copyArtifactMediaBytesToArrayBuffer(slicedBytes);

    expectTypeOf<typeof copiedBuffer>().toEqualTypeOf<ArrayBuffer>();
    expect(Array.from(new Uint8Array(copiedBuffer))).toEqual([1, 2, 3]);
  });
});
