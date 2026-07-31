import { pairedDeviceTokenStore } from "./pairedDeviceTokenStore";

export async function secureFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("x-client-source")) {
    headers.set("x-client-source", "thin-client");
  }
  const token = pairedDeviceTokenStore.getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
