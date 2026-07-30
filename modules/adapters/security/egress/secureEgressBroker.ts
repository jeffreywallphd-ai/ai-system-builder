import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface SecureEgressPolicy {
  readonly allowedProtocols: readonly ["http:", "https:"] | readonly ["https:"];
  readonly maximumRedirects: number;
  readonly maximumResponseBytes: number;
  readonly maximumTotalBytes: number;
  readonly timeoutMs: number;
  readonly maximumConcurrentRequests: number;
}

export interface SecureEgressResponse {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
}

export interface SecureEgressTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  cancel?(): void;
}

export type SecureEgressDnsLookup = (
  hostname: string,
) => Promise<readonly { address: string; family: 4 | 6 }[]>;

export type SecureEgressRequestImplementation = (input: {
  readonly url: URL;
  readonly addresses: readonly { address: string; family: 4 | 6 }[];
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}) => Promise<SecureEgressTransportResponse>;

export class SecureEgressError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "destination-denied"
      | "dns-denied"
      | "redirect-denied"
      | "media-type-denied"
      | "size-exceeded"
      | "timeout"
      | "transport-failed",
  ) {
    super(message);
    this.name = "SecureEgressError";
  }
}

const DEFAULT_POLICY: SecureEgressPolicy = {
  allowedProtocols: ["http:", "https:"],
  maximumRedirects: 5,
  maximumResponseBytes: 5 * 1024 * 1024,
  maximumTotalBytes: 12 * 1024 * 1024,
  timeoutMs: 15_000,
  maximumConcurrentRequests: 4,
};

