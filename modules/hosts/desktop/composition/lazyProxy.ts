export type AsyncProvider<T> = () => Promise<T>;

export function asyncLazyObject<T extends object>(getObject: AsyncProvider<T>): T {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      return async (...args: unknown[]) => {
        const object = await getObject();
        const value = (object as Record<PropertyKey, unknown>)[property];
        if (typeof value !== "function") {
          return value;
        }
        return value.apply(object, args);
      };
    },
  }) as T;
}

export function syncLazyObject<T extends object>(getObject: () => T): T {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      const object = getObject();
      const value = (object as Record<PropertyKey, unknown>)[property];
      return typeof value === "function" ? value.bind(object) : value;
    },
  }) as T;
}
