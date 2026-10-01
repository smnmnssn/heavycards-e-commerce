import { del, put } from "@vercel/blob";

import { StorageNotConfiguredError, type ObjectStorage } from "./types";

/** Uploaded objects are immutable (unique keys), so caches may keep them. */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Vercel Blob (public store). The token comes from BLOB_READ_WRITE_TOKEN,
 * which Vercel sets when a Blob store is connected to the project. It is
 * passed explicitly so behaviour never depends on ambient credentials.
 */
export function createVercelBlobStorage(token: string | null): ObjectStorage {
  const requireToken = () => {
    if (!token) {
      throw new StorageNotConfiguredError(
        "BLOB_READ_WRITE_TOKEN is not set for this environment",
      );
    }
    return token;
  };

  return {
    provider: "vercel-blob",
    async put(key, body, contentType) {
      const blob = await put(key, Buffer.from(body), {
        access: "public",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: ONE_YEAR_SECONDS,
        token: requireToken(),
      });
      return { url: blob.url };
    },
    async delete(keys) {
      if (keys.length === 0) return;
      await del([...keys], { token: requireToken() });
    },
  };
}
