import { Pool, type PoolClient, type PoolConfig, type QueryResult } from "pg";

export type PostgresSslMode = "disable" | "require" | "verify-full";

export interface ResolvedPostgresPoolConfig {
  readonly connectionString: string;
  readonly sslMode: PostgresSslMode;
  readonly sslCaPem?: string;
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly applicationName: string;
}

export interface PostgresQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface PostgresPoolLike extends PostgresQueryable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on?(event: "error", listener: (error: Error) => void): unknown;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export function resolvePostgresPoolConfig(env: NodeJS.ProcessEnv): ResolvedPostgresPoolConfig {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for PostgreSQL deployment shapes.");
  }
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }

  const sslMode = normalizeSslMode(env.POSTGRES_SSL_MODE);
  return {
    connectionString,
    sslMode,
    sslCaPem: trimmed(env.POSTGRES_SSL_CA_PEM),
    maxConnections: integerEnv(env.POSTGRES_POOL_MAX, "POSTGRES_POOL_MAX", 10, 1, 100),
    connectionTimeoutMs: integerEnv(env.POSTGRES_CONNECTION_TIMEOUT_MS, "POSTGRES_CONNECTION_TIMEOUT_MS", 5_000, 100, 120_000),
    idleTimeoutMs: integerEnv(env.POSTGRES_IDLE_TIMEOUT_MS, "POSTGRES_IDLE_TIMEOUT_MS", 30_000, 1_000, 600_000),
    statementTimeoutMs: integerEnv(env.POSTGRES_STATEMENT_TIMEOUT_MS, "POSTGRES_STATEMENT_TIMEOUT_MS", 30_000, 100, 600_000),
    applicationName: trimmed(env.POSTGRES_APPLICATION_NAME) ?? "ai-system-builder-server",
  };
}

export function createPostgresPool(config: ResolvedPostgresPoolConfig): PostgresPoolLike {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs,
    application_name: config.applicationName,
    ssl: config.sslMode === "disable"
      ? false
      : {
        rejectUnauthorized: config.sslMode === "verify-full",
        ...(config.sslCaPem ? { ca: config.sslCaPem } : {}),
      },
  };
  return new Pool(poolConfig) as PostgresPoolLike;
}

function normalizeSslMode(value: string | undefined): PostgresSslMode {
  const normalized = value?.trim().toLowerCase() || "verify-full";
  if (normalized === "disable" || normalized === "require" || normalized === "verify-full") return normalized;
  throw new Error("POSTGRES_SSL_MODE must be disable, require, or verify-full.");
}

function integerEnv(value: string | undefined, name: string, fallback: number, minimum: number, maximum: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
