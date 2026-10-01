import { resolve } from "node:path";

/** Local image storage of the E2E test server (STORAGE_LOCAL_DIR). */
export const E2E_STORAGE_DIR = resolve(".e2e-storage");

/** Fake Stripe sessions of the E2E test server (FAKE_STRIPE_STATE_DIR). */
export const E2E_STRIPE_STATE_DIR = resolve(".e2e-stripe");

/**
 * Webhook signing secret of the E2E test server. Not a secret: it only
 * exists for the local fake gateway, which is refused on every deployment.
 */
export const E2E_WEBHOOK_SECRET = "whsec_e2e_local_only";
