const KEY = "ai-system-builder.paired-device-token";
export const pairedDeviceTokenStore = {
  getToken: () =>
    typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
  setToken: (token: string) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, token);
  },
  clearToken: () => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  },
  hasToken: () =>
    typeof localStorage !== "undefined" && !!localStorage.getItem(KEY),
};
