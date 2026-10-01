/**
 * Minimal object-storage contract for product images. Catalog code depends
 * only on this interface, never on a provider SDK, so the provider can be
 * replaced (e.g. S3 or R2) by adding one implementation.
 */
export interface ObjectStorage {
  readonly provider: "vercel-blob" | "local" | "memory";
  /**
   * Stores a new public object under `key` (never overwrites) and returns the
   * URL browsers load it from.
   */
  put(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ url: string }>;
  /** Deletes objects; keys that no longer exist are ignored. */
  delete(keys: readonly string[]): Promise<void>;
}

/** Storage is selected but not usable (e.g. a missing token on a preview). */
export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}
