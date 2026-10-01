import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { isManagedImageKey } from "./keys";
import type { ObjectStorage } from "./types";

/** Route that serves locally stored objects (src/app/api/media). */
export const LOCAL_MEDIA_ROUTE = "/api/media";

/**
 * Stores objects as files in a local directory (default `.storage/`, git
 * ignored). For development and E2E only: the environment validation refuses
 * it on Vercel, whose filesystem is not persistent.
 *
 * Only keys produced by productImageKey are accepted, so a key can never
 * address a path outside the storage directory.
 */
export function createLocalStorage(directory: string) {
  const root = resolve(directory);
  const pathFor = (key: string) => {
    if (!isManagedImageKey(key)) throw new Error("invalid storage key");
    return join(root, ...key.split("/"));
  };

  const storage: ObjectStorage & {
    read(key: string): Promise<Uint8Array | null>;
  } = {
    provider: "local",
    async put(key, body) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body, { flag: "wx" });
      return { url: `${LOCAL_MEDIA_ROUTE}/${key}` };
    },
    async delete(keys) {
      await Promise.all(keys.map((key) => rm(pathFor(key), { force: true })));
    },
    async read(key) {
      if (!isManagedImageKey(key)) return null;
      try {
        return await readFile(pathFor(key));
      } catch {
        return null;
      }
    },
  };
  return storage;
}
