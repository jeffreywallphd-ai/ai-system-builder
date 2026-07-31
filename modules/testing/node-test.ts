import assert from "node:assert/strict";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  test,
} from "node:test";
import { isDeepStrictEqual } from "node:util";

type AnyFunction = (...args: any[]) => any;

type ExpectAnyMatcher = {
  readonly __matcher: "any";
  readonly ctor: AnyFunction;
};

type ExpectStringMatchingMatcher = {
  readonly __matcher: "stringMatching";
  readonly regex: RegExp;
};

type ExpectObjectContainingMatcher = {
  readonly __matcher: "objectContaining";
  readonly value: Record<string, unknown>;
};

type MatcherValue = ExpectAnyMatcher | ExpectStringMatchingMatcher | ExpectObjectContainingMatcher;

type SpyFunction<TFunction extends AnyFunction = AnyFunction> = TFunction & {
  mock: {
    calls: Parameters<TFunction>[];
  };
  mockResolvedValue(value: Awaited<ReturnType<TFunction>>): SpyFunction<TFunction>;
  mockRejectedValue(error: unknown): SpyFunction<TFunction>;
  mockResolvedValueOnce(value: Awaited<ReturnType<TFunction>>): SpyFunction<TFunction>;
  mockRejectedValueOnce(error: unknown): SpyFunction<TFunction>;
  mockReturnValue(value: ReturnType<TFunction>): SpyFunction<TFunction>;
  mockReturnThis(): SpyFunction<TFunction>;
  mockImplementation(implementation: TFunction): SpyFunction<TFunction>;
  mockImplementationOnce(implementation: TFunction): SpyFunction<TFunction>;
  mockClear(): SpyFunction<TFunction>;
};

type SpyOnResult<T extends object, K extends keyof T> = SpyFunction<AnyFunction> & {
  mockRestore(): void;
};

const activeSpyRestores = new Set<() => void>();

function isMatcherValue(value: unknown): value is MatcherValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "__matcher" in value &&
    ((value as MatcherValue).__matcher === "any" ||
      (value as MatcherValue).__matcher === "stringMatching" ||
      (value as MatcherValue).__matcher === "objectContaining")
  );
}

function deepMatch(actual: any, expected: any): boolean {
  if (isMatcherValue(expected)) {
    if (expected.__matcher === "any") {
      return actual instanceof expected.ctor || typeof actual === expected.ctor.name.toLowerCase();
    }

    if (expected.__matcher === "objectContaining") {
      return deepMatch(actual, expected.value);
    }

    return typeof actual === "string" && expected.regex.test(actual);
  }

  if (expected instanceof RegExp) {
    return typeof actual === "string" && expected.test(actual);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }

    return expected.every((value, index) => deepMatch(actual[index], value));
  }

  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") {
      return false;
    }

    for (const [key, value] of Object.entries(expected)) {
      if (!deepMatch((actual as Record<string, unknown>)[key], value)) {
        return false;
      }
    }

    return true;
  }

  return isDeepStrictEqual(actual, expected);
}

function createSpyFunction<TFunction extends AnyFunction>(
  implementation?: TFunction,
): SpyFunction<TFunction> {
  let impl = implementation;
  const onceImplementations: TFunction[] = [];
  const calls: Parameters<TFunction>[] = [];

  const spy = ((...args: Parameters<TFunction>) => {
    calls.push(args);

    const onceImplementation = onceImplementations.shift();
    if (onceImplementation) {
      return onceImplementation(...args);
    }

    if (!impl) {
      return undefined as ReturnType<TFunction>;
    }

    return impl(...args);
  }) as SpyFunction<TFunction>;

  spy.mock = { calls };

  spy.mockResolvedValue = (value: Awaited<ReturnType<TFunction>>) => {
    impl = (() => Promise.resolve(value)) as TFunction;
    return spy;
  };

  spy.mockRejectedValue = (error: unknown) => {
    impl = (() => Promise.reject(error)) as TFunction;
    return spy;
  };

  spy.mockResolvedValueOnce = (value: Awaited<ReturnType<TFunction>>) => {
    onceImplementations.push((() => Promise.resolve(value)) as TFunction);
    return spy;
  };

  spy.mockRejectedValueOnce = (error: unknown) => {
    onceImplementations.push((() => Promise.reject(error)) as TFunction);
    return spy;
  };

  spy.mockReturnValue = (value: ReturnType<TFunction>) => {
    impl = (() => value) as TFunction;
    return spy;
  };

  spy.mockReturnThis = () => {
    impl = function thisImplementation(this: unknown) {
      return this as ReturnType<TFunction>;
    } as TFunction;
    return spy;
  };

  spy.mockImplementation = (nextImplementation: TFunction) => {
    impl = nextImplementation;
    return spy;
  };

  spy.mockImplementationOnce = (nextImplementation: TFunction) => {
    onceImplementations.push(nextImplementation);
    return spy;
  };

  spy.mockClear = () => {
    calls.splice(0, calls.length);
    return spy;
  };

  return spy;
}

