import type { SystemBuilderResult } from "../../../../../../../modules/contracts/system-builder";
import type { SystemPublishedFormClient } from "../../../../../../../modules/ui/shared/system-builder";
import { getDesktopApi } from "../../../lib/desktopApi";

async function request<T>(invoke: () => Promise<unknown> | undefined): Promise<SystemBuilderResult<T>> {
  try {
    const response = await invoke();
    if (response && typeof response === "object" && "ok" in response &&
        response.ok === true && "value" in response && response.value !== undefined) {
      return { ok: true, value: response.value as T };
    }
  } catch {
    // Keep transport details in the owning host.
  }
  return { ok: false, error: { code: "system-form.unavailable", message: "Published forms are unavailable." } };
}

export function createDesktopSystemPublishedFormClient(): SystemPublishedFormClient {
  return {
    list: (input) => request(() => getDesktopApi().listPublishedSystemForms?.(input)),
    submit: (input) => request(() => getDesktopApi().submitPublishedSystemForm?.(input)),
  };
}
