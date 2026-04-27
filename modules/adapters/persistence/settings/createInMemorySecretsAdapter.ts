import type { ApplicationSettingKey } from "../../../contracts/settings";
import type { ApplicationSecretsPort } from "../../../application/ports/settings";

export function createInMemorySecretsAdapter(): ApplicationSecretsPort {
  // TODO: Replace with OS secure storage adapter.
  const secretMap = new Map<ApplicationSettingKey, string>();

  return {
    async setSecret(key, value): Promise<void> {
      secretMap.set(key, value);
    },
    async getSecret(key): Promise<string | undefined> {
      return secretMap.get(key);
    },
    async clearSecret(key): Promise<void> {
      secretMap.delete(key);
    },
    async hasSecret(key): Promise<boolean> {
      return secretMap.has(key);
    },
  };
}
