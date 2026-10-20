import { TeachingOperationStoreError } from "./teaching-operations-error";

// Covers both headers and body, including injected clients that ignore abort.
// A deadline is an unknown outcome, never evidence that the provider did nothing.
export async function readGradebookProviderReceipt(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        if (!response.ok) throw new TeachingOperationStoreError(502, "Gradebook provider sync failed.");
        return await response.json();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TeachingOperationStoreError(502, "Gradebook provider outcome is unknown after timeout."));
        }, 10_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
