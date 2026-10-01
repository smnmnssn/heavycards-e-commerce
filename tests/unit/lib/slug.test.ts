import { describe, expect, it } from "vitest";

import { isValidSlug, slugify } from "@/lib/slug";

describe("slugify", () => {
  it.each([
    ["Destined Rivals Booster Box", "destined-rivals-booster-box"],
    ["Pokémon TCG: Scarlet & Violet", "pokemon-tcg-scarlet-och-violet"],
    ["Åsa Ängel Öland", "asa-angel-oland"],
    ["  --Elite   Trainer Box!!  ", "elite-trainer-box"],
    ["SV10 – Mini Tin (2-pack)", "sv10-mini-tin-2-pack"],
    ["Ünïcødé ñ", "unicode-n"],
    ["!!!", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
    if (expected) expect(isValidSlug(expected)).toBe(true);
  });

  it("cuts to the maximum length without a trailing hyphen", () => {
    const slug = slugify("abc def ".repeat(40), 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(["Abc", "a--b", "-a", "a-", "a b", "å", ""])(
    "rejects %j as a slug",
    (value) => expect(isValidSlug(value)).toBe(false),
  );
});