function throwWithMessage(message: string): never {
  throw new assert.AssertionError({ message });
}

function ensureSpy(value: unknown, matcherName: string): asserts value is { mock: { calls: unknown[] } } {
  if (
    !value ||
    typeof value !== "function" ||
    typeof (value as { mock?: unknown }).mock !== "object" ||
    (value as { mock?: { calls?: unknown } }).mock?.calls === undefined
  ) {
    throwWithMessage(`${matcherName} requires a spy function created with testDouble.fn/testDouble.spyOn.`);
  }
}

function formatExpected(expected: unknown): string {
  try {
    return JSON.stringify(expected);
  } catch {
    return String(expected);
  }
}

function assertWithNot(isNot: boolean, condition: boolean, message: string): void {
  if (isNot) {
    assert.equal(condition, false, message);
    return;
  }

  assert.equal(condition, true, message);
}

function createMatchers(actual: unknown, isNot: boolean) {
  const matchers = {
    toBe(expected: unknown) {
      if (isNot) {
        assert.notStrictEqual(actual, expected);
        return;
      }

      assert.strictEqual(actual, expected);
    },
    toEqual(expected: unknown) {
      if (isNot) {
        assert.notDeepStrictEqual(actual, expected);
        return;
      }

      assert.deepStrictEqual(actual, expected);
    },
    toContain(expected: unknown) {
      const contains =
        typeof actual === "string"
          ? actual.includes(String(expected))
          : Array.isArray(actual) && actual.some((entry) => deepMatch(entry, expected));

      assertWithNot(
        isNot,
        contains,
        `Expected ${formatExpected(actual)} ${isNot ? "not " : ""}to contain ${formatExpected(expected)}.`,
      );
    },
    toMatchObject(expected: unknown) {
      const matches = deepMatch(actual, expected);
      assertWithNot(
        isNot,
        matches,
        `Expected ${formatExpected(actual)} ${isNot ? "not " : ""}to match ${formatExpected(expected)}.`,
      );
    },
    toMatch(expected: string | RegExp) {
      if (typeof actual !== "string") {
        throwWithMessage("toMatch requires a string.");
      }

      const matches =
        typeof expected === "string"
          ? actual.includes(expected)
          : expected.test(actual);

      assertWithNot(
        isNot,
        matches,
        `Expected ${formatExpected(actual)} ${isNot ? "not " : ""}to match ${formatExpected(expected)}.`,
      );
    },
    toBeUndefined() {
      if (isNot) {
        assert.notStrictEqual(actual, undefined);
        return;
      }

      assert.strictEqual(actual, undefined);
    },
    toBeDefined() {
      if (isNot) {
        assert.strictEqual(actual, undefined);
        return;
      }

      assert.notStrictEqual(actual, undefined);
    },
    toBeTypeOf(expectedType: string) {
      const actualType = typeof actual;
      if (isNot) {
        assert.notStrictEqual(actualType, expectedType);
        return;
      }

      assert.strictEqual(actualType, expectedType);
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== "number") {
        throwWithMessage("toBeGreaterThan requires a number.");
      }

      if (isNot) {
        assert.equal(actual > expected, false);
        return;
      }

      assert.equal(actual > expected, true);
    },
    toHaveBeenCalledTimes(expected: number) {
      ensureSpy(actual, "toHaveBeenCalledTimes");
      const count = actual.mock.calls.length;
      if (isNot) {
        assert.notStrictEqual(count, expected);
        return;
      }

      assert.strictEqual(count, expected);
    },
    toHaveBeenCalledOnce() {
      ensureSpy(actual, "toHaveBeenCalledOnce");
      const count = actual.mock.calls.length;
      if (isNot) {
        assert.notStrictEqual(count, 1);
        return;
      }

      assert.strictEqual(count, 1);
    },
    toHaveBeenCalled() {
      ensureSpy(actual, "toHaveBeenCalled");
      const wasCalled = actual.mock.calls.length > 0;
      assertWithNot(
        isNot,
        wasCalled,
        `Expected spy ${isNot ? "not " : ""}to have been called.`,
      );
    },
    toHaveBeenCalledWith(...expectedArgs: unknown[]) {
      ensureSpy(actual, "toHaveBeenCalledWith");

      const matches = actual.mock.calls.some((call) => {
        if (!Array.isArray(call) || call.length !== expectedArgs.length) {
          return false;
        }

        return expectedArgs.every((expected, index) => deepMatch(call[index], expected));
      });

      assertWithNot(
        isNot,
        matches,
        `Expected spy ${isNot ? "not " : ""}to be called with ${formatExpected(expectedArgs)}.`,
      );
    },
    toThrow(expected?: string | RegExp | Error) {
      const callable = actual as AnyFunction;
      if (typeof callable !== "function") {
        throwWithMessage("toThrow requires a function.");
      }

      if (isNot) {
        assert.doesNotThrow(callable);
        return;
      }

      if (typeof expected === "string") {
        assert.throws(callable, (error: unknown) => {
          if (!(error instanceof Error)) {
            return false;
          }

          return error.message.includes(expected);
        });
        return;
      }

      if (expected instanceof Error) {
        assert.throws(callable, (error: unknown) => {
          if (!(error instanceof Error)) {
            return false;
          }

          return error.message === expected.message;
        });
        return;
      }

      if (expected instanceof RegExp) {
        assert.throws(callable, expected);
        return;
      }

      assert.throws(callable);
    },
  };

  return matchers;
}

