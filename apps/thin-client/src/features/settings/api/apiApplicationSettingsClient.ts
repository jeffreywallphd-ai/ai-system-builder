import type {
  ApplicationSettingDefinition,
  ApplicationSettingKey,
  ApplicationSettingPrimitiveValue,
  ApplicationSettingValue,
} from "../../../../../../modules/contracts/settings";
import {APPLICATION_SETTING_VALUE_KINDS,isApplicationSettingCategory} from "../../../../../../modules/contracts/settings";
import {SECURITY_ERROR_CODES} from "../../../../../../modules/contracts/security";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

interface ApiResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
}

export interface ApplicationSettingsApiClient {
  listDefinitions: (input?: { category?: string; keys?: ApplicationSettingKey[] }) => Promise<{ definitions: ApplicationSettingDefinition[] }>;
  readSettings: (input?: { category?: string; keys?: ApplicationSettingKey[] }) => Promise<{ values: ApplicationSettingValue[] }>;
  updateSetting: (input: { key: ApplicationSettingKey; value: ApplicationSettingPrimitiveValue }) => Promise<{ value: ApplicationSettingValue }>;
  clearSetting: (input: { key: ApplicationSettingKey }) => Promise<{ value: ApplicationSettingValue }>;
  restartServer: () => Promise<{ restartRequested: boolean }>;
}

