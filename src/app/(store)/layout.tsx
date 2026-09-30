import { StoreShell } from "@/components/store/store-shell";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return <StoreShell>{children}</StoreShell>;
}
