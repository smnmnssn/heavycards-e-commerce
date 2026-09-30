import { useId } from "react";

import { SearchIcon } from "@/components/ui/icons";
import { searchPath } from "@/lib/config/navigation";
import { cn } from "@/lib/utils";

/**
 * Product search entry point: a plain GET form to /sok, so it works without
 * JavaScript. Search results are implemented in Milestone 4.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const inputId = useId();

  return (
    <form
      role="search"
      action={searchPath}
      method="get"
      className={cn("relative", className)}
    >
      <label htmlFor={inputId} className="sr-only">
        Sök produkter
      </label>
      <input
        id={inputId}
        type="search"
        name="q"
        placeholder="Sök produkter"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={100}
        className="h-11 w-full rounded-md border border-input bg-background pr-11 pl-3.5 text-base text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-0 lg:h-10 lg:text-sm"
      />
      <button
        type="submit"
        aria-label="Sök"
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-foreground"
      >
        <SearchIcon className="size-5" />
      </button>
    </form>
  );
}
