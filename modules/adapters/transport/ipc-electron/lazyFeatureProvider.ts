export type AsyncFeatureProvider<TFeature extends object> = () => Promise<TFeature>;

export interface LazyProvidedObjectOptions {
  readonly afterCall?: (property: PropertyKey) => void;
}

type AsyncLazyObject<TObject extends object> = {
  [K in keyof TObject]: TObject[K] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Promise<Awaited<Return>>
    : TObject[K];
};

export function lazyProvidedObject<TFeature extends object>(provider: AsyncFeatureProvider<TFeature>, options?: LazyProvidedObjectOptions): AsyncLazyObject<TFeature>;
export function lazyProvidedObject<TFeature extends object, TObject extends object>(provider: AsyncFeatureProvider<TFeature>, select: (feature: TFeature) => TObject, options?: LazyProvidedObjectOptions): AsyncLazyObject<TObject>;
export function lazyProvidedObject<TFeature extends object, TObject extends object = TFeature>(provider: AsyncFeatureProvider<TFeature>, selectOrOptions?: ((feature: TFeature) => TObject) | LazyProvidedObjectOptions, maybeOptions?: LazyProvidedObjectOptions): AsyncLazyObject<TObject> {
  const select = typeof selectOrOptions === "function" ? selectOrOptions : undefined;
  const options = typeof selectOrOptions === "function" ? maybeOptions : selectOrOptions;
  return new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      return async (...args: unknown[]) => {
        const feature = await provider();
        const object = select ? select(feature) : feature as unknown as TObject;
        const value = (object as Record<PropertyKey, unknown>)[property];
        if (typeof value !== "function") return value;
        try {
          return await value.apply(object, args);
        } finally {
          try {
            options?.afterCall?.(property);
          } catch {
            // Lifecycle release hooks are best-effort and must not change IPC results.
          }
        }
      };
    },
  }) as AsyncLazyObject<TObject>;
}
