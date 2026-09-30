import "server-only";

import { parseServerEnv } from "./schema";

/**
 * Validated server environment. Parsed once at module load so that an invalid
 * configuration fails the build (during prerendering) or server startup
 * instead of surfacing later in a customer request.
 */
export const env = parseServerEnv(process.env);
