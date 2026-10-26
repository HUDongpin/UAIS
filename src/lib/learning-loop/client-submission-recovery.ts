/** Browser-only recovery data. Server persistence remains authoritative. */
export type SubmissionRecoveryScope = {
  learnerAccount: string;
  courseId: string;
  classId: string;
  activityId: string;
};
export type PendingSubmissionImage = {
  scope: SubmissionRecoveryScope & { submissionVersionId: string | null };
  clientAttachmentId: string;
  blob: Blob;
  name: string;
  updatedAt: number;
  draftRevision?: number;
};
export type SubmissionSealIntent = {
  scope: SubmissionRecoveryScope;
  submissionVersionId: string;
  draftRevision: number;
  idempotencyKey: string;
  updatedAt: number;
};
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const submissionRecoveryMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
function scopeKey(scope: SubmissionRecoveryScope) {
  return [scope.learnerAccount, scope.courseId, scope.classId, scope.activityId]
    .map(encodeURIComponent)
    .join(":");
}
export function sameSubmissionRecoveryScope(
  a: Partial<SubmissionRecoveryScope> | undefined,
  b: SubmissionRecoveryScope,
) {
  return (
    a?.learnerAccount === b.learnerAccount &&
    a.courseId === b.courseId &&
    a.classId === b.classId &&
    a.activityId === b.activityId
  );
}
export function pendingImageKey(value: PendingSubmissionImage) {
  return `${scopeKey(value.scope)}:${encodeURIComponent(value.scope.submissionVersionId ?? "unbound")}:${value.clientAttachmentId}`;
}
export function selectPendingImages(
  values: unknown[],
  scope: SubmissionRecoveryScope,
  now = Date.now(),
): PendingSubmissionImage[] {
  const selected = values.filter((value): value is PendingSubmissionImage => {
    const item = value as Partial<PendingSubmissionImage> | undefined;
    return Boolean(
      item &&
      sameSubmissionRecoveryScope(item.scope, scope) &&
      typeof item.clientAttachmentId === "string" &&
      typeof item.updatedAt === "number" &&
      item.updatedAt <= now + 60_000 &&
      now - item.updatedAt <= submissionRecoveryMaxAgeMs &&
      typeof item.name === "string" &&
      item.blob instanceof Blob &&
      (item.scope?.submissionVersionId === null ||
        typeof item.scope?.submissionVersionId === "string"),
    );
  });
  // A rebind writes the new key before removing the old one. Prefer that copy
  // if the browser closed between those two transactions.
  return [
    ...new Map(
      selected
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .map((item) => [item.clientAttachmentId, item]),
    ).values(),
  ];
}
async function openImageDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    throw Error("image-recovery-unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("uais-submission-recovery-v1", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images"))
        request.result.createObjectStore("images", { keyPath: "storageKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("image-recovery-blocked"));
  });
}
async function imageTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openImageDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("images", mode);
      const request = operation(tx.objectStore("images"));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? Error("image-recovery-aborted"));
    });
  } finally {
    db.close();
  }
}
export async function savePendingImage(value: PendingSubmissionImage) {
  try {
    await imageTransaction("readwrite", (store) =>
      store.put({ ...value, storageKey: pendingImageKey(value) }),
    );
    return true;
  } catch {
    return false;
  }
}
/** Persist one acknowledged queue transition atomically, including version-key changes. */
export async function replacePendingImages(
  changes: Array<{
    previous: PendingSubmissionImage;
    next: PendingSubmissionImage;
  }>,
) {
  if (changes.length === 0) return true;
  let db: IDBDatabase | undefined;
  try {
    db = await openImageDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction("images", "readwrite");
      const store = tx.objectStore("images");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? Error("image-recovery-aborted"));
      try {
        for (const { previous, next } of changes) {
          store.put({ ...next, storageKey: pendingImageKey(next) });
          if (pendingImageKey(previous) !== pendingImageKey(next)) {
            store.delete(pendingImageKey(previous));
          }
        }
      } catch (error) {
        // Synchronous DataCloneError does not automatically abort writes that
        // were queued earlier in the transaction.
        tx.abort();
        reject(error);
      }
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
export async function removePendingImage(value: PendingSubmissionImage) {
  try {
    await imageTransaction("readwrite", (store) =>
      store.delete(pendingImageKey(value)),
    );
    return true;
  } catch {
    return false;
  }
}
export async function readPendingImages(
  scope: SubmissionRecoveryScope,
): Promise<{ available: boolean; images: PendingSubmissionImage[] }> {
  try {
    const values = await imageTransaction("readonly", (store) =>
      store.getAll(),
    );
    const now = Date.now();
    for (const value of values) {
      if (
        sameSubmissionRecoveryScope(value?.scope, scope) &&
        typeof value.updatedAt === "number" &&
        now - value.updatedAt > submissionRecoveryMaxAgeMs
      )
        await removePendingImage(value);
    }
    return { available: true, images: selectPendingImages(values, scope, now) };
  } catch {
    return { available: false, images: [] };
  }
}
export function sealIntentKey(scope: SubmissionRecoveryScope) {
  return `uais:p1:seal-intent:v1:${scopeKey(scope)}`;
}
export function readSealIntent(
  storage: BrowserStorage | undefined,
  scope: SubmissionRecoveryScope,
): SubmissionSealIntent | undefined {
  if (!storage) return;
  try {
    const serialized = storage.getItem(sealIntentKey(scope));
    if (!serialized) return;
    const item = JSON.parse(serialized) as Partial<SubmissionSealIntent>;
    if (
      !sameSubmissionRecoveryScope(item.scope, scope) ||
      typeof item.submissionVersionId !== "string" ||
      typeof item.idempotencyKey !== "string" ||
      !Number.isSafeInteger(item.draftRevision) ||
      (item.draftRevision ?? 0) < 1 ||
      typeof item.updatedAt !== "number" ||
      Date.now() - item.updatedAt > submissionRecoveryMaxAgeMs
    ) {
      storage.removeItem(sealIntentKey(scope));
      return;
    }
    return item as SubmissionSealIntent;
  } catch {
    return;
  }
}
export function writeSealIntent(
  storage: BrowserStorage | undefined,
  intent: SubmissionSealIntent,
) {
  if (!storage) return false;
  try {
    storage.setItem(sealIntentKey(intent.scope), JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}
export function removeSealIntent(
  storage: BrowserStorage | undefined,
  intent: SubmissionSealIntent,
) {
  if (!storage) return false;
  try {
    const key = sealIntentKey(intent.scope);
    const existing = readSealIntent(storage, intent.scope);
    if (existing?.idempotencyKey === intent.idempotencyKey)
      storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
export function availableLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return;
  }
}
