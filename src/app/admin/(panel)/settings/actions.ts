"use server";

import { refresh, revalidatePath } from "next/cache";

import { canManageStoreSettings } from "@/lib/auth/authorization";
import { db } from "@/lib/db/client";
import {
  storeSettingsFormValues,
  type StoreSettingsFormValues,
} from "@/lib/validation/store-settings";
import {
  runAdminAction,
  type AdminFormState,
} from "@/server/admin/action-guard";
import {
  getStoreSettingsForAdmin,
  updateStoreSettings,
} from "@/server/admin/settings/store-settings";
import { logSafe } from "@/server/logging/safe-log";

/*
 * Store settings (OWNER only, PROJECT.md §50, §57). The session role is
 * checked here and again, inside the transaction, by the service, which
 * also validates every value and writes the audit entry. Affected
 * storefront pages are refreshed afterwards; a failed refresh only delays
 * them by the 60 s ISR window and never fails the save.
 */

export type SettingsSaveState =
  | AdminFormState
  | { status: "success"; message: string; values: StoreSettingsFormValues };

export async function saveStoreSettingsAction(
  values: unknown,
): Promise<SettingsSaveState> {
  return runAdminAction(
    {
      rule: canManageStoreSettings,
      forbidden: "Endast ägare (OWNER) kan ändra butiksinställningarna.",
    },
    async (admin): Promise<SettingsSaveState> => {
      const result = await updateStoreSettings(db, {
        actorId: admin.id,
        input: values,
      });
      if (!result.ok) {
        return result.error === "INVALID_INPUT"
          ? {
              status: "error",
              message: "Kontrollera de markerade fälten.",
              fieldErrors: result.fieldErrors,
            }
          : {
              status: "error",
              message:
                "Inställningarna ändrades samtidigt av någon annan. Ladda om sidan och försök igen.",
            };
      }

      for (const { path, type } of result.revalidate) {
        try {
          revalidatePath(path, type);
        } catch (error) {
          logSafe("admin", "error", "store revalidation failed", { error });
        }
      }
      refresh();
      const saved = await getStoreSettingsForAdmin(db, { actorId: admin.id });
      return {
        status: "success",
        message:
          result.changed.length === 0
            ? "Inga ändringar att spara."
            : result.created
              ? "Butiksinställningarna är skapade. Kassan kan nu användas."
              : "Butiksinställningarna är sparade.",
        values: storeSettingsFormValues(saved),
      };
    },
  );
}
