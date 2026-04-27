import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface HuggingFaceTokenStatus {
  configured: boolean;
  maskedToken?: string;
}

export interface HuggingFaceTokenConfigStore {
  getToken: () => string | undefined;
  getStatus: () => HuggingFaceTokenStatus;
  setToken: (token: string) => HuggingFaceTokenStatus;
  clearToken: () => HuggingFaceTokenStatus;
}

interface HuggingFaceTokenConfigFile {
  token: string;
}

function toMaskedToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 4) {
    return "••••";
  }

  return `••••${trimmed.slice(-4)}`;
}

function normalizeToken(value: string): string {
  const token = value.trim();
  if (!token) {
    throw new Error("Hugging Face token must be a non-empty string.");
  }

  return token;
}

function readConfiguredToken(filePath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<HuggingFaceTokenConfigFile>;
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export interface CreateHuggingFaceTokenConfigStoreOptions {
  filePath: string;
  fallbackToken?: string;
}

export function createHuggingFaceTokenConfigStore(
  options: CreateHuggingFaceTokenConfigStoreOptions,
): HuggingFaceTokenConfigStore {
  const configuredToken = readConfiguredToken(options.filePath);
  let token = configuredToken ?? options.fallbackToken?.trim();

  return {
    getToken() {
      return token?.trim() ? token : undefined;
    },

    getStatus() {
      if (!token?.trim()) {
        return { configured: false };
      }

      return {
        configured: true,
        maskedToken: toMaskedToken(token),
      };
    },

    setToken(nextToken: string) {
      const normalized = normalizeToken(nextToken);
      mkdirSync(path.dirname(options.filePath), { recursive: true });
      writeFileSync(options.filePath, JSON.stringify({ token: normalized }), "utf8");
      token = normalized;
      return {
        configured: true,
        maskedToken: toMaskedToken(normalized),
      };
    },

    clearToken() {
      rmSync(options.filePath, { force: true });
      token = undefined;
      return { configured: false };
    },
  };
}
