import {types} from "node:util";

/** A host-owned synchronous fence must return true, never an awaited authority. */
export function isHeadlessReadCurrent(check: unknown): boolean {
  if (typeof check !== "function") return false;
  try {
    const value: unknown = check();
    if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
    return value === true;
  } catch {return false;}
}
