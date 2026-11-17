/** Private inspection facts. None of these fields establishes ownership. */
export interface WindowsFileIdentity { readonly volume: string; readonly fileId: string }
export interface WindowsFileIdentityFacts extends WindowsFileIdentity {
  readonly index: number;
  readonly kind: "D" | "F";
  readonly links: number;
  readonly currentOwner: boolean;
  readonly daclPresent: boolean;
  readonly daclProtected: boolean;
  readonly aceCount: number;
}
export const WINDOWS_IDENTITY_MAX_HANDLES = 64;
export const WINDOWS_IDENTITY_MAX_FRAME = 131200;
export class WindowsFileIdentityUnavailableError extends Error {
  readonly code = "unavailable";
  constructor() { super("Native file identity inspection is unavailable."); }
}
const deny = (): never => { throw new WindowsFileIdentityUnavailableError(); };
export function assertWindowsFileIdentity(value: WindowsFileIdentity): void {
  if (!value || !/^[0-9a-f]{16}$/.test(value.volume) || /^0+$/.test(value.volume)
      || !/^[0-9a-f]{32}$/.test(value.fileId) || /^0+$/.test(value.fileId)) deny();
}
export function encodeWindowsIdentityRoot(root: string, expected: WindowsFileIdentity): string {
  assertWindowsFileIdentity(expected);
  if (typeof root !== "string" || root.length < 3 || root.length > 32760 || !/^[A-Za-z]:\\/.test(root)
      || /[\u0000-\u001f<>"|?*/]/.test(root) || root.slice(2).includes(":")) deny();
  const parts = root.slice(3).split("\\");
  if (parts.filter(Boolean).length > 128 || parts.some((part, index) => (!part && index !== parts.length - 1) || part === "." || part === ".."
      || part.length > 255 || /[. ]$/.test(part))) deny();
  const frame = `ROOT\t${Buffer.from(root, "utf16le").toString("hex")}\t${expected.volume}\t${expected.fileId}\n`;
  if (Buffer.byteLength(frame) - 1 > WINDOWS_IDENTITY_MAX_FRAME) deny();
  return frame;
}
export function encodeWindowsIdentityChild(parent: number, name: string, kind: "D" | "F", expected: WindowsFileIdentity): string {
  assertWindowsFileIdentity(expected);
  if (!Number.isSafeInteger(parent) || parent < 0 || parent >= WINDOWS_IDENTITY_MAX_HANDLES
      || typeof name !== "string" || !/^[A-Za-z0-9._-]{1,255}$/.test(name) || name === "." || name === ".." || /[. ]$/.test(name)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name) || (kind !== "D" && kind !== "F")) deny();
  return `CHILD\t${parent}\t${name}\t${kind}\t${expected.volume}\t${expected.fileId}\n`;
}
export function parseWindowsIdentityOpen(line: string): WindowsFileIdentityFacts {
  if (typeof line !== "string" || line.length > 256) return deny();
  const p = line.split("\t");
  const integer = (value: string | undefined, maximum: number): number => {
    if (!value || !/^(?:0|[1-9][0-9]{0,9})$/.test(value)) return deny();
    const n = Number(value); if (!Number.isSafeInteger(n) || n > maximum) return deny(); return n;
  };
  if (p.length !== 10 || p[0] !== "OPEN" || (p[4] !== "D" && p[4] !== "F") || ![p[6], p[7], p[8]].every(v => v === "0" || v === "1")) return deny();
  const result: WindowsFileIdentityFacts = { index: integer(p[1], 63), volume: p[2]!, fileId: p[3]!, kind: p[4], links: integer(p[5], 0xffffffff), currentOwner: p[6] === "1", daclPresent: p[7] === "1", daclProtected: p[8] === "1", aceCount: integer(p[9], 65535) };
  assertWindowsFileIdentity(result);
  if (result.links < 1 || (result.kind === "F" && result.links !== 1) || (!result.daclPresent && result.aceCount !== 0)) return deny();
  return Object.freeze(result);
}
