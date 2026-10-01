import Link from "next/link";

import { BrandMark } from "@/components/store/brand-mark";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/lib/config/site";

/** Frame for the pages that are reachable without a session. */
export default function AdminAuthLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col bg-surface">
      <header className="border-b border-border bg-background">
        <Container className="flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label={`${siteConfig.brandName} – till startsidan`}
            className="inline-flex items-center py-1"
          >
            <BrandMark className="h-8" />
          </Link>
          <p className="type-eyebrow text-muted-foreground">Admin</p>
        </Container>
      </header>
      <main
        id="innehall"
        className="flex flex-1 justify-center px-4 py-10 sm:py-16"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
