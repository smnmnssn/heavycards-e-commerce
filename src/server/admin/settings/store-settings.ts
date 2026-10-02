import type { PrismaClient } from "@/generated/prisma/client";
import {
  canManageStoreSettings,
  type AdminRole,
} from "@/lib/auth/authorization";
import {
  storeSettingsData,
  storeSettingsFormSchema,
  type StoreSettingsData,
} from "@/lib/validation/store-settings";
import {
  isUniqueViolation,
  withTransactionRetry,
} from "@/server/db/transactions";

import { assertActiveAdmin, lockActiveAdmin } from "../access";
import { changedFields } from "../catalog/shared";
import { storeSettingsRevalidationTargets } from "./revalidation";
import type { RevalidationTarget } from "../catalog/revalidation";

/*
 * Store settings administration (PROJECT.md §37, §57, §92). One row
 * (id 1). Only an OWNER may change it (canManageStoreSettings); every
 * administrator may read it.
 *
 * A fresh production database has no row: checkout answers "payment
 * unavailable" until the owner saves this form once, which creates it.
 * Every saved change is audited with old and new values; none of these
 * fields is secret.
 */

export const SETTINGS_AUDIT_ACTIONS = {
  updated: "UPDATE_STORE_SETTINGS",
} as const;

const FIELDS = [
  "storeName",
  "contactEmail",
  "companyName",
  "organizationNumber",
  "shippingPriceAmount",
  "freeShippingThresholdAmount",
  "defaultShippingCarrier",
  "vatRateBasisPoints",
  "lowStockThreshold",
  "defaultSeoTitle",
  "defaultSeoDescription",
] as const satisfies ReadonlyArray<keyof StoreSettingsData>;

const SELECT = Object.fromEntries(FIELDS.map((field) => [field, true])) as {
  [K in (typeof FIELDS)[number]]: true;
};

const READ_FORBIDDEN = "Behörighet saknas.";
const WRITE_FORBIDDEN = "Endast ägare (OWNER) kan ändra butiksinställningarna.";

/** Current settings for the admin screen, or null when not configured. */
export async function getStoreSettingsForAdmin(
  db: PrismaClient,
  { actorId }: { actorId: string },
): Promise<StoreSettingsData | null> {
  const anyAdmin = (admin: { role: AdminRole }) =>
    admin.role === "OWNER" || admin.role === "ADMIN";
  await assertActiveAdmin(db, actorId, anyAdmin, READ_FORBIDDEN);
  return db.storeSettings.findUnique({ where: { id: 1 }, select: SELECT });
}

export type UpdateStoreSettingsResult =
  | {
      ok: true;
      /** Fields whose value changed (empty: nothing to save). */
      changed: string[];
      created: boolean;
      /** Storefront pages to refresh. */
      revalidate: RevalidationTarget[];
    }
  | {
      ok: false;
      error: "INVALID_INPUT";
      fieldErrors: Partial<Record<string, string>>;
    }
  | { ok: false; error: "CONFLICT" };

/**
 * Validates and saves the settings form (`input` is untrusted). Throws
 * ForbiddenError unless the actor is an active OWNER, re-checked inside the
 * transaction with the settings row locked.
 */
export async function updateStoreSettings(
  db: PrismaClient,
  { actorId, input }: { actorId: string; input: unknown },
): Promise<UpdateStoreSettingsResult> {
  const parsed = storeSettingsFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, error: "INVALID_INPUT", fieldErrors };
  }
  const next = storeSettingsData(parsed.data);

  try {
    return await withTransactionRetry(() =>
      db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
          await lockActiveAdmin(
            tx,
            actorId,
            canManageStoreSettings,
            WRITE_FORBIDDEN,
          );
          await tx.$queryRaw`SELECT id FROM store_settings WHERE id = 1 FOR UPDATE`;
          const current = await tx.storeSettings.findUnique({
            where: { id: 1 },
            select: SELECT,
          });

          const changes = changedFields(
            current ?? emptySettings(),
            next,
            FIELDS,
          );
          const changed = Object.keys(changes);
          if (current && changed.length === 0) {
            return { ok: true, changed, created: false, revalidate: [] };
          }

          if (current) {
            await tx.storeSettings.update({ where: { id: 1 }, data: next });
          } else {
            await tx.storeSettings.create({ data: { id: 1, ...next } });
          }
          await tx.auditLog.create({
            data: {
              adminUserId: actorId,
              action: SETTINGS_AUDIT_ACTIONS.updated,
              entityType: "StoreSettings",
              entityId: "1",
              metadata: { created: !current, changes },
            },
          });
          return {
            ok: true,
            changed,
            created: !current,
            // A first save changes everything the storefront shows.
            revalidate: storeSettingsRevalidationTargets(
              current ? changed : FIELDS,
            ),
          };
        },
        { maxWait: 10_000, timeout: 20_000 },
      ),
    );
  } catch (error) {
    // Two owners creating the first row at the same moment.
    if (isUniqueViolation(error)) return { ok: false, error: "CONFLICT" };
    throw error;
  }
}

/** Baseline for the audit diff when the row does not exist yet. */
function emptySettings(): StoreSettingsData {
  return {
    storeName: "",
    contactEmail: "",
    companyName: null,
    organizationNumber: null,
    shippingPriceAmount: 0,
    freeShippingThresholdAmount: null,
    defaultShippingCarrier: "POSTNORD",
    vatRateBasisPoints: 0,
    lowStockThreshold: 0,
    defaultSeoTitle: null,
    defaultSeoDescription: null,
  };
}