function createResolveMatchers(actual: Promise<unknown>, isNot: boolean) {
  return {
    async toBe(expected: unknown) {
      const value = await actual;
      createMatchers(value, isNot).toBe(expected);
    },
    async toEqual(expected: unknown) {
      const value = await actual;
      createMatchers(value, isNot).toEqual(expected);
    },
    async toMatchObject(expected: unknown) {
      const value = await actual;
      createMatchers(value, isNot).toMatchObject(expected);
    },
    async toBeUndefined() {
      const value = await actual;
      createMatchers(value, isNot).toBeUndefined();
    },
  };
}

function createRejectMatchers(actual: Promise<unknown>, isNot: boolean) {
  return {
    async toThrow(expected?: string | RegExp | Error) {
      if (isNot) {
        await assert.doesNotReject(actual);
        return;
      }

      if (typeof expected === "string") {
        await assert.rejects(actual, (error: unknown) => {
          if (!(error instanceof Error)) {
            return false;
          }

          return error.message.includes(expected);
        });
        return;
      }

      if (expected instanceof Error) {
        await assert.rejects(actual, (error: unknown) => {
          if (!(error instanceof Error)) {
            return false;
          }

          return error.message === expected.message;
        });
        return;
      }

      if (expected instanceof RegExp) {
        await assert.rejects(actual, expected);
        return;
      }

      await assert.rejects(actual);
    },
  };
}

export function expect<TActual>(actual: TActual) {
  const matchers = createMatchers(actual, false);
  const notMatchers = createMatchers(actual, true);

  const expectation = {
    ...matchers,
    get not() {
      return notMatchers;
    },
    get resolves() {
      return createResolveMatchers(Promise.resolve(actual), false);
    },
    get rejects() {
      return createRejectMatchers(Promise.resolve(actual), false);
    },
  };

  return expectation;
}

expect.any = (ctor: AnyFunction): ExpectAnyMatcher => ({
  __matcher: "any",
  ctor,
});

expect.stringMatching = (regex: RegExp): ExpectStringMatchingMatcher => ({
  __matcher: "stringMatching",
  regex,
});

expect.objectContaining = (value: Record<string, unknown>): ExpectObjectContainingMatcher => ({
  __matcher: "objectContaining",
  value,
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
    ? true
    : false
  : false;

export function expectTypeOf<T>() {
  return {
    toEqualTypeOf<U>(..._args: Equal<T, U> extends true ? [] : ["Expected types to be equal"]) {
    },
    toExtend<U>(..._args: T extends U ? [] : ["Expected type to extend target"]) {
    },
    toMatchTypeOf<U>(..._args: T extends U ? [] : ["Expected type to match target"]) {
    },
    not: {
      toExtend<U>(..._args: T extends U ? ["Expected type not to extend target"] : []) {
      },
      toMatchTypeOf<U>(..._args: T extends U ? ["Expected type not to match target"] : []) {
      },
    },
  };
}

export const testDouble = {
  fn<TFunction extends AnyFunction = AnyFunction>(
    implementation?: TFunction,
  ): SpyFunction<TFunction> {
    return createSpyFunction(implementation);
  },
  spyOn<TObject extends object, TKey extends keyof TObject>(
    object: TObject,
    methodName: TKey,
  ): SpyOnResult<TObject, TKey> {
    const original = object[methodName];
    if (typeof original !== "function") {
      throw new TypeError(`Cannot spy on non-function property ${String(methodName)}.`);
    }

    const spy = createSpyFunction<AnyFunction>((...args) =>
      (original as unknown as (...innerArgs: any[]) => any).apply(object, args),
    ) as SpyOnResult<TObject, TKey>;

    const restore = () => {
      object[methodName] = original;
      activeSpyRestores.delete(restore);
    };

    spy.mockRestore = restore;
    activeSpyRestores.add(restore);
    object[methodName] = spy as unknown as TObject[TKey];

    return spy;
  },
  restoreAllMocks() {
    for (const restore of [...activeSpyRestores]) {
      restore();
    }
  },
};

afterEach(() => {
  testDouble.restoreAllMocks();
});

// Backward-compatible alias for older tests still using Vitest naming.
export const vi = testDouble;


export {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  test,
};
