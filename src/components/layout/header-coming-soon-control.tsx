"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function HeaderComingSoonControl({
  label,
  title,
  body,
  icon,
  showLabel = false,
  buttonClassName,
  open,
  onOpenChange,
}: {
  label: string;
  title: string;
  body: string;
  icon: ReactNode;
  showLabel?: boolean;
  buttonClassName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleDocumentPointerDown(event: MouseEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        onOpenChange(false);
      }
    }

    function handleDocumentFocusIn(event: FocusEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        onOpenChange(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("focusin", handleDocumentFocusIn);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("focusin", handleDocumentFocusIn);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        {icon}
        {showLabel ? <span className="hidden 2xl:inline">{label}</span> : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={title}
          className="absolute right-0 top-full z-50 mt-3 w-[320px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)] shadow-[0_22px_60px_var(--shadow-strong)]"
        >
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
        </div>
      ) : null}
    </div>
  );
}
