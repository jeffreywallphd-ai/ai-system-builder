import assert from "node:assert/strict";
import test from "node:test";

import { createExpressJsonBodyErrorMiddleware } from "./createExpressJsonBodyErrorMiddleware";

test("JSON body middleware returns a sanitized API failure for parse errors", () => {
  const middleware = createExpressJsonBodyErrorMiddleware();
  const result = response();
  let forwarded: unknown;
  middleware(
    { type: "entity.parse.failed", status: 400, message: "secret parser detail" },
    request({ "x-request-id": "request-a", "x-correlation-id": "correlation-a" }),
    result as never,
    (error?: unknown) => { forwarded = error; },
  );
  assert.equal(forwarded, undefined);
  assert.equal(result.statusCode, 400);
  assert.equal((result.body as any).operation, "api.request-body");
  assert.equal((result.body as any).requestId, "request-a");
  assert.equal((result.body as any).correlationId, "correlation-a");
  assert.equal((result.body as any).error.message, "Request body could not be parsed.");
  assert.doesNotMatch(JSON.stringify(result.body), /secret parser detail/);
});

test("JSON body middleware returns a safe 413 response", () => {
  const middleware = createExpressJsonBodyErrorMiddleware();
  const result = response();
  middleware(
    { type: "entity.too.large", statusCode: 413, message: "configured limit and stack" },
    request(),
    result as never,
    () => assert.fail("known body-parser failures must not be forwarded"),
  );
  assert.equal(result.statusCode, 413);
  assert.equal((result.body as any).error.message, "Request body exceeds the configured size limit.");
  assert.doesNotMatch(JSON.stringify(result.body), /configured limit and stack/);
});

test("JSON body middleware forwards unrelated errors unchanged", () => {
  const middleware = createExpressJsonBodyErrorMiddleware();
  const result = response();
  const original = new Error("route failure");
  let forwarded: unknown;
  middleware(original, request(), result as never, (error?: unknown) => { forwarded = error; });
  assert.equal(forwarded, original);
  assert.equal(result.body, undefined);
});

function request(headers: Readonly<Record<string, string>> = {}) {
  return { header: (name: string) => headers[name.toLowerCase()] } as never;
}

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}
