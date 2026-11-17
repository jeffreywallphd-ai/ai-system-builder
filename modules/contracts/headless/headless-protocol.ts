export const HEADLESS_CONTRACT_VERSION = "aisb-headless-v1";

export type HeadlessHostIncarnationId = string & {
  readonly __headlessHostIncarnationIdBrand: unique symbol;
};

export function isHeadlessHostIncarnationId(value: unknown): value is HeadlessHostIncarnationId {
  // Canonical random UUID v4, minted by the host for this process lifetime.
  return typeof value === "string" && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
