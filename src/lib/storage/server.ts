import "server-only";

import { env } from "@/lib/env/server";

import { createLocalStorage } from "./local";
import type { ObjectStorage } from "./types";
import { createVercelBlobStorage } from "./vercel-blob";

/** Local file storage when it is the configured provider (served by /api/media). */
export const localMediaStore =
  env.storage.provider === "local"
    ? createLocalStorage(env.storage.directory)
    : null;

/** The application's object storage, selected by STORAGE_PROVIDER. */
export const storage: ObjectStorage =
  localMediaStore ??
  createVercelBlobStorage(
    env.storage.provider === "vercel-blob" ? env.storage.blobToken : null,
  );
