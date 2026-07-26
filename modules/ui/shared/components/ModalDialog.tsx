import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

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

const modalStack: string[] = [];

function isTopmostModal(modalId: string): boolean {
  return modalStack[modalStack.length - 1] === modalId;
}

function unregisterModal(modalId: string): void {
  const index = modalStack.lastIndexOf(modalId);
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
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
}

function focusInitialElement(
  dialog: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const target =
    initialFocusRef?.current ??
    dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
    getFocusableElements(dialog)[0] ??
    dialog;
  target.focus();
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
  descriptionId,
  initialFocusRef,
  overlayClassName,
  dialogClassName,
  bodyClassName,
}: ModalDialogProps) {
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
    modalStack.push(instanceId);
    focusInitialElement(dialog, initialFocusRefValue.current);

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
      unregisterModal(instanceId);
      if (
        previouslyFocused?.isConnected &&
        typeof previouslyFocused.focus === "function"
      ) {
        previouslyFocused.focus();
      }
    };
  }, [instanceId, open]);

  if (!open) {
    return null;
  }

  const titleId = `${instanceId}-title`;
  const overlayClasses = [
    "ui-modal-overlay",
    stacked ? "ui-modal-overlay--stacked" : undefined,
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
        <div className={bodyClasses}>{children}</div>
      </section>
    </div>
  );

  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}
