import type { PlaywrightChromiumLike } from "./playwrightChromiumTypes";

interface PlaywrightModuleLike {
  chromium?: PlaywrightChromiumLike;
}

type RequireLike = (specifier: string) => unknown;

function isModuleNotFoundError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: string }).code === "MODULE_NOT_FOUND",
  );
}

export function loadPlaywrightChromiumLauncher(
  loadModule: RequireLike = require as RequireLike,
): PlaywrightChromiumLike["launch"] {
  let loadedModule: unknown;

  try {
    loadedModule = loadModule("playwright");
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      throw new Error(
        "PlaywrightWebsiteHtmlAcquisitionAdapter requires the optional 'playwright' dependency. Install it with 'npm install -D playwright'.",
      );
    }

    throw error;
  }

  const playwrightModule = loadedModule as PlaywrightModuleLike;

  if (!playwrightModule.chromium || typeof playwrightModule.chromium.launch !== "function") {
    throw new Error(
      "The loaded 'playwright' module is missing 'chromium.launch'. Ensure a compatible Playwright package is installed.",
    );
  }

  return playwrightModule.chromium.launch.bind(playwrightModule.chromium);
}
