import { createServer } from "./createServer";

const { app, config } = createServer();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[server] listening on port ${config.port} (storage root: ${config.storageRootDirectory})`,
  );
});
