import type { ObjectStorage } from "./types";

/** In-memory storage for automated tests; no files or network involved. */
export function createMemoryStorage() {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const storage: ObjectStorage & {
    objects: typeof objects;
    failNextPut: boolean;
  } = {
    provider: "memory",
    objects,
    failNextPut: false,
    async put(key, body, contentType) {
      if (storage.failNextPut) {
        storage.failNextPut = false;
        throw new Error("simulated storage failure");
      }
      if (objects.has(key)) throw new Error(`object exists: ${key}`);
      objects.set(key, { body, contentType });
      return { url: `https://storage.test/${key}` };
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return storage;
}
