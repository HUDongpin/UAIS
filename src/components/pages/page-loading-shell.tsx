"use client";

type PageLoadingShellProps = {
  label: string;
};

export function PageLoadingShell({ label }: PageLoadingShellProps) {
  return (
    <main
      aria-busy="true"
      aria-label={label}
      className="min-h-[70vh] bg-[var(--background)] px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="h-10 w-52 animate-pulse rounded-lg bg-[var(--surface-soft)]" />
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="h-72 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-44 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
            <div className="h-44 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
            <div className="h-56 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)] md:col-span-2" />
          </div>
        </div>
      </div>
    </main>
  );
}
