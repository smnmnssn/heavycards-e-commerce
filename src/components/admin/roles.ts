import type { AdminRole } from "@/lib/auth/authorization";

export const ROLE_LABELS: Record<AdminRole, string> = {
  OWNER: "Ägare",
  ADMIN: "Administratör",
};
