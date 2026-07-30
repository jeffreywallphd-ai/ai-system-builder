import type {
  SystemRuntimeDataBindingId,
  SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";

export interface SystemRuntimePostgresCredential {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly dataBindingId: SystemRuntimeDataBindingId;
  readonly connectionString: string;
  readonly updatedAt: string;
}

export interface SystemRuntimePostgresCredentialStore {
  read(
    runtimeInstanceId: SystemRuntimeInstanceId,
  ): Promise<SystemRuntimePostgresCredential | undefined>;
  write(credential: SystemRuntimePostgresCredential): Promise<void>;
  delete(runtimeInstanceId: SystemRuntimeInstanceId): Promise<void>;
}

