import type {TestInfo} from "@playwright/test";
import type {ElectronApplication} from "playwright";
import type {CriticalAccessibilityMode} from "../technical-accessibility-observation";
import {closeImportedMainDesktop,type ImportedFileJourneyStage} from "./desktop-main-cleanup";
export type {ImportedFileJourneyStage} from "./desktop-main-cleanup";
/** File import exercises no model worker; preserve its existing main-only report. */
export function closeImportedFileDesktop(app: ElectronApplication, dataRoot: string, info: TestInfo, journeyStage: ImportedFileJourneyStage, mode: CriticalAccessibilityMode = "standard") {
  return closeImportedMainDesktop(app,dataRoot,info,journeyStage,mode);
}
