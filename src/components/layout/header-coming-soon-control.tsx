"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function HeaderComingSoonControl({
  label,
  title,
  body,
  icon,
  showLabel = false,
  buttonClassName,
}: {
  label: string;
  title: string;
  body: string;
  icon: ReactNode;
  showLabel?: boolean;
  buttonClassName: string;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

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
        setOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
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
