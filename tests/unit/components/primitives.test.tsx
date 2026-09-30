import { describe, expect, it } from "vitest";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Logo } from "@/components/store/logo";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

import { render } from "./render";

describe("Button", () => {
  it("defaults to type=button so it never submits forms by accident", () => {
    expect(render(<Button>Spara</Button>).elements("button")[0]?.type).toBe(
      "button",
    );
  });

  it("meets the 44px touch target at the default size", () => {
    expect(buttonClasses()).toContain("h-11");
    expect(buttonClasses({ size: "icon" })).toContain("size-11");
  });

  it("supports full width and drops sizing for the link variant", () => {
    expect(buttonClasses({ fullWidth: true })).toContain("w-full");
    expect(buttonClasses({ variant: "link" })).not.toContain("h-11");
  });
});

describe("Input", () => {
  it("uses 16px text (prevents iOS zoom) and an error style tied to aria-invalid", () => {
    const [input] = render(<Input aria-invalid="true" />).elements("input");

    expect(input?.class).toContain("text-base");
    expect(input?.class).toContain("aria-invalid:border-destructive");
    expect(input?.["aria-invalid"]).toBe("true");
  });
});

describe("Breadcrumbs", () => {
  it("links ancestors and marks the last item as the current page", () => {
    const doc = render(
      <Breadcrumbs
        items={[
          { label: "Hem", href: "/" },
          { label: "Pokémon TCG", href: "/pokemon-tcg" },
          { label: "Destined Rivals Booster Box" },
        ]}
      />,
    );

    expect(doc.elements("nav")[0]?.["aria-label"]).toBe("Brödsmulor");
    expect(doc.elements("a").map((a) => a.href)).toEqual(["/", "/pokemon-tcg"]);
    expect(
      doc.elements("span").find((span) => span["aria-current"] === "page"),
    ).toBeDefined();
  });
});

describe("Logo", () => {
  it("links home with an accessible name and renders the official mark", () => {
    const doc = render(<Logo />);
    const [link] = doc.elements("a");
    const mark = doc
      .elements("span")
      .find((span) => span.class?.includes("brand-mark"));

    expect(link).toMatchObject({
      href: "/",
      "aria-label": "HeavyCards – till startsidan",
    });
    // One SVG source, filled with currentColor via a mask: no raster
    // variants, no <img>, no CSS invert filter.
    expect(doc.elements("img")).toHaveLength(0);
    expect(mark?.["aria-hidden"]).toBe("true");
    expect(mark?.class).toContain("bg-current");
    expect(mark?.style).toContain("/brand/heavycards-mark.svg");
    expect(mark?.style).toContain("aspect-ratio:559 / 684");
    expect(doc.html).not.toContain("invert");
  });
});
