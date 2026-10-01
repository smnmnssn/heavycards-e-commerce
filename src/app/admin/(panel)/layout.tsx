import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/auth/session";

/**
 * Signed-in admin area. The layout check gives every page the shell and an
 * early redirect, but layouts are not re-run on every navigation, so each
 * page and server action authorizes itself as well.
 */
export default async function AdminPanelLayout({
  children,
}: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return <AdminShell admin={admin}>{children}</AdminShell>;
}
