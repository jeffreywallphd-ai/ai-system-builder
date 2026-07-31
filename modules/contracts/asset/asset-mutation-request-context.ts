export interface AssetMutationRequestContext {
  readonly requestId?: string;
  readonly correlationId?: string;
  /**
   * Caller-provided safe idempotency key. It must not be a token, header,
   * session id, provider credential, or raw transport object.
   */
  readonly idempotencyKey?: string;
  readonly requestedAt?: string;
}
