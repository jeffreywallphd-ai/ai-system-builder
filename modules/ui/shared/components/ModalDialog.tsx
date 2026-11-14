import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { RevokeWindowTakeoverButton, useWindowTakeover } from "../takeover/WindowTakeoverContext";

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ModalLayer = "default" | "stacked" | "window-consent";
const modalLayerOrder = { default: 0, stacked: 1, "window-consent": 2 } as const;
const modalStack: Array<{ id: string; layer: ModalLayer; element: HTMLElement; focus: () => void }> = [];

interface ModalScrollLockState {
  count: number;
  readonly documentElementOverflow: string;
  readonly documentElementScrollbarGutter: string;
  readonly bodyOverflow: string;
}

const modalScrollLocks = new WeakMap<Document, ModalScrollLockState>();

function lockModalScroll(ownerDocument: Document): void {
  const current = modalScrollLocks.get(ownerDocument);
  if (current) {
    current.count += 1;
    return;
  }

  modalScrollLocks.set(ownerDocument, {
    count: 1,
    documentElementOverflow: ownerDocument.documentElement.style.overflow,
    documentElementScrollbarGutter: ownerDocument.documentElement.style.scrollbarGutter,
    bodyOverflow: ownerDocument.body.style.overflow,
  });
  // Keep the viewport width when hiding a classic scrollbar. Nested dialogs
  // share this scroll lock and restore its original styles on final close.
  const viewport = ownerDocument.defaultView;
  const root = ownerDocument.documentElement;
  if (viewport && root.clientWidth > 0 && viewport.innerWidth > root.clientWidth &&
      !viewport.getComputedStyle(root).scrollbarGutter.includes("stable")) {
    root.style.scrollbarGutter = "stable";
  }
  ownerDocument.documentElement.style.overflow = "hidden";
  ownerDocument.body.style.overflow = "hidden";
}

function unlockModalScroll(ownerDocument: Document): void {
  const current = modalScrollLocks.get(ownerDocument);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;

  ownerDocument.documentElement.style.overflow =
    current.documentElementOverflow;
  ownerDocument.documentElement.style.scrollbarGutter =
    current.documentElementScrollbarGutter;
  ownerDocument.body.style.overflow = current.bodyOverflow;
  modalScrollLocks.delete(ownerDocument);
}

function isTopmostModal(modalId: string): boolean {
  return modalStack[modalStack.length - 1]?.id === modalId;
}

