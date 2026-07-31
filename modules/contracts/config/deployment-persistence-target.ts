import {
  createPersistenceConfig,
  type PersistenceConfig,
} from "./persistence-config";

export const KNOWN_DEPLOYMENT_SHAPES = [
  "local",
  "campus-server",
  "corporate-server",
  "cloud",
] as const;

export type DeploymentShape = (typeof KNOWN_DEPLOYMENT_SHAPES)[number];

export type PersistenceAccessMode = "embedded-single-host" | "client-server";

export interface DeploymentPersistenceTarget {
  deploymentShape: DeploymentShape;
  persistence: PersistenceConfig;
  accessMode: PersistenceAccessMode;
}

const DEFAULT_PERSISTENCE_ADAPTERS = {
  local: "sqlite",
  "campus-server": "postgres",
  "corporate-server": "postgres",
  cloud: "postgres",
} as const satisfies Record<DeploymentShape, string>;

export function isDeploymentShape(value: string): value is DeploymentShape {
  return (KNOWN_DEPLOYMENT_SHAPES as readonly string[]).includes(value);
}

export function normalizeDeploymentShape(value: string): DeploymentShape {
  const normalizedValue = value.trim().toLowerCase();

  if (!isDeploymentShape(normalizedValue)) {
    throw new Error(
      `Deployment shape must be one of ${KNOWN_DEPLOYMENT_SHAPES.join(", ")}. Received "${value}".`,
    );
  }

  return normalizedValue;
}

export function createDefaultDeploymentPersistenceTarget(
  deploymentShape: string,
): DeploymentPersistenceTarget {
  const normalizedDeploymentShape = normalizeDeploymentShape(deploymentShape);
  const isLocal = normalizedDeploymentShape === "local";

  return {
    deploymentShape: normalizedDeploymentShape,
    persistence: createPersistenceConfig({
      adapter: DEFAULT_PERSISTENCE_ADAPTERS[normalizedDeploymentShape],
      namespace: "app.data",
    }),
    accessMode: isLocal ? "embedded-single-host" : "client-server",
  };
}