const createApiUrl = (baseUrl: string, suffix: string): string => `${baseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const validText = (value: unknown, maximum=4096): value is string => typeof value === "string" && value.length <= maximum;

function createApiError(response: ApiResponseEnvelope | undefined, status: number | undefined, endpoint: string): Error {
  const error = new Error("Application settings request failed.") as Error & { code?: string; status?: number; endpoint?: string };
  const code=response?.error?.code;
  error.code = typeof code === "string" && SECURITY_ERROR_CODES.includes(code as typeof SECURITY_ERROR_CODES[number]) ? code : undefined;
  error.status = status;
  error.endpoint = endpoint;
  return error;
}

function ensureSuccess<T>(response: ApiResponseEnvelope, status: number, endpoint: string, pick: (value: unknown) => T): T {
  if (!(status >= 200 && status < 300) || !response.ok) throw createApiError(response, status, endpoint);
  try {return pick(response.value);} catch {throw createApiError(undefined,status,endpoint);}
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<{ envelope: ApiResponseEnvelope; status: number; endpoint: string }> {
  const endpoint = createApiUrl(baseUrl, path);
  let status: number | undefined;
  try {
    const response = await secureFetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    status=response.status;
    const parsed = await response.json();
    return { envelope: parseApiEnvelope(parsed) as ApiResponseEnvelope, status, endpoint: path };
  } catch {throw createApiError(undefined,status,path);}
}

function expectDefinitions(value: unknown): { definitions: ApplicationSettingDefinition[] } {
  if (!isRecord(value) || !Array.isArray(value.definitions) || value.definitions.length > 200) throw new Error("invalid response");
  const seen=new Set<string>();
  const definitions=value.definitions.map(row=>{
    if (!isRecord(row) || !validText(row.key,200) || !row.key.trim() || seen.has(row.key) || !validText(row.label) || !row.label.trim()
        || typeof row.category!=="string" || !isApplicationSettingCategory(row.category)
        || !APPLICATION_SETTING_VALUE_KINDS.includes(row.valueKind as ApplicationSettingDefinition["valueKind"])
        || [row.description,row.placeholder,row.instructions].some(v=>v!==undefined&&!validText(v))
        || row.sensitive!==undefined&&typeof row.sensitive!=="boolean"
        || row.options!==undefined&&(!Array.isArray(row.options)||row.options.length>200||row.options.some(option=>!isRecord(option)||!validText(option.value)||option.label!==undefined&&!validText(option.label)))) throw new Error("invalid response");
    seen.add(row.key);return {...row,...(row.options===undefined?{}:{options:row.options.map(option=>({...option}))})} as unknown as ApplicationSettingDefinition;
  });
  return {definitions};
}

function expectSettingValue(row: unknown): ApplicationSettingValue {
  if (!isRecord(row) || !validText(row.key,200) || !row.key.trim() || typeof row.configured!=="boolean"
      || row.masked!==undefined&&typeof row.masked!=="boolean"
      || row.maskedValue!==undefined&&(!validText(row.maskedValue,32)||!/^\*{4,32}$/.test(row.maskedValue)||row.masked!==true)
      || row.masked===true&&row.value!==undefined
      || row.updatedAt!==undefined&&!validText(row.updatedAt,100)
      || row.value!==undefined&&typeof row.value!=="string"&&typeof row.value!=="boolean"&&!(typeof row.value==="number"&&Number.isFinite(row.value))&&!isRecord(row.value)) throw new Error("invalid response");
  return {...row} as unknown as ApplicationSettingValue;
}

function expectValues(value: unknown): { values: ApplicationSettingValue[] } {
  if (!isRecord(value) || !Array.isArray(value.values) || value.values.length>200) throw new Error("invalid response");
  const values=value.values.map(expectSettingValue),seen=new Set<string>();
  for(const row of values){if(seen.has(row.key))throw new Error("invalid response");seen.add(row.key);}
  return {values};
}

function expectValue(value: unknown): { value: ApplicationSettingValue } {
  if (!isRecord(value)) throw new Error("invalid response");
  return {value:expectSettingValue(value.value)};
}

function expectRestart(value: unknown): { restartRequested: boolean } {
  if (!isRecord(value) || value.restartRequested !== true) throw new Error("Server restart response is malformed.");
  return value as { restartRequested: boolean };
}

/** Reuse the same consumed-data admission before a renderer commits both reads. */
export function captureSettingsRead(definitionResult: unknown, valueResult: unknown): {definitions: ApplicationSettingDefinition[]; values: ApplicationSettingValue[]} {
  try {
    const {definitions}=expectDefinitions(definitionResult), {values}=expectValues(valueResult);
    const byKey=new Map(definitions.map(row=>[row.key,row]));
    const captured=values.map(row=>{
      const definition=byKey.get(row.key);if(!definition)throw new Error("invalid response");
      if(definition.valueKind==="secret"){
        if(row.value!==undefined)throw new Error("invalid response");return {...row};
      }
      if(row.masked===true)throw new Error("invalid response");
      if(row.value===undefined){if(row.configured)throw new Error("invalid response");return {...row};}
      let value=row.value;
      switch(definition.valueKind){
        case "string":case "folder":case "select":if(!validText(value))throw new Error("invalid response");break;
        case "number":if(typeof value!=="number"||!Number.isFinite(value))throw new Error("invalid response");break;
        case "boolean":if(typeof value!=="boolean")throw new Error("invalid response");break;
        case "object":
          if(!isRecord(value))throw new Error("invalid response");
          if(definition.key.includes("default")&&definition.key.includes("model"))value=captureModelFields(value);
          break;
      }
      return {...row,value};
    });
    return {definitions,values:captured};
  } catch {throw createApiError(undefined,undefined,"/application-settings/read");}
}

function captureModelFields(source: Record<string,unknown>): Record<string,string> {
  const fields:readonly [string,readonly string[]|undefined][]=[
    ["provider",["transformers"]],["modelId",undefined],["inferenceMode",["auto","text2text","causal","chat"]],
    ["device",["auto","cpu","cuda"]],["torchDtype",["auto","float16","bfloat16","float32"]],
  ];
  const result:Record<string,string>={};
  for(const [name,allowed] of fields){
    const descriptor=Object.getOwnPropertyDescriptor(source,name);
    if(!descriptor)continue;if(!("value" in descriptor))throw new Error("invalid response");
    const value=descriptor.value;if(value===undefined)continue;
    if(!validText(value)||allowed&&!allowed.includes(value))throw new Error("invalid response");result[name]=value;
  }
  return Object.freeze(result);
}

export function createApiApplicationSettingsClient(options: { apiBaseUrl?: string } = {}): ApplicationSettingsApiClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  return {
    async listDefinitions(input = {}) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/list-definitions", input);
      return ensureSuccess(envelope, status, endpoint, expectDefinitions);
    },
    async readSettings(input = {}) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/read", input);
      return ensureSuccess(envelope, status, endpoint, expectValues);
    },
    async updateSetting(input) {
      const request={key:input.key,value:input.value}, expectedKey=request.key.trim();
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/update", request);
      const result=ensureSuccess(envelope, status, endpoint, expectValue);
      if(result.value.key!==expectedKey||result.value.configured!==true)throw createApiError(undefined,status,endpoint);
      return result;
    },
    async clearSetting(input) {
      const request={key:input.key}, expectedKey=request.key.trim();
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/clear", request);
      const result=ensureSuccess(envelope, status, endpoint, expectValue);
      if(result.value.key!==expectedKey||result.value.configured!==false)throw createApiError(undefined,status,endpoint);
      return result;
    },
    async restartServer() {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/server/restart", {});
      return ensureSuccess(envelope, status, endpoint, expectRestart);
    },
  };
}
