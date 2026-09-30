import { describe, expect, it } from "vitest";

import { Price } from "@/components/store/price";
import { ProductCard } from "@/components/store/product-card";

import { render } from "./render";

const product = {
  href: "/pokemon-tcg/destined-rivals-booster-box",
  name: "Destined Rivals Booster Box",
  subtitle: "Destined Rivals",
  priceAmount: 219_900,
};

describe("ProductCard", () => {
  it("links the product name to the product page", () => {
    const doc = render(<ProductCard product={product} />);

    expect(doc.elements("a")).toEqual([
      expect.objectContaining({ href: product.href }),
    ]);
    expect(doc.text()).toContain("Destined Rivals Booster Box");
    expect(doc.text()).toContain("Destined Rivals");
    expect(doc.text()).toMatch(/2\s199\skr/);
  });

  it("renders a decorative placeholder when there is no image", () => {
    const doc = render(<ProductCard product={product} />);

    expect(doc.elements("img")).toHaveLength(0);
    expect(doc.html).toContain('aria-hidden="true"');
  });

  it("renders the image with its alt text and intrinsic size", () => {
    const doc = render(
      <ProductCard
        product={{
          ...product,
          image: {
            src: "/test/booster-box.webp",
            alt: "Destined Rivals Booster Box, framsida",
            width: 1200,
            height: 1200,
          },
        }}
      />,
    );
    const [img] = doc.elements("img");

    expect(img).toMatchObject({
      alt: "Destined Rivals Booster Box, framsida",
      width: "1200",
      height: "1200",
    });
    expect(img?.sizes).toBeTruthy();
  });

  it("shows caller-provided status badges", () => {
    const doc = render(
      <ProductCard
        product={{
          ...product,
          badges: [{ label: "Slutsåld", variant: "muted" }],
          unavailable: true,
        }}
      />,
    );

    expect(doc.text()).toContain("Slutsåld");
  });
});

describe("Price", () => {
  it("announces a sale price and the previous price", () => {
    const doc = render(<Price amount={199_900} compareAtAmount={229_900} />);

    expect(doc.text()).toMatch(/^Nu 1\s999\skr , tidigare 2\s299\skr$/);
    expect(doc.elements("s")).toHaveLength(1);
  });

  it("ignores a compare-at price that is not higher", () => {
    const doc = render(<Price amount={199_900} compareAtAmount={199_900} />);

    expect(doc.elements("s")).toHaveLength(0);
    expect(doc.text()).not.toContain("tidigare");
  });
});
