import type {
  SystemRuntimeDatabaseHealth,
  SystemRuntimeInstance,
  SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";
import type { StructuredDocumentStore } from "../shared";

export interface SystemRuntimeStructuredDataSession {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly documents: StructuredDocumentStore;
  readonly health: SystemRuntimeDatabaseHealth;
}

export interface SystemRuntimeStructuredDataSessionProvider {
  acquire(
    instance: SystemRuntimeInstance,
  ): Promise<SystemRuntimeStructuredDataSession>;
  release(runtimeInstanceId: SystemRuntimeInstanceId): Promise<void>;
}

