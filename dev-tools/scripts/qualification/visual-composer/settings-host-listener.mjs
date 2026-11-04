/** The dedicated Settings qualifier never opens a non-loopback listener. */
export function listenSettingsHostOnLoopback(listener, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      listener.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      listener.off("error", onError);
      resolve();
    };
    listener.once("error", onError);
    listener.once("listening", onListening);
    try {
      listener.listen(port, "127.0.0.1");
    } catch (error) {
      listener.off("error", onError);
      listener.off("listening", onListening);
      reject(error);
    }
  });
}
