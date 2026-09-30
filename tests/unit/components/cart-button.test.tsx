import { describe, expect, it } from "vitest";

import { CartButton, cartButtonLabel } from "@/components/store/cart-button";

import { render } from "./render";

describe("cartButtonLabel", () => {
  it.each([
    [0, "Kundvagn, tom"],
    [1, "Kundvagn, 1 artikel"],
    [3, "Kundvagn, 3 artiklar"],
  ])("describes %i items in Swedish", (count, label) => {
    expect(cartButtonLabel(count)).toBe(label);
  });
});

describe("CartButton", () => {
  it("is a labelled button without a badge when the cart is empty", () => {
    const doc = render(<CartButton count={0} />);
    const [button] = doc.elements("button");

    expect(button).toMatchObject({
      type: "button",
      "aria-label": "Kundvagn, tom",
    });
    expect(doc.html).not.toContain("cart-badge");
  });

  it("shows the total quantity in a badge hidden from assistive tech", () => {
    const doc = render(<CartButton count={3} />);
    const badge = doc
      .elements("span")
      .find((span) => span["data-testid"] === "cart-badge");

    expect(badge?.["aria-hidden"]).toBe("true");
    expect(doc.text()).toBe("3");
    expect(doc.elements("button")[0]?.["aria-label"]).toBe(
      "Kundvagn, 3 artiklar",
    );
  });

  it("caps the visual badge but keeps the exact count in the label", () => {
    const doc = render(<CartButton count={120} />);

    expect(doc.text()).toBe("99+");
    expect(doc.elements("button")[0]?.["aria-label"]).toBe(
      "Kundvagn, 120 artiklar",
    );
  });

  it("applies the pulse animation only when requested, respecting reduced motion", () => {
    expect(render(<CartButton count={1} />).html).not.toContain(
      "animate-cart-pulse",
    );
    expect(render(<CartButton count={1} pulse />).html).toContain(
      "motion-safe:animate-cart-pulse",
    );
  });
});
