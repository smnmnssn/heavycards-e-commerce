import { describe, expect, it } from "vitest";

import { infoPages } from "@/lib/config/info-pages";
import {
  customerServiceNavigation,
  footerNavigation,
  isActiveHref,
  primaryNavigation,
} from "@/lib/config/navigation";

describe("primary navigation", () => {
  it("stays intentionally simple (PROJECT.md §9)", () => {
    expect(primaryNavigation.map((item) => item.label)).toEqual([
      "Nyheter",
      "Pokémon TCG",
      "Kommande",
      "Om oss",
    ]);
  });
});

describe("navigation links", () => {
  const allLinks = [
    ...primaryNavigation,
    ...customerServiceNavigation,
    ...footerNavigation.flatMap((group) => group.items),
  ];

  it.each(allLinks.map((item) => [item.label, item.href]))(
    "%s uses a clean lowercase slug URL (%s)",
    (_label, href) => {
      expect(href).toMatch(/^\/[a-z0-9]+(-[a-z0-9]+)*$/);
    },
  );

  it("points every information link at a configured info page", () => {
    const shopPaths = new Set(["/nyheter", "/pokemon-tcg", "/kommande"]);
    for (const { href } of allLinks) {
      if (!shopPaths.has(href)) {
        expect(Object.keys(infoPages)).toContain(href.slice(1));
      }
    }
  });
});

describe("isActiveHref", () => {
  it.each([
    ["/pokemon-tcg", "/pokemon-tcg", true],
    ["/pokemon-tcg/destined-rivals-booster-box", "/pokemon-tcg", true],
    ["/pokemon-tcg-extra", "/pokemon-tcg", false],
    ["/om-oss", "/pokemon-tcg", false],
    ["/", "/", true],
    ["/om-oss", "/", false],
  ])("%s is active for %s: %s", (pathname, href, expected) => {
    expect(isActiveHref(pathname, href)).toBe(expected);
  });
});
