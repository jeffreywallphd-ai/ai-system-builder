import { isIP } from "node:net";
import { types } from "node:util";

export const WEBSITE_HOST_TIMEOUT_MS = 180_000;
export const WEBSITE_PHASE_TIMEOUT_MS = 30_000;
export interface WebsiteHostFixture {
  readonly schemaVersion: "authorized-website-host-fixture-v1";
  readonly pageUrl: string;
  readonly expectedText: string;
  readonly authorizationRef: string;
}
const invalid = () => new Error("The authorized public website test fixture is unavailable or invalid.");
function denseStrings(input: unknown, maximum: number): string[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) throw invalid();
  const values: string[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.length > 640) throw invalid();
    values.push(descriptor.value);
  }
  return values;
}

/** A declaration is not authority. The operator must first authorize this exact synthetic page. */
export function readWebsiteHostFixture(input: unknown): Readonly<WebsiteHostFixture> | undefined {
  if (input === undefined || input === "") return undefined;
  if (typeof input !== "string" || Buffer.byteLength(input) > 2048) throw invalid();
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const keys = ["schemaVersion", "pageUrl", "expectedText", "authorizationRef"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw invalid();
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== "authorized-website-host-fixture-v1" || typeof v.pageUrl !== "string" || v.pageUrl.length > 512 ||
      typeof v.expectedText !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .,!?()'-]{7,127}$/.test(v.expectedText) ||
      typeof v.authorizationRef !== "string" || !/^[a-z][a-z0-9-]{7,79}$/.test(v.authorizationRef)) throw invalid();
  let url: URL;
  try { url = new URL(v.pageUrl); } catch { throw invalid(); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      url.href !== v.pageUrl || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname) || isIP(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(hostname) ||
      /^\d+(?:\.\d+)*$/.test(hostname) || /%(?:00|0a|0d|5c)/i.test(url.pathname)) throw invalid();
  // DNS, redirect, robots and content checks remain in the production capture adapter.
  return Object.freeze({ schemaVersion: "authorized-website-host-fixture-v1", pageUrl: url.href,
    expectedText: v.expectedText, authorizationRef: v.authorizationRef });
}

export function websiteWorkspace(input: unknown): string {
  if (typeof input !== "string" || !/^workspace\.[A-Za-z0-9._-]{1,128}$/.test(input)) throw invalid();
  return input;
}
export function websiteArtifactPair(workspace: unknown, input: unknown) {
  workspace = websiteWorkspace(workspace);
  const values = denseStrings(input, 2);
  if (values.length !== 2) throw invalid();
  const prefix = `workspaces/${workspace}/artifacts/files/website/`;
  const parse = (key: string) => {
    if (!key.startsWith(prefix)) throw invalid();
    const result = /^(source\.[A-Za-z0-9._-]{1,192})\/(snapshot\.[A-Za-z0-9._-]{1,192})\.(html|txt)$/.exec(key.slice(prefix.length));
    if (!result) throw invalid();
    return { key, source: result[1]!, snapshot: result[2]!, kind: result[3]! };
  };
  const records = values.map(parse), raw = records.find(record => record.kind === "html"), text = records.find(record => record.kind === "txt");
  if (!raw || !text || raw.source !== text.source || raw.snapshot !== text.snapshot) throw invalid();
  return Object.freeze({ rawKey: raw.key, textKey: text.key });
}

export const WEBSITE_HOST_PHASES = Object.freeze([
  "workspace-owned", "single-page-submitted", "task-completed", "raw-and-readable-reopened",
  "renderer-reload-preserved-identities", "other-workspace-empty", "original-workspace-restored",
] as const);
export function websiteHostReport(phases: readonly string[], failed: boolean) {
  const captured = denseStrings(phases, WEBSITE_HOST_PHASES.length);
  if (typeof failed !== "boolean" || captured.some((phase, i) => phase !== WEBSITE_HOST_PHASES[i])) throw invalid();
  return { schemaVersion: "website-host-ui-outcome-v1", host: "thin-chrome", status: !failed && captured.length === WEBSITE_HOST_PHASES.length ? "passed" : "failed",
    phases: captured, nextPhase: WEBSITE_HOST_PHASES[captured.length] ?? "complete", parentQualificationGranted: false,
    scope: "Actual app controls and persisted raw/readable identities. No Refresh UI, full-suite, native crash or parent qualification." };
}
