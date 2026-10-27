import { startDesktopRenderer } from "./startup/desktopStartup";

void startDesktopRenderer(() => import("./main"));
