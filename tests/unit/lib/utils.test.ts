import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins conditional class names", () => {
    const isActive = false;

    expect(cn("px-2", isActive && "hidden", undefined, "font-bold")).toBe(
      "px-2 font-bold",
    );
  });

  it("lets later Tailwind utilities override conflicting earlier ones", () => {
    expect(cn("px-2 py-1 text-sm", "px-4 text-lg")).toBe("py-1 px-4 text-lg");
  });
});
