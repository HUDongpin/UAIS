"use client";

// The one interactive element on the print view. It exists as its own client
// island so the export page itself stays a server component: the page reads a
// session cookie and a transcript, and none of that should ship to the browser.
export function ChatroomPrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
    >
      {label}
    </button>
  );
}
