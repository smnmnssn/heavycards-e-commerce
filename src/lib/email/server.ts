import "server-only";

import { env } from "@/lib/env/server";

import { createEmailTransport } from "./transport";

/** The application's email transport, configured from the environment. */
export const emailTransport = createEmailTransport(env.email, {
  production: env.nodeEnv === "production",
});
