import {createHash} from "node:crypto";

const getTypedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
)!.get!;

/** Adapter-private inspection. EOF verification runs before the contained writer
 * publishes a target. It grants no filesystem, metadata or admission authority. */
export function verifiedPublicationStream(input: {
  readonly content: AsyncIterable<Uint8Array>;
  readonly maximumBytes: number;
  readonly expectedSizeBytes: number;
  readonly expectedSha256?: string;
}, maximumAllowedBytes: number) {
  if (!Number.isSafeInteger(maximumAllowedBytes) || maximumAllowedBytes < 0 ||
      !Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0 || input.maximumBytes > maximumAllowedBytes ||
      !Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 0 || input.expectedSizeBytes > input.maximumBytes ||
      (input.expectedSha256 !== undefined && !/^sha256:[a-f0-9]{64}$/.test(input.expectedSha256)))
    throw new Error("Invalid content bounds.");
  const {content: source, maximumBytes, expectedSizeBytes, expectedSha256} = input;
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let digest: `sha256:${string}` | undefined;
  let started = false;
  const content = async function* () {
    if (started) throw new Error("Content verification is one use.");
    started = true;
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Invalid content.");
      const byteLength = getTypedArrayByteLength.call(chunk);
      if (byteLength > maximumBytes - sizeBytes) throw new Error("Invalid content.");
      // Hash and write the same private allocation, with intrinsic admission.
      // Concurrent shared growth cannot enlarge this allocation.
      const owned = new Uint8Array(byteLength);
      Uint8Array.prototype.set.call(owned, chunk);
      sizeBytes += owned.byteLength;
      hash.update(owned);
      yield owned;
    }
    const completeDigest = `sha256:${hash.digest("hex")}` as const;
    if (sizeBytes !== expectedSizeBytes || (expectedSha256 !== undefined && expectedSha256 !== completeDigest))
      throw new Error("Content verification failed.");
    digest = completeDigest;
  };
  return {content: content(), result: () => {
    if (!digest || sizeBytes !== expectedSizeBytes) throw new Error("Incomplete content.");
    return {sizeBytes, digest};
  }};
}
