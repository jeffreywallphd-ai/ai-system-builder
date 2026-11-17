import { readStrictPassiveRecord } from "../shared";
import { readUiControlLeaseTarget, readUiControlWindow, type UiControlLeaseTarget, type UiControlWindowTarget } from "./ui-control-authority";
import { readUiPresentationAcknowledgment, readUiPresentationPublication, readUiPresentationPull } from "./ui-control-delivery";
import { sameManagedBrowserDocument } from "./managed-browser-consent";

export const MANAGED_BROWSER_DELIVERY_PATH = "/api/headless/browser/delivery";
export const MANAGED_BROWSER_ACKNOWLEDGE_PATH = "/api/headless/browser/delivery/acknowledge";
export const MANAGED_BROWSER_CONTEXT_PATH = "/api/headless/browser/context";
export const MANAGED_BROWSER_PUBLISH_CONTEXT_PATH = "/api/headless/browser/context/publish";
export type ManagedBrowserPresentationOperation = "pull" | "acknowledge" | "challenge" | "publish";

type Delivery = NonNullable<ReturnType<typeof readUiPresentationPull>>;
type Acknowledgment = NonNullable<ReturnType<typeof readUiPresentationAcknowledgment>>;
type Publication = NonNullable<ReturnType<typeof readUiPresentationPublication>>;

type Operation = {readonly document: UiControlWindowTarget} & (
  {readonly operation: "pull"; readonly payload: Delivery} |
  {readonly operation: "acknowledge"; readonly payload: Acknowledgment} |
  {readonly operation: "challenge"; readonly payload: {readonly target: UiControlLeaseTarget}} |
  {readonly operation: "publish"; readonly payload: Publication}
);

export function parseManagedBrowserPresentation(value: unknown, expected: ManagedBrowserPresentationOperation): Operation | undefined {
  try {
    const { operation, document: rawDocument, input } = readStrictPassiveRecord(value, ["operation", "document", "input"]);
    const document = readUiControlWindow(rawDocument);
    if (!document || operation !== expected) return;
    if (operation === "pull") {
      const payload = readUiPresentationPull(input);
      if (payload && sameManagedBrowserDocument(document, payload.target)) return {operation,document,payload};
    }
    if (operation === "acknowledge") {
      const payload = readUiPresentationAcknowledgment(input);
      if (payload && sameManagedBrowserDocument(document, payload.target)) return {operation,document,payload};
    }
    if (operation === "challenge") {
      const target = readUiControlLeaseTarget(readStrictPassiveRecord(input, ["target"]).target);
      if (target && sameManagedBrowserDocument(document, target)) return {operation,document,payload:{target}};
    }
    if (operation === "publish") {
      const payload = readUiPresentationPublication(input);
      if (payload && sameManagedBrowserDocument(document, payload.target)) return {operation,document,payload};
    }
  } catch { return undefined; }
}
