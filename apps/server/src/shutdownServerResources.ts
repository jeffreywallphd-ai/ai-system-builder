export async function shutdownServerResources(options: {
  listener?: { close(callback: (error?: Error) => void): unknown };
  shutdownBackgroundTasks?: () => Promise<void>;
  closePersistence?: () => Promise<void>;
}): Promise<void> {
  // Begin the host fence before waiting for requests that may own active work.
  const drain = options.shutdownBackgroundTasks?.();
  const listener = options.listener;
  const closed = listener ? new Promise<void>((resolve, reject) => {
    listener.close((error) => error ? reject(error) : resolve());
  }) : Promise.resolve();
  const results = await Promise.allSettled([drain, closed]);
  if (results.some((result) => result.status === "rejected")) throw new Error("Server shutdown remains pending.");
  await options.closePersistence?.();
}
