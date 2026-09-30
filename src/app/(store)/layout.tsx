import { StoreShell } from "@/components/store/store-shell";

// Store pages without request-time data (e.g. information pages) are served
// from cache and refreshed at most every 60 seconds, so footer details from
// store settings update without a redeploy. Listings that read search
// parameters render per request regardless.
export const revalidate = 60;

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return <StoreShell>{children}</StoreShell>;
}
