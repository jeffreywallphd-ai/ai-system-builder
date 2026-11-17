import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TaskObservationManager } from "./taskObservation";

const Context = createContext<TaskObservationManager | undefined>(undefined);

function useDisposeAfterUnmount(manager: TaskObservationManager) {
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    // StrictMode remounts effects synchronously; its next setup cancels this
    // disposal. Subscribers still detach synchronously and reject late replies.
    return () => queueMicrotask(() => { if (generation.current === current) manager.dispose(); });
  }, [manager]);
}

/** Remount with the authenticated shell/session; never share across transports. */
export function TaskObservationProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => {
    const value = new TaskObservationManager();
    if (typeof document !== "undefined") value.setVisible(document.visibilityState !== "hidden");
    return value;
  });
  useDisposeAfterUnmount(manager);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const changed = () => manager.setVisible(document.visibilityState !== "hidden");
    changed(); document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, [manager]);
  return <Context.Provider value={manager}>{children}</Context.Provider>;
}

export function useTaskObservationManager(): TaskObservationManager {
  const shared = useContext(Context);
  const [fallback] = useState(() => new TaskObservationManager());
  useDisposeAfterUnmount(fallback);
  return shared ?? fallback;
}
