import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function contextDefaultPortLaunch(args = []) {
  if (!Array.isArray(args) || args.length) throw new Error("The default-port Context profile accepts no arguments.");
  return Object.freeze({
    endpointProfile: "os-selected-default",
    args: Object.freeze(["test", "--config=dev-tools/config/playwright.visual-composer.config.ts",
      "--project=packaged-desktop", "--workers=1", "--grep",
      "approves saves queries rebuilds and reveals real Context through MCP", "packaged-desktop-headless.e2e.spec.ts"]),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const launch = contextDefaultPortLaunch(process.argv.slice(2));
  process.env.VISUAL_COMPOSER_CONTEXT_ENDPOINT_PROFILE = launch.endpointProfile;
  process.argv = [process.execPath, resolve("node_modules/@playwright/test/cli.js"), ...launch.args];
  await import("../../../../node_modules/@playwright/test/cli.js");
}