function unregisterModal(modalId: string): void {
  const index = modalStack.findIndex(modal => modal.id === modalId);
  if (index >= 0) {
    modalStack.splice(index, 1);
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hidden &&
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
}

function isFocusableElement(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element &&
      element.matches(focusableSelector) &&
      !element.hidden &&
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
}

function focusInitialElement(
  dialog: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null>,
): HTMLElement {
  const referencedTarget = initialFocusRef?.current ?? null;
  const markedTarget = dialog.querySelector<HTMLElement>(
    "[data-modal-initial-focus]",
  );
  const target = isFocusableElement(referencedTarget)
    ? referencedTarget
    : isFocusableElement(markedTarget)
      ? markedTarget
      : (getFocusableElements(dialog)[0] ?? dialog);
  target.focus();
  return target;
}

export interface ModalDialogProps {
  readonly open: boolean;
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly closeLabel?: string;
  readonly closeDisabled?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly stacked?: boolean;
  readonly windowConsent?: boolean;
  readonly descriptionId?: string;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly overlayClassName?: string;
  readonly dialogClassName?: string;
  readonly bodyClassName?: string;
}

export function ModalDialog({
  open,
  title,
  children,
  onClose,
  closeLabel = "Close dialog",
  closeDisabled = false,
  closeOnBackdrop = false,
  stacked = false,
  windowConsent = false,
  descriptionId,
  initialFocusRef,
  overlayClassName,
  dialogClassName,
  bodyClassName,
}: ModalDialogProps) {
  const { presentationAttached } = useWindowTakeover();
  const layer: ModalLayer = windowConsent ? "window-consent" : stacked ? "stacked" : "default";
  const instanceId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const initialFocusRefValue = useRef(initialFocusRef);

  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;
  initialFocusRefValue.current = initialFocusRef;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    unregisterModal(instanceId);
    const nextLayer = modalStack.findIndex(modal => modalLayerOrder[modal.layer] > modalLayerOrder[layer]);
    modalStack.splice(nextLayer < 0 ? modalStack.length : nextLayer, 0, {
      id: instanceId, layer, element: dialog,
      focus: () => { focusInitialElement(dialog, initialFocusRefValue.current); },
    });
    lockModalScroll(dialog.ownerDocument);
    const initialTarget = isTopmostModal(instanceId)
      ? focusInitialElement(dialog, initialFocusRefValue.current)
      : dialog;
    const MutationObserverConstructor =
      dialog.ownerDocument.defaultView?.MutationObserver;
    const preferredFocusObserver = MutationObserverConstructor
      ? new MutationObserverConstructor(() => {
          const referencedTarget = initialFocusRefValue.current?.current ?? null;
          const markedTarget = dialog.querySelector<HTMLElement>(
            "[data-modal-initial-focus]",
          );
          const preferredTarget = isFocusableElement(referencedTarget)
            ? referencedTarget
            : isFocusableElement(markedTarget)
              ? markedTarget
              : null;
          const activeElement = dialog.ownerDocument.activeElement;
          if (
            isTopmostModal(instanceId) &&
            preferredTarget &&
            preferredTarget !== activeElement &&
            (activeElement === initialTarget ||
              activeElement === dialog ||
              !dialog.contains(activeElement))
          ) {
            preferredTarget.focus();
          }
        })
      : undefined;
    preferredFocusObserver?.observe(dialog, {
      attributes: true,
      attributeFilter: ["disabled", "hidden", "aria-hidden", "tabindex"],
      childList: true,
      subtree: true,
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostModal(instanceId)) {
        return;
      }

      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (
        event.shiftKey &&
        (activeElement === firstElement || !dialog.contains(activeElement))
      ) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === lastElement || !dialog.contains(activeElement))
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (
        isTopmostModal(instanceId) &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      ) {
        focusInitialElement(dialog, initialFocusRefValue.current);
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      preferredFocusObserver?.disconnect();
      const wasTopmost = isTopmostModal(instanceId);
      unregisterModal(instanceId);
      unlockModalScroll(dialog.ownerDocument);
      if (
        wasTopmost && previouslyFocused?.isConnected &&
        typeof previouslyFocused.focus === "function"
      ) {
        previouslyFocused.focus();
      }
      const exposed = modalStack[modalStack.length - 1];
      if (wasTopmost && exposed?.element.isConnected &&
          !exposed.element.contains(dialog.ownerDocument.activeElement)) exposed.focus();
    };
  }, [instanceId, layer, open]);

  if (!open) {
    return null;
  }

  const titleId = `${instanceId}-title`;
  const overlayClasses = [
    "ui-modal-overlay",
    layer === "stacked" ? "ui-modal-overlay--stacked" : undefined,
    layer === "window-consent" ? "ui-window-takeover-consent-overlay" : undefined,
    overlayClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const dialogClasses = [
    "ui-panel",
    "ui-modal-dialog",
    "ui-stack",
    "ui-stack--sm",
    dialogClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const bodyClasses = [
    "ui-modal-body",
    "ui-stack",
    "ui-stack--sm",
    bodyClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (
      closeOnBackdrop &&
      !closeDisabled &&
      isTopmostModal(instanceId) &&
      event.target === event.currentTarget
    ) {
      onClose();
    }
  };

  const dialog = (
    <div
      className={overlayClasses}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        ref={dialogRef}
        className={dialogClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="ui-modal-header">
          <h2 id={titleId}>{title}</h2>
          <RevokeWindowTakeoverButton />
          <button
            className="ui-modal-close"
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={closeDisabled}
          >
            Close
          </button>
        </header>
        <div className={bodyClasses} inert={presentationAttached || undefined}
          onClickCapture={event => {
            if (presentationAttached) { event.preventDefault(); event.stopPropagation(); }
          }}
        >
          {children}
        </div>
      </section>
    </div>
  );

  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}
