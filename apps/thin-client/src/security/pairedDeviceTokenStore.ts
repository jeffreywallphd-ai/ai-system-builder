const KEY = "ai-system-builder.paired-device-token";
const readSnapshot = (): { readable: boolean; token: string | null } => {
  try {
    if (typeof localStorage === "undefined") return { readable: false, token: null };
    const token = localStorage.getItem(KEY);
    return token === null || typeof token === "string" ? { readable: true, token } : { readable: false, token: null };
  } catch { return { readable: false, token: null }; }
};
export const pairedDeviceTokenStore = {
  getToken: () => readSnapshot().token,
  setToken: (token: string) => {
    if (typeof localStorage === "undefined" || !readSnapshot().readable) throw new Error("Pairing storage is unavailable.");
    localStorage.setItem(KEY, token);
    const observed = readSnapshot();
    if (!observed.readable || observed.token !== token) throw new Error("Pairing storage could not confirm the write.");
  },
  clearToken: () => {
    if (typeof localStorage === "undefined") throw new Error("Pairing storage is unavailable.");
    localStorage.removeItem(KEY);
    const observed = readSnapshot();
    if (!observed.readable || observed.token !== null) throw new Error("Pairing storage could not confirm removal.");
  },
  hasToken: () => !!readSnapshot().token,
  captureToken: () => {
    const captured = readSnapshot();
    const isCurrent = () => {
      const current = readSnapshot();
      return captured.readable && current.readable && current.token === captured.token;
    };
    return {
      readable: captured.readable,
      hasToken: captured.readable && !!captured.token,
      isCurrent,
      clearIfCurrent: () => {
        if (!captured.token || !isCurrent()) return false;
        pairedDeviceTokenStore.clearToken();
        return true;
      },
    };
  },
};
