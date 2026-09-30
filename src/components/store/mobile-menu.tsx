"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CloseIcon, MenuIcon } from "@/components/ui/icons";

const DESKTOP_QUERY = "(min-width: 64rem)"; // Tailwind `lg`

type MobileMenuProps = {
  /** Server-rendered menu content (links, search). */
  children: ReactNode;
};

/**
 * Mobile navigation drawer on the native modal <dialog>. The browser supplies
 * the hard accessibility parts: focus moves into the dialog, the rest of the
 * page becomes inert, Escape closes it, and focus returns to the menu button
 * on close. This component only wires open/close, so the menu content itself
 * stays server-rendered.
 */
export function MobileMenu({ children }: MobileMenuProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = () => dialogRef.current?.close();

  // Close after client-side navigation (a link in the menu was followed).
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  // Close if the viewport grows to desktop, where the menu button is hidden;
  // otherwise an open modal would leave the page inert with no visible way out.
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) dialogRef.current?.close();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Öppna meny"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        className="inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted lg:hidden"
      >
        <MenuIcon className="size-6" />
      </button>

      <dialog
        ref={dialogRef}
        id="mobile-menu"
        aria-label="Meny"
        data-side="left"
        className="drawer"
        // Fires for every way of closing: button, Escape, backdrop, navigation.
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // Clicks on the backdrop target the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
            <span className="type-eyebrow">Meny</span>
            <button
              type="button"
              aria-label="Stäng meny"
              onClick={close}
              className="inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
            >
              <CloseIcon className="size-6" />
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onClick={(event) => {
              // Following any link in the menu closes it immediately, also
              // when the link points at the current page.
              if ((event.target as HTMLElement).closest("a")) close();
            }}
          >
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
