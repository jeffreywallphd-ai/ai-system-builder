import { startDesktopRenderer } from "./startup/desktopStartup";
import { readDesktopStartupFailure } from "../startupFailure";

void startDesktopRenderer(() => import("./main"), readDesktopStartupFailure(window.location.search));
