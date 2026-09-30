import type { ReactNode } from "react";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const MAIN_CONTENT_ID = "innehall";

/**
 * Public page frame: skip link, header, main landmark and footer. Used by the
 * (store) layout and by the root not-found page, which renders outside it.
 */
export function StoreShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="fixed top-2 left-2 z-50 -translate-y-24 bg-foreground px-4 py-3 type-nav text-background focus-visible:translate-y-0"
      >
        Hoppa till innehållet
      </a>
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