function ipv4Number(address: string): number | undefined {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inIpv4Cidr(address: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return false;
  const denied = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const;
  return !denied.some(([network, prefix]) => inIpv4Cidr(value, ipv4Number(network)!, prefix));
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  const expanded = expandIpv6(normalized);
  if (!expanded) return false;
  const first = expanded[0]!;
  if ((first & 0xe000) !== 0x2000) return false;
  const deniedPrefixes = [
    ["2001:0000::", 23],
    ["2001:0db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ] as const;
  return !deniedPrefixes.some(([network, prefix]) => inIpv6Cidr(expanded, expandIpv6(network)!, prefix));
}

function expandIpv6(address: string): readonly number[] | undefined {
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (value: string): number[] | undefined => {
    if (!value) return [];
    const segments = value.split(":");
    const parsed: number[] = [];
    for (const segment of segments) {
      if (segment.includes(".")) {
        const ipv4 = ipv4Number(segment);
        if (ipv4 === undefined) return undefined;
        parsed.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(segment)) return undefined;
      parsed.push(Number.parseInt(segment, 16));
    }
    return parsed;
  };
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const omitted = 8 - left.length - right.length;
  return omitted >= 1 ? [...left, ...Array<number>(omitted).fill(0), ...right] : undefined;
}

function inIpv6Cidr(address: readonly number[], network: readonly number[], prefix: number): boolean {
  const fullSegments = Math.floor(prefix / 16);
  const remainingBits = prefix % 16;
  for (let index = 0; index < fullSegments; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (address[fullSegments]! & mask) === (network[fullSegments]! & mask);
}

export function isPublicEgressAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

function normalizeHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[name.toLowerCase()] = value;
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(", ");
  }
  return normalized;
}

function defaultRequestImplementation(input: Parameters<SecureEgressRequestImplementation>[0]): Promise<SecureEgressTransportResponse> {
  return new Promise((resolve, reject) => {
    const request = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const pinnedLookup = ((
      _hostname: string,
      options: { all?: boolean } | number,
      callback: (...args: unknown[]) => void,
    ) => {
      if (typeof options === "object" && options.all) {
        callback(null, input.addresses);
        return;
      }
      const selected = input.addresses[0];
      if (!selected) {
        callback(new Error("No validated destination address is available."));
        return;
      }
      callback(null, selected.address, selected.family);
    }) as never;
    const outgoing = request(input.url, {
      method: "GET",
      headers: input.headers,
      lookup: pinnedLookup,
      signal: input.signal,
    }, (response) => {
      resolve({
        status: response.statusCode ?? 0,
        headers: normalizeHeaders(response.headers),
        body: response as AsyncIterable<Uint8Array>,
        cancel: () => response.destroy(),
      });
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  public constructor(private readonly maximum: number) {}

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

function mediaTypeAllowed(contentType: string | undefined, allowed: readonly string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType) return false;
  return allowed.some((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized.endsWith("/*")
      ? mediaType.startsWith(normalized.slice(0, -1))
      : mediaType === normalized;
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    throw new SecureEgressError("Secure egress request timed out.", "timeout");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new SecureEgressError("Secure egress request timed out.", "timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class SecureEgressBroker {
  private readonly policy: SecureEgressPolicy;
  private readonly resolveDns: SecureEgressDnsLookup;
  private readonly requestImplementation: SecureEgressRequestImplementation;
  private readonly semaphore: Semaphore;

  public constructor(options: {
    policy?: Partial<SecureEgressPolicy>;
    resolveDns?: SecureEgressDnsLookup;
    requestImplementation?: SecureEgressRequestImplementation;
  } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    if (
      !Number.isInteger(this.policy.maximumRedirects)
      || this.policy.maximumRedirects < 0
      || !Number.isSafeInteger(this.policy.maximumResponseBytes)
      || this.policy.maximumResponseBytes <= 0
      || !Number.isSafeInteger(this.policy.maximumTotalBytes)
      || this.policy.maximumTotalBytes <= 0
      || !Number.isSafeInteger(this.policy.timeoutMs)
      || this.policy.timeoutMs <= 0
      || !Number.isSafeInteger(this.policy.maximumConcurrentRequests)
      || this.policy.maximumConcurrentRequests <= 0
    ) {
      throw new TypeError("Secure egress policy limits must be positive safe integers.");
    }
    this.resolveDns = options.resolveDns ?? (async (hostname) => {
      const results = await dnsLookup(hostname, { all: true, verbatim: true });
      return results.map(({ address, family }) => {
        if (family !== 4 && family !== 6) {
          throw new SecureEgressError("Secure egress DNS returned an unsupported address family.", "dns-denied");
        }
        return { address, family };
      });
    });
    this.requestImplementation = options.requestImplementation ?? defaultRequestImplementation;
    this.semaphore = new Semaphore(this.policy.maximumConcurrentRequests);
  }

  public createSession(options: {
    allowedMediaTypes?: readonly string[];
    maximumResponseBytes?: number;
    maximumTotalBytes?: number;
    timeoutMs?: number;
  } = {}) {
    const startedAt = Date.now();
    let totalBytes = 0;
    const maximumResponseBytes = options.maximumResponseBytes ?? this.policy.maximumResponseBytes;
    const maximumTotalBytes = options.maximumTotalBytes ?? this.policy.maximumTotalBytes;
    const timeoutMs = options.timeoutMs ?? this.policy.timeoutMs;

    return {
      fetch: async (target: string, requestOptions: { headers?: Readonly<Record<string, string>> } = {}) =>
        this.semaphore.run(async () => {
          let current = await withTimeout(
            this.resolveAllowedTarget(target),
            timeoutMs - (Date.now() - startedAt),
          );
          let redirects = 0;
          let headers = { ...(requestOptions.headers ?? {}) };

          while (true) {
            const remainingMs = timeoutMs - (Date.now() - startedAt);
            if (remainingMs <= 0) {
              throw new SecureEgressError("Secure egress request timed out.", "timeout");
            }
            const controller = new AbortController();
            let response: SecureEgressTransportResponse | undefined;
            const timer = setTimeout(() => {
              controller.abort();
              response?.cancel?.();
            }, remainingMs);
            try {
              try {
                response = await this.requestImplementation({
                  url: current.url,
                  addresses: current.addresses,
                  headers,
                  signal: controller.signal,
                });
              } catch (error) {
                if (controller.signal.aborted) {
                  throw new SecureEgressError("Secure egress request timed out.", "timeout");
                }
                throw new SecureEgressError(
                  `Secure egress transport failed: ${error instanceof Error ? error.message : String(error)}`,
                  "transport-failed",
                );
              }

              const location = response.headers.location;
              if (response.status >= 300 && response.status < 400 && location) {
                response.cancel?.();
                redirects += 1;
                if (redirects > this.policy.maximumRedirects) {
                  throw new SecureEgressError("Secure egress redirect limit exceeded.", "redirect-denied");
                }
                const previousOrigin = current.url.origin;
                current = await withTimeout(
                  this.resolveAllowedTarget(new URL(location, current.url).toString()),
                  timeoutMs - (Date.now() - startedAt),
                );
                if (current.url.origin !== previousOrigin) {
                  const { authorization: _authorization, cookie: _cookie, ...safeHeaders } = headers;
                  headers = safeHeaders;
                }
                continue;
              }

              if (!mediaTypeAllowed(response.headers["content-type"], options.allowedMediaTypes)) {
                response.cancel?.();
                throw new SecureEgressError("Secure egress response media type is not allowed.", "media-type-denied");
              }
              const declaredLength = Number(response.headers["content-length"]);
              if (Number.isFinite(declaredLength) && (
                declaredLength > maximumResponseBytes
                || totalBytes + declaredLength > maximumTotalBytes
              )) {
                response.cancel?.();
                throw new SecureEgressError("Secure egress response exceeds the configured byte limit.", "size-exceeded");
              }

              const chunks: Uint8Array[] = [];
              let responseBytes = 0;
              for await (const chunk of response.body) {
                if (controller.signal.aborted) {
                  throw new SecureEgressError("Secure egress request timed out.", "timeout");
                }
                responseBytes += chunk.byteLength;
                totalBytes += chunk.byteLength;
                if (responseBytes > maximumResponseBytes || totalBytes > maximumTotalBytes) {
                  response.cancel?.();
                  throw new SecureEgressError("Secure egress response exceeds the configured byte limit.", "size-exceeded");
                }
                chunks.push(chunk);
              }
              const bytes = new Uint8Array(responseBytes);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
              }
              return {
                url: current.url.toString(),
                status: response.status,
                headers: response.headers,
                bytes,
              } satisfies SecureEgressResponse;
            } catch (error) {
              if (controller.signal.aborted) {
                throw new SecureEgressError("Secure egress request timed out.", "timeout");
              }
              throw error;
            } finally {
              clearTimeout(timer);
            }
          }
        }),
    };
  }

  public async assertAllowedUrl(target: string): Promise<void> {
    await this.resolveAllowedTarget(target);
  }

  public async withTransferPermit<T>(operation: () => Promise<T>): Promise<T> {
    return this.semaphore.run(operation);
  }

  private async resolveAllowedTarget(target: string): Promise<{
    url: URL;
    addresses: readonly { address: string; family: 4 | 6 }[];
  }> {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new SecureEgressError("Secure egress requires a valid absolute URL.", "destination-denied");
    }
    if (!this.policy.allowedProtocols.some((protocol) => protocol === url.protocol) || url.username || url.password) {
      throw new SecureEgressError("Secure egress destination scheme or credentials are not allowed.", "destination-denied");
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      throw new SecureEgressError("Secure egress destination hostname is not allowed.", "destination-denied");
    }
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily as 4 | 6 }]
      : await this.resolveDns(hostname);
    if (addresses.length === 0 || addresses.some(({ address, family }) => (
      isIP(address) !== family || !isPublicEgressAddress(address)
    ))) {
      throw new SecureEgressError("Secure egress DNS resolution includes a denied address.", "dns-denied");
    }
    return { url, addresses };
  }
}

export async function readBoundedWebResponse(input: {
  response: Response;
  maximumBytes: number;
  allowedMediaTypes?: readonly string[];
}): Promise<Uint8Array> {
  const contentType = input.response.headers.get("content-type") ?? undefined;
  if (!mediaTypeAllowed(contentType, input.allowedMediaTypes)) {
    throw new SecureEgressError("Remote response media type is not allowed.", "media-type-denied");
  }
  const declaredLength = Number(input.response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > input.maximumBytes) {
    throw new SecureEgressError("Remote response exceeds the configured byte limit.", "size-exceeded");
  }
  if (!input.response.body) return new Uint8Array();
  const reader = input.response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > input.maximumBytes) {
        await reader.cancel();
        throw new SecureEgressError("Remote response exceeds the configured byte limit.", "size-exceeded");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
